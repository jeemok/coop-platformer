# Co-op Platformer (working title) — Design

Date: 2026-11-01. Status: draft for review.

## Intent
A free, browser-based, online co-op puzzle platformer for friends, inspired by the *mechanics* of Pico Park (shared screen, players push and stack on each other, everyone must get the key to the door). It is an ORIGINAL game: own name, art, audio, levels, and code. Nothing is decompiled or extracted from Pico Park or any TECOPARK asset.

Why: the owner wants a shareable web version they can run at the lowest possible cost, grow with new levels, and monetize lightly (donations, plus a host unlock for bigger rooms).

## Goals
- Online rooms joined by link/code; 1–10 players per room (owner decision: cap at 10, like Pico Park).
- Players can push, stand on, and carry each other. Server-authoritative physics so everyone sees the same stack.
- Runs in desktop browsers; keyboard controls. Mobile is not a goal for v1 (my call).
- Levels are data files (JSON/tile maps) so new levels can be added without code changes.
- Total launch running cost about €5/month plus ~$12/year domain.

## Monetization (owner decided)
- Free for rooms of up to 5 players.
- One-time paid "host unlock" for rooms of 6–10 players. The host pays; guests never pay.
- Separate optional donation button (e.g. Ko-fi link, no code).
- Do NOT charge per player (kills the invite-your-friends loop).

## Non-goals
- No account system in v1: players pick a nickname; the host unlock is tied to a purchase token/room-host code (builder decides the simplest safe scheme; see Open items).
- No matchmaking with strangers in v1; private rooms only.
- No mobile/touch, no voice chat, no level editor in v1.
- No Pico Park assets, names, characters, or level layouts.

## Anti-goals (failure even if it "works")
- A surprise hosting bill from a traffic spike.
- Stacking/pushing that feels floaty or desyncs between players.
- Any content that copies Pico Park's protected assets.
- A paywall that blocks a guest from joining a friend's room.

## Constraints and decisions
- Hosting (my recommendation, owner asked for lowest cost): static client on Cloudflare Pages (free); one small flat-rate VPS (Hetzner-class, ~€4–5/month, large included traffic) running the game server. Avoid pay-per-use serverless for the game server.
- Spend protection: max live rooms per server (new players see "servers full, retry shortly"), idle-room timeout, billing alert.
- Netcode: authoritative server over WebSockets, ~30 ticks/s, small snapshots; client-side prediction for the local player with server reconciliation; interpolation for others. Target comfortable play under ~100 ms ping.
- Stack (my call, owner delegated): TypeScript throughout; Phaser or plain Canvas for the client; Node.js server with `ws`; shared physics/level code between client and server; Matter.js or a small custom AABB solver (builder decides, prefer simple custom AABB if stacking is deterministic and easier to tune).
- Abuse control: host can kick players; per-room rate limits.
- Art/audio: free CC0 packs (e.g. Kenney) for v1; custom art is optional later.

## Estimated costs (unverified estimates)
- ~48 kbps server-out per player; 100 concurrent players ≈ 5 Mbps, 1,000 ≈ 50 Mbps.
- Hosting ≈ $5–10/mo at 100 concurrent, $20–60/mo at 1,000.
- Payments: Stripe 2.9% + 30¢ per transaction.

## Milestones (rough order)
1. Single-room prototype: movement, collision, push/stack, key + door, 2–5 players over WebSocket.
2. Level loader and 5–8 starter levels.
3. Room codes/links, lobby, kick, scale to 10 players, spend protections.
4. Host unlock payment + donation link.
5. Deploy (Pages + VPS), domain, monitoring.

## Gameplay rules (my calls, owner can override)
- Falling off the map or touching a hazard respawns only that player at the level start/last checkpoint after ~2 s. No lives, no timer in v1.
- A level is complete when the key has been collected and every connected player is at the door. The host has a "restart level" button for stuck rooms.
- One player per browser/keyboard (no same-keyboard local play).
- Reconnection: a dropped player keeps their slot and nickname for 60 s via a session token; the game continues without them. The slot is released afterwards.
- Kick: the host can kick; the kicked session token is blocked from that room only. No IP or device tracking (privacy). Determined trolls can rejoin with a new tab; accepted for v1.
- Starter levels (5–8) are designed by the builder, sized to work for 2–10 players; the owner playtests.

## Left to the builder
Physics solver choice, rendering library, exact tick/snapshot format, project structure, how the host-unlock token is verified, test approach.

## Open items for the owner
- ANSWERED: most players are in Southeast Asia, so the VPS should be in Singapore. Note: Hetzner's Singapore plans include far less traffic than its EU ones, so re-check the cost estimate (or compare Vultr/DigitalOcean/Linode Singapore) before deploying.
- Game name and visual style (cute minimal shapes assumed).
- Price of the host unlock.
