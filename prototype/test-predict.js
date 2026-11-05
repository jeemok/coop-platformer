// Automated test of client-side prediction: the REAL Predictor talks to the REAL Room over a
// simulated network (fixed one-way delays + jitter, in-order delivery like TCP/WebSocket).
const assert = require('assert');
const { Room } = require('./server');
const Predictor = require('./predict');

const DT = 1 / 60, TICK_MS = 1000 / 60;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// scripted keyboard: right, jump pulses, left, idle, right again
const script = t => ({
  l: t >= 140 && t < 220 ? 1 : 0,
  r: (t >= 10 && t < 140) || (t >= 240 && t < 320) ? 1 : 0,
  j: (t >= 40 && t < 48) || (t >= 95 && t < 103) || (t >= 260 && t < 268) ? 1 : 0,
});

function simulate({ up, down, jitter, blocker = false, seed = 1, ticks = 520, level = 0, onPlat = false, keys = script }) {
  const rand = rng(seed);
  const room = new Room('P'); room.load(level);
  let tick = 0, lastUp = 0, lastDown = 0;
  const toServer = [], toClient = [];
  const delay = base => Math.max(1, base + Math.floor(rand() * (2 * jitter + 1)) - jitter);
  const myWs = { readyState: 1, send: s => { const at = Math.max(lastDown, tick + delay(down)); lastDown = at; toClient.push({ at, msg: JSON.parse(s) }); } };
  const me = room.add(myWs, 'me');
  if (onPlat) { const pl = room.sim.platforms[0]; me.x = pl.x + 100; me.y = pl.y - 28 - 0.5; } // start standing on the first moving platform
  if (blocker) room.add({ readyState: 0, send() {} }, 'blocker'); // stands right in front of us
  for (let i = 0; i < 30; i++) room.update(DT); // settle

  const P = new Predictor(); P.setGrid(room.level.grid, room.level.movers);
  const ghosts = new Map();
  const startX = me.x;
  let firstVisibleTick = null, firstServerVisible = null, maxErr = 0, sumErr = 0, nErr = 0, snapsSeen = 0;

  for (tick = 0; tick < ticks; tick++) {
    while (toServer.length && toServer[0].at <= tick) room.onInput(me, toServer.shift().msg);
    room.update(DT); if (++room.tick % 2 === 0) room.snap();
    while (toClient.length && toClient[0].at <= tick) {
      const m = toClient.shift().msg;
      if (m.t !== 's') continue;
      snapsSeen++;
      for (const [id, x, y, dead, vy, og, ack] of m.p) {
        if (id === me.id) {
          P.reconcile({ x, y, vy, og, dead, ack, pt: m.pt });
          if (snapsSeen > 3) { maxErr = Math.max(maxErr, P.lastError); sumErr += P.lastError; nErr++; }
          if (firstServerVisible === null && Math.abs(x - startX) > 0.5 && tick >= 10) firstServerVisible = tick;
        } else ghosts.set(id, { id, x, y, dead });
      }
    }
    P.setGhosts([...ghosts.values()]);
    const inp = P.step(keys(tick));
    toServer.push({ at: Math.max(lastUp, tick + delay(up)), msg: { t: 'in', ...inp } }); lastUp = toServer[toServer.length - 1].at;
    if (P.ready && firstVisibleTick === null && Math.abs(P.renderPos().x - startX) > 0.5 && tick >= 10) firstVisibleTick = tick;
  }
  // let the network drain with no input changes, then compare final positions
  const final = { server: { x: me.x, y: me.y }, client: P.renderPos() };
  return { firstVisibleTick, firstServerVisible, maxErr, meanErr: nErr ? sumErr / nErr : 0, final, startX };
}

let ok = 0; const rows = [];
function scenario(name, opts, expect) {
  const r = simulate(opts);
  const rtt = Math.round((opts.up + opts.down) * TICK_MS);
  const respondPred = (r.firstVisibleTick - 10) * TICK_MS, respondServer = (r.firstServerVisible - 10) * TICK_MS;
  rows.push(`${name.padEnd(34)} RTT~${String(rtt).padStart(3)}ms | input->screen: ${respondPred.toFixed(0).padStart(3)}ms predicted vs ${respondServer.toFixed(0).padStart(3)}ms without | correction max ${r.maxErr.toFixed(1)}px mean ${r.meanErr.toFixed(2)}px | end gap ${Math.hypot(r.final.server.x - r.final.client.x, r.final.server.y - r.final.client.y).toFixed(2)}px`);
  try { expect(r); console.log('  ok  ', name); ok++; } catch (e) { console.error('  FAIL', name, '-', e.message); process.exitCode = 1; }
}
const converged = r => assert(Math.hypot(r.final.server.x - r.final.client.x, r.final.server.y - r.final.client.y) < 1, `client and server end ${Math.hypot(r.final.server.x - r.final.client.x, r.final.server.y - r.final.client.y).toFixed(1)}px apart`);
const instant = r => assert(r.firstVisibleTick - 10 <= 1, `input took ${(r.firstVisibleTick - 10)} ticks to show`);
const faster = r => assert(r.firstServerVisible - r.firstVisibleTick >= 4, 'prediction should beat waiting for the server by several ticks');

console.log('Client-side prediction vs a simulated network:');
scenario('LAN-like (RTT ~33ms)', { up: 1, down: 1, jitter: 0 }, r => { instant(r); converged(r); assert(r.maxErr < 2, `max correction ${r.maxErr}`); });
scenario('Good internet (RTT ~100ms)', { up: 3, down: 3, jitter: 0 }, r => { instant(r); faster(r); converged(r); assert(r.maxErr < 2, `max correction ${r.maxErr}`); });
scenario('SEA mobile (RTT ~100ms, jitter)', { up: 3, down: 3, jitter: 2, seed: 7 }, r => { instant(r); faster(r); converged(r); assert(r.maxErr < 25, `max correction ${r.maxErr}`); });
scenario('Bad (RTT ~250ms, heavy jitter)', { up: 8, down: 7, jitter: 4, seed: 3 }, r => { instant(r); faster(r); converged(r); assert(r.maxErr < 60, `max correction ${r.maxErr}`); });
scenario('Pushing another player (RTT ~100ms)', { up: 3, down: 3, jitter: 1, blocker: true, seed: 5 }, r => { instant(r); converged(r); assert(r.maxErr < 40, `max correction ${r.maxErr}`); });

// riding a moving platform: standing still, then shuffling about and hopping, while it carries us (ferry = level 10, elevator = level 9)
const rideKeys = t => ({ l: (t >= 300 && t < 320) || (t >= 560 && t < 600) ? 1 : 0, r: (t >= 270 && t < 290) || (t >= 520 && t < 545) ? 1 : 0, j: (t >= 420 && t < 430) || (t >= 700 && t < 712) ? 1 : 0 });
scenario('Riding the ferry (RTT ~100ms, jitter)', { up: 3, down: 3, jitter: 2, seed: 11, level: 9, onPlat: true, ticks: 900, keys: rideKeys }, r => { converged(r); assert(r.maxErr < 6, `max correction ${r.maxErr}`); });
scenario('Riding the elevator (RTT ~100ms, jitter)', { up: 3, down: 3, jitter: 2, seed: 4, level: 8, onPlat: true, ticks: 900, keys: rideKeys }, r => { converged(r); assert(r.maxErr < 6, `max correction ${r.maxErr}`); });
scenario('Ferry on a bad connection (RTT ~250ms)', { up: 8, down: 7, jitter: 4, seed: 3, level: 9, onPlat: true, ticks: 900, keys: rideKeys }, r => { converged(r); assert(r.maxErr < 15, `max correction ${r.maxErr}`); });

console.log('\n' + rows.join('\n'));
console.log(`\n${ok} checks passed${process.exitCode ? ' (with FAILURES)' : ''}`);
