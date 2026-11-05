// THROWAWAY PROTOTYPE. Shared deterministic physics: runs on the server (authoritative) and in the
// browser (client-side prediction). Both MUST use exactly this code.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 32, PW = 24, PH = 28, SPEED = 200, MAXV = 900;
  // Jump feel: ~114 px peak (same reach as before) but snappy. Gravity is 1.6x on the way down and
  // 4x on the way up when the jump key is released (hold = full jump, tap = short hop).
  const GRAV = 2200, JUMP = 710, FALL_MULT = 1.6, CUT_MULT = 4;
  // Spring tile 'S': landing on it launches you at SPRING px/s. While rising faster than a normal jump the
  // jump-cut does not apply, so a spring needs jump HELD for its full height (~227 px) and gives ~141 px without.
  const SPRING = 1000;
  // Boxes that merely touch must not count as overlapping: float error would otherwise make a
  // pushed player try to push the pusher back, deadlocking long chains of players.
  const EPS = 1e-6;
  const ov = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w - EPS > b.x && a.y < b.y + b.h - EPS && a.y + a.h - EPS > b.y;
  const box = p => ({ x: p.x, y: p.y, w: PW, h: PH });

  // Moving platforms / saw blades follow a pure function of the tick count, so the server and every client's
  // prediction agree without sending positions. Cycle: rest at A (dwellA s), glide to B (move s), rest at B (dwellB s), glide back.
  const ease = x => x * x * (3 - 2 * x);
  function moverPos(d, tick) {
    const P = 2 * d.move + d.dwellA + d.dwellB, T = (((tick / 60 + d.phase) % P) + P) % P;
    let s;
    if (T < d.dwellA) s = 0;
    else if (T < d.dwellA + d.move) s = ease((T - d.dwellA) / d.move);
    else if (T < d.dwellA + d.move + d.dwellB) s = 1;
    else s = 1 - ease((T - d.dwellA - d.move - d.dwellB) / d.move);
    return { x: d.x + d.ax * s, y: d.y + d.ay * s };
  }

  class Sim {
    constructor(grid) { this.players = new Map(); this.gateOpen = false; this.platforms = []; this.hazards = []; this.setGrid(grid || []); }
    // defs: [{kind:'plat'|'saw', x,y,w,h (px, top-left at rest at A), ax,ay (px travel to B), move,dwellA,dwellB,phase (s)}]
    setMovers(defs) {
      this.platforms = []; this.hazards = [];
      for (const d of defs || []) (d.kind === 'saw' ? this.hazards : this.platforms).push({ x: d.x, y: d.y, w: d.w, h: d.h, d });
      this.placeMovers(0);
    }
    placeMovers(tick) { for (const m of [...this.platforms, ...this.hazards]) { const p = moverPos(m.d, tick); m.x = p.x; m.y = p.y; } }
    // Advance every mover to `tick`. Players standing on a platform are carried, players in its way are pushed,
    // anyone it squeezes against a wall is returned (the server kills them). onlyCarry: only move the given players (client prediction).
    movePlatforms(tick, carry, onlyCarry) {
      const crushed = [], all = (onlyCarry ? carry : [...this.players.values(), ...(carry || [])]).filter(p => !p.dead);
      for (const h of this.hazards) { const p = moverPos(h.d, tick); h.x = p.x; h.y = p.y; }
      for (const pl of this.platforms) {
        const np = moverPos(pl.d, tick), dx = np.x - pl.x, dy = np.y - pl.y;
        if (!dx && !dy) continue;
        const riders = all.filter(p => p.x < pl.x + pl.w && p.x + PW > pl.x && p.y + PH <= pl.y + 0.01 && p.y + PH > pl.y - 1.5);
        pl.off = true; // not solid while we move things around it
        for (const r of riders) { if (dx) this.moveX(r, dx); if (dy) this.moveY(r, dy); }
        pl.x = np.x; pl.y = np.y;
        for (const p of all) {
          if (riders.includes(p) || !ov(box(p), pl)) continue;
          if (Math.abs(dx) >= Math.abs(dy)) this.moveX(p, dx > 0 ? pl.x + pl.w - p.x : -(p.x + PW - pl.x));
          else this.moveY(p, dy > 0 ? pl.y + pl.h - p.y : -(p.y + PH - pl.y));
        }
        pl.off = false;
        for (const p of all) if (ov(box(p), pl)) crushed.push(p);
      }
      return crushed;
    }
    onSpring(p) {
      const ty = Math.floor((p.y + PH + 1.5) / TILE); if (ty >= this.rows) return false;
      for (let tx = Math.floor(p.x / TILE); tx <= Math.floor((p.x + PW - 1e-4) / TILE); tx++) if (this.grid[ty][tx] === 'S') return true;
      return false;
    }
    setGrid(grid) { this.grid = grid; this.rows = grid.length; this.cols = grid.length ? grid[0].length : 0; }
    solid(tx, ty) {
      if (tx < 0 || tx >= this.cols) return true; if (ty < 0 || ty >= this.rows) return false;
      const c = this.grid[ty][tx];
      return c === '#' || c === 'S' || (c === 'G' && !this.gateOpen); // 'G' = gate: solid until a button opens it
    }
    hitsTile(p) {
      const e = 1e-4;
      for (let ty = Math.floor(p.y / TILE); ty <= Math.floor((p.y + PH - e) / TILE); ty++)
        for (let tx = Math.floor(p.x / TILE); tx <= Math.floor((p.x + PW - e) / TILE); tx++)
          if (this.solid(tx, ty)) return true;
      for (const pl of this.platforms) if (!pl.off && ov(box(p), pl)) return true;
      return false;
    }
    others(p) { return [...this.players.values()].filter(o => o !== p && !o.dead); }
    ridersOf(p) {
      return this.others(p).filter(o => o.x < p.x + PW && o.x + PW > p.x && o.y + PH <= p.y + 0.01 && o.y + PH > p.y - 1.5);
    }
    stepX(p, s, d) {
      const riders = this.ridersOf(p);
      p.x += s;
      if (this.hitsTile(p)) { p.x -= s; return false; }
      for (const o of this.others(p)) if (ov(box(p), box(o))) {
        if (d >= 12 || !this.stepX(o, s, d + 1)) { p.x -= s; return false; }
      }
      for (const o of this.others(p)) if (ov(box(p), box(o))) { p.x -= s; return false; }
      for (const r of riders) this.stepX(r, s, d + 1);
      return true;
    }
    stepY(p, s, d) {
      p.y += s;
      if (this.hitsTile(p)) { p.y -= s; return false; }
      for (const o of this.others(p)) if (ov(box(p), box(o))) {
        if (s < 0 && d < 12 && this.stepY(o, s, d + 1)) continue; // pushing someone upward
        p.y -= s; return false;
      }
      return true;
    }
    moveX(p, dx) {
      let rem = dx;
      while (Math.abs(rem) > 1e-9) { const s = Math.sign(rem) * Math.min(1, Math.abs(rem)); rem -= s; if (!this.stepX(p, s, 0)) break; }
    }
    moveY(p, dy) {
      let rem = dy;
      while (Math.abs(rem) > 1e-9) {
        const s = Math.sign(rem) * Math.min(1, Math.abs(rem)); rem -= s;
        if (!this.stepY(p, s, 0)) { if (s > 0) { p.onGround = true; if (this.onSpring(p)) { p.vy = -SPRING; p.onGround = false; break; } } p.vy = 0; break; }
      }
    }
    // advance ONE player by one tick given an input {l, r, j}
    stepPlayer(p, input, dt) {
      if (input.j && p.onGround) p.vy = -JUMP;
      p.onGround = false;
      const g = p.vy < 0 ? (input.j || p.vy < -JUMP ? GRAV : GRAV * CUT_MULT) : GRAV * FALL_MULT;
      p.vy = Math.min(p.vy + g * dt, MAXV);
      this.moveX(p, (input.r - input.l) * SPEED * dt);
      this.moveY(p, p.vy * dt);
    }
  }
  return { Sim, TILE, PW, PH, SPEED, GRAV, JUMP, FALL_MULT, CUT_MULT, SPRING, MAXV, ov, box, moverPos };
});
