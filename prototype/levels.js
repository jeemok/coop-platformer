// THROWAWAY PROTOTYPE. Original levels (not from Pico Park).
// Legend: '#' solid, '^' spike, 'D' door tile, '.' empty
// Rule for level design: a stack is only ever needed to reach the KEY, which sits on a
// FLOATING platform (ground stays free underneath). Never gate the path to the door behind
// a climb the last player cannot make, or the level becomes unwinnable.
const TILE = 32, W = 40, H = 16;

function make() { return Array.from({ length: H }, () => Array(W).fill('.')); }
function rect(g, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[y + j][x + i] = c;
}
// Movers follow a fixed cycle (see Sim.moverPos): rest at A, glide to B, rest at B, glide back. Positions in px.
// plat(col, topY, widthTiles, travelXTiles, travelYpx): a 14 px thick platform that carries whoever stands on it.
const THICK = 14;
const plat = (col, y, w, ax, ay, o = {}) => ({ kind: 'plat', x: col * TILE, y, w: w * TILE, h: THICK, ax: ax * TILE, ay, move: o.move || 3, dwellA: o.dwellA ?? 2, dwellB: o.dwellB ?? 2, phase: o.phase || 0 });
// saw(col, yTop, yBottom): a blade on a vertical rail (22 px hitbox), kills on touch
const saw = (col, y0, y1, o = {}) => ({ kind: 'saw', x: col * TILE + 5, y: y0, w: 22, h: 22, ax: 0, ay: y1 - y0, move: o.move || 1.1, dwellA: o.dwellA ?? 1.8, dwellB: o.dwellB ?? 1, phase: o.phase || 0 });

function lvl(name, min, key, hint, draw, opts = {}) {
  const g = make();
  rect(g, 0, 13, W, 3, '#'); // ground
  draw(g);
  rect(g, 31, 10, 8, 3, 'D'); // door: wide enough for 10 players to all touch it at once
  return { name, min, hint, movers: opts.movers || [], gateTime: opts.gateTime || 4, spawn: { x: 1, y: 12 }, key, grid: g.map(r => r.join('')) };
}

// Extra tiles: 'B' = timed button (opens every 'G' gate for gateTime seconds), 'G' = gate (solid until opened).
// Hazards stay clear of the spawn row (cols 0-10). A stack is only ever needed for the KEY.
const LEVELS = [
  // 1: a gentle first level, but already with a box, a wall, spikes and a pit
  lvl('1. Warm-up', 1, { x: 25, y: 12 }, 'Grab the key, then everyone into the door.', g => {
    rect(g, 12, 12, 2, 1, '#');
    rect(g, 16, 11, 2, 2, '#');
    rect(g, 22, 12, 2, 1, '^');
    rect(g, 27, 13, 2, 3, '.');
  }),
  // 2: a 2-stack for the key, then a pit and a wall to cross CARRYING the key (die and it flies home)
  lvl('2. Give me a boost', 2, { x: 15, y: 8 }, "Too high alone: stand on a friend's head. Dying with the key sends it home!", g => {
    rect(g, 14, 9, 4, 1, '#');
    rect(g, 24, 13, 3, 3, '.');
    rect(g, 29, 11, 2, 2, '#');
  }),
  // 3: three pits with small stepping stones, then a 2-stack for the key
  lvl('3. Stepping stones', 2, { x: 27, y: 8 }, 'Hold jump for a full leap. Stones are small, and friends push!', g => {
    rect(g, 10, 13, 3, 3, '.');
    rect(g, 15, 13, 3, 3, '.');
    rect(g, 20, 13, 3, 3, '.');
    rect(g, 26, 9, 4, 1, '#');
  }),
  // 4: 3-stack, then spikes and a wall with the key in hand
  lvl('4. Tall order', 3, { x: 16, y: 7 }, 'Three-high stack: the one on top grabs the key.', g => {
    rect(g, 15, 8, 3, 1, '#');
    rect(g, 24, 12, 2, 1, '^');
    rect(g, 28, 11, 2, 2, '#');
  }),
  // 5: climb to the button, then everyone through the gate in 3.5 s, then a 2-stack
  lvl('5. Gatekeepers', 2, { x: 23, y: 8 }, 'Someone press the button, then EVERYONE through the gate before it shuts!', g => {
    rect(g, 10, 10, 4, 1, '#');
    g[9][11] = 'B';
    rect(g, 17, 0, 1, 13, 'G');
    rect(g, 22, 9, 4, 1, '#');
  }, { gateTime: 3.5 }),
  // 6: pure platforming: four spike patches in a row. Solo-able, but with friends shoving...
  lvl('6. Spike garden', 1, { x: 27, y: 12 }, 'Time every leap. Small safe patches, and friends push!', g => {
    rect(g, 11, 12, 2, 1, '^');
    rect(g, 15, 12, 2, 1, '^');
    rect(g, 19, 12, 2, 1, '^');
    rect(g, 23, 12, 2, 1, '^');
  }),
  // 7: two gates, spikes between them, 3 s timer, then a 2-stack
  lvl('7. Double gate', 2, { x: 27, y: 8 }, 'Two gates and spikes between them. Be quick!', g => {
    rect(g, 9, 10, 4, 1, '#');
    g[9][10] = 'B';
    rect(g, 14, 0, 1, 13, 'G');
    rect(g, 18, 12, 2, 1, '^');
    rect(g, 22, 0, 1, 13, 'G');
    rect(g, 26, 9, 4, 1, '#');
  }, { gateTime: 3 }),
  // 8: key six tiles up -> a 4-stack (4+ players), after spikes, a pit and more spikes
  lvl('8. The tower', 4, { x: 25, y: 6 }, 'Four-high tower. Everyone has a job.', g => {
    rect(g, 11, 12, 2, 1, '^');
    rect(g, 14, 13, 3, 3, '.');
    rect(g, 19, 12, 2, 1, '^');
    rect(g, 24, 7, 4, 1, '#');
  }),
  // 9: moving platform (vertical). The key sits on a high ledge only the elevator reaches; spikes on the way and on the ledge.
  lvl('9. Elevator', 1, { x: 27, y: 6 }, 'Ride the lift up for the key. Wait for it, stand still, and mind the spikes up there.', g => {
    rect(g, 13, 12, 2, 1, '^');
    rect(g, 22, 7, 7, 1, '#');
    rect(g, 24, 6, 2, 1, '^');
  }, { movers: [plat(19, 402, 3, 0, -178, { move: 3.4, dwellA: 2.4, dwellB: 2.4 })] }),
  // 10: a wide ferry crosses a 13-tile pit; everybody must ride it (it carries the whole room at once)
  lvl('10. The ferry', 1, { x: 9, y: 12 }, 'The pit is far too wide to jump. Board the ferry, stand still, step off on the far side.', g => {
    rect(g, 11, 13, 13, 3, '.');
    rect(g, 28, 11, 2, 2, '#');
  }, { movers: [plat(11, 416, 9, 4, 0, { move: 3.2, dwellA: 3.5, dwellB: 3.5 })] }),
  // 11: springs. Hold jump on the second one: tapping falls short of the key ledge.
  lvl('11. Trampolines', 1, { x: 19, y: 2 }, 'Land on a spring and HOLD jump: the second one only reaches the key if you hold.', g => {
    rect(g, 10, 12, 1, 1, 'S');
    rect(g, 13, 9, 4, 1, '#');
    rect(g, 15, 8, 1, 1, 'S');
    rect(g, 17, 3, 4, 1, '#');
    rect(g, 26, 12, 2, 1, '^');
    rect(g, 29, 11, 2, 2, '#');
  }),
  // 12: two saw lanes the whole room has to cross, in a pack, while the blades are up
  lvl('12. Sawmill', 1, { x: 27, y: 12 }, 'Wait for the blades to rise, then run. Everyone has to get through both lanes.', g => {}, {
    movers: [saw(12, 322, 394, { phase: 0 }), saw(24, 322, 394, { phase: 2.5 })],
  }),
];

module.exports = { LEVELS, TILE, W, H };
