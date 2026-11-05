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
function lvl(name, min, key, draw) {
  const g = make();
  rect(g, 0, 13, W, 3, '#'); // ground
  draw(g);
  rect(g, 31, 10, 8, 3, 'D'); // door: wide enough for 10 players to all touch it at once
  return { name, min, spawn: { x: 1, y: 12 }, key, grid: g.map(r => r.join('')) };
}

const LEVELS = [
  // 1: hop a small box, grab the key, all into the door
  lvl('1. Hop over', 1, { x: 22, y: 12 }, g => {
    rect(g, 14, 12, 2, 1, '#');
  }),
  // 2: key on a floating platform 4 tiles up -> needs a 2-stack
  lvl('2. Give me a boost', 2, { x: 19, y: 8 }, g => {
    rect(g, 18, 9, 4, 1, '#');
  }),
  // 3: pit, then a platform key (2-stack), then spikes
  lvl('3. Mind the gap', 2, { x: 21, y: 8 }, g => {
    rect(g, 14, 13, 3, 3, '.');  // pit
    rect(g, 20, 9, 4, 1, '#');   // floating key platform
    rect(g, 26, 12, 2, 1, '^');  // spikes
  }),
  // 4: key on a platform 5 tiles up -> needs a 3-stack (3+ players)
  lvl('4. Tall order', 3, { x: 21, y: 7 }, g => {
    rect(g, 20, 8, 3, 1, '#');
  }),
  // 5: spikes + pit + platform key (2-stack)
  lvl('5. Spike run', 2, { x: 23, y: 8 }, g => {
    rect(g, 12, 12, 2, 1, '^');  // spikes (hazards start well clear of the 10-player spawn area)
    rect(g, 16, 13, 3, 3, '.');  // pit
    rect(g, 22, 9, 4, 1, '#');   // floating key platform
  }),
];

module.exports = { LEVELS, TILE, W, H };
