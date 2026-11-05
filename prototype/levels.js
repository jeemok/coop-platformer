// THROWAWAY PROTOTYPE. The campaign: long, hard levels built from reusable SEGMENTS (original design, not from Pico Park).
// Legend: '#' solid, '^' spike, 'D' door, 'B' button, 'G' gate, 'S' spring, 'C' checkpoint flag, '.' empty.
// A level is: a start zone, a list of segments laid end to end, then the door zone. Each segment draws its own terrain and
// movers and records what it is (`segs`), so the bot tests can play any level by walking its segments in order.
//
// Rules the bot tests enforce (see docs/STACK.md): the whole room (up to 10) must be able to finish with no deaths when
// everyone plays well. Difficulty comes from length, timing, hazard density and coordination, not from impossible jumps.
const TILE = 32, H = 16, START = 12, REST_W = 11, DOOR_ZONE = 12;
const THICK = 14;

function make(w) { return Array.from({ length: H }, () => Array(w).fill('.')); }
function rect(g, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[y + j][x + i] = c; }
const plat = (col, y, w, ax, ay, o = {}) => ({ kind: 'plat', x: col * TILE, y, w: w * TILE, h: THICK, ax: ax * TILE, ay, move: o.move || 3, dwellA: o.dwellA ?? 2, dwellB: o.dwellB ?? 2, phase: o.phase || 0 });
const saw = (col, y0, y1, o = {}) => ({ kind: 'saw', x: col * TILE + 5, y: y0, w: 22, h: 22, ax: 0, ay: y1 - y0, move: o.move || 0.8, dwellA: o.dwellA ?? 1.5, dwellB: o.dwellB ?? 1, phase: o.phase || 0 });

// ---- segment constructors: each returns { type, w, ...params, build(g, x0, movers) -> key|undefined } ----
// terrain: ordinary platforming. feats: ['spike',c,n] ['pit',c,n] ['wall',c,width,height]; opts.key = column of a key lying on the ground
// The first hazard is always 8+ tiles in: a pack of 10 arriving behind you shoves you forward by up to ~7 tiles.
const LEAD = 8;
const terrain = (w, feats, opts = {}) => ({ type: 'terrain', w: w + LEAD, key: opts.key, build(g, x0) {
  x0 += LEAD;
  for (const [k, c, a, b] of feats) {
    if (k === 'spike') rect(g, x0 + c, 12, a, 1, '^');
    else if (k === 'pit') rect(g, x0 + c, 13, a, 3, '.');
    else if (k === 'wall') rect(g, x0 + c, 13 - b, a, b, '#');
  }
  if (opts.key != null) return { x: x0 + opts.key, y: 12 };
} });
// rest: flat ground and a checkpoint flag. After someone touches the flag, everyone respawns here.
const rest = () => ({ type: 'rest', w: REST_W, build(g, x0) { g[12][x0 + REST_W - 1] = 'C'; } });
// saws: vertical saw lanes, 10 tiles apart; the pack waits for the blades to rise, then runs through
const saws = (n, o = {}) => ({ type: 'saws', w: 10 * n + 4, n, build(g, x0, mv) {
  for (let i = 0; i < n; i++) mv.push(saw(x0 + 10 * i + 10, o.y0 ?? 322, 394, { move: o.move, dwellA: o.dwellA, dwellB: o.dwellB, phase: (o.phase ?? 2.5) * i }));
} });
// ferry: a platform shuttles across a pit that is too wide to jump. plat = width in tiles (5 fits 5 players, 9 fits 10)
const ferry = (pit, platW, o = {}) => ({ type: 'ferry', w: 9 + pit + 4, pit, platW, build(g, x0, mv) {
  rect(g, x0 + 9, 13, pit, 3, '.');
  mv.push(plat(x0 + 9, 416, platW, pit - platW, 0, { move: o.move || 2.4, dwellA: o.rest || 2.0, dwellB: o.rest || 2.0, phase: o.phase || 0 }));
} });
// lift: a wide platform rises from a shaft to a ledge (row 8) with hazards on it; walk off the end and drop to the ground
const lift = (L, ledgeFeats, o = {}) => ({ type: 'lift', w: 18 + L + 7, L, build(g, x0, mv) {
  rect(g, x0 + 9, 13, 9, 3, '.');
  rect(g, x0 + 18, 8, L, 1, '#');
  for (const [k, c, a] of ledgeFeats || []) if (k === 'spike') rect(g, x0 + 18 + c, 7, a, 1, '^');
  mv.push(plat(x0 + 9, 416, 9, 0, -160, { move: o.move || 3, dwellA: o.rest || 3, dwellB: o.rest || 3 }));
} });
// gate: climb the ledge, stand on the button, and everyone runs through the gate before it shuts (opts.time seconds)
const gate = (time = 3.5) => ({ type: 'gate', w: 16, time, build(g, x0) {
  rect(g, x0 + 2, 10, 4, 1, '#'); g[9][x0 + 3] = 'B'; rect(g, x0 + 9, 0, 1, 13, 'G');
} });
// stackKey: the key sits on a platform only a k-high stack can reach
const stackKey = k => ({ type: 'stackKey', w: 18, k, build(g, x0) {
  const row = 11 - k; rect(g, x0 + 8, row, 4, 1, '#'); return { x: x0 + 9, y: row - 1 };
} });
// springKey: two springs in a row; the second only reaches the key if jump is HELD
const springKey = () => ({ type: 'springKey', w: 24, build(g, x0) {
  rect(g, x0 + 6, 12, 1, 1, 'S'); rect(g, x0 + 9, 9, 4, 1, '#'); rect(g, x0 + 11, 8, 1, 1, 'S'); rect(g, x0 + 13, 3, 4, 1, '#');
  return { x: x0 + 15, y: 2 };
} });

function level(name, min, hint, segs, opts = {}) {
  const movers = []; let x = START, key = null;
  const width = START + segs.reduce((a, s) => a + s.w, 0) + DOOR_ZONE;
  const g = make(width); rect(g, 0, 13, width, 3, '#');
  const placed = segs.map(s => { const x0 = x; const k = s.build(g, x0, movers); if (k) key = k; x += s.w; return { ...s, x0, build: undefined }; });
  rect(g, width - 9, 10, 8, 3, 'D'); // door: wide enough for 10 players at once
  if (!key) throw new Error(`${name}: no key`);
  return { name, min, hint, movers, gateTime: opts.gateTime || 3.5, spawn: { x: 1, y: 12 }, key, segs: placed, grid: g.map(r => r.join('')) };
}

// Hazard spacing (checked by the bots): 2+ free tiles between a pit and the next hazard, nothing within ~4 tiles after a drop-off.
const garden = (n, c0 = 4) => Array.from({ length: n }, (_, i) => ['spike', c0 + i * 4, 2]);       // spike patches with 2-tile safe islands
const stones = (n, c0 = 4) => Array.from({ length: n }, (_, i) => ['pit', c0 + i * 5, 3]);          // 3-wide pits with 2-tile stepping stones
const HARD_SAWS = { move: 0.5, dwellA: 1.25, dwellB: 0.9 };  // fast blades: only ~1.75 s of safe time per cycle

const LEVELS = [
  level('1. The long road', 1, 'A long way to the door, with checkpoints. Touch a flag and everyone respawns there.', [
    terrain(24, [['spike', 6, 2], ['pit', 12, 3], ['wall', 19, 2, 2]]),
    rest(),
    terrain(30, [...garden(3), ['pit', 17, 3], ['spike', 22, 2]], { key: 27 }),
    rest(),
    terrain(30, [['wall', 4, 2, 2], ['pit', 10, 3], ['spike', 16, 2], ['spike', 20, 2], ['pit', 25, 3]]),
  ]),
  level('2. Sawmill run', 1, 'Saw lanes in a row. Wait for the blades to rise, then run, all of you.', [
    terrain(26, [['spike', 5, 2], ['spike', 9, 2], ['pit', 14, 3], ['wall', 20, 2, 2]]),
    saws(3),
    rest(),
    terrain(30, [['spike', 4, 2], ['pit', 9, 3], ['spike', 15, 2], ['spike', 19, 2], ...stones(1, 24)], { key: 22 }),
    saws(3, HARD_SAWS),
    rest(),
    terrain(30, [...stones(3, 4), ['spike', 22, 2]]),
  ]),
  level('3. Over the water', 2, 'Ferries carry five at a time. Wait your turn, stand still, and watch the spikes after each crossing.', [
    terrain(24, [['spike', 6, 2], ['wall', 13, 2, 2], ['spike', 19, 2]]),
    ferry(12, 5),
    rest(),
    stackKey(2),
    terrain(22, [...garden(3), ['pit', 16, 3]]),
    ferry(13, 5, { phase: 4 }),
    rest(),
    terrain(26, [['spike', 5, 2], ['spike', 9, 2], ['wall', 15, 2, 2], ['spike', 20, 2]]),
    ferry(12, 5, { move: 2.0, rest: 1.9 }),
    terrain(20, [['spike', 6, 2]]),
  ]),
  level('4. Gatekeepers II', 2, 'One of you holds the button. The rest run for the gates. Gates close again!', [
    terrain(22, [['spike', 6, 2], ['pit', 12, 3]]),
    gate(4),
    terrain(24, [...garden(3), ['wall', 18, 2, 2]]),
    gate(4),
    rest(),
    stackKey(2),
    terrain(24, [...stones(2, 4), ['spike', 18, 2]]),
    gate(4),
    terrain(22, [['spike', 6, 2], ['spike', 10, 2], ['pit', 15, 3]]),
  ], { gateTime: 4 }),
  level('5. Skyline', 1, 'Lifts take the whole crew up. Mind the spikes up there, and the drop.', [
    terrain(24, [['spike', 6, 2], ['pit', 12, 3]]),
    lift(16, [['spike', 5, 2], ['spike', 10, 2]]),
    rest(),
    springKey(),
    terrain(24, [...garden(3), ['pit', 17, 3]]),
    lift(18, [['spike', 4, 2], ['spike', 8, 2], ['spike', 13, 2]]),
    saws(2, HARD_SAWS),
    rest(),
    terrain(32, [['wall', 4, 2, 2], ['pit', 10, 3], ['spike', 18, 2], ['wall', 24, 2, 2]]),
  ]),
  level('6. The gauntlet', 3, 'Everything at once. Checkpoints are your friends.', [
    terrain(26, [...garden(4), ['pit', 20, 3]]),
    saws(3, HARD_SAWS),
    rest(),
    stackKey(3),
    terrain(24, [['wall', 4, 2, 2], ['spike', 10, 2], ...stones(1, 16)]),
    ferry(12, 5, { phase: 2 }),
    rest(),
    gate(3),
    saws(2),
    terrain(26, [...stones(2, 4), ['spike', 16, 2], ['spike', 20, 2]]),
    rest(),
    terrain(24, [...garden(4)]),
  ], { gateTime: 3.6 }),
  level('7. Tower of Babel', 4, 'A four-high tower, then lifts, saws and ferries. Nobody gets left behind.', [
    terrain(26, [['spike', 6, 2], ['pit', 12, 3], ['wall', 19, 2, 2], ['spike', 23, 2]]),
    stackKey(4),
    rest(),
    lift(14, [['spike', 4, 2], ['spike', 9, 2]]),
    saws(3, HARD_SAWS),
    rest(),
    ferry(13, 5),
    terrain(22, [...garden(3), ['pit', 16, 3]]),
    rest(),
    gate(2.8),
    terrain(24, [...stones(3, 4)]),
  ], { gateTime: 3.6 }),
  level('8. Endurance', 4, 'The whole campaign in one go. Good luck, all of you.', [
    terrain(22, [...garden(3), ['pit', 18, 3]]),
    saws(2, HARD_SAWS),
    rest(),
    stackKey(4),
    terrain(22, [['wall', 4, 2, 2], ...stones(2, 8)]),
    ferry(12, 5, { phase: 1 }),
    rest(),
    lift(14, [['spike', 4, 2], ['spike', 9, 2]]),
    gate(),
    saws(2, HARD_SAWS),
    rest(),
    terrain(26, [...garden(4), ['wall', 22, 2, 2]]),
    ferry(13, 5, { phase: 3, move: 2.0, rest: 1.9 }),
    terrain(24, [...stones(2, 4), ['spike', 20, 2]]),
  ], { gateTime: 3.6 }),
];

module.exports = { LEVELS, TILE, H };
