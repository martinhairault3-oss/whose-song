const socket = io();
const $ = (id) => document.getElementById(id);
// WAV valide minimal (44 bytes) pour debloquer l'audio sur mobile
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let me = { playerId: null };
let st = null;
let audio = new Audio();
audio.preload = 'auto';
let audioUnlocked = false;
let currentRound = -1;
let picked = null;
let voteSent = false;
let myResult = null;
let artistSent = false;
let artistResult = null;
let titleSent = false;
let scheduleTimers = [];
let spotifyAvailable = false;

// ---------- auto-reconnexion ----------
let rejoinPending = false;
function tryAutoRejoin() {
  const savedRoom = sessionStorage.getItem('ws_room');
  const savedPlayerId = sessionStorage.getItem('ws_playerId');
  if (!savedRoom || !savedPlayerId || !socket.connected || rejoinPending) return;
  rejoinPending = true;
  socket.emit('room:rejoin', { code: savedRoom, playerId: savedPlayerId }, (res) => {
    rejoinPending = false;
    if (res && res.ok) { me.playerId = res.playerId; }
    else { sessionStorage.removeItem('ws_room'); sessionStorage.removeItem('ws_playerId'); }
  });
}
socket.on('connect', tryAutoRejoin);
socket.on('disconnect', () => { rejoinPending = false; toast('Connexion perdue, reconnexion…'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (socket.disconnected) socket.connect();
    tryAutoRejoin(); setTimeout(tryAutoRejoin, 500); setTimeout(tryAutoRejoin, 2000);
    try { if (audio && audio.paused && st && st.phase === 'playing' && st.round && st.round.type === 'roulette') audio.play().catch(() => {}); } catch {}
  }
});

// ---------- utilitaires UI ----------
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); }
const myPlayer = () => st && st.players.find(p => p.id === me.playerId);
const isHost = () => st && st.hostId === me.playerId;
const playerName = (id) => { const p = st && st.players.find(x => x.id === id); return p ? p.name : '?'; };
const playerLabel = (id) => { const p = st && st.players.find(x => x.id === id); return p ? `${p.avatar} ${p.name}` : '?'; };
function clearTimers() { scheduleTimers.forEach(clearTimeout); scheduleTimers = []; }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- Spotify ----------
fetch('/auth/spotify/check').then(r => r.json()).then(d => { spotifyAvailable = d.available; }).catch(() => {});
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'spotify-connected') toast('Connecté à Spotify ✓'); });

// ---------- accueil ----------
$('btn-create').onclick = () => {
  const name = $('home-name').value.trim(); if (!name) return toast('Choisis un pseudo.');
  socket.emit('room:create', { name }, (res) => { if (res && res.ok) { me.playerId = res.playerId; sessionStorage.setItem('ws_room', res.code); sessionStorage.setItem('ws_playerId', res.playerId); } });
};
$('btn-join').onclick = () => {
  const name = $('home-name').value.trim(); const code = $('home-code').value.trim().toUpperCase();
  if (!name) return toast('Choisis un pseudo.'); if (code.length !== 4) return toast('Le code fait 4 lettres.');
  socket.emit('room:join', { code, name }, (res) => { if (res && res.ok) { me.playerId = res.playerId; sessionStorage.setItem('ws_room', res.code); sessionStorage.setItem('ws_playerId', res.playerId); } else toast(res && res.error || 'Impossible de rejoindre.'); });
};

// ---------- lobby ----------
$('btn-copy').onclick = (e) => { e.stopPropagation(); if (st) navigator.clipboard?.writeText(st.code).then(() => toast('Code copié : ' + st.code)); };

// saved playlists
function getSavedPlaylists() { try { return JSON.parse(localStorage.getItem('saved_playlists') || '[]'); } catch { return []; } }
function savePlaylists(list) { try { localStorage.setItem('saved_playlists', JSON.stringify(list)); } catch {} }
function savePlaylistData(name, url, tracks) {
  const list = getSavedPlaylists(); const existing = list.findIndex(p => p.url === url);
  const entry = { name, url, tracks: tracks.map(t => ({ title: t.title, artist: t.artist, preview: t.preview, cover: t.cover, deezerId: t.deezerId })), savedAt: Date.now() };
  if (existing >= 0) list[existing] = entry; else list.push(entry); savePlaylists(list);
}
function removeSavedPlaylist(url) { savePlaylists(getSavedPlaylists().filter(p => p.url !== url)); }
function loadSavedPlaylist(entry) { socket.emit('playlist:load', { name: entry.name, tracks: entry.tracks }, (res) => { if (res && res.ok) { $('pl-status').textContent = `« ${res.name} » : +${res.added} morceaux (total ${res.total}).`; renderSavedPlaylists(); } else toast(res && res.error || 'Erreur.'); }); }
function renderSavedPlaylists() {
  const box = $('saved-playlists'); if (!box) return; const list = getSavedPlaylists();
  if (list.length === 0) { box.style.display = 'none'; return; }
  box.style.display = 'flex'; const container = $('saved-list'); container.innerHTML = '';
  for (const entry of list) {
    const row = document.createElement('div'); row.className = 'saved-row';
    row.innerHTML = `<span class="saved-name">🎵 ${escapeHtml(entry.name)} <span class="small">(${entry.tracks.length})</span></span>`;
    const btns = document.createElement('span'); btns.className = 'saved-btns';
    const load = document.createElement('button'); load.className = 'btn-ghost saved-btn'; load.textContent = 'Charger'; load.onclick = () => loadSavedPlaylist(entry);
    const del = document.createElement('button'); del.className = 'kick-btn'; del.textContent = '✕'; del.onclick = () => { removeSavedPlaylist(entry.url); renderSavedPlaylists(); };
    btns.appendChild(load); btns.appendChild(del); row.appendChild(btns); container.appendChild(row);
  }
}

let lastImportUrl = '';
$('btn-add-pl').onclick = () => {
  const url = $('pl-url').value.trim(); if (!url) return; lastImportUrl = url;
  $('btn-add-pl').disabled = true; $('pl-status').textContent = 'Import en cours…';
  socket.emit('playlist:add', { url }, (res) => {
    $('btn-add-pl').disabled = false;
    if (res && res.ok) { $('pl-url').value = ''; let msg = `« ${res.name} » : +${res.added} morceaux (total ${res.total}).`; if (res.requested && res.matched < res.requested) msg += ` ${res.matched}/${res.requested} trouvés sur Deezer.`; $('pl-status').textContent = msg; if (res.added > 0 && lastImportUrl && res.savedTracks) { savePlaylistData(res.name, lastImportUrl, res.savedTracks); renderSavedPlaylists(); } }
    else { $('pl-status').textContent = res && res.error || 'Import impossible.'; toast(res && res.error || 'Import impossible.'); }
  });
};
$('set-rounds').onchange = () => socket.emit('settings:update', { rounds: parseInt($('set-rounds').value, 10) });
$('set-blind').onchange = () => socket.emit('settings:update', { blindTest: $('set-blind').checked });
$('set-mode').onchange = () => socket.emit('settings:update', { mode: $('set-mode').value });
$('btn-start').onclick = () => socket.emit('game:start');

$('btn-spotify').onclick = () => {
  if (!st || !me.playerId) return; const mine = myPlayer(); if (!mine) return;
  const url = `/auth/spotify?roomCode=${encodeURIComponent(st.code)}&playerId=${encodeURIComponent(me.playerId)}`;
  window.open(url, 'spotify-auth', `width=500,height=700,left=${(screen.width-500)/2},top=${(screen.height-700)/2}`);
};

function renderLobby() {
  $('lobby-code').firstChild.textContent = st.code + ' ';
  const box = $('lobby-players'); box.innerHTML = '';
  for (const p of st.players) {
    const el = document.createElement('span'); el.className = 'chip' + (p.connected ? '' : ' off');
    let extra = ''; if (p.isHost) extra += ' <span class="host">hôte</span>'; if (p.spotifyConnected) extra += ' <span class="spotify-badge">spotify</span>';
    el.innerHTML = `<span class="dot"></span>${p.avatar || '🎵'} ${escapeHtml(p.name)}` + extra + ` <span class="count">${p.trackCount}🎵</span>`;
    if (isHost() && p.id !== me.playerId) { const kick = document.createElement('button'); kick.className = 'kick-btn'; kick.textContent = '✕'; kick.onclick = (e) => { e.stopPropagation(); socket.emit('player:kick', { playerId: p.id }); }; el.appendChild(kick); }
    box.appendChild(el);
  }
  const mine = myPlayer();
  if (mine && mine.trackCount) $('pl-status').textContent = `${mine.trackCount} morceaux importés.`;
  $('host-settings').style.display = isHost() ? 'flex' : 'none';
  $('set-rounds').value = st.settings.rounds;
  $('set-blind').checked = st.settings.blindTest;
  $('set-mode').value = st.settings.mode || 'roulette';
  const enough = st.players.filter(p => p.connected).length >= 2;
  $('btn-start').style.display = isHost() ? 'block' : 'none'; $('btn-start').disabled = !enough;
  $('btn-close-lobby').style.display = isHost() ? 'block' : 'none';
  $('lobby-hint').textContent = isHost() ? (enough ? '' : 'Il faut au moins 2 joueurs.') : "En attente que l'hôte lance la partie.";
  const spotifyWrap = $('spotify-wrap');
  if (spotifyAvailable && mine) { spotifyWrap.style.display = 'block'; if (mine.spotifyConnected) { $('btn-spotify').textContent = 'Spotify connecté ✓'; $('btn-spotify').disabled = true; $('btn-spotify').classList.add('connected'); } else { $('btn-spotify').textContent = 'Se connecter à Spotify'; $('btn-spotify').disabled = false; $('btn-spotify').classList.remove('connected'); } } else { spotifyWrap.style.display = 'none'; }
  renderSavedPlaylists();
}

// ---------- deblocage audio ----------
$('btn-ready').onclick = () => {
  // Deblocage audio : AudioContext (fiable sur iOS) + element audio
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start();
    ctx.resume();
  } catch {}
  audio.src = SILENT;
  audio.play().then(() => { audio.pause(); audio.currentTime = 0; audioUnlocked = true; }).catch(() => { audioUnlocked = true; });
  socket.emit('player:ready'); $('btn-ready').disabled = true; $('btn-ready').textContent = 'Prêt ✓';
};
function renderUnlock() { const ready = st.players.filter(p => p.ready).length; const total = st.players.filter(p => p.connected).length; $('ready-count').textContent = `${ready}/${total} prêts…`; }

// ---------- jeu ----------
function renderPlay() {
  const r = st.round;
  $('round-label').textContent = `Manche ${r.index + 1}/${r.total}`;
  if (r.index !== currentRound) { currentRound = r.index; picked = null; voteSent = false; myResult = null; artistSent = false; artistResult = null; titleSent = false; setupRound(r); }

  const isQuiz = r.type === 'quizplus';
  $('play-stage').style.display = isQuiz ? 'none' : '';
  $('quiz-question').style.display = isQuiz ? 'block' : 'none';
  if (isQuiz) $('quiz-text').textContent = `Qui a le ${r.direction === 'plus' ? 'plus' : 'moins'} de chansons de ${r.artist} ?`;
  $('play-heading').textContent = isQuiz ? 'À toi de deviner !' : 'De qui vient ce morceau ?';

  const grid = $('guess-grid'); grid.innerHTML = '';
  if (!voteSent) { for (const p of st.players) { const b = document.createElement('button'); b.className = 'guess-btn' + (picked === p.id ? ' picked' : ''); b.textContent = `${p.avatar || '🎵'} ${p.name}`; b.onclick = () => { picked = p.id; renderPlay(); }; grid.appendChild(b); } }

  const ownerCorrect = !isQuiz && voteSent && myResult && myResult.correct && st.settings.blindTest;
  const showArtist = ownerCorrect && !artistSent;
  const showTitle = ownerCorrect && artistSent && artistResult && artistResult.correct && !titleSent;
  if (showArtist) { $('blind-wrap').style.display = 'block'; $('blind-label').textContent = "Bien joué ! Bonus : trouve l'artiste"; $('blind-input').placeholder = "Nom de l'artiste…"; $('blind-input').disabled = false; $('btn-title').textContent = "Valider l'artiste"; }
  else if (showTitle) { $('blind-wrap').style.display = 'block'; $('blind-label').textContent = 'Bravo ! Maintenant le titre'; $('blind-input').placeholder = 'Titre de la chanson…'; $('blind-input').disabled = false; $('btn-title').textContent = 'Valider le titre'; }
  else { $('blind-wrap').style.display = 'none'; }

  const alreadyVoted = r.voted.includes(me.playerId);
  $('btn-vote').disabled = voteSent || alreadyVoted || !picked;
  $('btn-vote').style.display = voteSent ? 'none' : 'block';
  if (!voteSent && !alreadyVoted) $('vote-hint').textContent = picked ? '' : 'Choisis un joueur.';
  else if (showArtist) $('vote-hint').textContent = "Devine l'artiste pour le bonus (+25).";
  else if (showTitle) $('vote-hint').textContent = 'Devine le titre pour encore plus (+50).';
  else if (artistSent && artistResult && !artistResult.correct) $('vote-hint').textContent = "Raté pour l'artiste. On attend la fin…";
  else $('vote-hint').textContent = voteSent ? 'Réponse envoyée. On attend la fin…' : '';
}

function setupRound(r) {
  clearTimers(); show('screen-play');
  const disc = $('play-disc'), cd = $('play-countdown');
  if (r.type === 'roulette') {
    disc.classList.add('spinning');
    // Reset propre de l'element audio (sans en creer un nouveau — garde le deblocage)
    try { audio.pause(); } catch {}
    audio.removeAttribute('src');
    audio.load(); // force le reset interne du navigateur
    audio.src = r.preview;
    audio.load();
  } else { disc.classList.remove('spinning'); try { audio.pause(); audio.removeAttribute('src'); } catch {} }
  const delay = r.startAt - Date.now(), clipSec = (r.deadline - r.startAt) / 1000;
  if (delay > 0) {
    cd.style.display = 'block'; cd.textContent = Math.ceil(delay / 1000);
    const tick = () => { const left = Math.ceil((r.startAt - Date.now()) / 1000); if (left <= 0) { cd.style.display = 'none'; return; } cd.textContent = left; scheduleTimers.push(setTimeout(tick, 250)); }; tick();
    if (r.type === 'roulette') scheduleTimers.push(setTimeout(() => startClip(r, clipSec), delay));
    else scheduleTimers.push(setTimeout(() => { cd.style.display = 'none'; }, delay));
  } else { cd.style.display = 'none'; if (r.type === 'roulette') startClip(r, clipSec); }
  const chrono = () => { const left = Math.max(0, Math.ceil((r.deadline - Date.now()) / 1000)); $('round-timer').textContent = left; if (left > 0) scheduleTimers.push(setTimeout(chrono, 300)); }; chrono();
}
function startClip(r, clipSec) {
  if (!audioUnlocked) return;
  const elapsed = Math.max(0, (Date.now() - r.startAt) / 1000);
  if (elapsed >= clipSec) return;
  try { audio.currentTime = Math.min(elapsed, clipSec - 0.5); } catch {}

  const tryPlay = (attempt) => {
    audio.play().then(() => {
      // Watchdog : verifie que ca joue vraiment 1s apres
      scheduleTimers.push(setTimeout(() => {
        if (audio.paused && Date.now() < r.deadline) {
          audio.load();
          setTimeout(() => audio.play().catch(() => {}), 200);
        }
      }, 1000));
    }).catch(() => {
      if (attempt < 3) {
        setTimeout(() => { audio.load(); setTimeout(() => tryPlay(attempt + 1), 200); }, 300);
      }
    });
  };
  tryPlay(0);

  scheduleTimers.push(setTimeout(() => { try { audio.pause(); } catch {} }, Math.max(0, r.deadline - Date.now())));
}

$('btn-vote').onclick = () => { if (!picked || voteSent) return; voteSent = true; socket.emit('round:guess', { ownerId: picked }); renderPlay(); };
$('btn-title').onclick = () => { const val = $('blind-input').value.trim(); if (!val) return; if (!artistSent) { artistSent = true; socket.emit('round:guess-artist', { artist: val }); } else if (!titleSent) { titleSent = true; socket.emit('round:guess-title', { title: val }); } $('blind-input').value = ''; renderPlay(); };

socket.on('round:your-result', (data) => { myResult = data; if (st && st.phase === 'playing') renderPlay(); });
socket.on('round:artist-result', (data) => { artistResult = data; if (st && st.phase === 'playing') renderPlay(); });
socket.on('round:found', ({ name, avatar }) => { const feed = $('found-feed'); if (!feed) return; const msg = document.createElement('div'); msg.className = 'found-msg'; msg.textContent = `${avatar} ${name} a trouvé !`; feed.appendChild(msg); setTimeout(() => msg.remove(), 2500); });

// ---------- reveal ----------
function renderReveal() {
  clearTimers(); try { audio.pause(); } catch {}
  const r = st.round, box = $('reveal-results'); box.innerHTML = '';

  if (r.type === 'roulette') {
    $('reveal-cover').src = r.cover || ''; $('reveal-cover').style.display = '';
    $('reveal-disc').style.display = '';
    $('reveal-owner').textContent = "C'était " + (st.players.find(p => p.id === r.ownerId)?.avatar || '') + ' ' + r.ownerName;
    $('reveal-song').textContent = `${r.artist} — ${r.title}`;
    for (const v of r.votes) {
      const line = document.createElement('div'); line.className = 'result-line'; let detail = '';
      if (v.correctOwner) {
        detail = `<span class="verdict ok">trouvé en ${v.elapsedSec}s → +${v.speedPts}</span>`;
        if (v.artistGuess) { detail += v.artistCorrect ? ` <span class="verdict ok">🎤 « ${escapeHtml(v.artistGuess)} » ✓ +25</span>` : ` <span class="title-guess">🎤 « ${escapeHtml(v.artistGuess)} » ✗</span>`; }
        if (v.titleGuess) { detail += v.correctTitle ? ` <span class="verdict ok">🎵 « ${escapeHtml(v.titleGuess)} » ✓ +50</span>` : ` <span class="title-guess">🎵 « ${escapeHtml(v.titleGuess)} » ✗</span>`; }
      } else { detail = `<span class="verdict no">a dit ${escapeHtml(playerLabel(v.guessOwner))}</span>`; }
      const d = r.deltas[v.voter] || 0;
      line.innerHTML = `<span>${escapeHtml(playerLabel(v.voter))}</span><span>${detail} <span class="delta">${d > 0 ? '+' + d : ''}</span></span>`;
      box.appendChild(line);
    }
    const od = r.deltas[r.ownerId]; if (od) { const line = document.createElement('div'); line.className = 'result-line'; line.innerHTML = `<span>${escapeHtml(playerLabel(r.ownerId))} <span class="small">(a piégé)</span></span><span class="delta">+${od}</span>`; box.appendChild(line); }

  } else {
    // Quiz plus/moins
    $('reveal-disc').style.display = 'none';
    $('reveal-owner').textContent = `Qui a le ${r.direction === 'plus' ? 'plus' : 'moins'} de ${r.artist} ?`;
    const answerPlayer = st.players.find(p => p.id === r.answerId);
    $('reveal-song').textContent = `→ ${answerPlayer ? answerPlayer.avatar + ' ' + answerPlayer.name : '?'} (${r.answerCount} chansons)`;
    // Counts par joueur
    for (const p of st.players) {
      const count = r.counts[p.id] || 0;
      const line = document.createElement('div'); line.className = 'result-line';
      const isAnswer = r.answerId === p.id;
      line.innerHTML = `<span>${p.avatar} ${escapeHtml(p.name)}</span><span>${count} chansons ${isAnswer ? '<span class="verdict ok">✓</span>' : ''}</span>`;
      box.appendChild(line);
    }
    // Votes
    const vTitle = document.createElement('h2'); vTitle.textContent = 'Votes'; vTitle.style.marginTop = '10px'; box.appendChild(vTitle);
    for (const v of r.votes) {
      const line = document.createElement('div'); line.className = 'result-line';
      const detail = v.correctOwner ? `<span class="verdict ok">trouvé en ${v.elapsedSec}s → +${v.speedPts}</span>` : `<span class="verdict no">a dit ${escapeHtml(playerLabel(v.guessOwner))}</span>`;
      const d = r.deltas[v.voter] || 0;
      line.innerHTML = `<span>${escapeHtml(playerLabel(v.voter))}</span><span>${detail} <span class="delta">${d > 0 ? '+' + d : ''}</span></span>`;
      box.appendChild(line);
    }
  }

  // Mini classement
  const sTitle = document.createElement('h2'); sTitle.textContent = 'Scores'; sTitle.style.marginTop = '14px'; box.appendChild(sTitle);
  [...st.players].sort((a, b) => b.score - a.score).forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'result-line' + (i === 0 ? ' first-rank' : '');
    row.innerHTML = `<span>${i + 1}. ${escapeHtml(p.name)}</span><span class="pts">${p.score} pts</span>`; box.appendChild(row);
  });

  $('btn-next').style.display = isHost() ? 'block' : 'none';
  $('btn-stop').style.display = isHost() ? 'block' : 'none';
  $('reveal-hint').textContent = isHost() ? '' : "En attente de l'hôte…";
}
$('btn-next').onclick = () => socket.emit('round:next');
$('btn-stop').onclick = () => { if (confirm('Arrêter la partie ?')) socket.emit('game:stop'); };
$('btn-close-lobby').onclick = () => { if (confirm('Fermer le salon ?')) socket.emit('game:stop'); };

// ---------- classement ----------
function renderFinished() {
  clearTimers(); const box = $('final-rank'); box.innerHTML = '';
  st.ranking.forEach((p, i) => { const el = document.createElement('div'); el.className = 'row-item' + (i === 0 ? ' first' : ''); el.innerHTML = `<span class="pos">${i + 1}</span><span>${escapeHtml(p.name)}</span><span class="pts">${p.score}</span>`; box.appendChild(el); });
  $('btn-restart').style.display = isHost() ? 'block' : 'none';
}
$('btn-restart').onclick = () => socket.emit('game:restart');

// ---------- routage d'etat ----------
socket.on('state', (state) => {
  st = state;
  switch (state.phase) {
    case 'lobby': currentRound = -1; show('screen-lobby'); renderLobby(); break;
    case 'lobby-ready': show('screen-unlock'); renderUnlock(); break;
    case 'playing': renderPlay(); break;
    case 'reveal': show('screen-reveal'); renderReveal(); break;
    case 'finished': show('screen-finished'); renderFinished(); break;
  }
});
socket.on('error:msg', (m) => toast(m));
socket.on('kicked', () => { me.playerId = null; st = null; sessionStorage.removeItem('ws_room'); sessionStorage.removeItem('ws_playerId'); show('screen-home'); toast("Tu as été retiré du salon."); });
socket.on('room:closed', () => { me.playerId = null; st = null; sessionStorage.removeItem('ws_room'); sessionStorage.removeItem('ws_playerId'); show('screen-home'); toast('Le salon a été fermé.'); });
