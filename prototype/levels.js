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
function lvl(name, min, key, hint, draw) {
  const g = make();
  rect(g, 0, 13, W, 3, '#'); // ground
  draw(g);
  rect(g, 31, 10, 8, 3, 'D'); // door: wide enough for 10 players to all touch it at once
  return { name, min, hint, spawn: { x: 1, y: 12 }, key, grid: g.map(r => r.join('')) };
}

// Extra tiles: 'B' = timed button (opens every 'G' gate for a few seconds), 'G' = gate (solid until opened).
const LEVELS = [
  // 1: tutorial. Box, taller box, a small pit. The key lies on the way; everyone into the door.
  lvl('1. Hop over', 1, { x: 22, y: 12 }, 'Grab the key, then everyone into the door.', g => {
    rect(g, 14, 12, 2, 1, '#');
    rect(g, 18, 11, 2, 2, '#');
    rect(g, 26, 13, 2, 3, '.');
  }),
  // 2: key on a floating platform 4 tiles up -> needs a 2-stack
  lvl('2. Give me a boost', 2, { x: 19, y: 8 }, 'Too high alone. Stand on a friend\'s head!', g => {
    rect(g, 12, 12, 2, 1, '^');
    rect(g, 18, 9, 4, 1, '#');
  }),
  // 3: two pits in a row, then the key platform (2-stack)
  lvl('3. Mind the gap', 2, { x: 26, y: 8 }, 'Hold jump for a full leap. Don\'t fall in.', g => {
    rect(g, 11, 13, 3, 3, '.');  // pit
    rect(g, 17, 13, 3, 3, '.');  // pit
    rect(g, 25, 9, 4, 1, '#');   // floating key platform
  }),
  // 4: key on a platform 5 tiles up -> needs a 3-stack (3+ players)
  lvl('4. Tall order', 3, { x: 21, y: 7 }, 'Three-high stack: the one on top grabs the key.', g => {
    rect(g, 12, 12, 2, 1, '^');
    rect(g, 20, 8, 3, 1, '#');
  }),
  // 5: spikes, pit, spikes in quick succession, then a boost for the key
  lvl('5. Spike run', 2, { x: 26, y: 8 }, 'Spikes, a pit, more spikes. Keep moving!', g => {
    rect(g, 11, 12, 2, 1, '^');  // hazards start clear of the 10-player spawn row
    rect(g, 14, 13, 3, 3, '.');  // pit
    rect(g, 19, 12, 2, 1, '^');
    rect(g, 25, 9, 4, 1, '#');   // key platform
  }),
  // 6: someone must climb to the button; the gate then stays open only ~4 s, so everyone has to squeeze through the 1-wide gap fast
  lvl('6. Gatekeepers', 2, { x: 27, y: 8 }, 'Someone press the button, then EVERYONE through the gate before it shuts!', g => {
    rect(g, 10, 10, 4, 1, '#');  // ledge with the button on it (3 tiles up: reachable alone)
    g[9][11] = 'B';
    rect(g, 22, 0, 1, 13, 'G');  // gate wall
    rect(g, 26, 9, 4, 1, '#');   // key platform behind the gate
  }),
  // 7: key six tiles up -> a 4-stack (4+ players), after spikes and a pit
  lvl('7. The tower', 4, { x: 25, y: 6 }, 'Four-high tower. Everyone has a job.', g => {
    rect(g, 11, 12, 2, 1, '^');
    rect(g, 15, 13, 3, 3, '.');
    rect(g, 24, 7, 4, 1, '#');
  }),
];

module.exports = { LEVELS, TILE, W, H };
