# Slipstream: notes for Claude Code

Overhead kart-racing game (Phaser + TypeScript, Matter.js physics) played online with coworkers. The owner hosts it from this Windows PC; coworkers join from their own networks via a browser.

## Run it

- **Online (normal use):** double-click `Start-Multiplayer.cmd`. First run does `npm ci` + build. Every later run rebuilds automatically if anything in `src/`, `server/`, `assets/`, `index.html` or `package.json` is newer than the last build. It starts the game server (picks the next free port if 8080 is busy) and opens a free Cloudflare quick tunnel. It prints a `https://….trycloudflare.com` link that serves both the game page and the `/race` WebSocket. The link changes on every restart.
- **Dev:** `npm run dev` (solo, Vite). `npm run build` then `npm run multiplayer` for a local server on :8080.
- **Checks:** `npm run check` (tests + type-check + build). Node 24 is installed on this PC; the project needs 22.12+.

## Layout

- `src/simulation.ts`: physics, bots, laps (shared by client and server). `tuning.topSpeed = 7.95` gives 80 km/h on the HUD (HUD km/h = speed × 13).
- `src/main.ts`: Phaser scene, menus, HUD, online client logic.
- `src/network.ts`: WebSocket client and the lobby DOM panel.
- `server/rooms.mjs`, `server/index.mjs`: authoritative room server (60 Hz physics, ~20 Hz snapshots).
- `scripts/start-online.mjs`: launcher (port fallback, auto-rebuild, cloudflared download and tunnel).

## Recent changes (Nov 2026, made in a claude.ai session, not yet playtested in a browser)

- Top speed raised from about 63 to 80 km/h. 8-bot races still finish cleanly with no resets.
- Mouse menus fixed: pixel scaling now uses Phaser's `scale.zoom` (the old manual canvas CSS sizing broke pointer mapping), and menu hit zones use `setScrollFactor(0)`.
- Podium: the host can click or press Enter for "Back to lobby"; guests see a waiting message; the podium redraws if the host changes.
- Online smoothness: the client sends input every physics step with a sequence number, logs it, and on each snapshot replays unacknowledged inputs (up to 20 steps). Corrections are drawn as a render offset that fades over 150 ms. The server sends one snapshot per catch-up loop, rounds snapshot floats, and allows up to 200 messages/s. Simulated at about 120 ms RTT with jitter: about 3× smoother than before.
- Launcher: serves the game from this PC through the tunnel (no longer the old chatgpt.site copy); port fallback; auto-rebuild.

These changes are **not committed to git yet**. Things worth verifying first: menu clicks at different window sizes, the podium flow with 2+ players, and online feel with real coworkers.
