# Co-op Platformer (working title) — prototype

A free, browser-based, online co-op puzzle platformer for 1–10 players. Players push each other,
stand on each other's heads, carry the key to the door, and everyone has to get through together.

It is **inspired by the mechanics** of games like Pico Park, but it is an original game: its own code,
levels and art. Nothing was decompiled, extracted or copied from Pico Park or any TECOPARK asset, and
none should be added.

> **Status: throwaway prototype.** Built to test the feel of the idea. The written design is in
> [`docs/superpowers/specs/`](docs/superpowers/specs/2026-11-01-coop-platformer-design.md);
> keeping this code as the real foundation needs an explicit decision. See [`docs/STACK.md`](docs/STACK.md)
> for the stack, architecture, netcode, costs and known limits.

## Play locally

```bash
cd prototype
npm install
npm start            # http://localhost:3000   (PORT=3017 npm start to change the port)
```

**Long levels:** levels are 150-355 tiles wide (4-11 screens). The camera follows you, a mini-map along the bottom shows everyone, the key, the checkpoints and the door, and touching a checkpoint flag moves everyone's respawn point there.

**Level choice:** pick a start level on the join screen (used when you create a room). The host (first player in the room) can switch level any time from the drop-down in the top bar.

Open it in two or more browser tabs, enter a nickname, and join the same room code (or use the
"Copy invite link" button). Controls: arrows or A/D to move, space/W/up to jump.

## Test

```bash
cd prototype
npm test
```

86 automated checks plus the physics assertions, all headless (no browser):

| Suite | What it proves |
|---|---|
| `test.js` | Physics basics: jump feel (hold = high, tap = hop, falls faster than it rises), jump height, pushing, riders being carried, moving platforms (lift, ferry, pushing, no overlap), springs (hold = ~220 px, tap = ~135 px), saws, key + door |
| `test-levels.js` | Bots play all 8 campaign levels (150-355 tiles long) through the real physics with the minimum players, +2, and a full room of 10, and **nobody may die**. Each level is built from segments (saw lanes, ferries, lifts, gates, stacks, springs, spike gardens...) and each segment type has its own bot. Also: a 4-high stack is not buildable by 3 players, gates stay shut without the button, checkpoints work. Debug one case: `ONLY=6:4 TRACE=1 node test-levels.js` (level 6, 4 players). |
| `test-classic.js` | The 12 original 40-tile levels (`levels-classic.js`) are kept as fixtures: the same bot playthroughs plus negative tests for stacks, gates, lift, ferry and saws. They are no longer in the game menu. |
| `test-server.js` | Real WebSockets: the room creator picks the start level, only the host can switch level, bad level numbers are ignored |
| `test-predict.js` | The real client prediction code against the real server over a simulated laggy/jittery network: input shows instantly, corrections stay small, client and server converge, also while riding a moving platform |

The browser client itself (drawing, keyboard) is **not** covered by automated tests; it was only checked by hand in headless Chrome screenshots. `START_LEVEL=6 npm start` starts new rooms on level 6 and `SPAWN_COL=150` starts everyone that far along (dev only); `?auto=1` in the URL joins immediately.

## Deploy (Render, free plan)

`render.yaml` is a Blueprint. In the Render dashboard: **New → Blueprint → select this repo → Apply.**
It deploys the `prototype/` folder as a free Node web service in the Singapore region.
See the free-tier caveats in [`docs/STACK.md`](docs/STACK.md#hosting-and-cost).

## Layout

```
prototype/
  server.js        authoritative game server (HTTP + WebSocket, rooms, 60 Hz tick)
  sim.js           shared physics — used by BOTH the server and the browser
  predict.js       client-side prediction + server reconciliation (pure logic, unit-tested)
  levels.js        the 8 campaign levels, built from segments (ASCII grids: # solid, ^ spike, B button, G gate, S spring, C checkpoint, D door; plus moving platforms and saws)
  levels-classic.js  the 12 old 40-tile levels, kept only as test fixtures
  public/index.html  the browser client (canvas)
  test*.js         automated tests
docs/              design doc and stack notes
render.yaml        Render Blueprint (free plan)
```
