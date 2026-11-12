# Slipstream

Local overhead kart racing prototype. Phaser + TypeScript render the game; a separate Matter.js simulation runs at a fixed 60 Hz. One player races seven bots around Foundry Circuit.

## Run

```sh
npm install
npm run dev
```

Open the local Vite URL. `npm run build` type-checks and builds; `npm test` exercises physics and race progression.

Controls are available on the in-game Driving School board. W/arrow up accelerates, S/arrow down brakes and reverses, A/D or arrows steer, Space drifts, R resets, Escape pauses. F2 opens the optional engineering overlay; click minus/plus to tune handling.

## Prototype scope

Original circuit geometry follows the supplied layout reference. Broad roads, small rotating procedural kart placeholders, integer display scaling and a north-up following camera establish the intended scale. Production artwork should move into Aseprite and track assembly into Tiled after handling is approved. The editable Tiled map lives in `assets/tracks/foundry.json`; `src/track.ts` derives road and wall geometry from it; no reference artwork is shipped. No networking or audio yet.

`src/simulation.ts` owns physics, bot inputs, recovery, ordered gates and race state independently from Phaser. `src/main.ts` owns rendering, keyboard input and in-game menus. R moves a kart 100 world pixels back along the circuit and holds it for 1.5 seconds while the race continues, without awarding checkpoints. The same penalty applies to automatic bot recovery. Recovering karts are ghosted during the hold, then ignore kart contact for one second while wall collision remains active. Continuous concrete barriers use flush joined collision geometry. The grid and timing gates share a start line at the middle of the southern straight. Engine power tapers towards a configurable top speed. Three laps require passing all ordered gates.

## Drafting and timing

Top speed is tuned to 5.8 physics units per tick (a modest increase from 5.0). Follow within 24–130 world pixels, within 17 pixels of another kart's wake and within 20 degrees of its heading to gain up to 20% acceleration. Both karts must be moving on the same stretch of road. Boost does not stack and does not raise the engine speed limit. Short, fading air streaks are capped at 16 logical pixels; warm trails and the DRAFT HUD label indicate an active boost.

The finish line requires a forward crossing after all checkpoints. Current/last lap and personal best are visible during racing; best lap and race records persist in browser local storage. Reset waiting time is included in lap time. Editing physics in F2 makes the session ineligible for records until reload. Saved records are local to this browser and game version.

## Track editing

Open `assets/tracks/foundry.json` in Tiled as a map. Edit the **Racing line** polyline's control points, **Timing** start point (keep it on the horizontal southern straight), and **Grandstands** rectangles. Map properties define road width and world bounds. The game imports this file directly and derives the smooth circuit, barriers, checkpoints, bot route and grid; no parallel hardcoded layout needs updating. Tile grid is 16 pixels. This is the initial object-layer track workflow; painted production tiles and Aseprite sprite artwork remain to be authored when those tools are available.

## Hosting

See [HOSTING.md](HOSTING.md) for hosted deployment updates and running the production build on a Windows PC or local network. `npm run check` verifies a release; `npm run serve:lan` serves the built `dist/` folder to the local network. GitHub Actions also verifies and archives builds on pushes to main.
