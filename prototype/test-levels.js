// Automated playthroughs: bots drive the real Room simulation with keyboard-style inputs only
// (no teleporting). Every level must be WON by its minimum player count (and by more players),
// and the "needs a stack" levels must NOT be winnable with fewer players.
const assert = require('assert');
const { Room, PW, PH, TILE } = require('./server');
const { LEVELS } = require('./levels');
const { moverPos } = require('./sim');

const fake = () => ({ readyState: 0, send() {} });
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const bx = p => ({ x: p.x, y: p.y, w: PW, h: PH });
const cx = p => p.x + PW / 2;
const inDoor = (r, p) => r.doors.some(d => ov(bx(p), d));
const stop = p => { p.input = { l: 0, r: 0, j: 0 }; };
const standingOn = (p, base) => Math.abs((p.y + PH) - base.y) < 2.5 && p.x < base.x + PW && p.x + PW > base.x;

// walk toward x (center), or until cond(); auto-jumps over blocks, pits and spikes
function* walk(r, p, x, cond, max = 1500) {
  let guard = 0;
  while (!(cond ? cond() : Math.abs(cx(p) - x) < 5)) {
    if (++guard > max) throw new Error('walk timeout');
    const dir = x > cx(p) ? 1 : -1;
    const aheadX = cx(p) + dir * (PW / 2 + 6), farX = cx(p) + dir * (PW / 2 + 22);
    const ty = Math.floor((p.y + PH - 1) / TILE), below = Math.floor((p.y + PH + 4) / TILE);
    const at = (px, row) => r.grid[row] && r.grid[row][Math.floor(px / TILE)];
    const wall = r.solid(Math.floor(aheadX / TILE), ty);
    const spike = at(farX, ty) === '^';
    let gap = true; for (let row = below; row < r.sim.rows; row++) if (r.solid(Math.floor(aheadX / TILE), row)) gap = false; // a real pit: nothing solid anywhere below
    p.input = { l: dir < 0 ? 1 : 0, r: dir > 0 ? 1 : 0, j: (p.onGround && (wall || spike || gap)) || (!p.onGround && p.vy < 0 && p.jumping) ? 1 : 0 };
    p.jumping = !!(p.input.j);
    yield;
  }
  stop(p);
}
function* wait(cond, max = 3000) { let n = 0; while (!cond()) { if (++n > max) throw new Error('wait timeout'); yield; } }

// jump straight up; once feet are above `top`, drift right until `done()`
function* climb(p, top, done, stopX, max = 300) {
  let n = 0;
  while (!done()) {
    if (++n > max) throw new Error(`climb timeout at x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} top=${top}`);
    const above = p.y + PH < top - 2;
    p.input = { l: 0, r: above && p.x < stopX ? 1 : 0, j: p.onGround || p.vy < 0 ? 1 : 0 };
    yield;
  }
  stop(p);
}
// shuffle right on top of a platform/player until our right edge reaches x
function* slideTo(p, rightEdge) {
  let n = 0;
  while (p.x + PW < rightEdge) { if (++n > 120) throw new Error(`slide timeout x=${p.x.toFixed(0)}`); p.input = { l: 0, r: 1, j: 0 }; yield; }
  stop(p);
}

function run(n, li, scriptFor, maxTicks = 60 * 120) {
  const r = new Room('T'); r.load(li);
  const ps = []; for (let i = 0; i < n; i++) ps.push(r.add(fake(), 'b' + i));
  for (let i = 0; i < 30; i++) r.update(1 / 60); // settle
  const gens = scriptFor(r, ps).map(g => ({ g, done: false }));
  let deaths = 0, was = ps.map(() => 0), won = false, t = 0, err = null;
  try {
    for (; t < maxTicks && !won; t++) {
      for (const o of gens) if (!o.done) { const s = o.g.next(); if (s.done) o.done = true; }
      r.update(1 / 60);
      if (process.env.TRACE && t % 15 === 0) console.log(t, ps.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}${p.onGround ? 'g' : ''}`).join('  '));
      ps.forEach((p, i) => { if (p.dead && !was[i]) { deaths++; if (process.env.TRACE) console.log('DEATH tick', t, 'player', i, 'at', p.x.toFixed(0), p.y.toFixed(0)); } was[i] = p.dead ? 1 : 0; });
      if (r.win > 0) won = true;
    }
  } catch (e) { err = e.message; }
  return { r, ps, won, deaths, ticks: t, err };
}

// x of the left edge of the key platform (first '#' in the rows above the ground)
const platX = r => { for (let y = 5; y < 13; y++) { const i = r.grid[y].indexOf('#'); if (i >= 0) return { x: i * TILE, top: y * TILE }; } };
const toDoor = (r, p) => walk(r, p, 35 * TILE, () => inDoor(r, p));
const byX = ps => [...ps].sort((a, b) => b.x - a.x); // rightmost first (becomes the base)

// k-stack (k = 2 or 3). The k rightmost players assemble just left of the key platform; roles
// (base / middle / top) are assigned by position AFTER assembly, so crowd shuffling while
// crossing pits or spikes cannot confuse the script. The top player takes the key; everyone
// then walks into the door.
function stackN(k, prelude, backGroup) {
  return (r, ps) => {
    const { x: px, top } = platX(r);
    const order = byX(ps);
    // backGroup (gate level): the leftmost player is the button presser; with spare players he is NOT in the
    // stack, otherwise (minimum players) he is. The stack is made of the next-leftmost k.
    const presser = backGroup ? order[order.length - 1] : null, spare = backGroup && order.length > k;
    const grp = backGroup ? (spare ? order.slice(-k - 1, -1) : order.slice(-k)) : order.slice(0, k);
    const rest = backGroup ? order.filter(q => !grp.includes(q)) : order.slice(k);
    const edge = px - 8, baseCx = px - PW - 8 + PW / 2;
    let roles = null; const getRoles = () => roles || (roles = byX(grp));
    const baseReady = () => Math.abs(cx(getRoles()[0]) - baseCx) < 6 && getRoles()[0].onGround;
    // member idx (1..k-1) may start climbing once members 1..idx-1 are stacked on the base
    const chainReady = idx => { const rl = getRoles(); if (!baseReady()) return false; for (let j = 1; j < idx; j++) if (!(standingOn(rl[j], rl[j - 1]) && rl[j].x + PW >= edge && rl[j].onGround)) return false; return true; };
    const pre = p => prelude ? prelude(r, p, presser === p, grp, ps) : (function* () {})();
    return [
      ...grp.map(p => (function* () {
        yield* pre(p);
        yield* walk(r, p, px - 60, () => cx(p) >= px - 80, 2500);
        yield* wait(() => grp.every(q => cx(q) >= px - 80));
        const rl = getRoles(), idx = rl.indexOf(p);
        if (idx === 0) {
          yield* walk(r, p, baseCx); stop(p);
          yield* wait(() => r.key.holder != null); yield* toDoor(r, p);
        } else {
          const below = rl[idx - 1];
          yield* wait(() => chainReady(idx));
          yield* walk(r, p, px - 48);
          yield* climb(p, below.y, () => standingOn(p, below), below.x - 8);
          yield* slideTo(p, edge);
          if (idx === k - 1) { // top: grabs the key
            yield* climb(p, top, () => p.y + PH <= top + 0.5 && p.x + PW > px, px - 10);
            yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
          } else yield* wait(() => r.key.holder != null);
          yield* toDoor(r, p);
        }
      })()),
      ...rest.map(p => (function* () { yield* pre(p); yield* wait(() => r.key.holder != null); yield* toDoor(r, p); })()),
    ];
  };
}
const stack2 = stackN(2), stack3 = stackN(3), stack4 = stackN(4);

// level 6: the leftmost player climbs the ledge, steps on the button and sprints for the gate;
// everyone else waits for the gate to open, then heads for the key platform as a normal stack level.
function* gatePrelude(r, p, presser, grp, ps) {
  const gateX = Math.max(...r.gates.map(g => g.x)), inStack = grp.includes(p);
  if (presser) {
    const btn = r.buttons[0];
    const lx = r.grid[10].indexOf('#') * TILE; // the ledge holding the button
    yield* walk(r, p, lx - 2 * TILE);
    yield* climb(p, 10 * TILE, () => p.y + PH <= 10 * TILE + 0.5 && p.x + PW > lx, lx - 10);
    yield* walk(r, p, btn.x + btn.w / 2);
    // a spare presser sprints on to the door area; one who is part of the stack stops just past the gate
    if (inStack) yield* walk(r, p, gateX + 3 * TILE, () => p.x > gateX + TILE);
    else yield* walk(r, p, 32 * TILE, () => p.x > 31 * TILE);
  } else {
    yield* wait(() => r.sim.gateOpen);
    // players outside the stack go first and wait in the door area (out of the stack's way);
    // the stack members follow right behind them
    for (let i = 0; i < 12 && inStack; i++) yield; // the stack members start a moment later (they are behind the rest anyway)
    yield* walk(r, p, inStack ? gateX + 3 * TILE : 32 * TILE, () => p.x > (inStack ? gateX + TILE : 31 * TILE));
  }
}
const stack2Gate = stackN(2, gatePrelude, true);
// level 1: everyone just walks to the door; the key is picked up on the way
const solo = (r, ps) => ps.map(p => (function* () { yield* walk(r, p, r.key.x + 10, () => r.key.holder != null); yield* toDoor(r, p); })());


// ---- moving platforms, springs and saws (levels 9-12) ----
const cycle = d => 2 * d.move + d.dwellA + d.dwellB;
const cycT = (d, r) => (((r.pt / 60 + d.phase) % cycle(d)) + cycle(d)) % cycle(d);
const restA = (d, r) => { const T = cycT(d, r); return T < d.dwellA ? d.dwellA - T : 0; };                              // seconds left resting at A
const restB = (d, r) => { const T = cycT(d, r), s = d.dwellA + d.move; return T >= s && T < s + d.dwellB ? s + d.dwellB - T : 0; }; // ... at B
const onPlat = (p, pl) => Math.abs((p.y + PH) - pl.y) < 2.5 && p.x < pl.x + pl.w && p.x + PW > pl.x;
// walk (never jumping) until our LEFT edge is at getX()
function* shuffleTo(p, getX, max = 1500) {
  let n = 0;
  while (Math.abs(getX() - p.x) > 3) { if (++n > max) throw new Error(`shuffle timeout x=${p.x.toFixed(0)} want ${getX().toFixed(0)}`); const l = getX() < p.x; p.input = { l: l ? 1 : 0, r: l ? 0 : 1, j: 0 }; yield; }
  stop(p);
}
// level 9: the rightmost player rides the lift to the ledge (hopping on while it rests at the bottom), steps off at the top, takes the key
const elevator = (r, ps) => {
  const carrier = byX(ps)[0], pl = r.sim.platforms[0], d = pl.d;
  return ps.map(p => (function* () {
    if (p !== carrier) { yield* wait(() => r.key.holder != null); yield* toDoor(r, p); return; }
    yield* walk(r, p, d.x - 40);
    yield* wait(() => restA(d, r) > 1.2);
    let n = 0;
    while (!onPlat(p, pl)) { if (++n > 200) throw new Error('could not board the lift'); p.input = { l: 0, r: 1, j: (p.onGround && p.x + PW > pl.x - 20) || (!p.onGround && p.vy < 0 && p.jumping) ? 1 : 0 }; p.jumping = !!p.input.j; yield; }
    stop(p);
    yield* shuffleTo(p, () => pl.x + 30);
    yield* wait(() => restB(d, r) > 0.3);
    yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
    yield* toDoor(r, p);
  })());
};
// level 10: everyone queues at the ledge, boards the ferry while it rests, stands still, and walks off at the far dock
const ferry = (r, ps) => {
  const order = byX(ps), pl = r.sim.platforms[0], d = pl.d;
  const slot = k => pl.x + d.w - PW - 6 - k * (PW + 3), queue = k => d.x - PW - 6 - k * (PW + 3);
  return ps.map(p => (function* () {
    const k = order.indexOf(p);
    yield* shuffleTo(p, () => queue(k));
    yield* wait(() => r.key.holder != null);
    yield* wait(() => restA(d, r) > 2.0, 6000);
    yield* shuffleTo(p, () => slot(k));
    yield* wait(() => restB(d, r) > 0.4, 6000);
    yield* toDoor(r, p);
  })());
};
// level 11: the rightmost player bounces up spring A, then spring B (holding jump), takes the key; the rest wait for the door
const trampolines = (r, ps) => {
  const carrier = byX(ps)[0], a = r.grid[12].indexOf('S') * TILE, bCol = r.grid[8].indexOf('S'), b = bCol * TILE;
  const l1 = r.grid[9].indexOf('#') * TILE, l2 = r.grid[3].indexOf('#') * TILE;
  return ps.map(p => (function* () {
    if (p !== carrier) { yield* wait(() => r.key.holder != null); yield* toDoor(r, p); return; }
    yield* walk(r, p, a + 16, () => cx(p) > a + 6 && p.y + PH <= 12 * TILE + 2);
    yield* climb(p, 9 * TILE, () => p.y + PH <= 9 * TILE + 0.5 && p.x + PW > l1, l1 + 24, 400);
    yield* walk(r, p, b + 16, () => cx(p) > b + 6 && p.y + PH <= 8 * TILE + 2);
    yield* climb(p, 3 * TILE, () => p.y + PH <= 3 * TILE + 0.5 && p.x + PW > l2, l2 + 24, 400);
    yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
    yield* toDoor(r, p);
  })());
};
// level 12: the whole pack queues before each saw lane, waits until the blade will stay up for 2.4 s, then runs through
const sawmill = (r, ps) => {
  const order = byX(ps), lanes = [...r.sim.hazards].sort((a, b) => a.x - b.x);
  const clear = (h, secs) => { for (let t = 0; t <= secs * 60; t += 3) if (moverPos(h.d, r.pt + t).y + h.h > 380) return false; return true; };
  const queue = (lane, k) => lane.d.x - 36 - k * (PW + 3);
  return ps.map(p => (function* () {
    const k = order.indexOf(p);
    for (const lane of lanes) { yield* shuffleTo(p, () => queue(lane, k)); yield* wait(() => clear(lane, 2.4), 4000); yield* shuffleTo(p, () => (lanes[lanes.indexOf(lane) + 1] ? queue(lanes[lanes.indexOf(lane) + 1], k) : lane.d.x + 3 * TILE)); }
    yield* walk(r, p, r.key.x + 10, () => r.key.holder != null || r.key.gone);
    yield* toDoor(r, p);
  })());
};

const SCRIPTS = [solo, stack2, stack2, stack3, stack2Gate, solo, stack2Gate, stack4, elevator, ferry, trampolines, sawmill];
let passed = 0;
function check(label, fn) { try { fn(); console.log('  ok  ', label); passed++; } catch (e) { console.error('  FAIL', label, '-', e.message); process.exitCode = 1; } }

console.log('Levels solvable by bots:');
LEVELS.forEach((L, i) => {
  for (const n of [...new Set([L.min, L.min + 2, 10])]) {
    if (process.env.ONLY && process.env.ONLY !== `${i + 1}:${n}`) continue; // debugging: ONLY=2:2 TRACE=1
    check(`level ${i + 1} "${L.name}" with ${n} players`, () => {
      const res = run(n, i, SCRIPTS[i]);
      assert(!res.err, `bot error: ${res.err} (tick ${res.ticks})`);
      assert(res.won, `not won after ${res.ticks} ticks (key holder ${res.r.key.holder}, door open ${res.r.doorOpen})`);
      assert.strictEqual(res.deaths, 0, `bots died ${res.deaths}x`);
    });
  }
});

console.log('Levels that require cooperation are NOT solvable without it:');
check('level 2 key unreachable by a single player', () => {
  const res = run(1, 1, (r, ps) => [(function* () {
    const { x: px } = platX(r); yield* walk(r, ps[0], px - 20);
    for (let n = 0; n < 600; n++) { ps[0].input = { l: 0, r: n % 40 < 20 ? 1 : 0, j: 1 }; yield; }
  })()], 60 * 15);
  assert(!res.won && res.r.key.holder == null, 'solo player got the key');
});
check('level 4 key unreachable by only 2 players (needs 3)', () => {
  const res = run(2, 3, stack2, 60 * 40);
  assert(!res.won && res.r.key.holder == null, '2 players reached the 3-stack key');
});

check('gate level: stays shut without the button, opens when pressed, closes ~4 s after', () => {
  const res = run(2, 4, (r, ps) => ps.map(p => walk(r, p, 40 * TILE, () => false, 600)), 60 * 8); // everyone just runs at the gate
  assert(!res.won && res.ps.every(p => p.x < 17 * TILE), 'players got past a closed gate');
  const r = new Room('G'); r.load(4); const p = r.add(fake(), 'x');
  for (let i = 0; i < 30; i++) r.update(1 / 60);
  assert(!r.sim.gateOpen, 'gate open at start');
  const b = r.buttons[0]; p.x = b.x + 4; p.y = b.y - PH; r.update(1 / 60);
  assert(r.sim.gateOpen, 'gate did not open on button press');
  p.x = 5 * TILE; p.y = 388; let t = 0; while (r.sim.gateOpen && t < 600) { r.update(1 / 60); t++; }
  const want = r.level.gateTime * 60; assert(t > want - 40 && t < want + 40, `gate stayed open ${t} ticks (expected ~${want})`);
  const g = r.gates[0]; r.gateT = 0.1; p.x = g.x + 4; p.y = g.y + 12 * TILE - PH - 1; for (let i = 0; i < 90; i++) r.update(1 / 60);
  assert(r.sim.gateOpen, 'gate closed on a player standing inside it');
});

check('level 8 key unreachable by only 3 players (needs 4)', () => {
  const res = run(3, 7, stack3, 60 * 40);
  assert(!res.won && res.r.key.holder == null, '3 players reached the 4-stack key');
});

check('level 9 key unreachable without the lift (no stack, no jump gets up there)', () => {
  const res = run(1, 8, (r, ps) => [(function* () {
    const ledge = r.grid[7].indexOf('#') * TILE; yield* walk(r, ps[0], ledge - 30);
    for (let n = 0; n < 900; n++) { ps[0].input = { l: 0, r: n % 50 < 25 ? 1 : 0, j: 1 }; yield; }
  })()], 60 * 20);
  assert(!res.won && res.r.key.holder == null, 'a lone player reached the ledge key without the lift');
});
check('level 10: the pit cannot be jumped, only ferried', () => {
  const res = run(2, 9, (r, ps) => ps.map(p => walk(r, p, 35 * TILE, () => inDoor(r, p), 3000)), 60 * 40);
  assert(!res.won, 'players crossed the 13-tile pit without the ferry');
});
check('level 12: running through the saw lanes at the wrong moment gets you killed', () => {
  const res = run(3, 11, (r, ps) => ps.map(p => (function* () { for (let i = 0; i < 150; i++) yield; yield* walk(r, p, 35 * TILE, () => inDoor(r, p), 3000); })()), 60 * 10);
  assert(res.deaths > 0, 'nobody died running straight through the saws');
});
check('level 9 lift: a platform carries every player standing on it, and the key stays reachable', () => {
  const r = new Room('E'); r.load(8); const ps = [0, 1, 2].map(i => r.add(fake(), 'e' + i)); for (let i = 0; i < 20; i++) r.update(1 / 60);
  const pl = r.sim.platforms[0]; ps.forEach((p, i) => { p.x = pl.x + 6 + i * 28; p.y = pl.y - PH - 0.5; });
  let top = Infinity; for (let i = 0; i < 60 * 9; i++) { ps.forEach(p => stop(p)); r.update(1 / 60); top = Math.min(top, ...ps.map(p => p.y)); }
  assert(ps.every(p => !p.dead) && top < 224 - PH + 3, `riders: top y ${top.toFixed(0)}, dead ${ps.filter(p => p.dead).length}`);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with FAILURES)' : ''}`);
