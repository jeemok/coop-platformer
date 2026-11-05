# Stack, architecture and costs

Last updated 2026-11-05 (after the first playtest: moving platforms, then long hard levels).

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Server | Node.js 22 + [`ws`](https://github.com/websockets/ws) | The only runtime dependency. Plain `http` serves the page. |
| Client | One HTML page, Canvas 2D, no framework, no build step | Loads `/sim.js` and `/predict.js` from the server. |
| Language | JavaScript (CommonJS/UMD) | Shared modules use a small UMD wrapper so Node and the browser run the same file. |
| Hosting (planned) | Render free web service, Singapore | Players are mostly in Southeast Asia. |
| Source | GitHub (private repo) | Render deploys from it via `render.yaml`. |
| Art / audio | Drawn in code | Characters, key, door, tiles, background and particles are drawn with Canvas calls; sound effects are a tiny WebAudio synth. No asset files. |
| Payments | Built (needs seller setup) | Host unlock for 6-10 players via a license key validated against Lemon Squeezy (`license.js`); donations via Buy Me a Coffee. |

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
- **Jump feel.** Peak ~110 px. Gravity is 1.6x on the way down and 4x when the jump key is released while rising
  (hold = full jump, tap = short hop). First playtest said the original jump was floaty.
- **Prediction.** The client runs `sim.js` on its own player immediately. When a snapshot arrives it rewinds
  to the server's state, drops inputs the server has acknowledged, replays the rest, and eases any leftover
  error out over a few ticks (snaps only if it is off by more than 64 px).
- **Jitter handling.** The server advances a player by one queued input per tick. If the queue is empty (late
  packet) the player simply does not advance for up to 6 ticks, so the server never runs ahead of the client's
  replay. If more than 3 inputs are queued (after a stall) it consumes two per tick, limited by a credit bucket
  (about +10% speed sustained) so flooding inputs cannot speed-hack. Previously the queue dropped the oldest input
  on overflow, which caused rubber-banding.
- **Moving platforms and saws.** Each is a pure function of a per-room tick counter `pt` (rest at A, glide to B, rest at B, glide back:
  `Sim.moverPos`). The server sends only `pt` in every snapshot, never positions. The client rebuilds the platforms at the server's `pt`
  and replays each unacknowledged input one tick later, so the predicted rider and the platform agree. Platforms carry whoever stands on
  them (and anyone stacked on those), push players in their way, and a player squeezed against a wall is killed. Remote players are drawn ~100 ms in
  the past, so a remote rider is shifted along with its platform at draw time. Saws kill on touch (checked on the server every tick).
- **Springs** (`S` tile) launch you at 1000 px/s on landing. While rising faster than a normal jump the jump-cut does not apply, so a held jump
  reaches ~220 px and a tap ~135 px. This needs no extra state, so prediction handles it for free.
- **Long levels.** A level is a start zone, a list of segments laid end to end (`terrain`, `rest` with a checkpoint flag, `saws`,
  `ferry`, `lift`, `gate`, `stackKey`, `springKey`) and the door zone. `levels.js` builds the grid, the movers and the key position from
  that list, and the bot tests read the same list to play it. The client scrolls a camera that follows your own player and draws a
  mini-map. Checkpoints (`C` tiles): when anyone touches one, `spawnCol` moves there for everybody (never backwards); it is sent in every snapshot as `c`.
- **Two modes.** *Remote*: every browser is a player. *One screen*: the shared display joins with `role:'screen'` (watch-only, receives snapshots, may pick levels and restart, is not counted as a player) and phones join as normal players with `role:'pad'` via `/pad`. Pads send unnumbered inputs `{t:'in',l,r,j}` (no prediction needed, the display shows the result) with a 250 ms keep-alive; the server zeroes a pad's input after 1.5 s of silence so a dropped phone does not keep running. A room is deleted only when it has no players and no screens. The QR code uses qrcodejs from cdnjs (text fallback if blocked).
- **Fixed 60 Hz server clock** driven by real elapsed time (a plain `setInterval` drifts and would cause
  constant prediction corrections). One queued input per tick also stops a client from speeding up.
- **Rooms** are created on first join by room code, hold up to 10 players, and are deleted when empty.
  `MAX_ROOMS` caps live rooms per server; a new room beyond it gets "Servers full".

## Paid unlock

Free rooms hold `FREE_PLAYERS` (5). A key (from the join message, or `{t:'unlock'}` from the host/screen) is checked by `license.js`: `UNLOCK_KEYS` first, then Lemon Squeezy `POST /v1/licenses/validate` (no secret needed; must be `status: active` and `meta.product_id == LS_PRODUCT_ID`; positives cached 10 min). Valid means `room.unlocked = true` and the cap is `MAX_PLAYERS` (10) until the room empties. A provider outage never unlocks. Five bad keys per connection are tolerated. Limitation: a key is not bound to one room or limited by activations, so a leaked key works for anyone.

## Choir gates and Party Pack levels

Levels 9-12 are `premium: true`; `Room.load` falls back to level 1 if the room is not unlocked and the host's `go` is refused with a message. A choir segment draws `n` `b` buttons (2 tiles apart, so one player cannot cover two) and a `g` gate column. The server groups each `g` column with the `b` buttons since the previous `g`; the gate opens while every button in its group is held at once and stays open `choirTime` (7 s) after the last moment they were, or while someone is inside it. State is `sim.gateMap[column]`, shared with the client predictor (`setChoir`), and snapshots carry `cg` (per-gate timers) and `cb` (held buttons) only on levels that have choir gates. The old `B`/`G` timed gates are untouched.

## Latency (phones)

A phone controller sends unnumbered inputs and has no prediction, so its delay is: phone to server one-way + up to 16 ms server tick + snapshot interval + the shared screen's interpolation buffer + server to screen. Rooms with a screen therefore get 60 Hz snapshots (16 ms) and the screen interpolates only 60 ms behind (100 ms and 30 Hz otherwise). The controller shows its round-trip time (green under 60 ms). **Local mode** (`npm run local`, `local.js`) removes the cloud hop: the laptop runs the server, `GET /lan.json` gives its wifi address (VPN/VM/container interfaces are skipped), and the shared screen builds the QR from that address instead of `localhost`. The QR library is served from `/qrcode.min.js`, so it needs no internet. Phone pages are plain http on the LAN, so wake-lock is unavailable (fullscreen still works). The part we cannot fix in code over the internet is the route phone, cloud server, laptop: if the phone is on mobile data and the server is far away, that alone can exceed 100 ms.

## Gameplay rules

- Fall off the map or touch spikes: only that player respawns after about 1.5 s; a carried key returns home.
- A level is won when the key has reached the door (door opens) and **every** connected player is touching it.
- Levels are ASCII grids in `levels.js` (`#` solid, `^` spike, `D` door, `B` button, `G` gate, `S` spring) plus a `movers` list (platforms, saws). 12 long levels (8 free + 4 Party Pack, built from segments, see below); the last loops to the 1st. The creator of a room picks the start level (`level` in the join message) and the host can switch with `{t:'go', l}`; `/levels.json` lists names for the pickers.
- **Timed gate (levels 5 and 7):** standing on a `B` button opens every `G` gate for the level's `gateTime` (3.5 s and 3 s) after the last press. A gate never
  closes on a player standing inside it (it stays open at least 0.6 s after anyone is in it).
- Players never visually overlap: remote players are nudged out of overlap at draw time (the local player's own box is exact).
- **Level design rules learned the hard way** (each was a real bug caught by the bot tests):
  1. A stack may only be needed to reach the **key**, which sits on a floating platform. Never gate the path
     to the door behind a climb the last player cannot make: nobody can pull the last player up.
  2. The door must be wide enough for a full room (10 players) to touch it at once.
  3. Hazards after the key platform must start at least ~4 tiles past its right edge (a player dropping off lands
     about 3 tiles further on), and never right in front of the door: 10 players land in a pile.
  4. A platform that has to carry the whole room must be wide enough for 10 players (9 tiles = 10 players at 27 px each) and must rest
     at each end long enough to board (only ~2 s on the ferries now). Keep platform paths free of walls and floors so nobody is crushed.
  5. A saw lane must stay passable for a whole pack (the bots wait for 2.4 s of clear time), and nothing a player must cross
     may be unjumpable except the ferry pit (13 tiles).
  6. The first hazard of a terrain segment is 8+ tiles in (`LEAD`): a pack of 10 arriving behind you shoves you ~7 tiles forward.
  7. Keep 4+ tiles between a pit and the next hazard (a landing in a dense pack gets shoved).
  8. A gate must stay open long enough for the presser to sprint through behind the pack (3.6-4 s).
  9. Keep hazards clear of the spawn row (10 players spawn across x = 32..290) and leave a run-up between
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

- Browser client not covered by automated tests; never verified on real phones (the pad UI was only checked in headless Chrome) or other browsers.
- Prediction is exact for solo movement but can snap up to about 23 px when pushing another player
  (we only see them 100 ms in the past).
- No accounts, no reconnection slot-holding, no kick button, no sound. (All are in the design doc.)
- Rooms live in server memory; a restart or free-tier spin-down drops everyone.
- Remote riders on moving platforms are shifted at draw time, which is approximate. Prediction while riding is within ~2 px in the simulated-network test.
- Levels 3, 4, 6 need 2-3+ players and levels 7, 8 need 4+. Difficulty with real humans is untested: bots pass every level with no deaths, which only proves they are solvable. If a key carrier dies the key returns to where it started, which on a long level can be far back.
- The camera follows only your own player, so you can lose sight of friends who run ahead (the mini-map shows them).
- The jump is shorter than before (reach ~115 px horizontally), so pits must stay at 3 tiles or less.

## Next steps

1. Playtest and tune: jump height, speed, level pacing.
2. Decide the paid unlock model, price, and seller/tax setup (open questions in the design doc).
3. Real art and sound; mobile controls if wanted.
4. Reconnect, kick, name moderation; room list / quick-join.
5. Move to a flat-rate Singapore VPS before promoting it.
