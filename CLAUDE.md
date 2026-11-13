# Slipstream: notes for Claude Code

Overhead kart-racing game (Phaser + TypeScript, Matter.js physics) played online with coworkers. The owner hosts it from this Windows PC; coworkers join from their own networks via a browser.

## Run it

- **Online (normal use):** double-click `Start-Multiplayer.cmd`. First run does `npm ci` + build. Every later run rebuilds automatically if anything in `src/`, `server/`, `assets/`, `index.html` or `package.json` is newer than the last build. It starts the game server (picks the next free port if 8080 is busy) and opens a free Cloudflare quick tunnel. It prints a `https://….trycloudflare.com` link that serves both the game page and the `/race` WebSocket. The link changes on every restart.
- **Dev:** `npm run dev` (solo, Vite). `npm run build` then `npm run multiplayer` for a local server on :8080.
- **Checks:** `npm run check` (tests + type-check + build). Node 24 is installed on this PC; the project needs 22.12+.

## Layout

- `src/simulation.ts`: physics, bots, laps (shared by client and server). Races default to `LAPS = 6` (online hosts pick 1 to `MAX_LAPS = 10` in the lobby). `tuning.topSpeed = 7.95` gives 80 km/h on the HUD (11.52 gives 100; HUD km/h = speed × 13).
- Boosts (`BOOST` in `src/simulation.ts`): pads give 1 s of boost; a drift held with steering charges a drift boost (level 1 at 0.5 s, level 2 at 1 s, steering one way; changing direction restarts the charge) released when Space is let go. Boost pushes a kart from 80 to about 100 km/h. Pad positions are per track (`pads`: distance after the start line + sideways offset). `boost` and `driftCharge` travel in snapshots.
- `src/track.ts`: builds every track in `assets/tracks/` (`tracks` map). Foundry is a Tiled map; Overpass and Valencia Streets are plain JSON lists of centreline points. A track with `"theme": "street"` gets city blocks, zebra crossings and street lamps (`paintCity` in `src/main.ts`) in place of grass and trees. Valencia was traced from a circuit outline image and keeps separate stretches of road at least road width + 60 px apart so their walls do not overlap. A track that crosses itself gets a bridge automatically: segments near the crossing are layered, and karts/walls on different layers do not collide. Start straights must run left to right.
- Walls and kerbs follow `offset(i, d)` in `src/track.ts`, which reads from `edge(d)`: the line `d` to one side of the centreline with the loops cut off. On the inside of a bend tighter than `d` a plain sideways offset doubles back and pokes out behind the corner, so those points all move to one corner point. Wall sections there can be triangles or empty; `Simulation` skips the empty ones.
- `src/scenery.ts`: decorations painted on the ground texture, pictures only. A track lists them as `scenery` in its JSON (`lake`, `pond`, `field`, `barn`, `paddock`, `marquees`, `carpark`, `camp`, `helipad`, `flowers`, `crowd`, `tower`, `wood`, `rocks`), and `"trackside": true` adds tyre walls outside the bends and sponsor boards on the straights. Only Overpass uses them so far. Keep every item at least road / 2 + 40 px from the centreline.
- In the Vite dev page the Phaser game is on `window.slipstream` (handy for looking at a whole track texture).
- Track choice: solo from the garage menu (saved in localStorage); online the host picks track and laps in the lobby (`track` / `laps` messages and snapshot fields).
- `src/main.ts`: Phaser scene, menus, online client logic.
- `src/hud.ts`: the in-race HUD. It is HTML over the canvas, in the Press Start 2P pixel font (`assets/fonts/`), sized so one font pixel is a whole number of screen pixels (`--u`). Styles are the `.hud` rules in `index.html`. Online name tags above karts are HTML too (`Hud.tags`, placed from the camera each frame). Only the F2 panel is still drawn on the canvas.
- `src/network.ts`: WebSocket client and the lobby DOM panel (create / join screen, then the room lobby with a SETTINGS button for sound). The game server is the site the page was opened from, so there is no address box; invite links are just `?room=CODE` (`?server=` still works, and the Vite dev page uses `:8080`).
- `src/podium.ts`: the podium, HTML shown in the menu board (solo and online).
- Rooms hold up to `MAX_KARTS = 10` racers (solo practice stays at 8 karts). Room leaderboard (`award()` in `server/rooms.mjs`): a win scores `WIN_POINTS = 10`, each place below one less, no place points for a DNF, plus 1 for the fastest lap. Totals live on each member (`points`) for the life of the room; the last race's standings travel as `results` in the snapshot.
- Catch-up help (`CATCH_UP` in `src/simulation.ts`): online only (the `catchUp` flag on `Simulation`, so solo lap records stay fair). Karts more than 150 px of track behind the leader get up to +8% top speed, +20% power and a 60% longer pad boost, in full at 1500 px behind.
- Easy mode (`EASY` in `src/simulation.ts`): a host option in the lobby (`easy` message and snapshot field, the `easy` flag on `Simulation`), online only. Walls stand at the road edge (`wallVertices(i, side, 0)`) and act as guard rails: `guardRail()` pushes a kart back towards the road and turns it to face along it (`railTurn`, in snapshots). Top speed is 70 km/h and the countdown is 6 s. On the client the camera turns so the kart always drives up the screen (`turned` / `camTurn` in `src/main.ts`; name tags go through `onScreen`), and each track has a second texture (`track-<id>-easy`) with striped rails.
- Championship: the host picks FREE PLAY or a 3 / 5 race cup (`series` message, `SERIES`). Changing it zeroes the points. After the last race the podium button leads to a champion screen, and reopening the lobby starts a new cup from zero (`champion` keeps the last winner's name).
- Between the races of a cup the room stays on the podium (`betweenRaces` in `server/rooms.mjs`): everyone clicks READY FOR NEXT RACE (the `ready` message) and the next race starts by itself once all connected racers are ready (`nextIfReady()`, at least two). The host can pick the next track there. RETURN TO LOBBY is still offered; if anyone uses it the others follow. Free play and a cup's last race keep the old flow below.
- Spectating: after finishing an online race the camera follows a racer who is still out there (`watching` in `src/main.ts`, shown by `Hud.watch`). A / D or the arrow keys switch racer; the taps are counted from a `keydown` listener (`watchStep`) because Phaser's `JustDown` loses very short taps.
- Race callouts (`callouts()` in `src/main.ts`, shown by `Hud.callout` / `Hud.arrow`): FINAL LAP, a new leader, a new fastest lap, and an arrow by the position for a place gained or lost. Lead and place changes stay quiet until the leader finishes lap 1; fastest laps are announced from lap 2.
- Podium (online): everyone gets RETURN TO LOBBY. The first racer to click sends `rematch`, which reopens the lobby on the server; the others keep their podium (cached in `Race.podium`) until they click too. Leaving the room is done from the lobby or the pit menu.
- Phaser captures driving keys on the whole window (even while paused). `main.ts` stops key events that start in form fields so the lobby inputs can be typed in; keep that guard if adding new text inputs.
- `src/menu.ts`: HTML garage / settings / pit menus (same `.room-board` styling as the lobby, in `index.html`). The podium uses the same board.
- `src/audio.ts`: Web Audio. Sound effects are synthesised in code; music is the CC0 loop in `assets/music/` (see `CREDITS.md` there). Volumes are saved in localStorage under `slipstream-audio`.
- `server/rooms.mjs`, `server/index.mjs`: authoritative room server (60 Hz physics, ~20 Hz snapshots).
- `scripts/start-online.mjs`: launcher (port fallback, auto-rebuild, cloudflared download and tunnel).

## Earlier changes (Nov 2026, made in a claude.ai session)

- Top speed raised from about 63 to 80 km/h. 8-bot races still finish cleanly with no resets.
- Mouse menus fixed: pixel scaling now uses Phaser's `scale.zoom` (the old manual canvas CSS sizing broke pointer mapping), and menu hit zones use `setScrollFactor(0)`.
- Online smoothness: the client sends input every physics step with a sequence number, logs it, and on each snapshot replays unacknowledged inputs (up to 20 steps). Corrections are drawn as a render offset that fades over 150 ms. The server sends one snapshot per catch-up loop, rounds snapshot floats, and allows up to 200 messages/s. Simulated at about 120 ms RTT with jitter: about 3× smoother than before.
- Launcher: serves the game from this PC through the tunnel (no longer the old chatgpt.site copy); port fallback; auto-rebuild.

These are committed. Still worth verifying with real players: menu clicks at different window sizes, the podium flow with 2+ players, and online feel with real coworkers.
