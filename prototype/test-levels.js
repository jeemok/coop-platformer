// Automated playthroughs: bots drive the real Room simulation with keyboard-style inputs only
// (no teleporting). Every level must be WON by its minimum player count (and by more players),
// and the "needs a stack" levels must NOT be winnable with fewer players.
const assert = require('assert');
const { Room, PW, PH, TILE } = require('./server');
const { LEVELS } = require('./levels');

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
    const aheadX = cx(p) + dir * (PW / 2 + 6), farX = cx(p) + dir * (PW / 2 + 28);
    const ty = Math.floor((p.y + PH - 1) / TILE), below = Math.floor((p.y + PH + 4) / TILE);
    const at = (px, row) => r.grid[row] && r.grid[row][Math.floor(px / TILE)];
    const wall = r.solid(Math.floor(aheadX / TILE), ty);
    const spike = at(farX, ty) === '^';
    const gap = !r.solid(Math.floor(aheadX / TILE), below);
    p.input = { l: dir < 0 ? 1 : 0, r: dir > 0 ? 1 : 0, j: p.onGround && (wall || spike || gap) ? 1 : 0 };
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
    p.input = { l: 0, r: above && p.x < stopX ? 1 : 0, j: p.onGround ? 1 : 0 };
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
function stackN(k) {
  return (r, ps) => {
    const { x: px, top } = platX(r);
    const order = byX(ps), grp = order.slice(0, k), rest = order.slice(k);
    const edge = px - 8, baseCx = px - PW - 8 + PW / 2;
    let roles = null; const getRoles = () => roles || (roles = byX(grp));
    const baseReady = () => Math.abs(cx(getRoles()[0]) - baseCx) < 6 && getRoles()[0].onGround;
    return [
      ...grp.map(p => (function* () {
        yield* walk(r, p, px - 60, () => cx(p) >= px - 80, 2500);
        yield* wait(() => grp.every(q => cx(q) >= px - 80));
        const rl = getRoles(), idx = rl.indexOf(p);
        if (idx === 0) {
          yield* walk(r, p, baseCx); stop(p);
          yield* wait(() => r.key.holder != null); yield* toDoor(r, p);
        } else if (idx === k - 1) { // top: grabs the key
          const below = rl[idx - 1];
          yield* wait(() => idx === 1 ? baseReady() : standingOn(rl[1], rl[0]) && rl[1].x + PW >= edge && rl[1].onGround);
          yield* walk(r, p, px - 48);
          yield* climb(p, below.y, () => standingOn(p, below), below.x - 8);
          yield* slideTo(p, edge);
          yield* climb(p, top, () => p.y + PH <= top + 0.5 && p.x + PW > px, px - 10);
          yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
          yield* toDoor(r, p);
        } else { // middle of a 3-stack
          yield* wait(baseReady);
          yield* walk(r, p, px - 48);
          yield* climb(p, rl[0].y, () => standingOn(p, rl[0]), rl[0].x - 8);
          yield* slideTo(p, edge);
          yield* wait(() => r.key.holder != null); yield* toDoor(r, p);
        }
      })()),
      ...rest.map(p => (function* () { yield* wait(() => r.key.holder != null); yield* toDoor(r, p); })()),
    ];
  };
}
const stack2 = stackN(2), stack3 = stackN(3);
// level 1: everyone just walks to the door; the key is picked up on the way
const solo = (r, ps) => ps.map(p => toDoor(r, p));

const SCRIPTS = [solo, stack2, stack2, stack3, stack2];
let passed = 0;
function check(label, fn) { try { fn(); console.log('  ok  ', label); passed++; } catch (e) { console.error('  FAIL', label, '-', e.message); process.exitCode = 1; } }

console.log('Levels solvable by bots:');
LEVELS.forEach((L, i) => {
  for (const n of [...new Set([L.min, L.min + 2, 10])]) {
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

console.log(`\n${passed} checks passed${process.exitCode ? ' (with FAILURES)' : ''}`);
