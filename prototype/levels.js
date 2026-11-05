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
function lvl(name, min, key, hint, draw, opts = {}) {
  const g = make();
  rect(g, 0, 13, W, 3, '#'); // ground
  draw(g);
  rect(g, 31, 10, 8, 3, 'D'); // door: wide enough for 10 players to all touch it at once
  return { name, min, hint, gateTime: opts.gateTime || 4, spawn: { x: 1, y: 12 }, key, grid: g.map(r => r.join('')) };
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
];

module.exports = { LEVELS, TILE, W, H };
