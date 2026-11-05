# Stack, architecture and costs

Last updated 2026-11-05. Everything here describes the **prototype**.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Server | Node.js 22 + [`ws`](https://github.com/websockets/ws) | The only runtime dependency. Plain `http` serves the page. |
| Client | One HTML page, Canvas 2D, no framework, no build step | Loads `/sim.js` and `/predict.js` from the server. |
| Language | JavaScript (CommonJS/UMD) | Shared modules use a small UMD wrapper so Node and the browser run the same file. |
| Hosting (planned) | Render free web service, Singapore | Players are mostly in Southeast Asia. |
| Source | GitHub (private repo) | Render deploys from it via `render.yaml`. |
| Art / audio | None yet | Placeholder rectangles. Plan: free CC0 packs (e.g. Kenney). |
| Payments | Not built | Planned: one-time host unlock via a merchant of record or Stripe, plus a donation link. |

## Architecture

```
 browser                                              server (Node)
 -------                                              -------------
 keys -> Predictor.step()  --{in, seq, l,r,j} 60/s-->  per-player input queue
   |  applies input NOW using sim.js                     |  1 input consumed per 60 Hz tick
   |                                                     v
   |                                              Sim.stepPlayer() for every player (sim.js)
   |                                                     |
 Predictor.reconcile() <---- snapshot 30/s ---------  [id,x,y,dead,vy,onGround,ack]
   rewind to server state, replay unacked inputs
 other players: interpolated ~100 ms in the past
```

- **Authoritative server.** Clients send only inputs; the server decides positions, key, door, deaths.
- **One physics module (`sim.js`).** Simple AABB movement in 1-pixel sub-steps. Players are solid to each
  other: walking into someone pushes them (chains of up to 12), jumping into someone below pushes them up,
  and a player standing on someone is carried when they move.
- **Prediction.** The client runs `sim.js` on its own player immediately. When a snapshot arrives it rewinds
  to the server's state, drops inputs the server has acknowledged, replays the rest, and eases any leftover
  error out over a few ticks (snaps only if it is off by more than 64 px).
- **Fixed 60 Hz server clock** driven by real elapsed time (a plain `setInterval` drifts and would cause
  constant prediction corrections). One queued input per tick also stops a client from speeding up.
- **Rooms** are created on first join by room code, hold up to 10 players, and are deleted when empty.
  `MAX_ROOMS` caps live rooms per server; a new room beyond it gets "Servers full".

## Gameplay rules

- Fall off the map or touch spikes: only that player respawns after about 1.5 s; a carried key returns home.
- A level is won when the key has reached the door (door opens) and **every** connected player is touching it.
- Levels are ASCII grids in `levels.js` (`#` solid, `^` spike, `D` door). 5 levels; the 5th loops to the 1st.
- **Level design rules learned the hard way** (each was a real bug caught by the bot tests):
  1. A stack may only be needed to reach the **key**, which sits on a floating platform. Never gate the path
     to the door behind a climb the last player cannot make: nobody can pull the last player up.
  2. The door must be wide enough for a full room (10 players) to touch it at once.
  3. Keep hazards clear of the spawn row (10 players spawn across x = 32..290) and leave a run-up between
     a pit and a following hazard.

## Hosting and cost

Verified against Render's free-instance docs on 2026-11-05:

- 750 free instance hours per workspace per month (one always-on service fits).
- Spins down after **15 minutes without inbound traffic** (WebSocket messages on an open connection count
  as traffic, so an active game keeps it awake). Waking takes about a minute, and the first visitor waits.
- Render states free instances are for testing and hobby projects, **not production**; they can restart
  at any time and have no persistent disk.
- Free web services count against a monthly outbound-bandwidth allowance whose size the docs page did not state
  (check the dashboard). **Without a payment method on the account, going over suspends the free services
  instead of billing** — so do not add a card unless you want overage billing.
- Not confirmed from the docs: whether sign-up needs a card, the exact CPU/RAM of the free instance, and the
  region list (`render.yaml` asks for `singapore`; the dashboard will say if it is unavailable).

| Item | Cost |
|---|---|
| Render free web service | $0 |
| GitHub private repo | $0 |
| Domain | not bought ($0; you get a `*.onrender.com` URL) |
| Art / audio | $0 (none yet) |

**The free tier's CPU is small and untested for this game.** The server runs a 60 Hz simulation per room.
`MAX_ROOMS=10` is a guess to protect it. If rooms stutter on Render, the planned upgrade is a flat-rate VPS
in Singapore (roughly $5–10/month; compare providers, because Singapore plans usually include much less
bandwidth than EU ones). Per-player bandwidth is about 48 kbps from the server and about 2 KB/s of inputs up.

## Known limits

- Browser client not covered by automated tests; never verified on real phones or other browsers.
- Prediction is exact for solo movement but can snap up to about 23 px when pushing another player
  (we only see them 100 ms in the past).
- No accounts, no reconnection slot-holding, no kick button, no payments, no sound. (All are in the design doc.)
- Rooms live in server memory; a restart or free-tier spin-down drops everyone.
- Level 4 needs 3+ players; level 5's difficulty with real humans is untested.

## Next steps (if the prototype feels right)

1. Playtest and tune: jump height, speed, level pacing.
2. Decide the paid unlock model, price, and seller/tax setup (open questions in the design doc).
3. Real art and sound; mobile controls if wanted.
4. Reconnect, kick, name moderation; room list / quick-join.
5. Move to a flat-rate Singapore VPS before promoting it.
