// music.js — import de playlists et resolution des extraits audio.
//
// Source audio : l'API publique de Deezer, qui fournit des extraits MP3 de 30s
// gratuitement, sans cle ni login. On l'appelle cote serveur (le front ne peut
// pas a cause du CORS Deezer).
//
// - Lien Deezer  -> lecture directe des pistes (chaque piste a deja son extrait).
// - Lien Spotify -> on lit la tracklist publique (identifiants Spotify requis),
//                   puis on matche chaque piste sur Deezer par ISRC (precis) ou,
//                   a defaut, par recherche artiste+titre, pour recuperer l'extrait.

const DEEZER = 'https://api.deezer.com';

// ---------- utilitaires ----------

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'whose-song/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

// Nettoie un titre pour comparer ("Song (Remastered 2011) - feat. X" -> "song")
function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')                       // parentheses / crochets
    .replace(/\b(feat|ft|featuring|with)\b.*$/i, ' ')       // featurings
    .replace(/-\s*(remaster|remastered|radio edit|live|mono|stereo|version).*$/i, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                      // ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- detection du lien ----------

// Suit les redirections des liens courts (link.deezer.com, spotify.link, etc.)
async function expandUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return res.url || url;
  } catch {
    return url;
  }
}

async function detectPlaylist(rawUrl) {
  let url = rawUrl.trim();
  if (/link\.deezer\.com|deezer\.page\.link|spotify\.link/.test(url)) {
    url = await expandUrl(url);
  }

  let m = url.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
  if (m) return { provider: 'deezer', id: m[1] };

  m = url.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/i);
  if (m) return { provider: 'spotify', id: m[1] };

  // ID Deezer brut colle tel quel
  if (/^\d{5,}$/.test(url)) return { provider: 'deezer', id: url };

  return null;
}

// ---------- Deezer ----------

async function importDeezerPlaylist(id) {
  const meta = await getJson(`${DEEZER}/playlist/${id}`);
  if (meta.error) throw new Error(`Playlist Deezer introuvable (${meta.error.message || 'erreur'})`);

  const tracks = [];
  let next = `${DEEZER}/playlist/${id}/tracks?limit=100&index=0`;
  let guard = 0;
  while (next && guard++ < 50) {
    const page = await getJson(next);
    for (const t of page.data || []) {
      if (!t.preview) continue; // pas d'extrait dispo -> inutilisable
      tracks.push({
        title: t.title_short || t.title,
        artist: t.artist && t.artist.name,
        preview: t.preview,
        cover: t.album && (t.album.cover_medium || t.album.cover),
        deezerId: t.id,
      });
    }
    next = page.next || null;
  }
  return { provider: 'deezer', name: meta.title || 'Playlist Deezer', tracks };
}

// ---------- Spotify (optionnel) ----------

let spotifyToken = { value: null, exp: 0 };

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Import Spotify non configure. Ajoute SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET " +
      "cote serveur (dashboard developpeur Spotify, gratuit), ou colle un lien Deezer."
    );
  }
  if (spotifyToken.value && Date.now() < spotifyToken.exp) return spotifyToken.value;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Authentification Spotify echouee (verifie tes identifiants).');
  const data = await res.json();
  spotifyToken = { value: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return spotifyToken.value;
}

async function fetchSpotifyTracks(id) {
  const token = await getSpotifyToken();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const meta = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name`, auth).then(r => r.json());
  const name = meta.name || 'Playlist Spotify';

  const out = [];
  let url = `https://api.spotify.com/v1/playlists/${id}/tracks?fields=next,items(track(name,artists(name),external_ids(isrc)))&limit=100`;
  let guard = 0;
  while (url && guard++ < 50) {
    const page = await fetch(url, auth).then(r => r.json());
    if (page.error) throw new Error(`Spotify: ${page.error.message}`);
    for (const it of page.items || []) {
      const t = it.track;
      if (!t) continue;
      out.push({
        title: t.name,
        artist: t.artists && t.artists[0] && t.artists[0].name,
        isrc: t.external_ids && t.external_ids.isrc,
      });
    }
    url = page.next;
  }
  return { name, spotifyTracks: out };
}

// Matche une piste Spotify sur Deezer pour recuperer l'extrait MP3.
async function matchOnDeezer(track) {
  // 1) par ISRC (tres precis)
  if (track.isrc) {
    try {
      const t = await getJson(`${DEEZER}/track/isrc:${track.isrc}`);
      if (t && t.preview && !t.error) {
        return {
          title: t.title_short || t.title,
          artist: t.artist && t.artist.name,
          preview: t.preview,
          cover: t.album && (t.album.cover_medium || t.album.cover),
          deezerId: t.id,
        };
      }
    } catch { /* on tente la recherche */ }
  }
  // 2) par recherche artiste + titre
  try {
    const q = encodeURIComponent(`artist:"${track.artist}" track:"${track.title}"`);
    const r = await getJson(`${DEEZER}/search?q=${q}&limit=5`);
    const want = normalizeTitle(track.title);
    const hit = (r.data || []).find(d => d.preview && normalizeTitle(d.title).includes(want.split(' ')[0]))
             || (r.data || []).find(d => d.preview);
    if (hit) {
      return {
        title: hit.title_short || hit.title,
        artist: hit.artist && hit.artist.name,
        preview: hit.preview,
        cover: hit.album && (hit.album.cover_medium || hit.album.cover),
        deezerId: hit.id,
      };
    }
  } catch { /* rien trouve */ }
  return null;
}

async function importSpotifyPlaylist(id) {
  const { name, spotifyTracks } = await fetchSpotifyTracks(id);
  // Matching en parallele mais par petits lots pour rester poli avec l'API Deezer.
  const tracks = [];
  const BATCH = 6;
  for (let i = 0; i < spotifyTracks.length; i += BATCH) {
    const batch = spotifyTracks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(matchOnDeezer));
    for (const r of results) if (r) tracks.push(r);
  }
  return { provider: 'spotify', name, tracks, requested: spotifyTracks.length };
}

// ---------- point d'entree ----------

async function importPlaylist(rawUrl) {
  const info = await detectPlaylist(rawUrl);
  if (!info) {
    throw new Error("Lien non reconnu. Colle un lien de playlist Deezer ou Spotify.");
  }
  const result = info.provider === 'deezer'
    ? await importDeezerPlaylist(info.id)
    : await importSpotifyPlaylist(info.id);

  if (!result.tracks.length) {
    throw new Error("Aucun extrait jouable trouve dans cette playlist.");
  }
  return result;
}

module.exports = { importPlaylist, normalizeTitle };
