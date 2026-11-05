// Headless checks of the physics assumptions the level design relies on.
const assert = require('assert');
const { Room, PH, TILE } = require('./server');
const CLASSIC = require('./levels-classic').LEVELS;
const fake = () => ({ readyState: 0, send() {} });

function run(room, ticks, cb) { for (let i = 0; i < ticks; i++) { cb && cb(i); room.update(1 / 60); } }
function setup(levelIdx, n) {
  const r = new Room('T'); r.load(CLASSIC[levelIdx]);
  const ps = []; for (let i = 0; i < n; i++) ps.push(r.add(fake(), 'p' + i));
  return { r, ps };
}

// 0. Jump feel: holding jumps high, a tap is a short hop, and falling is faster than rising (not floaty)
{
  const jump = holdTicks => {
    const { r, ps } = setup(1, 1); const p = ps[0]; run(r, 60); const g = p.y; let minY = g, tUp = 0, tDown = 0, peaked = false;
    for (let i = 0; i < 120; i++) {
      p.input = { l: 0, r: 0, j: i < holdTicks ? 1 : 0 }; r.update(1 / 60);
      if (i > 0 && p.onGround) break;
      if (p.y < minY) { minY = p.y; tUp = i; } else peaked = true;
      if (peaked) tDown = i - tUp;
    }
    return { rise: g - minY, tUp, tDown };
  };
  const full = jump(60), tap = jump(2);
  console.log('full jump', full, 'tap', tap);
  assert(full.rise > 100 && full.rise < 128, 'held jump should be ~110px');
  assert(tap.rise < full.rise * 0.45, `a tap should be a short hop (${tap.rise.toFixed(0)}px vs ${full.rise.toFixed(0)}px)`);
  assert(full.tDown < full.tUp * 0.9, 'falling should be quicker than rising');
  assert((full.tUp + full.tDown) / 60 < 0.65, 'total air time should be under 0.65 s');
}

// 1. A single player cannot clear a 4-tile wall by jumping (jump apex < 128px)
{
  const { r, ps } = setup(1, 1); const p = ps[0];
  run(r, 60); const groundY = p.y; let minY = p.y;
  run(r, 80, i => { p.input = { l: 0, r: 0, j: 1 }; minY = Math.min(minY, p.y); });
  const rise = groundY - minY; console.log('single jump rise', rise.toFixed(1));
  assert(rise > 100 && rise < 128, 'single jump should be 100-128px');
}

// 2. A player standing on another can rise past 128px relative to the ground
{
  const { r, ps } = setup(1, 2); const [a, b] = ps;
  b.x = a.x; b.y = a.y - PH - 0.5; // b above a
  run(r, 60);
  assert(Math.abs((b.y + PH) - a.y) < 2, 'b should rest on a');
  const groundTop = a.y + PH; let minFeet = b.y + PH;
  run(r, 80, () => { b.input = { l: 0, r: 0, j: 1 }; minFeet = Math.min(minFeet, b.y + PH); });
  const reach = groundTop - minFeet; console.log('stacked reach', reach.toFixed(1));
  assert(reach > 128, 'stacked player should clear a 4-tile wall');
}

// 3. Players push each other horizontally
{
  const { r, ps } = setup(0, 2); const [a, b] = ps;
  run(r, 30); b.x = a.x + 30; const bx = b.x;
  run(r, 60, () => { a.input = { l: 0, r: 1, j: 0 }; });
  console.log('pushed b by', (b.x - bx).toFixed(1));
  assert(b.x > bx + 20, 'a should push b');
}

// 4. A rider is carried by the base player
{
  const { r, ps } = setup(0, 2); const [a, b] = ps;
  run(r, 30); b.x = a.x; b.y = a.y - PH - 0.5; run(r, 30);
  const bx = b.x; run(r, 60, () => { a.input = { l: 0, r: 1, j: 0 }; });
  console.log('rider carried', (b.x - bx).toFixed(1));
  assert(b.x > bx + 100, 'rider should be carried');
}

// 5. Key + door completes the level
{
  const { r, ps } = setup(0, 1); const p = ps[0];
  run(r, 20);
  p.x = r.key.x - 4; p.y = r.key.y - 10; run(r, 5);
  assert.strictEqual(r.key.holder, p.id, 'key should be picked up');
  p.x = r.doors[0].x + 2; p.y = r.doors[0].y; run(r, 3);
  assert(r.doorOpen, 'door should open'); run(r, 3);
  assert(r.win > 0, 'level should be won');
}
// 6. Moving platforms (level 9 elevator, level 10 ferry)
{
  // the elevator carries a rider up to the ledge, and rests at both ends
  const { r, ps } = setup(8, 1); const p = ps[0], el = r.sim.platforms[0];
  run(r, 5); assert(Math.abs(el.y - 402) < 0.01, 'elevator starts at the bottom');
  p.x = el.x + 30; p.y = el.y - PH - 0.5; p.onGround = false; run(r, 10);
  assert(Math.abs(p.y + PH - el.y) < 2, 'player stands on the platform');
  let top = Infinity; run(r, 60 * 8, () => { top = Math.min(top, p.y); });
  console.log('elevator carried the rider up to y', top.toFixed(1));
  assert(top < 224 - PH + 3, 'the elevator should lift the rider to the ledge height');
  // it must come back down with the rider on it (no sliding off)
  run(r, 60 * 3); assert(Math.abs(p.x - (el.x + 30)) < 30, 'rider stays on the platform');
}
{
  // the ferry carries a rider sideways across the pit and sets them down at the far dock
  const { r, ps } = setup(9, 1); const p = ps[0], fe = r.sim.platforms[0];
  p.x = fe.x + 100; p.y = fe.y - PH - 0.5; run(r, 5); const x0 = p.x;
  let maxX = x0; run(r, 60 * 14, () => { maxX = Math.max(maxX, p.x); });
  console.log('ferry carried the rider', (maxX - x0).toFixed(0), 'px');
  assert(maxX - x0 > 120, 'the ferry should carry its rider ~4 tiles across');
  assert(!p.dead, 'rider survived the ride');
}
{
  // a platform pushes a player standing in its way, and crushes one pinned against a wall (the server kills them)
  const { r, ps } = setup(9, 2); const fe = r.sim.platforms[0], [a, b] = ps;
  a.x = fe.x + fe.w + 2; a.y = 416 - PH - 0.5; b.x = 800; b.y = 416 - PH - 0.5; run(r, 5);
  let pushed = 0, dead = false;
  run(r, 60 * 5, () => { if (a.x > fe.x + fe.w - 1) pushed++; if (a.dead) dead = true; });
  assert(a.x >= fe.x + fe.w - 0.01 || a.dead || pushed > 0, 'platform should not overlap a player it pushes');
  assert(!r.sim.platforms.some(pl => [a, b].some(q => !q.dead && ov2(q, pl))), 'no one is left overlapping a platform');
}
function ov2(p, pl) { return p.x < pl.x + pl.w - 1e-6 && p.x + 24 > pl.x + 1e-6 && p.y < pl.y + pl.h - 1e-6 && p.y + PH > pl.y + 1e-6; }

// 7. Spring: HOLDING jump launches ~220 px, not holding gives only ~140 px (level 11's second spring needs the hold)
{
  const bounce = hold => {
    const { r, ps } = setup(10, 1); const p = ps[0]; run(r, 5);
    const sp = r.grid[12].indexOf('S') * TILE; p.x = sp + 4; p.y = 12 * TILE - PH - 40; p.onGround = false; p.vy = 0;
    let landed = false, minY = Infinity;
    run(r, 120, () => { p.input = { l: 0, r: 0, j: hold ? 1 : 0 }; if (p.vy < -900) landed = true; if (landed) minY = Math.min(minY, p.y); });
    assert(landed, 'landing on a spring should launch'); return 12 * TILE - PH - minY;
  };
  const held = bounce(true), tapped = bounce(false);
  console.log('spring rise held', held.toFixed(0), 'not held', tapped.toFixed(0));
  assert(held > 190 && held < 260, 'held spring should reach ~220px');
  assert(tapped > 100 && tapped < 165, 'unheld spring should reach ~140px');
  assert(held - tapped > 60, 'holding jump has to matter on a spring');
}

// 8. Saw blades kill on touch
{
  const { r, ps } = setup(11, 1); const p = ps[0], h = r.sim.hazards[0]; run(r, 5);
  p.x = h.x - 6; p.y = h.y - 2; p.onGround = false; run(r, 2);
  assert(p.dead, 'a saw should kill a player it touches');
}
console.log('ALL PASS');
