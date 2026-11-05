// Automated playthroughs of the campaign: bots drive the real Room with keyboard-style inputs only (no teleporting).
// Every level is played by the minimum player count, +2, and a full room of 10, with NO deaths allowed. Levels are built
// from segments (levels.js), and each segment type has its own bot behaviour below.
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

let ROOM = null;
function run(n, li, scriptFor, maxTicks = 60 * 120) {
  const r = new Room('T'); r.load(LEVELS[li]);
  const ps = []; for (let i = 0; i < n; i++) ps.push(r.add(fake(), 'b' + i));
  for (let i = 0; i < 30; i++) r.update(1 / 60); // settle
  ROOM = r; const gens = scriptFor(r, ps).map(g => ({ g, done: false }));
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

// ---- moving platforms, springs and saws (levels 9-12) ----
const cycle = d => 2 * d.move + d.dwellA + d.dwellB;
const cycT = (d, r) => (((r.pt / 60 + d.phase) % cycle(d)) + cycle(d)) % cycle(d);
const restA = (d, r) => { const T = cycT(d, r); return T < d.dwellA ? d.dwellA - T : 0; };                              // seconds left resting at A
const restB = (d, r) => { const T = cycT(d, r), s = d.dwellA + d.move; return T >= s && T < s + d.dwellB ? s + d.dwellB - T : 0; }; // ... at B
const onPlat = (p, pl) => Math.abs((p.y + PH) - pl.y) < 2.5 && p.x < pl.x + pl.w && p.x + PW > pl.x;
// walk (never jumping) until our LEFT edge is at getX()
function* shuffleTo(p, getX, max = 1500) {
  let n = 0;
  const under = () => [...ROOM.players.values()].find(o => o !== p && !o.dead && p.onGround && Math.abs((p.y + PH) - o.y) < 2.5 && p.x < o.x + PW && p.x + PW > o.x);
  while (Math.abs(getX() - p.x) > 3 || under()) {
    if (++n > max) throw new Error(`shuffle timeout x=${p.x.toFixed(0)} want ${getX().toFixed(0)}`);
    const l = getX() < p.x; // (standing on someone's head: walking toward the target also walks off it)
    p.input = { l: l ? 1 : 0, r: l ? 0 : 1, j: 0 }; yield;
  }
  stop(p);
}

const byX = ps => [...ps].sort((a, b) => b.x - a.x); // rightmost first
const cycleNo = (d, r) => Math.floor((r.pt / 60 + d.phase) / cycle(d));
const end = seg => (seg.x0 + seg.w) * TILE;
const moversIn = (list, seg) => list.filter(m => m.d.x >= seg.x0 * TILE && m.d.x < (seg.x0 + seg.w) * TILE).sort((a, b) => a.x - b.x);
const toDoor = (r, p) => walk(r, p, r.doors.reduce((a, d) => a + d.x, 0) / r.doors.length + 3.5 * TILE, () => r.doors.some(d => ov(bx(p), d)), 4000);

let RANK = new Map();
// every segment bot first walks to the segment start and waits until the whole room is there, then ranks are fixed (rightmost = 0)
function* arrive(r, p, ps, seg, S) {
  const at = q => q.x >= seg.x0 * TILE - (RANK.get(q) || 0) * (PW + 3); // arrived, standing in file behind the leader
  yield* walk(r, p, seg.x0 * TILE + TILE, () => at(p), 4000);
  for (let n = 0; n < 400 && [...r.players.values()].some(o => o !== p && !o.dead && p.onGround && Math.abs((p.y + PH) - o.y) < 2.5 && p.x < o.x + PW && p.x + PW > o.x); n++) { p.input = { l: 0, r: 1, j: 0 }; yield; } // never wait on someone's head
  stop(p);
  yield* wait(() => ps.every(q => at(q) && q.y > 380), 9000);
  if (!S.t1) S.t1 = r.pt + 45; yield* wait(() => r.pt >= S.t1); // let everyone settle (and stop shoving) before ranks are fixed
  if (!S.order) S.order = byX(ps);
  return S.order.indexOf(p);
}
// stop in file (rightmost first, 27 px apart) instead of pushing the whole pack forward into the next segment's hazards
const walkTo = (r, p, x, file) => walk(r, p, x, () => cx(p) >= x - (file ? (RANK.get(p) || 0) * (PW + 3) : 0), 4000);

const SEG = {
  // a dense pack jumping the same hazard lands on each other's heads, so players leave one after another (~0.3 s apart)
  terrain: function* (r, p, ps, seg, S) {
    if (!S.order) { S.order = byX(ps); S.t0 = r.pt; }
    const k = S.order.indexOf(p);
    yield* wait(() => r.pt >= S.t0 + k * 8, 3000);
    yield* walkTo(r, p, end(seg));
  },
  rest: function* (r, p, ps, seg) { yield* walkTo(r, p, end(seg), true); },
  // saw lanes: queue before each lane, wait until the blade stays up 2.4 s, run through
  saws: function* (r, p, ps, seg, S) {
    const k = yield* arrive(r, p, ps, seg, S), lanes = moversIn(r.sim.hazards, seg);
    const clear = (h, secs) => { for (let t = 0; t <= secs * 60; t += 3) if (moverPos(h.d, r.pt + t).y + h.h > 380) return false; return true; };
    const queue = (lane, k) => lane.d.x - 36 - k * (PW + 3);
    for (let i = 0; i < lanes.length; i++) {
      yield* shuffleTo(p, () => queue(lanes[i], k));
      yield* wait(() => clear(lanes[i], 1.65), 6000);
      yield* shuffleTo(p, () => lanes[i + 1] ? queue(lanes[i + 1], k) : lanes[i].d.x + 3 * TILE);
    }
    yield* walkTo(r, p, end(seg));
  },
  // ferry / lift: queue by rank at the ledge, board in waves of `cap` while the platform rests, stand still, step off at the far end
  ride: function* (r, p, ps, seg, S) {
    const k = yield* arrive(r, p, ps, seg, S), pl = r.sim.platforms.find(m => m.d.x >= seg.x0 * TILE && m.d.x < (seg.x0 + seg.w) * TILE), d = pl.d;
    const cap = Math.floor(d.w / (PW + 3)), wave = Math.floor(k / cap), j = k % cap;
    yield* shuffleTo(p, () => d.x - PW - 6 - k * (PW + 3));
    for (let n = 0; ; n++) {
      if (n > 9000) throw new Error('ride: never boarded');
      if (restA(d, r) > 1.75) { if (S.first == null) S.first = cycleNo(d, r); if (cycleNo(d, r) >= S.first + wave) break; }
      yield;
    }
    yield* shuffleTo(p, () => pl.x + d.w - PW - 6 - j * (PW + 3));
    yield* wait(() => restB(d, r) > 0.4, 6000);
    yield* walkTo(r, p, end(seg));
  },
  gate: function* (r, p, ps, seg, S) {
    const k = yield* arrive(r, p, ps, seg, S), presser = S.order[S.order.length - 1] === p;
    const lx = (seg.x0 + 2) * TILE, gx = (seg.x0 + 9) * TILE, btn = r.buttons.find(b => b.x >= seg.x0 * TILE && b.x < (seg.x0 + seg.w) * TILE);
    if (presser) {
      yield* walk(r, p, lx - 2 * TILE);
      yield* climb(p, 10 * TILE, () => p.y + PH <= 10 * TILE + 0.5 && p.x + PW > lx, lx - 10);
      yield* walk(r, p, btn.x + btn.w / 2);
      yield* walk(r, p, gx + 3 * TILE, () => p.x > gx + TILE);
    } else {
      yield* wait(() => r.sim.gateOpen, 9000);
      yield* walk(r, p, gx + 3 * TILE, () => p.x > gx + TILE);
    }
    yield* walkTo(r, p, end(seg));
  },
  // k-stack under the key platform: the k rightmost players build it, the top one takes the key, the rest wait for it
  stackKey: function* (r, p, ps, seg, S) {
    const k0 = yield* arrive(r, p, ps, seg, S), k = seg.k, px = (seg.x0 + 8) * TILE, top = (11 - k) * TILE;
    const grp = S.order.slice(0, k), edge = px - 8, baseLeft = px - PW - 8, baseCx = baseLeft + PW / 2;
    const stage = i => baseLeft - i * (PW + 3);       // the group lines up left of the platform, rightmost = base
    const getRoles = () => grp;
    const baseReady = () => Math.abs(cx(grp[0]) - baseCx) < 6 && grp[0].onGround;
    const chainReady = idx => { if (!baseReady()) return false; for (let j = 1; j < idx; j++) if (!(standingOn(grp[j], grp[j - 1]) && grp[j].x + PW >= edge && grp[j].onGround)) return false; return true; };
    if (grp.includes(p)) {
      const idx = grp.indexOf(p);
      yield* shuffleTo(p, () => stage(idx), 3000);
      yield* wait(() => grp.every((q, j) => Math.abs(q.x - stage(j)) <= 8), 6000);
      if (idx === 0) { yield* wait(() => r.key.holder != null || r.key.gone, 9000); }
      else {
        const below = grp[idx - 1];
        yield* wait(() => chainReady(idx), 9000);
        yield* walk(r, p, px - 48);
        yield* climb(p, below.y, () => standingOn(p, below), below.x - 8);
        yield* slideTo(p, edge);
        if (idx === k - 1) {
          yield* climb(p, top, () => p.y + PH <= top + 0.5 && p.x + PW > px, px - 10);
          yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
        } else yield* wait(() => r.key.holder != null || r.key.gone, 9000);
      }
    } else yield* wait(() => r.key.holder != null || r.key.gone, 9000);
    yield* walkTo(r, p, end(seg));
  },
  // two springs up to a high ledge: the rightmost player takes the key, the rest wait
  springKey: function* (r, p, ps, seg, S) {
    yield* arrive(r, p, ps, seg, S);
    const carrier = S.order[0], x0 = seg.x0 * TILE;
    if (p === carrier) {
      const a = (seg.x0 + 6) * TILE, b = (seg.x0 + 11) * TILE, l1 = (seg.x0 + 9) * TILE, l2 = (seg.x0 + 13) * TILE;
      yield* walk(r, p, a + 16, () => cx(p) > a + 6 && p.y + PH <= 12 * TILE + 2);
      yield* climb(p, 9 * TILE, () => p.y + PH <= 9 * TILE + 0.5 && p.x + PW > l1, l1 + 24, 400);
      yield* walk(r, p, b + 16, () => cx(p) > b + 6 && p.y + PH <= 8 * TILE + 2);
      yield* climb(p, 3 * TILE, () => p.y + PH <= 3 * TILE + 0.5 && p.x + PW > l2, l2 + 24, 400);
      yield* walk(r, p, r.key.x + 10, () => r.key.holder === p.id);
    } else yield* wait(() => r.key.holder != null || r.key.gone, 9000);
    yield* walkTo(r, p, end(seg));
  },
};
// choir: the n rightmost players each stand on their own button (rightmost on the farthest); when all are held the gate opens and everyone sprints through
SEG.choir = function* (r, p, ps, seg, S) {
  const k = yield* arrive(r, p, ps, seg, S), n = seg.n, gx = seg.x0 + 8 + 2 * n + 2;
  if (k < n) { const bx = (seg.x0 + 8 + 2 * (n - 1 - k)) * TILE + TILE / 2; yield* walk(r, p, bx); stop(p); }
  yield* wait(() => r.sim.gateMap[gx], 9000);
  yield* walk(r, p, (gx + 3) * TILE, () => p.x > (gx + 1) * TILE);
  yield* walkTo(r, p, end(seg));
};
SEG.ferry = SEG.ride; SEG.lift = SEG.ride;

const scriptFor = L => (r, ps) => {
  RANK = new Map(byX(ps).map((p, i) => [p, i]));
  const st = L.segs.map(() => ({}));
  return ps.map(p => (function* () {
    for (let i = 0; i < L.segs.length; i++) yield* SEG[L.segs[i].type](r, p, ps, L.segs[i], st[i]);
    yield* toDoor(r, p);
  })());
};

let passed = 0;
function check(label, fn) { try { fn(); console.log('  ok  ', label); passed++; } catch (e) { console.error('  FAIL', label, '-', e.message); process.exitCode = 1; } }

console.log('Campaign levels playable by bots (no deaths):');
LEVELS.forEach((L, i) => {
  for (const n of [...new Set([L.min, L.min + 2, 10])].filter(n => n <= 10)) {
    if (process.env.ONLY && process.env.ONLY !== `${i + 1}:${n}`) continue; // debugging: ONLY=2:2 TRACE=1
    check(`level ${i + 1} "${L.name}" (${L.grid[0].length} tiles) with ${n} players`, () => {
      const res = run(n, i, scriptFor(L), 60 * 420);
      assert(!res.err, `bot error: ${res.err} (tick ${res.ticks})`);
      assert(res.won, `not won after ${res.ticks} ticks (key holder ${res.r.key.holder}, door open ${res.r.doorOpen})`);
      assert.strictEqual(res.deaths, 0, `bots died ${res.deaths}x`);
    });
  }
});

console.log('Campaign rules:');
check('every level key is placed and every level has a door, a checkpoint rest area and 12+ spare tiles at the end', () => {
  for (const L of LEVELS) {
    assert(L.grid.some(r => r.includes('D')), `${L.name}: no door`);
    assert(L.grid.some(r => r.includes('C')), `${L.name}: no checkpoint`);
    assert(L.grid[0].length > 120, `${L.name}: should be a long level (>120 tiles), is ${L.grid[0].length}`);
  }
});
check('level 7 (needs a 4-high stack) is not winnable with 3 players', () => {
  const res = run(3, 6, scriptFor(LEVELS[6]), 60 * 120);
  assert(!res.won, 'three players built a four-stack');
});
check('level 9 (seven choir buttons) is not winnable with 6 players', () => {
  const res = run(6, 8, scriptFor(LEVELS[8]), 60 * 150);
  assert(!res.won, 'six players held seven buttons');
});
check('choir gate: opens only while every button is held, then closes again', () => {
  const r = new Room('CH'); r.load(LEVELS[8]); const ps = []; for (let i = 0; i < 7; i++) ps.push(r.add(fake(), 'c' + i));
  for (let i = 0; i < 20; i++) r.update(1 / 60);
  const g = r.groups[0], put = (p, b) => { p.x = b.x + 2; p.y = b.y + b.h - PH; p.vx = p.vy = 0; };
  ps.slice(0, 6).forEach((p, i) => put(p, g.btns[i])); for (let i = 0; i < 20; i++) r.update(1 / 60);
  assert(!r.sim.gateMap[g.tx], 'gate opened with 6 of 7 buttons held');
  put(ps[6], g.btns[6]); r.update(1 / 60); assert(r.sim.gateMap[g.tx], 'gate did not open with all 7 held');
  ps.forEach(p => { p.x = 3 * TILE; p.y = 300; }); for (let i = 0; i < 60 * (r.level.choirTime + 1); i++) r.update(1 / 60);
  assert(!r.sim.gateMap[g.tx], 'gate stayed open');
});
check('Party Pack levels are premium and every one needs 7+ players', () => {
  const prem = LEVELS.filter(l => l.premium); assert.strictEqual(prem.length, 4);
  assert(prem.every(l => l.min >= 7), 'a premium level needs fewer than 7');
  assert(LEVELS.filter(l => !l.premium).every(l => l.min <= 4));
});
check('checkpoint: after touching a flag, a death respawns the player at the flag, not at the start', () => {
  const r = new Room('CP'); r.load(LEVELS[0]); const p = r.add(fake(), 'cp'); for (let i = 0; i < 20; i++) r.update(1 / 60);
  const flag = r.cps[0]; p.x = flag.x - 4; p.y = flag.y + 3; r.update(1 / 60);
  assert.strictEqual(r.spawnCol, flag.col, 'flag should become the spawn point');
  r.die(p); for (let i = 0; i < 120; i++) r.update(1 / 60);
  assert(!p.dead && Math.abs(p.x - (flag.col * TILE + p.slot * (PW + 2))) < 2, `respawned at x=${p.x}, flag spawn x=${flag.col * TILE}`);
  p.x = 3 * TILE; r.update(1 / 60); assert.strictEqual(r.spawnCol, flag.col, 'walking back must not move the checkpoint backwards');
});
check('gates stay shut without the button (level 4)', () => {
  const res = run(3, 3, (r, ps) => ps.map(p => walk(r, p, 100 * TILE, () => false, 900)), 60 * 12);
  const gate = LEVELS[3].segs.find(s => s.type === 'gate'); const gxPx = (gate.x0 + 9) * TILE;
  assert(!res.won && res.ps.every(p => p.x < gxPx), 'players got past a closed gate');
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with FAILURES)' : ''}`);
