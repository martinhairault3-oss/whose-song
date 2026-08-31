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
let scheduleTimers = [];
let spotifyAvailable = false; // le serveur a-t-il Spotify configure ?

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

// ---------- Spotify OAuth : retour apres redirect ----------
(function handleSpotifyReturn() {
  const params = new URLSearchParams(location.search);
  const spotifyResult = params.get('spotify');
  if (!spotifyResult) return;

  // Nettoie l'URL
  history.replaceState(null, '', '/');

  if (spotifyResult === 'ok') {
    // Reconnexion automatique au salon
    const savedRoom = sessionStorage.getItem('ws_room');
    const savedName = sessionStorage.getItem('ws_name');
    if (savedRoom && savedName) {
      socket.emit('room:join', { code: savedRoom, name: savedName }, (res) => {
        if (res && res.ok) {
          me.playerId = res.playerId;
          toast('Connecté à Spotify ✓');
        } else {
          toast('Spotify connecté, mais le salon a expiré.');
        }
      });
    } else {
      toast('Spotify connecté ! Rejoins ton salon.');
    }
  } else if (spotifyResult === 'denied') {
    // Reconnexion sans Spotify
    const savedRoom = sessionStorage.getItem('ws_room');
    const savedName = sessionStorage.getItem('ws_name');
    if (savedRoom && savedName) {
      socket.emit('room:join', { code: savedRoom, name: savedName }, (res) => {
        if (res && res.ok) me.playerId = res.playerId;
      });
    }
    toast('Connexion Spotify annulée.');
  } else if (spotifyResult === 'error') {
    const savedRoom = sessionStorage.getItem('ws_room');
    const savedName = sessionStorage.getItem('ws_name');
    if (savedRoom && savedName) {
      socket.emit('room:join', { code: savedRoom, name: savedName }, (res) => {
        if (res && res.ok) me.playerId = res.playerId;
      });
    }
    toast('Erreur de connexion Spotify. Réessaie.');
  }

  // Nettoyage sessionStorage
  sessionStorage.removeItem('ws_room');
  sessionStorage.removeItem('ws_name');
})();

// ---------- accueil ----------
$('btn-create').onclick = () => {
  const name = $('home-name').value.trim();
  if (!name) return toast('Choisis un pseudo.');
  socket.emit('room:create', { name }, (res) => {
    if (res && res.ok) me.playerId = res.playerId;
  });
};
$('btn-join').onclick = () => {
  const name = $('home-name').value.trim();
  const code = $('home-code').value.trim().toUpperCase();
  if (!name) return toast('Choisis un pseudo.');
  if (code.length !== 4) return toast('Le code fait 4 lettres.');
  socket.emit('room:join', { code, name }, (res) => {
    if (res && res.ok) me.playerId = res.playerId;
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
  // Sauvegarde les infos pour se reconnecter apres le redirect OAuth
  sessionStorage.setItem('ws_room', st.code);
  sessionStorage.setItem('ws_name', mine.name);
  // Redirect vers l'auth Spotify
  window.location.href = `/auth/spotify?roomCode=${encodeURIComponent(st.code)}&playerId=${encodeURIComponent(me.playerId)}`;
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
    picked = null; voteSent = false;
    setupRound(r);
  }

  // grille de vote (tous sauf moi)
  const grid = $('guess-grid'); grid.innerHTML = '';
  for (const p of st.players) {
    if (p.id === me.playerId) continue;
    const b = document.createElement('button');
    b.className = 'guess-btn' + (picked === p.id ? ' picked' : '');
    b.textContent = p.name;
    b.disabled = voteSent;
    b.onclick = () => { picked = p.id; renderPlay(); };
    grid.appendChild(b);
  }

  $('blind-wrap').style.display = st.settings.blindTest ? 'block' : 'none';
  $('blind-input').disabled = voteSent;

  const alreadyVoted = st.round.voted.includes(me.playerId);
  $('btn-vote').disabled = voteSent || alreadyVoted || !picked;
  $('btn-vote').style.display = alreadyVoted && !voteSent ? 'none' : 'block';
  $('vote-hint').textContent = (voteSent || alreadyVoted)
    ? 'Réponse envoyée. On attend les autres…'
    : (picked ? '' : 'Choisis un joueur.');
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
  socket.emit('round:guess', { ownerId: picked, title: $('blind-input').value.trim() });
  renderPlay();
};

// ---------- reveal ----------
function renderReveal() {
  clearTimers();
  try { audio.pause(); } catch {}
  const r = st.round;
  $('reveal-cover').src = r.cover || '';
  $('reveal-owner').textContent = 'C\'était ' + r.ownerName;
  $('reveal-song').textContent = `${r.artist} — ${r.title}`;

  const box = $('reveal-results'); box.innerHTML = '';
  // votants
  for (const v of r.votes) {
    const line = document.createElement('div');
    line.className = 'result-line';
    const bonus = v.correctTitle ? ' <span class="verdict ok">+ titre</span>' : '';
    const verdict = v.correctOwner
      ? '<span class="verdict ok">trouvé ✓</span>'
      : `<span class="verdict no">a dit ${escapeHtml(playerName(v.guessOwner))}</span>`;
    const d = r.deltas[v.voter] || 0;
    line.innerHTML = `<span>${escapeHtml(playerName(v.voter))}</span>` +
      `<span>${verdict}${bonus} <span class="delta">${d > 0 ? '+' + d : ''}</span></span>`;
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

  $('btn-next').style.display = isHost() ? 'block' : 'none';
  $('reveal-hint').textContent = isHost() ? '' : "En attente de l'hôte…";
}
$('btn-next').onclick = () => socket.emit('round:next');

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
socket.on('disconnect', () => toast('Connexion perdue, reconnexion…'));

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
