// server.js — backend temps reel du jeu.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { importPlaylist, normalizeTitle } = require('./music');

const app = express();
app.set('trust proxy', 1); // Render / Railway sont derriere un reverse proxy
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Whose Song sur http://localhost:${PORT}`));

// ---------------------------------------------------------------------------
// Etat en memoire
// ---------------------------------------------------------------------------
const rooms = new Map(); // code -> room

function makeCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function newRoom(code) {
  return {
    code,
    hostId: null,
    phase: 'lobby',                 // lobby | playing | reveal | finished
    players: new Map(),             // playerId -> { id, name, socketId, connected, score, tracks:[], ready:false, spotifyToken?, spotifyRefreshToken?, spotifyTokenExp? }
    settings: { rounds: 10, blindTest: true, clipMs: 30000 },
    songs: [],                      // pool retenu (exclusifs), melange
    roundIndex: -1,
    round: null,                    // { song, startAt, deadline, votes:Map, revealed:bool }
    timer: null,
  };
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const songKey = (t) => t.deezerId ? `d:${t.deezerId}` : `${normalizeTitle(t.artist)}|${normalizeTitle(t.title)}`;

// ---------------------------------------------------------------------------
// OAuth Spotify — Authorization Code Flow
// ---------------------------------------------------------------------------
const SPOTIFY_CALLBACK_PATH = '/auth/spotify/callback';

// Verifie que le serveur a les identifiants Spotify configures
function spotifyConfigured() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

// GET /auth/spotify?roomCode=XXXX&playerId=p_xxxxxxx
// Redirige le joueur vers l'ecran d'autorisation Spotify.
app.get('/auth/spotify', (req, res) => {
  if (!spotifyConfigured()) {
    return res.status(500).send('Spotify non configure sur ce serveur (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants).');
  }

  const { roomCode, playerId } = req.query;
  if (!roomCode || !playerId) return res.status(400).send('Parametres manquants.');

  const redirectUri = `${req.protocol}://${req.get('host')}${SPOTIFY_CALLBACK_PATH}`;
  const state = Buffer.from(JSON.stringify({ roomCode, playerId })).toString('base64url');
  const scopes = 'playlist-read-private playlist-read-collaborative';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'false',
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// GET /auth/spotify/callback — Spotify redirige ici apres l'autorisation.
// Echange le code contre un token, le stocke sur le joueur, et renvoie
// l'utilisateur vers l'app.
app.get(SPOTIFY_CALLBACK_PATH, async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    // L'utilisateur a refuse l'autorisation ou autre erreur
    return res.redirect('/?spotify=denied');
  }

  let roomCode, playerId;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    roomCode = parsed.roomCode;
    playerId = parsed.playerId;
  } catch {
    return res.status(400).send('State invalide.');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}${SPOTIFY_CALLBACK_PATH}`;

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('Spotify token exchange error:', tokenData);
      throw new Error(tokenData.error_description || tokenData.error);
    }

    // Stocke le token sur le joueur dans la room
    const room = rooms.get(roomCode);
    if (room) {
      const player = room.players.get(playerId);
      if (player) {
        player.spotifyToken = tokenData.access_token;
        player.spotifyRefreshToken = tokenData.refresh_token || null;
        player.spotifyTokenExp = Date.now() + (tokenData.expires_in || 3600) * 1000;
        // Le joueur est peut-etre momentanement deconnecte (redirect en cours)
        // Le broadcast se fera quand il se reconnectera via Socket.IO
        if (player.connected) broadcast(room);
      }
    }

    // Redirige vers l'app — le client detectera ?spotify=ok et se reconnectera
    res.redirect('/?spotify=ok');
  } catch (e) {
    console.error('Spotify OAuth error:', e.message);
    res.redirect('/?spotify=error');
  }
});

// GET /auth/spotify/check — le client verifie si Spotify est configure
app.get('/auth/spotify/check', (_, res) => {
  res.json({ available: spotifyConfigured() });
});

// ---------------------------------------------------------------------------
// Vue envoyee aux clients (on cache le proprietaire et, en blind test, le titre)
// ---------------------------------------------------------------------------
function publicState(room) {
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, connected: p.connected, score: p.score,
    trackCount: p.tracks.length, ready: p.ready,
    isHost: p.id === room.hostId,
    spotifyConnected: !!p.spotifyToken,
  }));

  const base = { code: room.code, phase: room.phase, hostId: room.hostId, settings: room.settings, players };

  if (room.phase === 'playing' && room.round) {
    const r = room.round;
    base.round = {
      index: room.roundIndex, total: room.songs.length,
      startAt: r.startAt, deadline: r.deadline,
      preview: r.song.preview,
      // titre/cover masques pendant la devinette
      voted: [...r.votes.keys()],
    };
  }

  if (room.phase === 'reveal' && room.round) {
    const r = room.round, s = r.song;
    const owner = room.players.get(s.ownerId);
    base.round = {
      index: room.roundIndex, total: room.songs.length,
      ownerId: s.ownerId, ownerName: owner ? owner.name : '?',
      title: s.title, artist: s.artist, cover: s.cover, preview: s.preview,
      votes: [...r.votes.entries()].map(([voter, v]) => ({
        voter, guessOwner: v.ownerId,
        correctOwner: v.ownerId === s.ownerId,
        titleGuess: v.title || null,
        correctTitle: v.titleCorrect || false,
      })),
      deltas: r.deltas || {},
    };
  }

  if (room.phase === 'finished') {
    base.ranking = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  return base;
}

function broadcast(room) { io.to(room.code).emit('state', publicState(room)); }

// ---------------------------------------------------------------------------
// Deroulement d'une partie
// ---------------------------------------------------------------------------
function buildPool(room) {
  const owners = new Map(); // key -> { track, ownerIds:Set }
  for (const p of room.players.values()) {
    const seen = new Set(); // dedup interne au joueur
    for (const t of p.tracks) {
      const k = songKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!owners.has(k)) owners.set(k, { track: t, ownerIds: new Set() });
      owners.get(k).ownerIds.add(p.id);
    }
  }
  const exclusive = [];
  for (const { track, ownerIds } of owners.values()) {
    if (ownerIds.size === 1) exclusive.push({ ...track, ownerId: [...ownerIds][0] });
  }
  return shuffle(exclusive);
}

function startGame(room) {
  const pool = buildPool(room);
  if (pool.length === 0) {
    io.to(room.code).emit('error:msg', "Aucun morceau n'est unique a un seul joueur. Ajoutez des playlists plus variees.");
    return;
  }
  room.songs = pool.slice(0, Math.min(room.settings.rounds, pool.length));
  for (const p of room.players.values()) { p.score = 0; p.ready = false; }
  room.roundIndex = -1;
  room.phase = 'playing';
  // On attend que tout le monde ait debloque l'audio (player:ready) avant la manche 1.
  room.phase = 'lobby-ready';
  broadcast(room);
}

function maybeStartFirstRound(room) {
  const active = [...room.players.values()].filter(p => p.connected);
  if (active.length && active.every(p => p.ready)) nextRound(room);
}

function nextRound(room) {
  clearTimeout(room.timer);
  room.roundIndex++;
  if (room.roundIndex >= room.songs.length) return endGame(room);

  const song = room.songs[room.roundIndex];
  const startAt = Date.now() + 3000;                 // decompte 3s synchronise
  const deadline = startAt + room.settings.clipMs;   // fin de la fenetre de reponse
  room.phase = 'playing';
  room.round = { song, startAt, deadline, votes: new Map(), revealed: false, deltas: null };
  broadcast(room);

  room.timer = setTimeout(() => reveal(room), (deadline - Date.now()) + 500);
}

function everyoneVoted(room) {
  const voters = [...room.players.values()].filter(p => p.connected && p.id !== room.round.song.ownerId);
  return voters.length > 0 && voters.every(p => room.round.votes.has(p.id));
}

function reveal(room) {
  clearTimeout(room.timer);
  if (!room.round || room.round.revealed) return;
  room.round.revealed = true;

  const s = room.round.song;
  const deltas = {};
  const add = (id, n) => { deltas[id] = (deltas[id] || 0) + n; };

  let fooled = 0;
  for (const [voterId, v] of room.round.votes.entries()) {
    if (voterId === s.ownerId) continue;
    if (v.ownerId === s.ownerId) add(voterId, 100);   // bon proprietaire
    else fooled++;                                     // pieger par le proprietaire
    if (v.titleCorrect) add(voterId, 50);             // bonus blind test
  }
  if (fooled > 0) add(s.ownerId, fooled * 20);        // points "piege"

  for (const [id, n] of Object.entries(deltas)) {
    const p = room.players.get(id); if (p) p.score += n;
  }
  room.round.deltas = deltas;
  room.phase = 'reveal';
  broadcast(room);
}

function endGame(room) {
  clearTimeout(room.timer);
  room.phase = 'finished';
  room.round = null;
  broadcast(room);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let joined = null; // { code, playerId }

  const room = () => joined && rooms.get(joined.code);
  const me = () => { const r = room(); return r && r.players.get(joined.playerId); };
  const isHost = () => { const r = room(); return r && r.hostId === joined.playerId; };

  function attach(r, player) {
    joined = { code: r.code, playerId: player.id };
    socket.join(r.code);
  }

  socket.on('room:create', ({ name }, cb) => {
    const code = makeCode();
    const r = newRoom(code);
    rooms.set(code, r);
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const player = { id, name: (name || 'Joueur').slice(0, 20), socketId: socket.id, connected: true, score: 0, tracks: [], ready: false };
    r.players.set(id, player);
    r.hostId = id;
    attach(r, player);
    cb && cb({ ok: true, code, playerId: id });
    broadcast(r);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    code = (code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return cb && cb({ ok: false, error: "Salon introuvable." });
    name = (name || 'Joueur').slice(0, 20);

    // reconnexion : meme nom deconnecte -> on reprend le meme joueur (et son score)
    let player = [...r.players.values()].find(p => p.name.toLowerCase() === name.toLowerCase() && !p.connected);
    if (player) { player.connected = true; player.socketId = socket.id; }
    else {
      if (r.phase !== 'lobby') return cb && cb({ ok: false, error: "Partie deja commencee." });
      const id = 'p_' + Math.random().toString(36).slice(2, 9);
      player = { id, name, socketId: socket.id, connected: true, score: 0, tracks: [], ready: false };
      r.players.set(id, player);
    }
    attach(r, player);
    cb && cb({ ok: true, code, playerId: player.id });
    broadcast(r);
  });

  // Reconnexion par ID (apres redirect OAuth Spotify)
  // Contrairement a room:join (par nom), on identifie le joueur par son ID exact
  // pour eviter les doublons quand l'ancien socket n'a pas encore timeout.
  socket.on('room:rejoin', ({ code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return cb && cb({ ok: false, error: "Salon introuvable." });
    const player = r.players.get(playerId);
    if (!player) return cb && cb({ ok: false, error: "Joueur introuvable." });
    player.connected = true;
    player.socketId = socket.id;
    attach(r, player);
    cb && cb({ ok: true, code, playerId: player.id });
    broadcast(r);
  });

  socket.on('playlist:add', async ({ url }, cb) => {
    const r = room(), p = me();
    if (!r || !p) return cb && cb({ ok: false, error: "Rejoins un salon d'abord." });
    if (r.phase !== 'lobby') return cb && cb({ ok: false, error: "Trop tard, la partie a commence." });
    try {
      // On passe le token Spotify du joueur s'il en a un
      const result = await importPlaylist(url, p.spotifyToken || null);
      const existing = new Set(p.tracks.map(songKey));
      let added = 0;
      for (const t of result.tracks) { if (!existing.has(songKey(t))) { p.tracks.push(t); existing.add(songKey(t)); added++; } }
      cb && cb({ ok: true, name: result.name, added, total: p.tracks.length, matched: result.tracks.length, requested: result.requested });
      broadcast(r);
    } catch (e) {
      cb && cb({ ok: false, error: e.message || "Import impossible." });
    }
  });

  socket.on('playlist:clear', (cb) => {
    const p = me(), r = room();
    if (p) { p.tracks = []; broadcast(r); }
    cb && cb({ ok: true });
  });

  socket.on('settings:update', (s) => {
    const r = room();
    if (!r || !isHost() || r.phase !== 'lobby') return;
    if (typeof s.rounds === 'number') r.settings.rounds = Math.max(1, Math.min(50, s.rounds | 0));
    if (typeof s.blindTest === 'boolean') r.settings.blindTest = s.blindTest;
    broadcast(r);
  });

  socket.on('game:start', () => {
    const r = room();
    if (!r || !isHost() || r.phase !== 'lobby') return;
    const active = [...r.players.values()].filter(p => p.connected);
    if (active.length < 2) return io.to(r.code).emit('error:msg', "Il faut au moins 2 joueurs.");
    startGame(r);
  });

  socket.on('player:ready', () => {
    const r = room(), p = me();
    if (!r || !p) return;
    p.ready = true;
    broadcast(r);
    if (r.phase === 'lobby-ready') maybeStartFirstRound(r);
  });

  socket.on('round:guess', ({ ownerId, title }) => {
    const r = room(), p = me();
    if (!r || !p || r.phase !== 'playing' || !r.round) return;
    if (p.id === r.round.song.ownerId) return;           // le proprietaire ne devine pas
    if (r.round.votes.has(p.id)) return;                 // un seul vote

    let titleCorrect = false;
    if (r.settings.blindTest && title) {
      const g = normalizeTitle(title), real = normalizeTitle(r.round.song.title);
      titleCorrect = !!g && (real.includes(g) || g.includes(real) ||
        real.split(' ').filter(w => w.length > 2 && g.includes(w)).length >= Math.min(2, real.split(' ').length));
    }
    r.round.votes.set(p.id, { ownerId, title: title || null, titleCorrect });
    broadcast(r);
    if (everyoneVoted(r)) reveal(r);
  });

  socket.on('round:next', () => {
    const r = room();
    if (!r || !isHost()) return;
    if (r.phase === 'reveal') nextRound(r);
  });

  socket.on('game:restart', () => {
    const r = room();
    if (!r || !isHost()) return;
    r.phase = 'lobby'; r.songs = []; r.round = null; r.roundIndex = -1;
    for (const p of r.players.values()) { p.score = 0; p.ready = false; }
    clearTimeout(r.timer);
    broadcast(r);
  });

  socket.on('disconnect', () => {
    const r = room(), p = me();
    if (!r || !p) return;
    p.connected = false;
    // si l'hote part, on transfere a un joueur connecte
    if (r.hostId === p.id) {
      const next = [...r.players.values()].find(x => x.connected);
      if (next) r.hostId = next.id;
    }
    // salon vide -> nettoyage differe
    if (![...r.players.values()].some(x => x.connected)) {
      setTimeout(() => { const rr = rooms.get(r.code); if (rr && ![...rr.players.values()].some(x => x.connected)) rooms.delete(r.code); }, 5 * 60 * 1000);
    }
    broadcast(r);
    if (r.phase === 'playing' && r.round && everyoneVoted(r)) reveal(r);
  });
});
