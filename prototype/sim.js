// THROWAWAY PROTOTYPE. Shared deterministic physics: runs on the server (authoritative) and in the
// browser (client-side prediction). Both MUST use exactly this code.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 32, PW = 24, PH = 28, SPEED = 200, GRAV = 1800, JUMP = 650, MAXV = 900;
  // Boxes that merely touch must not count as overlapping: float error would otherwise make a
  // pushed player try to push the pusher back, deadlocking long chains of players.
  const EPS = 1e-6;
  const ov = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w - EPS > b.x && a.y < b.y + b.h - EPS && a.y + a.h - EPS > b.y;
  const box = p => ({ x: p.x, y: p.y, w: PW, h: PH });

  class Sim {
    constructor(grid) { this.players = new Map(); this.setGrid(grid || []); }
    setGrid(grid) { this.grid = grid; this.rows = grid.length; this.cols = grid.length ? grid[0].length : 0; }
    solid(tx, ty) { if (tx < 0 || tx >= this.cols) return true; if (ty < 0 || ty >= this.rows) return false; return this.grid[ty][tx] === '#'; }
    hitsTile(p) {
      const e = 1e-4;
      for (let ty = Math.floor(p.y / TILE); ty <= Math.floor((p.y + PH - e) / TILE); ty++)
        for (let tx = Math.floor(p.x / TILE); tx <= Math.floor((p.x + PW - e) / TILE); tx++)
          if (this.solid(tx, ty)) return true;
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
        if (!this.stepY(p, s, 0)) { if (s > 0) p.onGround = true; p.vy = 0; break; }
      }
    }
    // advance ONE player by one tick given an input {l, r, j}
    stepPlayer(p, input, dt) {
      if (input.j && p.onGround) p.vy = -JUMP;
      p.onGround = false;
      p.vy = Math.min(p.vy + GRAV * dt, MAXV);
      this.moveX(p, (input.r - input.l) * SPEED * dt);
      this.moveY(p, p.vy * dt);
    }
  }
  return { Sim, TILE, PW, PH, SPEED, GRAV, JUMP, MAXV, ov, box };
});
