import { formatTime, stripExtension, uid, clamp, toast } from "./utils.js";
import { allTracks, saveTrack, removeTrack, clearTracks, loadSettings, saveSettings } from "./store.js";

const $ = (id) => document.getElementById(id);
const audio = $("audioPlayer");
const fileInput = $("fileInput");
const trackListEl = $("trackList");
const playBtn = $("playBtn");
const prevBtn = $("prevBtn");
const nextBtn = $("nextBtn");
const shuffleBtn = $("shuffleBtn");
const repeatBtn = $("repeatBtn");
const repeatLabel = $("repeatLabel");
const volumeSlider = $("volumeSlider");
const muteBtn = $("muteBtn");
const songTitle = $("songTitle");
const songArtist = $("songArtist");
const songMeta = $("songMeta");
const albumArt = $("albumArt");
const progressBar = $("progressBar");
const progressFill = $("progressFill");
const currentTimeEl = $("currentTime");
const totalTimeEl = $("totalTime");
const searchInput = $("searchInput");
const countLabel = $("countLabel");
const dropOverlay = $("dropOverlay");

let settings = loadSettings();
let playlist = []; // {id,name,artist,album,fav,mime,blob,coverUrl,objectUrl,duration}
let currentIndex = -1;
let isPlaying = false;
let filter = "all"; // all | fav | audio
let query = "";

// ---------- metadata ----------
function readTags(file) {
  return new Promise((resolve) => {
    try {
      if (!window.jsmediatags) return resolve({});
      window.jsmediatags.read(file, {
        onSuccess: (tag) => resolve(tag.tags || {}),
        onError: () => resolve({}),
      });
    } catch { resolve({}); }
  });
}

function tagsToRecord(file, tags) {
  let coverUrl = null;
  try {
    const pic = tags.picture;
    if (pic && pic.data) {
      let b64 = "";
      const d = pic.data;
      for (let i = 0; i < d.length; i++) b64 += String.fromCharCode(d[i]);
      coverUrl = `data:${pic.format || "image/jpeg"};base64,${btoa(b64)}`;
    }
  } catch {}
  return {
    name: tags.title || stripExtension(file.name),
    artist: tags.artist || "Lokal Audio",
    album: tags.album || "",
    coverUrl,
  };
}

// ---------- object urls ----------
function revokeTrack(t) {
  try { if (t && t.objectUrl) URL.revokeObjectURL(t.objectUrl); } catch {}
}

// ---------- files -> store ----------
async function addFiles(files) {
  const list = Array.from(files || []).filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|opus|flac|aac)$/i.test(f.name));
  if (!list.length) { toast("Tidak ada file audio valid"); return; }
  for (const file of list) {
    const tags = await readTags(file);
    const meta = tagsToRecord(file, tags);
    const rec = {
      id: uid(),
      name: meta.name,
      artist: meta.artist,
      album: meta.album,
      fav: false,
      mime: file.type || "audio/*",
      blob: file,
      coverUrl: meta.coverUrl,
      addedAt: Date.now(),
    };
    await saveTrack(rec);
    rec.objectUrl = URL.createObjectURL(rec.blob);
    playlist.push(rec);
  }
  sortPlaylist();
  renderPlaylist();
  updateControls();
  persistLast();
  toast(`${list.length} lagu ditambahkan, tersimpan offline`);
  if (currentIndex === -1 && playlist.length) loadTrack(0, false);
  else renderPlaylist();
}

function sortPlaylist() {
  playlist.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

// ---------- filtering ----------
function visibleTracks() {
  const q = query.trim().toLowerCase();
  return playlist
    .map((t, gi) => ({ t, gi }))
    .filter(({ t }) => {
      if (filter === "fav" && !t.fav) return false;
      if (filter === "audio" && !(t.mime || "").startsWith("audio/")) return false;
      if (q && !(`${t.name} ${t.artist} ${t.album}`.toLowerCase().includes(q))) return false;
      return true;
    });
}

// ---------- render (XSS-safe: textContent) ----------
function renderPlaylist() {
  trackListEl.innerHTML = "";
  const vis = visibleTracks();
  countLabel.textContent = vis.length ? `${vis.length} lagu` : "";
  if (!vis.length) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = playlist.length
      ? "Tidak cocok dengan filter/pencarian."
      : "Daftar putar kosong. Klik \"+ Tambah\" atau drag-drop file audio.";
    trackListEl.appendChild(div);
    return;
  }
  for (const { t, gi } of vis) {
    const row = document.createElement("div");
    row.className = `track${gi === currentIndex ? " active" : ""}`;
    row.setAttribute("role", "option");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", gi === currentIndex ? "true" : "false");

    const thumb = document.createElement("div");
    thumb.className = "track-thumb";
    if (t.coverUrl) {
      const img = document.createElement("img");
      img.src = t.coverUrl;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.textContent = "🎵";
    }

    const det = document.createElement("div");
    det.className = "track-details";
    const nm = document.createElement("div");
    nm.className = "track-name";
    nm.textContent = t.name;
    const ar = document.createElement("div");
    ar.className = "track-artist";
    ar.textContent = t.artist + (t.album ? ` • ${t.album}` : "");
    det.append(nm, ar);

    const acts = document.createElement("div");
    acts.className = "track-actions";

    const fav = document.createElement("button");
    fav.className = "mini-btn" + (t.fav ? " fav-on" : "");
    fav.textContent = t.fav ? "♥" : "♡";
    fav.title = "Favorit (L)";
    fav.setAttribute("aria-label", "Toggle favorit");
    fav.addEventListener("click", async (e) => {
      e.stopPropagation();
      t.fav = !t.fav;
      await saveTrack({ ...t, objectUrl: undefined, blob: t.blob });
      renderPlaylist();
    });

    const del = document.createElement("button");
    del.className = "mini-btn danger";
    del.textContent = "✕";
    del.title = "Hapus";
    del.setAttribute("aria-label", "Hapus lagu");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteTrack(gi);
    });

    acts.append(fav, del);
    row.append(thumb, det, acts);
    row.addEventListener("click", () => { loadTrack(gi, false); playTrack(); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { loadTrack(gi, false); playTrack(); }
    });
    trackListEl.appendChild(row);
  }
}

async function deleteTrack(globalIndex) {
  const t = playlist[globalIndex];
  if (!t) return;
  revokeTrack(t);
  await removeTrack(t.id);
  playlist.splice(globalIndex, 1);
  if (globalIndex === currentIndex) {
    audio.pause();
    isPlaying = false;
    currentIndex = -1;
    audio.removeAttribute("src");
    resetInfo();
  } else if (globalIndex < currentIndex) {
    currentIndex--;
  }
  renderPlaylist();
  updateControls();
  persistLast();
}

// ---------- load / play ----------
function resetInfo() {
  songTitle.textContent = "Belum Ada Lagu";
  songArtist.textContent = 'Pilih "+ Tambah"';
  songMeta.textContent = "";
  playBtn.innerHTML = "▶";
  albumArt.classList.remove("playing");
  progressFill.style.width = "0%";
  currentTimeEl.textContent = "0:00";
  totalTimeEl.textContent = "0:00";
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

function loadTrack(gi, autoplay = true) {
  const t = playlist[gi];
  if (!t) return;
  if (currentIndex !== gi) revokeNothing();
  currentIndex = gi;
  audio.src = t.objectUrl;
  songTitle.textContent = t.name;
  songArtist.textContent = t.artist;
  songMeta.textContent = t.album || t.mime || "";
  albumArt.src = t.coverUrl || "assets/icon.svg";
  renderPlaylist();
  updateControls();
  updateMediaSession(t);
  const resume = settings.lastTrackId === t.id ? settings.lastTime : 0;
  audio.currentTime = 0;
  if (resume > 1) {
    audio.addEventListener("loadedmetadata", function once() {
      try { audio.currentTime = Math.min(resume, (audio.duration || resume + 1) - 1); } catch {}
      audio.removeEventListener("loadedmetadata", once);
    });
  }
  persistLast();
  if (autoplay) playTrack();
}
function revokeNothing() {}

async function playTrack() {
  if (currentIndex < 0 && playlist.length) loadTrack(0, false);
  if (currentIndex < 0) return;
  try {
    await audio.play();
    isPlaying = true;
    playBtn.innerHTML = "⏸";
    playBtn.setAttribute("aria-label", "Pause");
    albumArt.classList.add("playing");
  } catch (e) {
    toast("Gagal memutar: " + (e.message || e));
  }
}

function pauseTrack() {
  audio.pause();
  isPlaying = false;
  playBtn.innerHTML = "▶";
  playBtn.setAttribute("aria-label", "Play");
  albumArt.classList.remove("playing");
  persistLast();
}

function pickNext(step) {
  if (!playlist.length) return -1;
  if (settings.shuffle) {
    if (playlist.length === 1) return 0;
    let n = currentIndex;
    while (n === currentIndex) n = Math.floor(Math.random() * playlist.length);
    return n;
  }
  let n = currentIndex + step;
  if (n >= playlist.length) n = 0;
  if (n < 0) n = playlist.length - 1;
  return n;
}

function updateControls() {
  const has = playlist.length > 0;
  playBtn.disabled = !has;
  prevBtn.disabled = !has;
  nextBtn.disabled = !has;
  shuffleBtn.classList.toggle("active", !!settings.shuffle);
  shuffleBtn.setAttribute("aria-pressed", String(!!settings.shuffle));
  repeatLabel.textContent = settings.repeat === "one" ? "1" : settings.repeat === "all" ? "∞" : "";
  repeatBtn.classList.toggle("active", settings.repeat !== "off");
  volumeSlider.value = String(settings.muted ? 0 : settings.volume);
  muteBtn.textContent = settings.muted || settings.volume === 0 ? "🔇" : "🔊";
  audio.volume = settings.muted ? 0 : settings.volume;
}

function persistLast() {
  const t = playlist[currentIndex];
  saveSettings({
    lastTrackId: t ? t.id : null,
    lastTime: audio.currentTime || 0,
    volume: settings.volume,
    muted: settings.muted,
    shuffle: settings.shuffle,
    repeat: settings.repeat,
    theme: settings.theme,
  });
}

function updateMediaSession(t) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.name,
      artist: t.artist,
      album: t.album || "Local Player",
      artwork: t.coverUrl ? [{ src: t.coverUrl, sizes: "512x512", type: "image/jpeg" }] : [{ src: "assets/icon.svg", sizes: "any", type: "image/svg+xml" }],
    });
  } catch {}
}

// ---------- seek (pointer-safe, bukan offsetX) ----------
function seekFromEvent(e) {
  if (!playlist.length || !isFinite(audio.duration)) return;
  const rect = progressBar.getBoundingClientRect();
  const x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - rect.left;
  const ratio = clamp(x / rect.width, 0, 1);
  audio.currentTime = ratio * audio.duration;
}

// ---------- theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === "auto" ? "" : settings.theme;
  if (settings.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  $("themeBtn").textContent = settings.theme === "dark" ? "☀" : settings.theme === "light" ? "🌙" : "◐";
  $("themeBtn").title = `Tema: ${settings.theme} (klik untuk ganti)`;
}

// ---------- events ----------
playBtn.addEventListener("click", () => (isPlaying ? pauseTrack() : playTrack()));
nextBtn.addEventListener("click", () => { const n = pickNext(1); if (n >= 0) { loadTrack(n, false); playTrack(); } });
prevBtn.addEventListener("click", () => { const n = pickNext(-1); if (n >= 0) { loadTrack(n, false); playTrack(); } });

shuffleBtn.addEventListener("click", () => {
  settings.shuffle = !settings.shuffle;
  saveSettings({ shuffle: settings.shuffle });
  updateControls();
});

repeatBtn.addEventListener("click", () => {
  settings.repeat = settings.repeat === "off" ? "all" : settings.repeat === "all" ? "one" : "off";
  saveSettings({ repeat: settings.repeat });
  updateControls();
});

volumeSlider.addEventListener("input", () => {
  settings.volume = parseFloat(volumeSlider.value);
  settings.muted = settings.volume === 0 ? true : false;
  if (settings.volume > 0) settings.muted = false;
  saveSettings({ volume: settings.volume, muted: settings.muted });
  updateControls();
});
muteBtn.addEventListener("click", () => {
  settings.muted = !settings.muted;
  saveSettings({ muted: settings.muted });
  updateControls();
});

audio.addEventListener("ended", () => {
  if (settings.repeat === "one") { audio.currentTime = 0; playTrack(); return; }
  if (settings.repeat === "off" && !settings.shuffle && currentIndex === playlist.length - 1) { pauseTrack(); return; }
  const n = pickNext(1);
  if (n >= 0) { loadTrack(n, false); playTrack(); }
});

audio.addEventListener("timeupdate", () => {
  if (!isFinite(audio.duration)) return;
  progressFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  currentTimeEl.textContent = formatTime(audio.currentTime);
  totalTimeEl.textContent = formatTime(audio.duration);
});

audio.addEventListener("loadedmetadata", () => {
  totalTimeEl.textContent = formatTime(audio.duration);
});

audio.addEventListener("error", () => {
  toast("File audio rusak / tidak bisa diputar");
  pauseTrack();
});

let scrubbing = false;
progressBar.addEventListener("pointerdown", (e) => { scrubbing = true; progressBar.setPointerCapture(e.pointerId); seekFromEvent(e); });
progressBar.addEventListener("pointermove", (e) => { if (scrubbing) seekFromEvent(e); });
progressBar.addEventListener("pointerup", () => { scrubbing = false; persistLast(); });
progressBar.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") audio.currentTime = clamp(audio.currentTime + 5, 0, audio.duration || 0);
  if (e.key === "ArrowLeft") audio.currentTime = clamp(audio.currentTime - 5, 0, audio.duration || 0);
});
setInterval(() => { if (isPlaying) persistLast(); }, 5000);

$("addMusicBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { addFiles(e.target.files); fileInput.value = ""; });

$("clearBtn").addEventListener("click", async () => {
  if (!playlist.length) return;
  if (!confirm("Hapus semua lagu tersimpan?")) return;
  playlist.forEach(revokeTrack);
  await clearTracks();
  playlist = [];
  currentIndex = -1;
  audio.pause();
  audio.removeAttribute("src");
  resetInfo(); renderPlaylist(); updateControls(); persistLast();
});

document.querySelectorAll(".tab-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    filter = b.dataset.filter;
    renderPlaylist();
  });
});

let searchT = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { query = searchInput.value; renderPlaylist(); }, 150);
});

$("themeBtn").addEventListener("click", () => {
  settings.theme = settings.theme === "auto" ? "light" : settings.theme === "light" ? "dark" : "auto";
  saveSettings({ theme: settings.theme });
  applyTheme(); persistLast();
});

// drag & drop
["dragenter", "dragover"].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); dropOverlay.classList.add("show"); }));
["dragleave", "drop"].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev !== "drop" && e.relatedTarget) return; dropOverlay.classList.remove("show"); }));
window.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

// keyboard
window.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
  if (typing) return;
  if (e.code === "Space") { e.preventDefault(); isPlaying ? pauseTrack() : playTrack(); }
  else if (e.key === "ArrowRight" && e.target === document.body) audio.currentTime = clamp(audio.currentTime + 5, 0, audio.duration || 0);
  else if (e.key === "ArrowLeft" && e.target === document.body) audio.currentTime = clamp(audio.currentTime - 5, 0, audio.duration || 0);
  else if (e.key === "n" || e.key === "N") nextBtn.click();
  else if (e.key === "p" || e.key === "P") prevBtn.click();
  else if (e.key === "m" || e.key === "M") muteBtn.click();
  else if (e.key === "l" || e.key === "L") {
    const t = playlist[currentIndex];
    if (t) { t.fav = !t.fav; saveTrack({ ...t, objectUrl: undefined, blob: t.blob }); renderPlaylist(); }
  }
});

// media keys
if ("mediaSession" in navigator) {
  try {
    navigator.mediaSession.setActionHandler("play", playTrack);
    navigator.mediaSession.setActionHandler("pause", pauseTrack);
    navigator.mediaSession.setActionHandler("previoustrack", () => prevBtn.click());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextBtn.click());
  } catch {}
}

// ---------- init ----------
async function init() {
  applyTheme();
  updateControls();
  resetInfo();
  try {
    const recs = await allTracks();
    playlist = recs.map((r) => ({ ...r, objectUrl: URL.createObjectURL(r.blob) }));
    sortPlaylist();
    renderPlaylist();
    updateControls();
    if (playlist.length) {
      const idx = Math.max(0, playlist.findIndex((t) => t.id === settings.lastTrackId));
      loadTrack(idx >= 0 ? idx : 0, false);
      pauseTrack();
    }
  } catch (e) {
    console.warn(e);
    toast("IndexedDB tidak tersedia, playlist tidak persist");
  }
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }
}
init();
