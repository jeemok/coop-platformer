// Headless checks of the physics assumptions the level design relies on.
const assert = require('assert');
const { Room, PH, TILE } = require('./server');
const fake = () => ({ readyState: 0, send() {} });

function run(room, ticks, cb) { for (let i = 0; i < ticks; i++) { cb && cb(i); room.update(1 / 60); } }
function setup(levelIdx, n) {
  const r = new Room('T'); r.load(levelIdx);
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
console.log('ALL PASS');
