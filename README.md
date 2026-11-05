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

Open it in two or more browser tabs, enter a nickname, and join the same room code (or use the
"Copy invite link" button). Controls: arrows or A/D to move, space/W/up to jump.

## Test

```bash
cd prototype
npm test
```

22 automated checks, all headless (no browser):

| Suite | What it proves |
|---|---|
| `test.js` | Physics basics: jump height, pushing, riders being carried, key + door |
| `test-levels.js` | Bots play all 5 levels through the real physics and win with the minimum players, +2, and a full room of 10. Cooperation-gated levels are **not** winnable without enough players. |
| `test-predict.js` | The real client prediction code against the real server over a simulated laggy/jittery network: input shows instantly, corrections stay small, client and server converge |

The browser client itself (drawing, keyboard) is **not** covered by automated tests.

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
  levels.js        the 5 levels (ASCII grids)
  public/index.html  the browser client (canvas)
  test*.js         automated tests
docs/              design doc and stack notes
render.yaml        Render Blueprint (free plan)
```
