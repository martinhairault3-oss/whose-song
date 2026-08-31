const socket = io();
const $ = (id) => document.getElementById(id);
const SILENT = 'data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA';

let me = { playerId: null };
let st = null;              // dernier etat recu
let audio = new Audio();
audio.preload = 'auto';
let audioUnlocked = false;
let currentRound = -1;      // pour detecter un changement de manche
let picked = null;          // proprietaire choisi ce tour
let voteSent = false;
let myResult = null;        // { correct: bool } recu apres le vote
let titleSent = false;
let scheduleTimers = [];
let spotifyAvailable = false; // le serveur a-t-il Spotify configure ?

// ---------- auto-reconnexion ----------
// Quand on quitte le navigateur (ex: aller copier un lien Spotify) et qu'on
// revient, le socket se reconnecte. On rejoint automatiquement le salon.
let rejoinPending = false;

function tryAutoRejoin() {
  const savedRoom = sessionStorage.getItem('ws_room');
  const savedPlayerId = sessionStorage.getItem('ws_playerId');
  if (!savedRoom || !savedPlayerId) return;
  if (!socket.connected) return;
  if (rejoinPending) return;
  rejoinPending = true;

  socket.emit('room:rejoin', { code: savedRoom, playerId: savedPlayerId }, (res) => {
    rejoinPending = false;
    if (res && res.ok) {
      me.playerId = res.playerId;
    } else {
      // Salon expire ou joueur introuvable
      sessionStorage.removeItem('ws_room');
      sessionStorage.removeItem('ws_playerId');
    }
  });
}

// Socket (re)connecte -> rejoin
socket.on('connect', tryAutoRejoin);

// Reset le flag si on perd la connexion
socket.on('disconnect', () => {
  rejoinPending = false;
  toast('Connexion perdue, reconnexion…');
});

// Tab redevient visible (retour depuis une autre app sur mobile)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Force la reconnexion si le socket est mort
    if (socket.disconnected) socket.connect();
    // Plusieurs tentatives pour laisser le temps au socket de se reconnecter
    tryAutoRejoin();
    setTimeout(tryAutoRejoin, 500);
    setTimeout(tryAutoRejoin, 2000);
  }
});

// ---------- utilitaires UI ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
const myPlayer = () => st && st.players.find(p => p.id === me.playerId);
const isHost = () => st && st.hostId === me.playerId;
const playerName = (id) => { const p = st && st.players.find(x => x.id === id); return p ? p.name : '?'; };
function clearTimers() { scheduleTimers.forEach(clearTimeout); scheduleTimers = []; }

// ---------- Spotify OAuth : verifier dispo au chargement ----------
fetch('/auth/spotify/check').then(r => r.json()).then(d => {
  spotifyAvailable = d.available;
}).catch(() => {});

// ---------- Spotify OAuth : retour via popup (postMessage) ----------
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'spotify-connected') {
    toast('Connecté à Spotify ✓');
  }
});

// ---------- accueil ----------
$('btn-create').onclick = () => {
  const name = $('home-name').value.trim();
  if (!name) return toast('Choisis un pseudo.');
  socket.emit('room:create', { name }, (res) => {
    if (res && res.ok) {
      me.playerId = res.playerId;
      sessionStorage.setItem('ws_room', res.code);
      sessionStorage.setItem('ws_playerId', res.playerId);
    }
  });
};
$('btn-join').onclick = () => {
  const name = $('home-name').value.trim();
  const code = $('home-code').value.trim().toUpperCase();
  if (!name) return toast('Choisis un pseudo.');
  if (code.length !== 4) return toast('Le code fait 4 lettres.');
  socket.emit('room:join', { code, name }, (res) => {
    if (res && res.ok) {
      me.playerId = res.playerId;
      sessionStorage.setItem('ws_room', res.code);
      sessionStorage.setItem('ws_playerId', res.playerId);
    }
    else toast(res && res.error || 'Impossible de rejoindre.');
  });
};

// ---------- lobby ----------
$('btn-copy').onclick = (e) => {
  e.stopPropagation();
  if (st) navigator.clipboard?.writeText(st.code).then(() => toast('Code copié : ' + st.code));
};
$('btn-add-pl').onclick = () => {
  const url = $('pl-url').value.trim();
  if (!url) return;
  $('btn-add-pl').disabled = true;
  $('pl-status').textContent = 'Import en cours…';
  socket.emit('playlist:add', { url }, (res) => {
    $('btn-add-pl').disabled = false;
    if (res && res.ok) {
      $('pl-url').value = '';
      let msg = `« ${res.name} » : +${res.added} morceaux (total ${res.total}).`;
      if (res.requested && res.matched < res.requested) msg += ` ${res.matched}/${res.requested} trouvés sur Deezer.`;
      $('pl-status').textContent = msg;
    } else {
      $('pl-status').textContent = res && res.error || 'Import impossible.';
      toast(res && res.error || 'Import impossible.');
    }
  });
};
$('set-rounds').onchange = () => socket.emit('settings:update', { rounds: parseInt($('set-rounds').value, 10) });
$('set-blind').onchange = () => socket.emit('settings:update', { blindTest: $('set-blind').checked });
$('btn-start').onclick = () => socket.emit('game:start');

// ---------- Spotify connect ----------
$('btn-spotify').onclick = () => {
  if (!st || !me.playerId) return;
  const mine = myPlayer();
  if (!mine) return;
  // Popup au lieu de redirect : le socket reste connecte
  const url = `/auth/spotify?roomCode=${encodeURIComponent(st.code)}&playerId=${encodeURIComponent(me.playerId)}`;
  const w = 500, h = 700;
  const left = (screen.width - w) / 2, top = (screen.height - h) / 2;
  window.open(url, 'spotify-auth', `width=${w},height=${h},left=${left},top=${top}`);
};

function renderLobby() {
  $('lobby-code').firstChild.textContent = st.code + ' ';
  const box = $('lobby-players'); box.innerHTML = '';
  for (const p of st.players) {
    const el = document.createElement('span');
    el.className = 'chip' + (p.connected ? '' : ' off');
    let extra = '';
    if (p.isHost) extra += ' <span class="host">hôte</span>';
    if (p.spotifyConnected) extra += ' <span class="spotify-badge">spotify</span>';
    el.innerHTML = `<span class="dot"></span>${escapeHtml(p.name)}` +
      extra +
      ` <span class="count">${p.trackCount}🎵</span>`;
    // Kick button (hote uniquement, pas sur soi-meme)
    if (isHost() && p.id !== me.playerId) {
      const kick = document.createElement('button');
      kick.className = 'kick-btn';
      kick.textContent = '✕';
      kick.title = 'Retirer ce joueur';
      kick.onclick = (e) => { e.stopPropagation(); socket.emit('player:kick', { playerId: p.id }); };
      el.appendChild(kick);
    }
    box.appendChild(el);
  }
  const mine = myPlayer();
  if (mine && mine.trackCount) $('pl-status').textContent = `${mine.trackCount} morceaux importés.`;

  $('host-settings').style.display = isHost() ? 'flex' : 'none';
  $('set-rounds').value = st.settings.rounds;
  $('set-blind').checked = st.settings.blindTest;

  const enough = st.players.filter(p => p.connected).length >= 2;
  $('btn-start').style.display = isHost() ? 'block' : 'none';
  $('btn-start').disabled = !enough;
  $('btn-close-lobby').style.display = isHost() ? 'block' : 'none';
  $('lobby-hint').textContent = isHost()
    ? (enough ? '' : 'Il faut au moins 2 joueurs.')
    : "En attente que l'hôte lance la partie.";

  // Bouton Spotify : visible si le serveur est configure
  const spotifyWrap = $('spotify-wrap');
  if (spotifyAvailable && mine) {
    spotifyWrap.style.display = 'block';
    if (mine.spotifyConnected) {
      $('btn-spotify').textContent = 'Spotify connecté ✓';
      $('btn-spotify').disabled = true;
      $('btn-spotify').classList.add('connected');
    } else {
      $('btn-spotify').textContent = 'Se connecter à Spotify';
      $('btn-spotify').disabled = false;
      $('btn-spotify').classList.remove('connected');
    }
  } else {
    spotifyWrap.style.display = 'none';
  }
}

// ---------- deblocage audio ----------
$('btn-ready').onclick = () => {
  audio.src = SILENT;
  audio.play().then(() => { audio.pause(); audio.currentTime = 0; audioUnlocked = true; })
    .catch(() => { audioUnlocked = true; }); // certains navigateurs debloquent quand meme
  socket.emit('player:ready');
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = 'Prêt ✓';
};
function renderUnlock() {
  const ready = st.players.filter(p => p.ready).length;
  const total = st.players.filter(p => p.connected).length;
  $('ready-count').textContent = `${ready}/${total} prêts…`;
}

// ---------- jeu ----------
function renderPlay() {
  const r = st.round;
  $('round-label').textContent = `Manche ${r.index + 1}/${r.total}`;

  // audio + decompte, seulement au changement de manche
  if (r.index !== currentRound) {
    currentRound = r.index;
    picked = null; voteSent = false; myResult = null; titleSent = false;
    setupRound(r);
  }

  // grille de vote : TOUS les joueurs (y compris moi)
  const grid = $('guess-grid'); grid.innerHTML = '';
  if (!voteSent) {
    for (const p of st.players) {
      const b = document.createElement('button');
      b.className = 'guess-btn' + (picked === p.id ? ' picked' : '');
      b.textContent = p.name;
      b.onclick = () => { picked = p.id; renderPlay(); };
      grid.appendChild(b);
    }
  }

  // Blind test : visible UNIQUEMENT apres une bonne reponse proprietaire
  const showBlind = voteSent && myResult && myResult.correct && st.settings.blindTest && !titleSent;
  $('blind-wrap').style.display = showBlind ? 'block' : 'none';
  $('blind-input').disabled = titleSent;

  // Bouton vote
  const alreadyVoted = st.round.voted.includes(me.playerId);
  $('btn-vote').disabled = voteSent || alreadyVoted || !picked;
  $('btn-vote').style.display = voteSent ? 'none' : 'block';

  // Hint
  if (!voteSent && !alreadyVoted) {
    $('vote-hint').textContent = picked ? '' : 'Choisis un joueur.';
  } else if (showBlind) {
    $('vote-hint').textContent = 'Bien joué ! Devine le titre pour le bonus.';
  } else {
    $('vote-hint').textContent = 'Réponse envoyée. On attend la fin…';
  }
}

function setupRound(r) {
  clearTimers();
  // ecran + disque
  show('screen-play');
  const disc = $('play-disc'); disc.classList.add('spinning');
  const cd = $('play-countdown');

  // charge l'extrait
  try { audio.pause(); } catch {}
  audio.src = r.preview;
  audio.load();

  const now = Date.now();
  const delay = r.startAt - now;

  if (delay > 0) {
    // decompte 3-2-1
    cd.style.display = 'block';
    let n = Math.ceil(delay / 1000);
    cd.textContent = n;
    const tick = () => {
      const left = Math.ceil((r.startAt - Date.now()) / 1000);
      if (left <= 0) { cd.style.display = 'none'; return; }
      cd.textContent = left;
      scheduleTimers.push(setTimeout(tick, 250));
    };
    tick();
    scheduleTimers.push(setTimeout(startClip, delay));
  } else {
    cd.style.display = 'none';
    startClip(); // on a rejoint en cours de manche
  }

  function startClip() {
    const elapsed = Math.max(0, (Date.now() - r.startAt) / 1000);
    if (audioUnlocked && elapsed < 30) {
      try { audio.currentTime = Math.min(elapsed, 29.5); } catch {}
      audio.play().catch(() => {});
    }
    // fin d'extrait
    scheduleTimers.push(setTimeout(() => { try { audio.pause(); } catch {} }, Math.max(0, r.deadline - Date.now())));
  }

  // chrono affiche
  const chrono = () => {
    const left = Math.max(0, Math.ceil((r.deadline - Date.now()) / 1000));
    $('round-timer').textContent = left;
    if (left > 0) scheduleTimers.push(setTimeout(chrono, 300));
  };
  chrono();
}

$('btn-vote').onclick = () => {
  if (!picked || voteSent) return;
  voteSent = true;
  socket.emit('round:guess', { ownerId: picked });
  renderPlay();
};

// Blind test : soumettre le titre (apres bonne reponse proprietaire)
$('btn-title').onclick = () => {
  if (titleSent) return;
  titleSent = true;
  socket.emit('round:guess-title', { title: $('blind-input').value.trim() });
  $('blind-input').value = '';
  renderPlay();
};

// Resultat prive du vote (pour savoir si on affiche le blind test)
socket.on('round:your-result', (data) => {
  myResult = data;
  if (st && st.phase === 'playing') renderPlay();
});

// ---------- reveal ----------
function renderReveal() {
  clearTimers();
  try { audio.pause(); } catch {}
  const r = st.round;
  $('reveal-cover').src = r.cover || '';
  $('reveal-owner').textContent = 'C\'était ' + r.ownerName;
  $('reveal-song').textContent = `${r.artist} — ${r.title}`;

  const box = $('reveal-results'); box.innerHTML = '';
  // votants (sauf le proprio)
  for (const v of r.votes) {
    if (v.voter === r.ownerId) continue;
    const line = document.createElement('div');
    line.className = 'result-line';
    let detail = '';
    if (v.correctOwner) {
      detail = `<span class="verdict ok">trouvé en ${v.elapsedSec}s → +${v.speedPts}</span>`;
      if (v.correctTitle) detail += ' <span class="verdict ok">+ titre +50</span>';
    } else {
      detail = `<span class="verdict no">a dit ${escapeHtml(playerName(v.guessOwner))}</span>`;
    }
    const d = r.deltas[v.voter] || 0;
    line.innerHTML = `<span>${escapeHtml(playerName(v.voter))}</span>` +
      `<span>${detail} <span class="delta">${d > 0 ? '+' + d : ''}</span></span>`;
    box.appendChild(line);
  }
  // points "piege" du proprietaire
  const od = r.deltas[r.ownerId];
  if (od) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.innerHTML = `<span>${escapeHtml(r.ownerName)} <span class="small">(a piégé)</span></span><span class="delta">+${od}</span>`;
    box.appendChild(line);
  }

  // Mini classement
  const title = document.createElement('h2');
  title.textContent = 'Scores';
  title.style.marginTop = '14px';
  box.appendChild(title);
  const sorted = [...st.players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'result-line' + (i === 0 ? ' first-rank' : '');
    row.innerHTML = `<span>${i + 1}. ${escapeHtml(p.name)}</span><span class="pts">${p.score} pts</span>`;
    box.appendChild(row);
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
  clearTimers();
  const box = $('final-rank'); box.innerHTML = '';
  st.ranking.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'row-item' + (i === 0 ? ' first' : '');
    el.innerHTML = `<span class="pos">${i + 1}</span><span>${escapeHtml(p.name)}</span><span class="pts">${p.score}</span>`;
    box.appendChild(el);
  });
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

// Kicked par l'hote
socket.on('kicked', () => {
  me.playerId = null;
  st = null;
  sessionStorage.removeItem('ws_room');
  sessionStorage.removeItem('ws_playerId');
  show('screen-home');
  toast("Tu as été retiré du salon par l'hôte.");
});

// Salon ferme par l'hote
socket.on('room:closed', () => {
  me.playerId = null;
  st = null;
  sessionStorage.removeItem('ws_room');
  sessionStorage.removeItem('ws_playerId');
  show('screen-home');
  toast('Le salon a été fermé.');
});

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
