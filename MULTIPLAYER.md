# Race with a friend

## On the host Windows PC

1. Use this project folder (or extract the entire Slipstream Multiplayer ZIP to a normal folder).
2. Install Node.js LTS (22 or newer) from https://nodejs.org/ if needed.
3. Double-click `Start-Multiplayer.cmd`. From a source checkout, the first run installs dependencies and builds the game automatically.
4. On first launch it downloads Cloudflare's official tunnel client to `.tools`. It starts the game server and prints a secure `https://….trycloudflare.com` link. Both the game page and the race connection come from your PC through that link, so everyone plays the same build. No router port forwarding or firewall changes are required.
5. Open that link, enter your driver name, and select **CREATE / JOIN ROOM** with the room code blank.
6. Select **COPY INVITE LINK** and send that link to your friend. They enter their name and join. Both select **READY UP**, then the room host selects **START RACE**.

Keep the launcher window open and the PC awake throughout the race. The temporary server address changes each time the launcher restarts, so create fresh invite links after restarting. Cloudflare Quick Tunnels are a playtesting service, not permanent hosting. To send players to a separately hosted copy of the game page instead, set `PUBLIC_GAME_URL` before launching; that copy must match the PC's build.

If a coworker can't load the link, their company network may block `trycloudflare.com`; try from a phone hotspot or home network to confirm.

The guest only needs a browser. No Node.js, tunnel client or account is needed on the guest's machine. The first person to create the room controls race starts and rematches. Up to eight human racers can join. Bots remain in solo practice.

## Racing

WASD or arrows drive, Space drifts, R resets with a 1.5-second hold and setback. Escape opens a menu; online races continue while menus are open or tabs are in the background. Finished karts stop and become non-solid. Once the first racer finishes, others get 45 seconds to finish before the podium. Unfinished racers are marked DNF and receive no podium place. Races also have a ten-minute maximum.

Temporary network loss clears throttle and allows 30 seconds to reclaim the same seat. The browser retries automatically. If the PC server stops, the room is lost; restart the launcher and create a new room. The server remains authoritative over movement, collisions, checkpoints, penalties and finish order. Do not share the reconnect token stored in the tab's session storage.

## Local development / LAN

```sh
npm ci
npm run build
npm run multiplayer
```

Open `http://localhost:8080/` on the host and choose **RACE WITH FRIENDS**. On another LAN machine, use the host's LAN IP in both the browser URL and server address. For browser QA the default local server address is filled automatically on localhost. The server serves only `dist/` and accepts WebSockets at `/race`.

The Windows release has the server and dependencies bundled into `server-dist/server.mjs`, so it needs no npm install. `scripts/start-online.mjs` launches the bundled server bound to localhost plus the tunnel. A manually installed tunnel client can be selected via `CLOUDFLARED_PATH`.

## Implementation and limits

The PC runs shared Matter.js physics at 60 Hz, broadcasts snapshots at 20 Hz (physics values rounded to keep them small) and accepts validated controls every client physics step (60 Hz). Each client logs its sequenced inputs; when a snapshot arrives it applies the server state, then replays the inputs the server has not yet acknowledged (up to 20 steps), so your own kart doesn't rubber-band with latency. Corrections are drawn as an offset that fades over about 150 ms rather than popping. Remaining smoothness depends mostly on network jitter through the tunnel. The wire protocol is implemented in `server/rooms.mjs`, `server/index.mjs` and `src/network.ts`; neither client lap claims nor client positions are accepted.

This first prototype uses a small WebSocket server rather than adding Colyseus. It preserves the existing physics/controller and can later move to an always-on game host. Latency and correction quality need playtesting across your two real internet connections. Windows launcher and firewall behaviour need a run on the actual PC; development verification is on macOS.
