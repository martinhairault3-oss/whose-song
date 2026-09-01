:root {
  --bg: #0a0f0a;
  --bg-2: #111a11;
  --surface: rgba(255, 255, 255, .055);
  --surface-2: rgba(255, 255, 255, .09);
  --line: rgba(255, 255, 255, .12);
  --ink: #e8f5e8;
  --muted: #8fb89a;
  --green: #1DB954;
  --green-light: #1ed760;
  --amber: #ffc24b;
  --cyan: #3de1c9;
  --teal: #17d1a6;
  --wrong: #ff6b6b;
  --spotify: #1db954;
  --radius: 18px;
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  color: var(--ink);
  background: var(--bg);
  background-image:
    radial-gradient(60vw 60vw at 12% -8%, rgba(29, 185, 84, .22), transparent 60%),
    radial-gradient(50vw 50vw at 100% 0%, rgba(30, 215, 96, .16), transparent 55%),
    radial-gradient(55vw 55vw at 50% 115%, rgba(23, 209, 166, .12), transparent 60%);
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}

#app {
  max-width: 620px;
  margin: 0 auto;
  padding: 22px 18px 40px;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.screen { display: none; flex: 1; flex-direction: column; gap: 18px; }
.screen.active { display: flex; animation: rise .32s ease both; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }

/* ---------- typographie ---------- */
h1.brand {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(34px, 9vw, 54px);
  line-height: .95;
  letter-spacing: -.02em;
}
h1.brand em { font-style: normal; color: var(--green); }
.tagline { color: var(--muted); font-size: 15px; max-width: 42ch; }
h2 { font-family: var(--font-display); font-weight: 700; font-size: 24px; letter-spacing: -.01em; }
.small { font-size: 13px; color: var(--muted); }

/* ---------- controles ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px;
}

input[type="text"], input[type="number"] {
  width: 100%;
  font: inherit;
  color: var(--ink);
  background: rgba(0, 0, 0, .28);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 13px 15px;
}
input::placeholder { color: #7d7196; }
input:focus-visible { outline: 2px solid var(--violet); outline-offset: 1px; }

button {
  font: inherit;
  cursor: pointer;
  border: none;
  border-radius: 13px;
  padding: 13px 18px;
  color: var(--ink);
  background: var(--surface-2);
  transition: transform .08s ease, filter .15s ease;
}
button:active { transform: translateY(1px) scale(.995); }
button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
button:disabled { opacity: .45; cursor: not-allowed; }

.btn-primary {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 18px;
  background: linear-gradient(135deg, var(--green), var(--teal));
  color: #0a0f0a;
  padding: 16px 20px;
}
.btn-primary:hover { filter: brightness(1.06); }
.btn-ghost { background: transparent; border: 1px solid var(--line); }
.row { display: flex; gap: 10px; }
.row > * { flex: 1; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.grow { flex: 1; }
label.field { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }

/* ---------- bouton Spotify ---------- */
.btn-spotify {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 15px;
  background: var(--spotify);
  color: #fff;
  padding: 12px 18px;
  border-radius: 999px;
  width: 100%;
}
.btn-spotify:hover:not(:disabled) { filter: brightness(1.1); }
.btn-spotify.connected {
  background: transparent;
  border: 1px solid var(--spotify);
  color: var(--spotify);
}

.spotify-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--spotify);
  background: rgba(29, 185, 84, .15);
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: .04em;
}

/* ---------- accueil ---------- */
.home-hero { margin: 8px 0 6px; }
.divider { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }
.divider::before, .divider::after { content: ""; height: 1px; background: var(--line); flex: 1; }

/* ---------- lobby ---------- */
.code-pill {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 30px;
  letter-spacing: .28em;
  padding: 10px 18px 10px 24px;
  background: rgba(0, 0, 0, .3);
  border: 1px dashed var(--line);
  border-radius: 14px;
  display: inline-flex;
  gap: 12px;
  align-items: center;
}
.players { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 13px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--line);
  font-size: 14px;
}
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); }
.chip.off .dot { background: #6b6280; }
.chip .host { color: var(--amber); font-size: 12px; }
.chip .count { color: var(--muted); font-size: 12px; }

.toggle { display: flex; align-items: center; gap: 10px; }
.toggle input { width: 44px; height: 26px; appearance: none; background: rgba(0,0,0,.35); border: 1px solid var(--line); border-radius: 999px; position: relative; cursor: pointer; }
.toggle input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: var(--muted); transition: .18s; }
.toggle input:checked { background: linear-gradient(135deg, var(--green), var(--teal)); }
.toggle input:checked::after { left: 20px; background: #fff; }

/* ---------- vinyle (element signature) ---------- */
.stage { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 8px 0; }
.disc {
  --size: min(66vw, 300px);
  width: var(--size); height: var(--size);
  border-radius: 50%;
  position: relative;
  background:
    repeating-radial-gradient(circle at 50% 50%, #0c0712 0 2px, #17101f 2px 4px);
  box-shadow: 0 0 0 6px #050a05, 0 24px 60px rgba(0,0,0,.55), 0 0 80px rgba(29,185,84,.18);
}
.disc::before {
  content: ""; position: absolute; inset: 27%;
  border-radius: 50%;
  background: conic-gradient(from 0deg, var(--green), var(--amber), var(--cyan), var(--teal), var(--green));
}
.disc::after {
  content: ""; position: absolute; inset: 45%;
  border-radius: 50%; background: #050a05; border: 3px solid #132213;
}
.disc.spinning { animation: spin 3.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.disc .cover {
  position: absolute; inset: 27%; border-radius: 50%; object-fit: cover;
  opacity: 0; transition: opacity .4s ease;
}
.disc.revealed .cover { opacity: 1; }
.disc.revealed::before { opacity: 0; }

.timer-ring { font-family: var(--font-display); font-weight: 700; font-size: 15px; color: var(--muted); }
.timer-ring b { color: var(--amber); font-size: 22px; }
.countdown {
  font-family: var(--font-display); font-weight: 800;
  font-size: clamp(60px, 22vw, 120px); color: var(--amber); line-height: 1;
}

/* ---------- vote ---------- */
.guess-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.guess-btn {
  font-family: var(--font-display); font-weight: 700; font-size: 17px;
  padding: 16px 12px; border: 1px solid var(--line); background: var(--surface);
}
.guess-btn.picked { background: linear-gradient(135deg, var(--green), var(--teal)); color: #fff; border-color: transparent; }
.guess-btn:disabled { opacity: .8; }

/* ---------- reveal ---------- */
.owner-tag { text-align: center; }
.owner-tag .who { font-family: var(--font-display); font-weight: 800; font-size: 30px; }
.owner-tag .song { color: var(--muted); }
.result-line { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); }
.result-line .verdict.ok { color: var(--cyan); }
.result-line .verdict.no { color: var(--wrong); }
.result-line .title-guess { color: var(--muted); font-style: italic; font-size: 13px; }
.delta { font-family: var(--font-display); font-weight: 700; color: var(--amber); }

/* ---------- classement ---------- */
.rank { display: flex; flex-direction: column; gap: 8px; }
.rank .row-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); }
.rank .row-item .pos { font-family: var(--font-display); font-weight: 800; width: 28px; color: var(--muted); }
.rank .row-item.first { background: linear-gradient(135deg, rgba(29,185,84,.22), rgba(255,194,75,.14)); border-color: rgba(29,185,84,.5); }
.rank .row-item.first .pos { color: var(--amber); }
.rank .row-item .pts { margin-left: auto; font-family: var(--font-display); font-weight: 700; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(20px);
  background: #0f1f12; border: 1px solid var(--green); color: var(--ink);
  padding: 12px 18px; border-radius: 12px; font-size: 14px; max-width: 90vw;
  opacity: 0; pointer-events: none; transition: .25s; z-index: 50;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

.hint { color: var(--muted); font-size: 13px; text-align: center; }

/* ---------- kick + stop ---------- */
.kick-btn {
  background: transparent; border: none; color: var(--wrong);
  font-size: 14px; padding: 0 2px 0 6px; cursor: pointer;
  opacity: .6; transition: opacity .15s;
}
.kick-btn:hover { opacity: 1; }

.btn-danger {
  color: var(--wrong); border-color: var(--wrong);
  font-size: 14px; padding: 10px 16px; margin-top: 4px;
}

.result-line.first-rank { border-color: rgba(255,194,75,.4); }
.result-line .pts { font-family: var(--font-display); font-weight: 700; color: var(--amber); }

/* ---------- playlists sauvegardees ---------- */
.saved-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--line);
}
.saved-name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.saved-btns { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.saved-btn { font-size: 12px; padding: 6px 12px; }

/* ---------- notifications "a trouvé" ---------- */
.found-feed {
  position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px;
  z-index: 40; pointer-events: none;
}
.found-msg {
  background: rgba(61, 225, 201, .15);
  border: 1px solid var(--cyan); color: var(--cyan);
  padding: 8px 18px; border-radius: 999px;
  font-size: 14px; font-weight: 600; white-space: nowrap;
  animation: foundPop .3s ease, foundFade .5s ease 2s forwards;
}
@keyframes foundPop { from { opacity: 0; transform: scale(.8) translateY(-8px); } }
@keyframes foundFade { to { opacity: 0; transform: translateY(-10px); } }

@media (prefers-reduced-motion: reduce) {
  .disc.spinning { animation: none; }
  .screen.active { animation: none; }
}
