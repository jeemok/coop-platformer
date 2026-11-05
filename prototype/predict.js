// THROWAWAY PROTOTYPE. Client-side prediction + server reconciliation for the local player.
// Pure logic (no DOM/network) so it can be unit-tested against a simulated laggy network.
//
// Flow:  every fixed tick the client calls setGhosts() then step(input) -> applies the input to a
//        local copy of the shared physics immediately (no waiting for the server) and returns the
//        numbered input to send.  When a server snapshot arrives, reconcile() rewinds to the server's
//        state for us, drops inputs the server has already processed (ack) and replays the rest.
//        Any leftover difference is not snapped: it is eased out over a few ticks (render offset).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim'));
  else root.Predictor = factory(root.Sim);
})(typeof self !== 'undefined' ? self : this, function (S) {
  const DT = 1 / 60, SNAP_DIST = 64, OFFSET_DECAY = 0.85;

  class Predictor {
    constructor() {
      this.sim = new S.Sim([]);
      this.me = { x: 0, y: 0, vy: 0, onGround: false, dead: 0 };
      this.history = []; this.seq = 0; this.ready = false;
      this.off = { x: 0, y: 0 };
      this.lastError = 0;
    }
    setGrid(grid) { this.sim.setGrid(grid); this.sim.gateOpen = false; this.history = []; this.ready = false; this.off.x = this.off.y = 0; this.sim.players.clear(); }

    setGate(open) { this.sim.gateOpen = !!open; }

    // other players, at the (interpolated) positions the user currently sees: [{id,x,y,dead}]
    setGhosts(list) {
      const seen = new Set();
      for (const g of list) {
        seen.add(g.id);
        let o = this.sim.players.get(g.id);
        if (!o) { o = { x: g.x, y: g.y, ix: g.x, dx: 0, dead: 0 }; this.sim.players.set(g.id, o); }
        o.dx = g.x - o.ix; o.ix = g.x; o.x = g.x; o.y = g.y; o.dead = g.dead ? 1 : 0; // dx = per-tick motion
      }
      for (const id of [...this.sim.players.keys()]) if (!seen.has(id)) this.sim.players.delete(id);
    }

    _advance(inp) {
      const me = this.me;
      // someone standing on a player who moves is carried along with them
      for (const g of this.sim.players.values()) {
        if (g.dead || !g.dx) continue;
        if (me.x < g.x + S.PW && me.x + S.PW > g.x && Math.abs(me.y + S.PH - g.y) < 2.5) this.sim.moveX(me, g.dx);
      }
      this.sim.stepPlayer(me, inp, DT);
    }

    // call once per fixed tick (60 Hz). Returns the numbered input to send to the server.
    step(input) {
      const inp = { s: ++this.seq, l: input.l ? 1 : 0, r: input.r ? 1 : 0, j: input.j ? 1 : 0 };
      this.history.push(inp);
      if (this.history.length > 300) this.history.shift();
      if (this.ready && !this.me.dead) this._advance(inp);
      this.off.x *= OFFSET_DECAY; this.off.y *= OFFSET_DECAY;
      if (Math.abs(this.off.x) < 0.01) this.off.x = 0;
      if (Math.abs(this.off.y) < 0.01) this.off.y = 0;
      return inp;
    }

    // srv = { x, y, vy, og, dead, ack } : our authoritative state as of input #ack
    reconcile(srv) {
      const me = this.me, had = this.ready && !me.dead, px = me.x, py = me.y;
      this.history = this.history.filter(h => h.s > srv.ack);
      me.x = srv.x; me.y = srv.y; me.vy = srv.vy; me.onGround = !!srv.og; me.dead = srv.dead ? 1 : 0;
      if (!me.dead) for (const h of this.history) this._advance(h);
      if (had && !me.dead) {
        const dx = px - me.x, dy = py - me.y;
        this.lastError = Math.hypot(dx, dy);
        if (this.lastError > SNAP_DIST) this.off.x = this.off.y = 0; // real divergence (e.g. respawn): snap
        else { this.off.x += dx; this.off.y += dy; }                // small: keep what the user saw, ease out
      } else { this.lastError = 0; this.off.x = this.off.y = 0; }
      this.ready = true;
    }

    // position to draw (prediction plus the easing-out error)
    renderPos() { return { x: this.me.x + this.off.x, y: this.me.y + this.off.y }; }
  }
  return Predictor;
});
