// THROWAWAY PROTOTYPE: authoritative game server (Node + ws).
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { LEVELS } = require('./levels');
const { Sim, TILE, PW, PH, ov, box } = require('./sim');

const PORT = +process.env.PORT || 3000;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 10;
const MAX_ROOMS = +process.env.MAX_ROOMS || 50;
const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];
const DT = 1 / 60, MAX_QUEUE = 10, IDLE_TICKS = 30;

class Room {
  constructor(code) {
    this.code = code; this.sim = new Sim([]); this.players = this.sim.players; this.tick = 0; this.load(0);
  }
  get grid() { return this.sim.grid; }
  solid(tx, ty) { return this.sim.solid(tx, ty); }
  load(i) {
    this.li = i % LEVELS.length;
    const L = LEVELS[this.li];
    this.level = L; this.sim.setGrid(L.grid);
    this.doors = []; this.spikes = [];
    L.grid.forEach((row, ty) => [...row].forEach((c, tx) => {
      if (c === 'D') this.doors.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
      if (c === '^') this.spikes.push({ x: tx * TILE + 4, y: ty * TILE + 14, w: TILE - 8, h: TILE - 14 });
    }));
    this.home = { x: L.key.x * TILE + 6, y: L.key.y * TILE + 6 };
    this.key = { x: this.home.x, y: this.home.y, holder: null, gone: false };
    this.doorOpen = false; this.win = 0;
    for (const p of this.players.values()) this.spawn(p);
    this.send({ t: 'lvl', name: L.name, min: L.min, grid: L.grid });
  }
  spawn(p) {
    const sp = this.level.spawn;
    p.x = sp.x * TILE + p.slot * (PW + 2); p.y = (sp.y + 1) * TILE - PH - 1;
    p.vx = p.vy = 0; p.dead = 0; p.onGround = false;
  }
  send(m, except) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
  roster() { this.send({ t: 'roster', host: this.players.keys().next().value, p: [...this.players.values()].map(p => ({ id: p.id, nick: p.nick, color: COLORS[p.slot] })) }); }

  // Client inputs are numbered and queued; exactly one is consumed per server tick, so the server's
  // result depends only on the input sequence (not on packet timing) and a client cannot run fast.
  onInput(p, m) {
    if (typeof m.s === 'number') {
      p.usesQueue = true;
      if (p.queue.length >= MAX_QUEUE) p.queue.shift();
      p.queue.push({ s: m.s | 0, l: m.l ? 1 : 0, r: m.r ? 1 : 0, j: m.j ? 1 : 0 });
    } else p.input = { l: m.l ? 1 : 0, r: m.r ? 1 : 0, j: m.j ? 1 : 0 }; // legacy: unnumbered (bots/tests)
  }
  consumeInputs() {
    for (const p of this.players.values()) {
      const inp = p.queue.shift();
      if (inp) { p.input = inp; p.ack = inp.s; p.idle = 0; }
      else if (p.usesQueue && ++p.idle > IDLE_TICKS) p.input = { l: 0, r: 0, j: 0 }; // tab hidden / lost connection
    }
  }
  die(p) {
    p.dead = 1.5;
    if (this.key.holder === p.id) { this.key.holder = null; this.key.x = this.home.x; this.key.y = this.home.y; }
  }
  update(dt) {
    this.consumeInputs();
    if (this.win > 0) { this.win -= dt; if (this.win <= 0) this.load(this.li + 1); return; }
    for (const p of this.players.values()) {
      if (p.dead) { p.dead -= dt; if (p.dead <= 0) this.spawn(p); continue; }
      this.sim.stepPlayer(p, p.input, dt);
      if (p.y > this.sim.rows * TILE + 60 || this.spikes.some(s => ov(box(p), s))) this.die(p);
    }
    const alive = [...this.players.values()].filter(p => !p.dead);
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
      k: this.key.gone ? null : [Math.round(this.key.x), Math.round(this.key.y)], d: this.doorOpen ? 1 : 0, w: this.win > 0 ? 1 : 0 });
  }
  add(ws, nick) {
    const used = new Set([...this.players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const p = { id: ++nextId, ws, nick, slot, input: { l: 0, r: 0, j: 0 }, queue: [], ack: 0, idle: 0, usesQueue: false, x: 0, y: 0, vx: 0, vy: 0, dead: 0, onGround: false };
    this.players.set(p.id, p); this.spawn(p); return p;
  }
  remove(p) {
    if (this.key.holder === p.id) { this.key.holder = null; this.key.x = this.home.x; this.key.y = this.home.y; }
    this.players.delete(p.id); this.roster();
  }
}
let nextId = 0;
const rooms = new Map();

const STATIC = { '/': ['public/index.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/predict.js': ['predict.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
  const f = STATIC[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(path.join(__dirname, f[0])));
});
const wss = new WebSocketServer({ server, maxPayload: 512 });

wss.on('connection', ws => {
  let room = null, me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!room) {
      if (m.t !== 'join') return;
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return ws.send(JSON.stringify({ t: 'err', m: 'Bad room code' }));
      let r = rooms.get(code);
      if (!r) {
        if (rooms.size >= MAX_ROOMS) return ws.send(JSON.stringify({ t: 'err', m: 'Servers full, try again shortly' }));
        r = new Room(code); rooms.set(code, r);
      }
      if (r.players.size >= MAX_PLAYERS) return ws.send(JSON.stringify({ t: 'err', m: `Room full (max ${MAX_PLAYERS})` }));
      room = r; me = r.add(ws, String(m.nick || 'Player').slice(0, 12));
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, code }));
      ws.send(JSON.stringify({ t: 'lvl', name: r.level.name, min: r.level.min, grid: r.level.grid }));
      r.roster();
    } else if (m.t === 'in') {
      room.onInput(me, m);
    } else if (m.t === 'restart' && room.players.keys().next().value === me.id) {
      room.load(room.li);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.remove(me);
    if (room.players.size === 0) rooms.delete(room.code);
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
  server.listen(PORT, () => console.log(`Prototype running: http://localhost:${PORT}  (max ${MAX_PLAYERS}/room)`));
}
module.exports = { Room, PW, PH, TILE };
