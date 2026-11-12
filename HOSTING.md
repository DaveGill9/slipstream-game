# Slipstream hosting

The hosted game is a static browser build, published through Sites. Anyone with the public link can play. Solo practice runs independently in each browser. Online rooms connect to the host PC through the server address in the invite link; see MULTIPLAYER.md. Personal bests stay in that browser.

## Update the hosted game

1. Edit the source in this checkout.
2. Run `npm ci` after dependency changes, then `npm run check`.
3. Ask Codex to publish the current Slipstream Site. The existing `.openai/hosting.json` identifies it; keep that ID so updates keep the same URL.
4. The Sites workflow commits and pushes the matching source, packages `dist/`, and deploys that saved version. Check the returned deployment status before sharing the update. Previous saved versions are available for rollback.

GitHub Actions checks pushes to main and pull requests, and makes the browser build available as a downloadable artifact. It does not publish unreviewed changes automatically. The GitHub origin and Sites source repository are separate destinations.

## Host from your Windows PC

For the prepared PC bundle: extract the ZIP, install Node.js LTS if it is not already installed, then double-click `scripts/start-pc.cmd`. No npm install is needed for that bundle.

From a source checkout instead:

```sh
npm ci
npm run build
npm run serve:lan
```

The terminal prints `http://localhost:8080/` and the PC's local-network URL, such as `http://192.168.1.20:8080/`. Open the latter on laptops connected to the same network. If Windows asks about firewall access, allow Node.js on your private network. Keep the terminal open and the PC awake; Ctrl+C stops hosting. Use `npm run serve` for access only from the host computer.

This PC setup is for local-network testing. Remote friends can use the hosted public URL; no router port forwarding is needed. To change the PC's port in PowerShell: `$env:PORT=8081; npm run serve:lan`.

## Playtest checklist

- Chrome/Edge on the PC and Safari/Chrome on the Mac: start with Enter; drive, drift, reset and pause.
- Resize the browser: the canvas should fill the content area without scrolling and preserve sharp pixels.
- Change tabs during a race: it should pause; return and resume with Escape.
- Reload after a finished lap: the personal best should remain on that browser.
- Test the hosted link in a private window to confirm visitors can load it without an account.

Only browser-build files are served. Source, Git metadata and local tooling are not part of the web deployment.
