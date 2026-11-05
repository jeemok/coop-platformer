// Authoritative game server (Node + ws).
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { LEVELS } = require('./levels');
const license = require('./license');
const { Sim, TILE, PW, PH, ov, box } = require('./sim');

const PORT = +process.env.PORT || 3000;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 10;
const FREE_PLAYERS = +process.env.FREE_PLAYERS || 5; // rooms above this need the paid unlock (up to MAX_PLAYERS)
const DONATE_URL = process.env.DONATE_URL || 'https://buymeacoffee.com/jeemok';
const BUY_URL = process.env.BUY_URL || '';
const MAX_ROOMS = +process.env.MAX_ROOMS || 50;
const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];
const START_LEVEL = Math.max(0, (+process.env.START_LEVEL || 1) - 1); // dev only: START_LEVEL=6 starts new rooms on level 6
const DT = 1 / 60, MAX_QUEUE = 30, IDLE_TICKS = 30, STARVE_TICKS = 6, ZERO = { l: 0, r: 0, j: 0 };

class Room {
  constructor(code, startLevel) {
    this.code = code; this.unlocked = false; this.screens = new Set(); this.sim = new Sim([]); this.players = this.sim.players; this.tick = 0; this.load(startLevel == null ? START_LEVEL : startLevel);
  }
  cap() { return this.unlocked ? MAX_PLAYERS : FREE_PLAYERS; }
  get grid() { return this.sim.grid; }
  solid(tx, ty) { return this.sim.solid(tx, ty); }
  load(i) {
    const L = typeof i === 'object' ? i : LEVELS[i % LEVELS.length]; // (an object = a test fixture level)
    this.li = typeof i === 'object' ? 0 : i % LEVELS.length;
    this.level = L; this.sim.setGrid(L.grid);
    this.doors = []; this.spikes = []; this.buttons = []; this.gates = []; this.cps = []; this.spawnCol = +process.env.SPAWN_COL || L.spawn.x; // (SPAWN_COL: dev only, start further along) this.gateT = 0; this.sim.gateOpen = false;
    L.grid.forEach((row, ty) => [...row].forEach((c, tx) => {
      if (c === 'D') this.doors.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
      if (c === 'B') this.buttons.push({ x: tx * TILE + 2, y: ty * TILE + 18, w: TILE - 4, h: TILE - 18 });
      if (c === 'G') this.gates.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
      if (c === 'C') this.cps.push({ x: tx * TILE + 8, y: ty * TILE, w: TILE - 16, h: TILE, col: tx - 10 }); // checkpoint flag: respawns move here
      if (c === '^') this.spikes.push({ x: tx * TILE + 6, y: ty * TILE + 16, w: TILE - 12, h: TILE - 16 });
    }));
    this.home = { x: L.key.x * TILE + 6, y: L.key.y * TILE + 6 };
    this.key = { x: this.home.x, y: this.home.y, holder: null, gone: false };
    this.doorOpen = false; this.win = 0;
    this.pt = 0; this.sim.setMovers(L.movers);
    for (const p of this.players.values()) this.spawn(p);
    this.send(this.lvlMsg());
  }
  lvlMsg() { const L = this.level; return { t: 'lvl', name: L.name, min: L.min, hint: L.hint, n: this.li + 1, of: LEVELS.length, grid: L.grid, mv: L.movers }; }
  spawn(p) {
    const sp = { x: this.spawnCol, y: this.level.spawn.y };
    p.x = sp.x * TILE + p.slot * (PW + 2); p.y = (sp.y + 1) * TILE - PH - 1;
    p.vx = p.vy = 0; p.dead = 0; p.onGround = false;
    // never respawn inside someone: drop in from above onto their head instead
    for (let n = 0; n < 40 && [...this.players.values()].some(o => o !== p && !o.dead && ov(box(p), box(o))); n++) p.y -= PH;
  }
  send(m, except) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); for (const w of this.screens) if (w.readyState === 1) w.send(s); } // (screens = big displays in one-screen mode: they watch, they are not players)
  roster() { this.send({ t: 'roster', scr: this.screens.size, cap: this.cap(), unlocked: this.unlocked, host: this.players.keys().next().value, p: [...this.players.values()].map(p => ({ id: p.id, nick: p.nick, color: COLORS[p.slot] })) }); }

  // Client inputs are numbered and queued; exactly one is consumed per server tick, so the server's
  // result depends only on the input sequence (not on packet timing) and a client cannot run fast.
  onInput(p, m) {
    if (typeof m.s === 'number') {
      p.usesQueue = true;
      if (p.queue.length >= MAX_QUEUE) p.queue.shift();
      p.queue.push({ s: m.s | 0, l: m.l ? 1 : 0, r: m.r ? 1 : 0, j: m.j ? 1 : 0 });
    } else { p.input = { l: m.l ? 1 : 0, r: m.r ? 1 : 0, j: m.j ? 1 : 0 }; p.lastIn = Date.now(); } // unnumbered: phone controllers, bots/tests
  }
  // Per tick a player normally advances by exactly ONE queued input, so the server's result depends on
  // the input sequence, not on packet timing (the client's replay matches). Two jitter cases:
  //  - queue empty (packet late): the player simply doesn't advance for up to STARVE_TICKS, instead of
  //    repeating the last input and drifting away from the client's prediction;
  //  - backlog (>3 queued, e.g. after a stall): consume two per tick to catch up, limited by a small
  //    credit bucket (~10% extra speed sustained) so nobody can speed-hack by flooding inputs.
  consumeInputs() {
    for (const p of this.players.values()) {
      if (!p.usesQueue) { if (p.pad && Date.now() - p.lastIn > 1500) p.input = ZERO; p.todo = [p.input]; continue; } // a phone that went quiet must not keep running
      let n = p.queue.length > 3 && p.credit >= 1 ? 2 : 1;
      if (n === 2) p.credit -= 1;
      p.credit = Math.min(12, p.credit + 0.1);
      p.todo = [];
      while (n-- > 0 && p.queue.length) { const inp = p.queue.shift(); p.input = inp; p.ack = inp.s; p.todo.push(inp); }
      if (p.todo.length) p.idle = 0;
      else if (++p.idle > STARVE_TICKS) p.todo = [p.idle > IDLE_TICKS ? ZERO : p.input]; // really gone: coast, then stop
    }
  }
  die(p) {
    p.dead = 1.5;
    if (this.key.holder === p.id) { this.key.holder = null; this.key.x = this.home.x; this.key.y = this.home.y; }
  }
  update(dt) {
    this.consumeInputs();
    this.pt++; for (const p of this.sim.movePlatforms(this.pt, null)) this.die(p); // platforms carry/push/crush
    if (this.win > 0) { this.win -= dt; if (this.win <= 0) this.load(this.li + 1); return; }
    for (const p of this.players.values()) {
      if (p.dead) { p.dead -= dt; if (p.dead <= 0) this.spawn(p); continue; }
      for (const inp of p.todo) {
        this.sim.stepPlayer(p, inp, dt);
        if (p.y > this.sim.rows * TILE + 60 || this.spikes.some(s => ov(box(p), s))) { this.die(p); break; }
      }
    }
    for (const p of this.players.values()) if (!p.dead && this.sim.hazards.some(h => ov(box(p), h))) this.die(p); // saw blades
    const alive = [...this.players.values()].filter(p => !p.dead);
    if (this.buttons.length) { // timed button: opens the gate for GATE_TIME s; stays open while anyone is inside it
      if (alive.some(p => this.buttons.some(b => ov(box(p), b)))) this.gateT = this.level.gateTime;
      else if (this.gateT > 0) this.gateT -= dt;
      if (alive.some(p => this.gates.some(g => ov(box(p), g)))) this.gateT = Math.max(this.gateT, 0.6);
      this.sim.gateOpen = this.gateT > 0;
    }
    for (const c of this.cps) if (c.col > this.spawnCol && alive.some(p => ov(box(p), c))) this.spawnCol = c.col; // reached a checkpoint
    const k = this.key;
    if (!k.gone) {
      if (k.holder == null) {
        const kb = { x: k.x, y: k.y, w: 20, h: 20 };
        const t = alive.find(p => ov(box(p), kb));
        if (t) k.holder = t.id;
      }
      const h = k.holder != null && this.players.get(k.holder);
      if (h) {
        k.x = h.x + 2; k.y = h.y - 22;
        if (this.doors.some(d => ov(box(h), d))) { this.doorOpen = true; k.gone = true; k.holder = null; }
      }
    }
    if (this.doorOpen && this.players.size > 0 && [...this.players.values()].every(p => !p.dead && this.doors.some(d => ov(box(p), d)))) this.win = 2.5;
  }
  // entry: [id, x, y, dead, vy, onGround, ack]   (vy/onGround/ack are used by the owner's prediction)
  snap() {
    const r2 = v => Math.round(v * 100) / 100;
    this.send({ t: 's', p: [...this.players.values()].map(p => [p.id, r2(p.x), r2(p.y), p.dead ? 1 : 0, Math.round(p.vy), p.onGround ? 1 : 0, p.ack]),
      k: this.key.gone ? null : [Math.round(this.key.x), Math.round(this.key.y), this.key.holder || 0], pt: this.pt, c: this.spawnCol, d: this.doorOpen ? 1 : 0, g: this.gateT > 0 ? Math.round(this.gateT * 10) / 10 : 0, w: this.win > 0 ? 1 : 0 });
  }
  add(ws, nick, pad) {
    const used = new Set([...this.players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const p = { id: ++nextId, ws, nick, slot, input: { l: 0, r: 0, j: 0 }, queue: [], todo: [], credit: 12, ack: 0, idle: 0, usesQueue: false, pad: !!pad, lastIn: 0, x: 0, y: 0, vx: 0, vy: 0, dead: 0, onGround: false };
    this.players.set(p.id, p); this.spawn(p); return p;
  }
  remove(p) {
    if (this.key.holder === p.id) { this.key.holder = null; this.key.x = this.home.x; this.key.y = this.home.y; }
    this.players.delete(p.id); this.roster();
  }
}
let nextId = 0;
const rooms = new Map();

const LEVEL_LIST = JSON.stringify(LEVELS.map(l => ({ name: l.name, min: l.min })));
const STATIC = { '/': ['public/index.html', 'text/html'], '/pad': ['public/pad.html', 'text/html'], '/llms.txt': ['public/llms.txt', 'text/plain; charset=utf-8'], '/sim.js': ['sim.js', 'text/javascript'], '/predict.js': ['predict.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/config.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify({ donate: DONATE_URL, buy: BUY_URL, free: FREE_PLAYERS, max: MAX_PLAYERS })); }
  if (url === '/levels.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(LEVEL_LIST); }
  const f = STATIC[url];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(path.join(__dirname, f[0])));
});
const wss = new WebSocketServer({ server, maxPayload: 512 });

wss.on('connection', ws => {
  let room = null, me = null, busy = false, badKeys = 0;
  const tryKey = async key => { if (badKeys >= 5) return false; const ok = await license.check(key); if (!ok) badKeys++; return ok; };
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (busy) return;
    if (!room) {
      if (m.t !== 'join') return;
      busy = true; try { var paid = m.key ? await tryKey(m.key) : false; } finally { busy = false; } if (room) return;
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return ws.send(JSON.stringify({ t: 'err', m: 'Bad room code' }));
      let r = rooms.get(code);
      if (!r) {
        if (rooms.size >= MAX_ROOMS) return ws.send(JSON.stringify({ t: 'err', m: 'Servers full, try again shortly' }));
        const lv = Number.isInteger(m.level) && m.level >= 0 && m.level < LEVELS.length ? m.level : undefined; // creator picks the start level
        r = new Room(code, lv); rooms.set(code, r);
        if (paid) r.unlocked = true; // the creator paid: this room holds up to MAX_PLAYERS
      } else if (paid && !r.unlocked && r.players.size === 0) r.unlocked = true;
      room = r;
      if (m.role === 'screen') { // one-screen mode: this connection only watches (and can pick levels); phones join as players
        me = { screen: true }; r.screens.add(ws);
        ws.send(JSON.stringify({ t: 'welcome', id: 0, code, screen: 1 })); ws.send(JSON.stringify(r.lvlMsg())); r.roster(); return;
      }
      if (r.players.size >= r.cap()) { room = null; return ws.send(JSON.stringify(r.unlocked ? { t: 'err', m: `Room full (max ${MAX_PLAYERS})` } : { t: 'err', m: `Room full: free rooms hold ${FREE_PLAYERS} players. The host can unlock up to ${MAX_PLAYERS}.`, full: 1 })); }
      me = r.add(ws, String(m.nick || 'Player').slice(0, 12), m.role === 'pad');
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, code }));
      ws.send(JSON.stringify(r.lvlMsg()));
      r.roster();
    } else if (m.t === 'unlock' && (me.screen || room.players.keys().next().value === me.id)) { // host pays for 6-10 players
      const ok = await tryKey(m.key);
      if (ok) { room.unlocked = true; room.roster(); ws.send(JSON.stringify({ t: 'unlocked' })); } else ws.send(JSON.stringify({ t: 'uerr', m: 'That key was not accepted' }));
    } else if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: m.c }));
    } else if (m.t === 'in') {
      if (!me.screen) room.onInput(me, m);
    } else if (m.t === 'go' && (me.screen || room.players.keys().next().value === me.id)) { // host picks a level
      if (Number.isInteger(m.l) && m.l >= 0 && m.l < LEVELS.length) room.load(m.l);
    } else if (m.t === 'restart' && (me.screen || room.players.keys().next().value === me.id)) {
      room.load(room.li);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    if (me.screen) room.screens.delete(ws); else room.remove(me);
    if (room.players.size === 0 && room.screens.size === 0) rooms.delete(room.code);
  });
});

// Fixed 60 Hz clock driven by real elapsed time (setInterval alone drifts, which would make the
// server run slightly faster/slower than clients and cause constant prediction corrections).
function startLoop() {
  let last = process.hrtime.bigint(), acc = 0;
  setInterval(() => {
    const now = process.hrtime.bigint();
    acc += Math.min(Number(now - last) / 1e9, 0.25); last = now;
    while (acc >= DT) {
      acc -= DT;
      for (const r of rooms.values()) { r.update(DT); if (++r.tick % 2 === 0) r.snap(); }
    }
  }, 5);
}

if (require.main === module) {
  startLoop();
  server.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}  (max ${MAX_PLAYERS}/room)`));
}
module.exports = { Room, PW, PH, TILE };
