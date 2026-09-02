// server.js — backend temps reel du jeu.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { importPlaylist, normalizeTitle } = require('./music');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Spotify Roulette sur http://localhost:${PORT}`));

// ---------------------------------------------------------------------------
// Etat en memoire
// ---------------------------------------------------------------------------
const rooms = new Map();

function makeCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function newRoom(code) {
  return {
    code, hostId: null, phase: 'lobby',
    players: new Map(),
    settings: { rounds: 10, blindTest: true, clipMs: 15000, mode: 'roulette' },
    songs: [], roundIndex: -1, round: null, timer: null,
  };
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const songKey = (t) => t.deezerId ? `d:${t.deezerId}` : `${normalizeTitle(t.artist)}|${normalizeTitle(t.title)}`;

const AVATARS = ['🎸', '🎹', '🎺', '🎻', '🥁', '🎤', '🎧', '🪗', '🎷', '🪘', '🪕', '🔔'];
function pickAvatar(room) {
  const used = new Set([...room.players.values()].map(p => p.avatar));
  return AVATARS.find(a => !used.has(a)) || AVATARS[room.players.size % AVATARS.length];
}

// ---------------------------------------------------------------------------
// OAuth Spotify
// ---------------------------------------------------------------------------
const SPOTIFY_CALLBACK_PATH = '/auth/spotify/callback';
function spotifyConfigured() { return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET); }

app.get('/auth/spotify', (req, res) => {
  if (!spotifyConfigured()) return res.status(500).send('Spotify non configure.');
  const { roomCode, playerId } = req.query;
  if (!roomCode || !playerId) return res.status(400).send('Parametres manquants.');
  const redirectUri = `${req.protocol}://${req.get('host')}${SPOTIFY_CALLBACK_PATH}`;
  const state = Buffer.from(JSON.stringify({ roomCode, playerId })).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: 'playlist-read-private playlist-read-collaborative',
    redirect_uri: redirectUri, state, show_dialog: 'false',
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get(SPOTIFY_CALLBACK_PATH, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send('<html><body style="background:#0a0f0a;color:#e8f5e8;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><p>Connexion annulee.</p><script>try{window.close()}catch(e){}</script></body></html>');
  let roomCode, playerId;
  try { const p = JSON.parse(Buffer.from(state, 'base64url').toString()); roomCode = p.roomCode; playerId = p.playerId; } catch { return res.status(400).send('State invalide.'); }
  const redirectUri = `${req.protocol}://${req.get('host')}${SPOTIFY_CALLBACK_PATH}`;
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64') },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const td = await tokenRes.json();
    if (td.error) throw new Error(td.error_description || td.error);
    const room = rooms.get(roomCode);
    if (room) { const player = room.players.get(playerId); if (player) { player.spotifyToken = td.access_token; player.spotifyRefreshToken = td.refresh_token || null; player.spotifyTokenExp = Date.now() + (td.expires_in || 3600) * 1000; if (player.connected) broadcast(room); } }
    res.send('<html><body style="background:#0a0f0a;color:#e8f5e8;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#1db954">Connecte a Spotify ✓</h2><p>Tu peux fermer cet onglet.</p></div><script>try{window.opener&&window.opener.postMessage({type:"spotify-connected"},"*")}catch(e){}try{window.close()}catch(e){}</script></body></html>');
  } catch (e) { console.error('Spotify OAuth error:', e.message); res.send(`<html><body style="background:#0a0f0a;color:#e8f5e8;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><p style="color:#ff6b6b">Erreur : ${e.message}</p></body></html>`); }
});

app.get('/auth/spotify/check', (_, res) => res.json({ available: spotifyConfigured() }));

// ---------------------------------------------------------------------------
// Vue publique
// ---------------------------------------------------------------------------
function publicState(room) {
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, avatar: p.avatar || '🎵', connected: p.connected, score: p.score,
    trackCount: p.tracks.length, ready: p.ready, isHost: p.id === room.hostId,
    spotifyConnected: !!p.spotifyToken,
  }));
  const base = { code: room.code, phase: room.phase, hostId: room.hostId, settings: room.settings, players };

  if (room.phase === 'playing' && room.round) {
    const r = room.round;
    const common = { index: room.roundIndex, total: room.songs.length, type: r.type, startAt: r.startAt, deadline: r.deadline, voted: [...r.votes.keys()] };
    if (r.type === 'roulette') {
      base.round = { ...common, preview: r.song.preview };
    } else {
      base.round = { ...common, artist: r.artist, direction: r.direction };
    }
  }

  if (room.phase === 'reveal' && room.round) {
    const r = room.round;
    if (r.type === 'roulette') {
      const s = r.song, owner = room.players.get(s.ownerId);
      base.round = {
        type: 'roulette', index: room.roundIndex, total: room.songs.length,
        ownerId: s.ownerId, ownerName: owner ? owner.name : '?',
        title: s.title, artist: s.artist, cover: s.cover, preview: s.preview,
        votes: [...r.votes.entries()].map(([voter, v]) => {
          let speedPts = 0, elapsedSec = 0;
          if (v.ownerId === s.ownerId) {
            const elapsed = Math.max(0, v.timestamp - r.startAt);
            const ratio = Math.min(1, elapsed / room.settings.clipMs);
            speedPts = Math.max(10, Math.round(100 - 90 * ratio));
            elapsedSec = Math.round(elapsed / 100) / 10;
          }
          return { voter, guessOwner: v.ownerId, correctOwner: v.ownerId === s.ownerId, artistGuess: v.artist || null, artistCorrect: v.artistCorrect || false, titleGuess: v.title || null, correctTitle: v.titleCorrect || false, speedPts, elapsedSec };
        }),
        deltas: r.deltas || {},
      };
    } else {
      const answerId = r.answerIds[0], answerPlayer = room.players.get(answerId);
      base.round = {
        type: 'quizplus', index: room.roundIndex, total: room.songs.length,
        artist: r.artist, direction: r.direction,
        answerId, answerName: answerPlayer ? answerPlayer.name : '?', answerCount: r.answerCount,
        counts: r.counts,
        votes: [...r.votes.entries()].map(([voter, v]) => {
          const correct = r.answerIds.includes(v.ownerId);
          let speedPts = 0, elapsedSec = 0;
          if (correct) {
            const elapsed = Math.max(0, v.timestamp - r.startAt);
            const ratio = Math.min(1, elapsed / room.settings.clipMs);
            speedPts = Math.max(10, Math.round(100 - 90 * ratio));
            elapsedSec = Math.round(elapsed / 100) / 10;
          }
          return { voter, guessOwner: v.ownerId, correctOwner: correct, speedPts, elapsedSec };
        }),
        deltas: r.deltas || {},
      };
    }
  }

  if (room.phase === 'finished') {
    base.ranking = [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  }
  return base;
}

function broadcast(room) { io.to(room.code).emit('state', publicState(room)); }

// ---------------------------------------------------------------------------
// Construction des pools
// ---------------------------------------------------------------------------
function buildRoulettePool(room) {
  const owners = new Map();
  for (const p of room.players.values()) {
    const seen = new Set();
    for (const t of p.tracks) { const k = songKey(t); if (seen.has(k)) continue; seen.add(k); if (!owners.has(k)) owners.set(k, { track: t, ownerIds: new Set() }); owners.get(k).ownerIds.add(p.id); }
  }
  const byOwner = new Map();
  for (const { track, ownerIds } of owners.values()) {
    if (ownerIds.size !== 1) continue;
    const ownerId = [...ownerIds][0];
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push({ ...track, ownerId });
  }
  for (const songs of byOwner.values()) shuffle(songs);
  const players = [...byOwner.keys()], indices = new Map(players.map(p => [p, 0])), balanced = [];
  let added = true;
  while (added) { added = false; for (const pid of players) { const songs = byOwner.get(pid); const i = indices.get(pid); if (i < songs.length) { balanced.push(songs[i]); indices.set(pid, i + 1); added = true; } } }
  // Retourne la liste equilibree (round-robin) SANS shuffle
  // Le shuffle se fait dans startGame APRES le slice pour garder l'equilibre
  return balanced.map(song => ({ type: 'roulette', song }));
}

function buildQuizPlusPool(room) {
  const artistData = new Map();
  for (const p of room.players.values()) {
    for (const t of p.tracks) {
      if (!t.artist) continue;
      const norm = normalizeTitle(t.artist);
      if (!norm) continue;
      if (!artistData.has(norm)) artistData.set(norm, { display: t.artist, players: new Map() });
      const d = artistData.get(norm);
      d.players.set(p.id, (d.players.get(p.id) || 0) + 1);
    }
  }
  const connected = [...room.players.values()].filter(p => p.connected);
  const questions = [];
  for (const [, data] of artistData) {
    // Remplir 0 pour les joueurs qui n'ont pas cet artiste
    for (const p of connected) { if (!data.players.has(p.id)) data.players.set(p.id, 0); }
    const entries = [...data.players.entries()].sort((a, b) => b[1] - a[1]);
    const maxC = entries[0][1], minC = entries[entries.length - 1][1];
    if (maxC === minC || maxC === 0) continue; // tous pareil ou personne -> pas interessant
    const maxIds = entries.filter(([, c]) => c === maxC).map(([id]) => id);
    const minIds = entries.filter(([, c]) => c === minC).map(([id]) => id);
    questions.push({ type: 'quizplus', artist: data.display, direction: 'plus', counts: Object.fromEntries(data.players), answerIds: maxIds, answerCount: maxC });
    questions.push({ type: 'quizplus', artist: data.display, direction: 'moins', counts: Object.fromEntries(data.players), answerIds: minIds, answerCount: minC });
  }
  console.log(`QuizPlus: ${artistData.size} artistes analyses, ${questions.length} questions generees`);
  return shuffle(questions);
}

function buildGamePool(room) {
  const mode = room.settings.mode || 'roulette';
  if (mode === 'roulette') return buildRoulettePool(room);
  if (mode === 'quizplus') return buildQuizPlusPool(room);
  // mixed : interleave roulette et quiz
  const r = buildRoulettePool(room), q = buildQuizPlusPool(room), mix = [];
  console.log(`Mixed pool: ${r.length} roulette, ${q.length} quiz`);
  let ri = 0, qi = 0;
  while (ri < r.length || qi < q.length) { if (ri < r.length) mix.push(r[ri++]); if (qi < q.length) mix.push(q[qi++]); }
  // Retourne le mix equilibre, le shuffle se fera dans startGame apres le slice
  return mix;
}

// ---------------------------------------------------------------------------
// Deroulement
// ---------------------------------------------------------------------------
function startGame(room) {
  const pool = buildGamePool(room);
  if (pool.length === 0) { io.to(room.code).emit('error:msg', "Pas assez de morceaux ou d'artistes en commun. Ajoutez plus de playlists."); return; }
  // Slice d'abord (garde l'equilibre round-robin), puis shuffle (ordre aleatoire)
  const selected = pool.slice(0, Math.min(room.settings.rounds, pool.length));
  room.songs = shuffle(selected);
  for (const p of room.players.values()) { p.score = 0; p.ready = false; }
  room.roundIndex = -1;
  room.phase = 'lobby-ready';
  broadcast(room);
}

function maybeStartFirstRound(room) {
  if (room.phase !== 'lobby-ready') return;
  const active = [...room.players.values()].filter(p => p.connected);
  if (active.length && active.every(p => p.ready)) nextRound(room);
}

function nextRound(room) {
  clearTimeout(room.timer);
  if (room.phase === 'playing' && room.round && !room.round.revealed) return;
  room.roundIndex++;
  if (room.roundIndex >= room.songs.length) return endGame(room);
  const desc = room.songs[room.roundIndex];
  const startAt = Date.now() + 3000;
  const duration = desc.type === 'quizplus' ? 10000 : room.settings.clipMs;
  const deadline = startAt + duration;
  if (desc.type === 'roulette') {
    room.round = { type: 'roulette', song: desc.song, startAt, deadline, votes: new Map(), revealed: false, deltas: null };
  } else {
    room.round = { type: 'quizplus', artist: desc.artist, direction: desc.direction, counts: desc.counts, answerIds: desc.answerIds, answerCount: desc.answerCount, startAt, deadline, votes: new Map(), revealed: false, deltas: null };
  }
  room.phase = 'playing';
  broadcast(room);
  room.timer = setTimeout(() => reveal(room), (deadline - Date.now()) + 500);
}

function reveal(room) {
  clearTimeout(room.timer);
  if (!room.round || room.round.revealed) return;
  room.round.revealed = true;
  const r = room.round;
  const deltas = {};
  const add = (id, n) => { deltas[id] = (deltas[id] || 0) + n; };

  if (r.type === 'roulette') {
    const s = r.song; let fooled = 0;
    for (const [voterId, v] of r.votes.entries()) {
      if (v.ownerId === s.ownerId) {
        const elapsed = Math.max(0, v.timestamp - r.startAt), ratio = Math.min(1, elapsed / room.settings.clipMs);
        add(voterId, Math.max(10, Math.round(100 - 90 * ratio)));
      } else if (voterId !== s.ownerId) { fooled++; }
      if (v.artistCorrect) add(voterId, 25);
      if (v.titleCorrect) add(voterId, 50);
    }
    if (fooled > 0) add(s.ownerId, fooled * 20);
  } else {
    for (const [voterId, v] of r.votes.entries()) {
      if (r.answerIds.includes(v.ownerId)) {
        const elapsed = Math.max(0, v.timestamp - r.startAt), ratio = Math.min(1, elapsed / room.settings.clipMs);
        add(voterId, Math.max(10, Math.round(100 - 90 * ratio)));
      }
    }
  }

  for (const [id, n] of Object.entries(deltas)) { const p = room.players.get(id); if (p) p.score += n; }
  r.deltas = deltas;
  room.phase = 'reveal';
  broadcast(room);
}

function endGame(room) { clearTimeout(room.timer); room.phase = 'finished'; room.round = null; broadcast(room); }

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let joined = null;
  const room = () => joined && rooms.get(joined.code);
  const me = () => { const r = room(); return r && r.players.get(joined.playerId); };
  const isHost = () => { const r = room(); return r && r.hostId === joined.playerId; };
  function attach(r, player) { joined = { code: r.code, playerId: player.id }; socket.join(r.code); }

  socket.on('room:create', ({ name }, cb) => {
    const code = makeCode(), r = newRoom(code); rooms.set(code, r);
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const player = { id, name: (name || 'Joueur').slice(0, 20), avatar: pickAvatar(r), socketId: socket.id, connected: true, score: 0, tracks: [], ready: false };
    r.players.set(id, player); r.hostId = id; attach(r, player);
    cb && cb({ ok: true, code, playerId: id }); socket.emit('state', publicState(r)); broadcast(r);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    code = (code || '').toUpperCase().trim(); const r = rooms.get(code);
    if (!r) return cb && cb({ ok: false, error: "Salon introuvable." });
    name = (name || 'Joueur').slice(0, 20);
    let player = [...r.players.values()].find(p => p.name.toLowerCase() === name.toLowerCase() && !p.connected);
    if (player) { player.connected = true; player.socketId = socket.id; }
    else { if (r.phase !== 'lobby') return cb && cb({ ok: false, error: "Partie deja commencee." }); const id = 'p_' + Math.random().toString(36).slice(2, 9); player = { id, name, avatar: pickAvatar(r), socketId: socket.id, connected: true, score: 0, tracks: [], ready: false }; r.players.set(id, player); }
    attach(r, player); cb && cb({ ok: true, code, playerId: player.id }); socket.emit('state', publicState(r)); broadcast(r);
  });

  socket.on('room:rejoin', ({ code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim(); const r = rooms.get(code);
    if (!r) return cb && cb({ ok: false, error: "Salon introuvable." });
    const player = r.players.get(playerId);
    if (!player) return cb && cb({ ok: false, error: "Joueur introuvable." });
    player.connected = true; player.socketId = socket.id; attach(r, player);
    cb && cb({ ok: true, code, playerId: player.id }); socket.emit('state', publicState(r)); broadcast(r);
  });

  socket.on('playlist:add', async ({ url }, cb) => {
    const r = room(), p = me();
    if (!r || !p) return cb && cb({ ok: false, error: "Rejoins un salon d'abord." });
    if (r.phase !== 'lobby') return cb && cb({ ok: false, error: "Trop tard." });
    try {
      const result = await importPlaylist(url, p.spotifyToken || null);
      const existing = new Set(p.tracks.map(songKey)); let added = 0;
      for (const t of result.tracks) { if (!existing.has(songKey(t))) { p.tracks.push(t); existing.add(songKey(t)); added++; } }
      cb && cb({ ok: true, name: result.name, added, total: p.tracks.length, matched: result.tracks.length, requested: result.requested, savedTracks: result.tracks.map(t => ({ title: t.title, artist: t.artist, preview: t.preview, cover: t.cover, deezerId: t.deezerId })) });
      broadcast(r);
    } catch (e) { cb && cb({ ok: false, error: e.message || "Import impossible." }); }
  });

  socket.on('playlist:clear', (cb) => { const p = me(), r = room(); if (p) { p.tracks = []; broadcast(r); } cb && cb({ ok: true }); });

  socket.on('playlist:load', ({ name, tracks }, cb) => {
    const r = room(), p = me();
    if (!r || !p) return cb && cb({ ok: false, error: "Rejoins un salon d'abord." });
    if (r.phase !== 'lobby') return cb && cb({ ok: false, error: "Trop tard." });
    if (!Array.isArray(tracks)) return cb && cb({ ok: false, error: "Donnees invalides." });
    const existing = new Set(p.tracks.map(songKey)); let added = 0;
    for (const t of tracks) { if (!t.title || !t.preview) continue; if (!existing.has(songKey(t))) { p.tracks.push(t); existing.add(songKey(t)); added++; } }
    cb && cb({ ok: true, name: name || 'Playlist', added, total: p.tracks.length }); broadcast(r);
  });

  socket.on('settings:update', (s) => {
    const r = room(); if (!r || !isHost() || r.phase !== 'lobby') return;
    if (typeof s.rounds === 'number') r.settings.rounds = Math.max(1, Math.min(50, s.rounds | 0));
    if (typeof s.blindTest === 'boolean') r.settings.blindTest = s.blindTest;
    if (typeof s.mode === 'string' && ['roulette', 'quizplus', 'mixed'].includes(s.mode)) r.settings.mode = s.mode;
    broadcast(r);
  });

  socket.on('game:start', () => {
    const r = room(); if (!r || !isHost() || r.phase !== 'lobby') return;
    if ([...r.players.values()].filter(p => p.connected).length < 2) return io.to(r.code).emit('error:msg', "Il faut au moins 2 joueurs.");
    startGame(r);
  });

  socket.on('player:ready', () => { const r = room(), p = me(); if (!r || !p) return; p.ready = true; broadcast(r); if (r.phase === 'lobby-ready') maybeStartFirstRound(r); });

  socket.on('round:guess', ({ ownerId }) => {
    const r = room(), p = me();
    if (!r || !p || r.phase !== 'playing' || !r.round) return;
    if (r.round.votes.has(p.id)) return;
    const correct = r.round.type === 'roulette' ? ownerId === r.round.song.ownerId : r.round.answerIds.includes(ownerId);
    r.round.votes.set(p.id, { ownerId, timestamp: Date.now(), artist: null, artistCorrect: false, title: null, titleCorrect: false });
    socket.emit('round:your-result', { correct });
    if (correct) io.to(r.code).emit('round:found', { name: p.name, avatar: p.avatar || '🎵' });
    broadcast(r);
  });

  socket.on('round:guess-artist', ({ artist }) => {
    const r = room(), p = me();
    if (!r || !p || r.phase !== 'playing' || !r.round || r.round.type !== 'roulette') return;
    const vote = r.round.votes.get(p.id); if (!vote || vote.ownerId !== r.round.song.ownerId || vote.artist !== null) return;
    let artistCorrect = false;
    if (r.settings.blindTest && artist) { const g = normalizeTitle(artist), real = normalizeTitle(r.round.song.artist); artistCorrect = !!g && (real.includes(g) || g.includes(real) || real.split(' ').filter(w => w.length > 2 && g.includes(w)).length >= Math.min(2, real.split(' ').length)); }
    vote.artist = artist || null; vote.artistCorrect = artistCorrect;
    socket.emit('round:artist-result', { correct: artistCorrect }); broadcast(r);
  });

  socket.on('round:guess-title', ({ title }) => {
    const r = room(), p = me();
    if (!r || !p || r.phase !== 'playing' || !r.round || r.round.type !== 'roulette') return;
    const vote = r.round.votes.get(p.id); if (!vote || !vote.artistCorrect || vote.title !== null) return;
    let titleCorrect = false;
    if (r.settings.blindTest && title) { const g = normalizeTitle(title), real = normalizeTitle(r.round.song.title); titleCorrect = !!g && (real.includes(g) || g.includes(real) || real.split(' ').filter(w => w.length > 2 && g.includes(w)).length >= Math.min(2, real.split(' ').length)); }
    vote.title = title || null; vote.titleCorrect = titleCorrect; broadcast(r);
  });

  socket.on('round:next', () => { const r = room(); if (!r || !isHost() || r.phase !== 'reveal') return; nextRound(r); });

  socket.on('game:restart', () => {
    const r = room(); if (!r || !isHost()) return;
    r.phase = 'lobby'; r.songs = []; r.round = null; r.roundIndex = -1;
    for (const p of r.players.values()) { p.score = 0; p.ready = false; }
    clearTimeout(r.timer); broadcast(r);
  });

  socket.on('game:stop', () => {
    const r = room(); if (!r || !isHost()) return; clearTimeout(r.timer);
    if (r.phase === 'lobby') { io.to(r.code).emit('room:closed'); rooms.delete(r.code); }
    else { r.phase = 'finished'; r.round = null; broadcast(r); }
  });

  socket.on('player:kick', ({ playerId }) => {
    const r = room(); if (!r || !isHost() || playerId === r.hostId) return;
    const target = r.players.get(playerId); if (!target) return;
    const ts = io.sockets.sockets.get(target.socketId);
    if (ts) { ts.emit('kicked'); ts.leave(r.code); }
    r.players.delete(playerId); broadcast(r);
  });

  socket.on('disconnect', () => {
    const r = room(), p = me(); if (!r || !p) return;
    if (p.socketId !== socket.id) return;
    p.connected = false;
    if (r.hostId === p.id) { const next = [...r.players.values()].find(x => x.connected); if (next) r.hostId = next.id; }
    if (![...r.players.values()].some(x => x.connected)) { setTimeout(() => { const rr = rooms.get(r.code); if (rr && ![...rr.players.values()].some(x => x.connected)) rooms.delete(r.code); }, 5 * 60 * 1000); }
    broadcast(r);
  });
});
