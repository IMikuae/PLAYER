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

// Ikon SVG inline (sumber tunggal). Konten statis, bukan input user, aman untuk innerHTML.
const SVG_STROKE = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SVG_FILL = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"';
const svgIcon = (attrs, body) => `<svg ${attrs}>${body}</svg>`;
const HEART_PATH = "M12 21s-7.5-4.6-9.5-9A5.2 5.2 0 0 1 12 6.3 5.2 5.2 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z";
const ICONS = {
  play: svgIcon(SVG_FILL, '<path d="M7 4.5v15l12.5-7.5z"/>'),
  pause: svgIcon(SVG_FILL, '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  prev: svgIcon(SVG_FILL, '<rect x="5" y="5" width="2.5" height="14"/><path d="M19 5v14L8.5 12z"/>'),
  next: svgIcon(SVG_FILL, '<path d="M5 5v14l10.5-7z"/><rect x="16.5" y="5" width="2.5" height="14"/>'),
  shuffle: svgIcon(SVG_STROKE, '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>'),
  repeat: svgIcon(SVG_STROKE, '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  volume: svgIcon(SVG_STROKE, '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  volumeOff: svgIcon(SVG_STROKE, '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  themeAuto: svgIcon(SVG_STROKE, '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  themeLight: svgIcon(SVG_STROKE, '<circle cx="12" cy="12" r="9" fill="currentColor"/>'),
  themeDark: svgIcon(SVG_STROKE, '<circle cx="12" cy="12" r="9"/>'),
  heart: svgIcon(SVG_FILL, `<path d="${HEART_PATH}"/>`),
  heartOff: svgIcon(SVG_STROKE, `<path d="${HEART_PATH}"/>`),
  arrowUp: svgIcon(SVG_STROKE, '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  arrowDown: svgIcon(SVG_STROKE, '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  close: svgIcon(SVG_STROKE, '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
};

function renderStaticIcons() {
  shuffleBtn.innerHTML = ICONS.shuffle;
  prevBtn.innerHTML = ICONS.prev;
  nextBtn.innerHTML = ICONS.next;
  playBtn.innerHTML = ICONS.play;
  repeatBtn.insertAdjacentHTML("afterbegin", ICONS.repeat);
}

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
  const BIG = 50 * 1024 * 1024;
  if (list.some((f) => f.size > BIG) && !confirm("Ada file lebih dari 50 MB. Pemutaran di ponsel lama bisa lambat. Lanjutkan?")) return;
  let added = 0;
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
    try {
      await saveTrack(rec);
    } catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));
      toast(quota ? "Penyimpanan penuh. Hapus lagu lain dulu." : "Gagal menyimpan lagu");
      break;
    }
    rec.objectUrl = URL.createObjectURL(rec.blob);
    playlist.push(rec);
    added++;
  }
  sortPlaylist();
  renderPlaylist();
  updateControls();
  persistLast();
  if (added) toast(`${added} lagu ditambahkan, tersimpan offline`);
  updateStorage();
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
  const reorderableNow = filter === "all" && !searchInput.value.trim();
  const hintEl = document.getElementById("reorderHint");
  if (hintEl) {
    hintEl.textContent = reorderableNow || !playlist.length || !vis.length ? "" : "Urutan hanya bisa diubah di filter Semua tanpa pencarian.";
  }
  if (!vis.length) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = playlist.length
      ? "Tidak cocok dengan filter/pencarian."
      : "Daftar putar kosong. Klik \"+ Tambah\" atau drag-drop file audio.";
    trackListEl.appendChild(div);
    return;
  }
  const reorderable = reorderableNow;
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
      thumb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true" focusable="false"><path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
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
    fav.innerHTML = t.fav ? ICONS.heart : ICONS.heartOff;
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
    del.innerHTML = ICONS.close;
    del.title = "Hapus";
    del.setAttribute("aria-label", "Hapus lagu");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteTrack(gi);
    });

    if (reorderable) {
      const up = document.createElement("button");
      up.className = "mini-btn";
      up.innerHTML = ICONS.arrowUp;
      up.title = "Naikkan";
      up.setAttribute("aria-label", "Naikkan urutan");
      up.disabled = gi === 0;
      up.addEventListener("click", (e) => { e.stopPropagation(); moveTrack(gi, -1); });
      const down = document.createElement("button");
      down.className = "mini-btn";
      down.innerHTML = ICONS.arrowDown;
      down.title = "Turunkan";
      down.setAttribute("aria-label", "Turunkan urutan");
      down.disabled = gi === playlist.length - 1;
      down.addEventListener("click", (e) => { e.stopPropagation(); moveTrack(gi, 1); });
      acts.append(up, down);
    }
    acts.append(fav, del);
    row.append(thumb, det, acts);
    row.addEventListener("click", () => { loadTrack(gi, false); playTrack(); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { loadTrack(gi, false); playTrack(); }
    });
    trackListEl.appendChild(row);
  }
}

let pendingDelete = null;

async function deleteTrack(globalIndex) {
  const t = playlist[globalIndex];
  if (!t) return;
  if (!confirm(`Hapus "${t.name}" dari antrean dan penyimpanan?`)) return;
  // Hapus tertunda 5 detik agar bisa dibatalkan. Lagu disembunyikan dulu dari antrean.
  if (pendingDelete) await commitPendingDelete();
  playlist.splice(globalIndex, 1);
  pendingDelete = { track: t, index: globalIndex, timer: null };
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
  pendingDelete.timer = setTimeout(commitPendingDelete, 5000);
  showUndoToast(t.name);
}

function showUndoToast(name) {
  const el = document.getElementById("toast");
  el.innerHTML = "";
  const msg = document.createElement("span");
  msg.textContent = `"${name}" dihapus. `;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "toast-undo";
  undo.textContent = "Batalkan";
  undo.addEventListener("click", undoPendingDelete);
  el.append(msg, undo);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 5200);
}

function undoPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  const { track, index } = pendingDelete;
  pendingDelete = null;
  const at = Math.min(index, playlist.length);
  playlist.splice(at, 0, track);
  if (currentIndex >= at) currentIndex++;
  renderPlaylist();
  updateControls();
  persistLast();
  toast("Dibatalkan");
}

async function commitPendingDelete() {
  if (!pendingDelete) return;
  const { track } = pendingDelete;
  clearTimeout(pendingDelete.timer);
  pendingDelete = null;
  revokeTrack(track);
  try { await removeTrack(track.id); } catch { toast("Gagal menghapus dari penyimpanan"); }
  updateStorage();
}

// ---------- load / play ----------
function resetInfo() {
  songTitle.textContent = "Belum Ada Lagu";
  songArtist.textContent = 'Pilih "+ Tambah"';
  songMeta.textContent = "";
  playBtn.innerHTML = ICONS.play;
  albumArt.classList.remove("playing");
  progressFill.style.width = "0%";
  currentTimeEl.textContent = "0:00";
  totalTimeEl.textContent = "0:00";
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

function loadTrack(gi, autoplay = true, fromHistory = false) {
  const t = playlist[gi];
  if (!t) return;
  if (!fromHistory && currentIndex >= 0 && currentIndex !== gi) {
    playHistory.push(currentIndex);
    if (playHistory.length > 200) playHistory.shift();
  }
  currentIndex = gi;
  audio.src = t.objectUrl;
  audio.playbackRate = settings.rate || 1;
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

async function playTrack() {
  if (currentIndex < 0 && playlist.length) loadTrack(0, false);
  if (currentIndex < 0) return;
  try {
    await audio.play();
    isPlaying = true;
    playBtn.innerHTML = ICONS.pause;
    playBtn.setAttribute("aria-label", "Pause");
    albumArt.classList.add("playing");
  } catch (e) {
    toast("Gagal memutar: " + (e.message || e));
  }
}

function pauseTrack() {
  audio.pause();
  isPlaying = false;
  playBtn.innerHTML = ICONS.play;
  playBtn.setAttribute("aria-label", "Play");
  albumArt.classList.remove("playing");
  persistLast();
}

// Riwayat putar untuk tombol prev saat shuffle (tidak disimpan ke storage, cukup per sesi).
const playHistory = [];

function pickNext(step) {
  if (!playlist.length) return -1;
  if (settings.shuffle) {
    if (step < 0) {
      // Prev di shuffle: kembali ke lagu yang benar-benar diputar sebelumnya.
      while (playHistory.length) {
        const prev = playHistory.pop();
        if (prev < playlist.length && prev !== currentIndex) return prev;
      }
      return -1;
    }
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
  muteBtn.innerHTML = settings.muted || settings.volume === 0 ? ICONS.volumeOff : ICONS.volume;
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
    rate: settings.rate,
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
  if (settings.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  $("themeBtn").innerHTML = settings.theme === "dark" ? ICONS.themeDark : settings.theme === "light" ? ICONS.themeLight : ICONS.themeAuto;
  $("themeBtn").title = `Tema: ${settings.theme} (klik untuk ganti)`;
}

// ---------- events ----------
playBtn.addEventListener("click", () => (isPlaying ? pauseTrack() : playTrack()));
nextBtn.addEventListener("click", () => { const n = pickNext(1); if (n >= 0) { loadTrack(n, false); playTrack(); } });
prevBtn.addEventListener("click", () => { const n = pickNext(-1); if (n >= 0) { loadTrack(n, false, settings.shuffle); playTrack(); } });

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
  resetInfo(); renderPlaylist(); updateControls(); persistLast(); updateStorage();
});

document.querySelectorAll(".tab-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((x) => {
      x.classList.remove("active");
      x.setAttribute("aria-selected", "false");
    });
    b.classList.add("active");
    b.setAttribute("aria-selected", "true");
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

// ---------- kecepatan, timer tidur, penyimpanan, urutan, layar kunci ----------
const storageInfo = $("storageInfo");
const rateSelect = $("rateSelect");
const sleepSelect = $("sleepSelect");
let sleepTimer = null;

const fmtSize = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);

async function updateStorage() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) { storageInfo.textContent = ""; return; }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    storageInfo.textContent = quota ? `Penyimpanan terpakai ${fmtSize(usage)} dari ${fmtSize(quota)}` : "";
  } catch { storageInfo.textContent = ""; }
}

rateSelect.addEventListener("change", () => {
  settings.rate = parseFloat(rateSelect.value) || 1;
  audio.playbackRate = settings.rate;
  saveSettings({ rate: settings.rate });
});

// Timer tidur hanya di memori: tidak disimpan, sengaja reset saat halaman ditutup.
function setSleep(min) {
  clearTimeout(sleepTimer);
  sleepTimer = null;
  if (min > 0) {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      sleepSelect.value = "0";
      pauseTrack();
      toast("Timer tidur selesai, musik dihentikan");
    }, min * 60000);
    toast(`Musik berhenti otomatis dalam ${min} menit`);
  } else {
    toast("Timer tidur dimatikan");
  }
}
sleepSelect.addEventListener("change", () => setSleep(parseInt(sleepSelect.value, 10) || 0));

// Urutan disimpan dengan menukar addedAt dua lagu bertetangga (sortPlaylist memakai addedAt).
function moveTrack(gi, dir) {
  const j = gi + dir;
  if (j < 0 || j >= playlist.length) return;
  const a = playlist[gi];
  const b = playlist[j];
  [a.addedAt, b.addedAt] = [b.addedAt, a.addedAt];
  if (currentIndex === gi) currentIndex = j;
  else if (currentIndex === j) currentIndex = gi;
  sortPlaylist();
  renderPlaylist();
  Promise.all([saveTrack({ ...a, objectUrl: undefined }), saveTrack({ ...b, objectUrl: undefined })])
    .catch(() => toast("Gagal menyimpan urutan"));
  persistLast();
}

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch {}
}
audio.addEventListener("timeupdate", updatePositionState);
audio.addEventListener("loadedmetadata", updatePositionState);
audio.addEventListener("ratechange", updatePositionState);

if ("mediaSession" in navigator) {
  const setMediaAction = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  };
  const seekBy = (sec) => { audio.currentTime = clamp(audio.currentTime + sec, 0, audio.duration || 0); };
  setMediaAction("seekbackward", (d) => seekBy(-(d.seekOffset || 10)));
  setMediaAction("seekforward", (d) => seekBy(d.seekOffset || 10));
  setMediaAction("seekto", (d) => { if (typeof d.seekTime === "number") audio.currentTime = d.seekTime; });
}

// ---------- init ----------
async function init() {
  renderStaticIcons();
  applyTheme();
  rateSelect.value = String(settings.rate || 1);
  audio.playbackRate = settings.rate || 1;
  updateStorage();
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
