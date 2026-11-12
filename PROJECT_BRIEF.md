# Slipstream — Project Brief

**Slipstream** is a browser-based, 2D kart racer for casual office competitions, eventually supporting up to **eight players racing remotely on their laptops**.

Development starts with a local prototype featuring one human driver and bots. The priority is enjoyable handling, drifting and collisions.

## Browser presentation and in-game interface

The game occupies the **entire browser content area**, edge to edge, from launch. It must work this way without requiring browser fullscreen mode.

- No surrounding website layout, marketing copy, feature cards, external control instructions, sidebars or decorative page framing.
- No narrow embedded game window. The game canvas fills the viewport with no page margins or scrolling.
- Present menus, settings, controls, tutorial, pause and results within the game, using its pixel-art visual language.
- Make settings and explanatory text diegetic: integrate them into the racing world through elements such as a pit-garage setup board, trackside instruction signs and a race scoreboard.
- Include an in-game tutorial screen or practice area covering acceleration, braking, steering, drifting and resetting. It must be skippable and accessible again from the in-game menu.
- Keep text concise and readable. The game itself is the product; do not add explanatory website content around it.
- Keep developer physics tuning and debug information in an optional in-game development overlay, hidden by default.

## Camera and track scale

Use a **scrolling camera that follows the player’s kart**, showing the surrounding section of circuit. The entire track does not need to fit on screen.

- Use the first supplied reference image as inspiration for the first circuit’s overall layout: a long start/finish straight connected by sweeping bends, tighter corners and hairpins.
- Use the second supplied reference image as the reference for camera scale, kart size relative to the road, and track width.
- Build a larger circuit with broad racing surfaces suitable for eight racers, overtaking and side-by-side contact.
- Keep enough track visible ahead for players to anticipate corners.
- Start with a fixed camera orientation: north stays up while the kart rotates.
- Tune road width and camera zoom through playtesting before finalising the track.

The reference images guide the design; their artwork will not be included directly. The images were supplied in the planning chat and are not embedded in this file. The descriptions above preserve their intended roles if the images are unavailable in the new project.

## Visual direction

Use **simple retro pixel art with a strictly vertical, 90-degree overhead view**.

- Small, simple kart sprites with clear front/rear orientation and distinct player colours.
- Flat overhead track surfaces, red-and-white kerbs and tyre barriers.
- Sparse scenery: bushes and a few grandstands, all drawn directly from above.
- No visible people, tents, perspective buildings or angled vehicle illustrations.
- Keep decoration minimal while developing the game.
- Use skid marks, small smoke effects and restrained impact effects to communicate handling.

The concept image generated earlier in the planning chat is superseded by this direction.

## Consistent pixel-art workflow

**Aseprite is the source of truth for production artwork; Tiled assembles the tracks.**

| Element | Starting specification |
|---|---|
| Logical viewport | Approximately 640 × 360 pixels as a starting reference; adapt to fill the browser while the track extends beyond it |
| Track tiles | 16 × 16 pixels |
| Kart frames | Initially 24 × 24 pixels, including transparent padding |
| Palette | One shared project palette |
| Asset density | One artwork pixel equals one logical game pixel |
| Display scaling | Integer multiples with nearest-neighbour filtering |
| Camera zoom | Fixed during initial development; avoid fractional zoom |
| Interface | Bitmap fonts and icons using the same pixel density |

These dimensions are provisional until the prototype achieves the intended relative scale: small readable karts on broad roads, with only the surrounding section of the circuit visible.

All sprites, scenery and effects share the same pixel density. Objects should be drawn at their intended size rather than independently scaled. Physics retains precise positions; rendered positions and camera movement are aligned to the logical pixel grid. Fill the browser by adapting the logical viewport and rendering additional world area at a uniform integer scale, rather than stretching a fixed canvas or adding letterboxing. A small amount of edge cropping is acceptable to accommodate viewport dimensions that are not exact multiples of the pixel scale. Reflow in-game interface elements on resize and preserve the intended kart-to-road scale.

Use simple rotating placeholders initially. Evaluate directional sprite frames for finished karts to preserve clean pixel shapes during turns.

## Technology stack

| Tool | Purpose |
|---|---|
| **Phaser + TypeScript** | Rendering, input, camera, audio, UI and game scenes |
| **Matter.js** | Collision bodies, contact forces and rotation |
| **Custom kart controller** | Acceleration, braking, steering, grip and drifting |
| **Aseprite** | Pixel artwork and animation |
| **Tiled** | Track layout, collision geometry, surfaces, checkpoints and bot paths |
| **Colyseus — later** | Online rooms and race synchronisation |

Keep driving and race simulation separate from rendering. Human and bot drivers use the same input interface and vehicle rules.

## Initial gameplay scope

- One human driver and up to seven bots.
- Keyboard controls: accelerate, brake/reverse, steer and drift.
- Progressive acceleration and noticeable momentum.
- Speed-sensitive steering and controllable sideways sliding.
- Kart-to-kart collisions, barrier scraping and recoverable spins.
- Grass and other off-track surfaces that affect speed or grip.
- Reset-to-track control.
- One circuit, ordered checkpoints, lap counting and race positions.
- Three-lap races with a countdown, results and quick restart.
- Full-browser presentation with in-game menus, diegetic settings and a skippable tutorial.

Power-ups, vehicle upgrades, extensive scenery and online multiplayer are deferred.

## Prototype development plan

| Stage | Deliverable | Acceptance criteria |
|---|---|---|
| **1. Handling and camera** | Full-browser game canvas, one kart in a large test area with straights and corners; player-following camera; adjustable handling values in a hidden development overlay. | Driving feels responsive but has weight. Corners are readable at the intended camera scale. The game fills the browser without an external page shell. |
| **2. Drifting and contact** | Drift control, barriers, stationary karts and scripted collision targets. | Slides can be entered and recovered deliberately. Impacts transfer momentum without excessive bounce or sticking. |
| **3. Bot traffic** | Waypoint-following bots with corner speed targets and recovery behaviour. | One human and seven bots can circulate and create useful overtaking and collision scenarios. |
| **4. First circuit** | Original track inspired by the first reference’s layout, using the second reference’s relative scale and broad roads. | Eight karts can race, pass and negotiate corners without constant congestion. |
| **5. Complete local race** | Countdown, checkpoints, laps, positions, results, restart, diegetic settings and a skippable in-game tutorial. | A full race completes correctly after spins, collisions and resets. Players can learn controls and change settings within the game. |
| **6. Art and readability** | Consistent pixel-art karts, track, minimal scenery, effects and UI. | Visuals remain crisp, readable and consistent while the camera scrolls. |
| **7. Online prototype — later** | Two remote players first, then expansion towards eight. | Driving and collisions remain acceptable under real network latency. |

## Testing priorities

Expose tuning controls for acceleration, braking, steering, lateral grip, drift grip, grip recovery, collision bounce and angular damping.

Test repeatable rear impacts, side swipes, barrier strikes and crowded corners. Check handling across different rendering frame rates while running physics at a fixed timestep, initially targeting 60 Hz.

Bots validate local racing behaviour; remote latency and network collision correction require separate testing later.

## Project handoff

The user will create a GitHub repository, clone it locally and open it as a new Codex project/chat. Add this file to the repository as `PROJECT_BRIEF.md`.

**The first implementation milestone is a playable handling-and-collision prototype with a scrolling camera, simple placeholder graphics and bot traffic.**

Start with stages 1–3. Focus on driving feel and contact before finished art or networking. Do not implement online multiplayer in the initial prototype.

From the first prototype, make the game fill the browser content area. Keep all player-facing instructions and settings within the game; do not build a surrounding website or narrow embedded preview.
