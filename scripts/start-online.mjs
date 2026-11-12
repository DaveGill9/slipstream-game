import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
// By default the game page is served from this PC through the same tunnel,
// so players always get the exact build the server is running.
// Set PUBLIC_GAME_URL to send players to a separately hosted copy instead.
const publicGame = process.env.PUBLIC_GAME_URL || "";
// Use PORT (default 8080), or the next free port if something else has it.
const isFree = (p) =>
  new Promise((done) => {
    const probe = createServer()
      .once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true)))
      .listen(p, "127.0.0.1");
  });
const preferredPort = Number(process.env.PORT || 8080);
let port = preferredPort;
while (!(await isFree(port))) {
  if (port >= preferredPort + 50)
    throw Error(`No free port found between ${preferredPort} and ${port}.`);
  port++;
}
if (port !== preferredPort)
  console.log(`Port ${preferredPort} is busy, using port ${port} instead.`);
if (Number(process.versions.node.split(".")[0]) < 22)
  throw Error("Install Node.js 22 or newer from https://nodejs.org/");
// From a source checkout, rebuild when any game source is newer than the
// last build, so edits are picked up just by relaunching.
const newest = (path) => {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(
    0,
    ...readdirSync(path).map((name) => newest(join(path, name))),
  );
};
if (existsSync("package.json") && existsSync("node_modules") && existsSync("src")) {
  const built =
    existsSync("server-dist/server.mjs") && existsSync("dist/index.html")
      ? Math.min(
          statSync("server-dist/server.mjs").mtimeMs,
          statSync("dist/index.html").mtimeMs,
        )
      : 0;
  const changed = Math.max(
    ...["src", "server", "assets", "index.html", "package.json"].map(newest),
  );
  if (changed > built) {
    console.log("Game files changed: rebuilding (takes a moment)…");
    const result = spawnSync("npm", ["run", "build"], {
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0)
      throw Error("Build failed. Check the messages above.");
  }
}
if (!existsSync("server-dist/server.mjs") || !existsSync("dist/index.html"))
  throw Error(
    "Game is not built yet. Run: npm ci && npm run build  (Start-Multiplayer.cmd does this automatically).",
  );
let cloudflared = process.env.CLOUDFLARED_PATH || "cloudflared";
if (process.platform === "win32" && !process.env.CLOUDFLARED_PATH) {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const name = `cloudflared-windows-${arch}.exe`;
  cloudflared = join(root, ".tools", name);
  if (!existsSync(cloudflared)) {
    console.log(
      "Downloading the official Cloudflare tunnel client (first launch only)…",
    );
    const release = await fetch(
      "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
      {
        headers: {
          "User-Agent": "Slipstream-PC-Launcher",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!release.ok)
      throw Error(
        "Cannot check the Cloudflare release. Check the internet connection and try again.",
      );
    const data = await release.json(),
      asset = data.assets.find((a) => a.name === name);
    if (
      !asset?.browser_download_url?.startsWith(
        "https://github.com/cloudflare/cloudflared/releases/download/",
      )
    )
      throw Error("Official Cloudflare download unavailable for this PC.");
    const response = await fetch(asset.browser_download_url);
    if (!response.ok) throw Error("Cloudflare download failed. Try again.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      asset.digest?.startsWith("sha256:") &&
      createHash("sha256").update(bytes).digest("hex") !== asset.digest.slice(7)
    )
      throw Error("Download checksum failed. Retry the download.");
    await mkdir(join(root, ".tools"), { recursive: true });
    await writeFile(cloudflared + ".download", bytes);
    await rename(cloudflared + ".download", cloudflared);
  }
}
const server = spawn(process.execPath, ["server-dist/server.mjs"], {
  cwd: root,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});
let tunnel,
  started = false,
  closing = false;
function stop() {
  if (closing) return;
  closing = true;
  tunnel?.kill();
  server.kill();
}
server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (started || !String(chunk).includes("multiplayer ready")) return;
  started = true;
  console.log("Opening a temporary internet link for this game server…");
  tunnel = spawn(
    cloudflared,
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let printed = false;
  const log = (chunk) => {
    const line = String(chunk);
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !printed) {
      printed = true;
      const url = new URL(publicGame || match[0] + "/");
      url.searchParams.set(
        "server",
        match[0].replace("https:", "wss:") + "/race",
      );
      console.log(
        `\nOPEN THIS LINK TO CREATE YOUR ROOM:\n${url}\n\nThen click CREATE / JOIN ROOM and COPY INVITE LINK to invite your friend.\nKeep this window open and your PC awake during races.\nThe server link changes when this launcher restarts. Old invites then stop working.\nCtrl+C stops hosting.\n`,
      );
    } else if (/ERR|error/i.test(line)) process.stderr.write(line);
  };
  tunnel.stdout.on("data", log);
  tunnel.stderr.on("data", log);
  tunnel.on("error", (error) => {
    console.error("Cannot start Cloudflare Tunnel:", error.message);
    stop();
    process.exitCode = 1;
  });
  tunnel.on("exit", () => {
    if (!closing) {
      console.error(
        "The internet tunnel stopped. Restart the launcher to get a new link.",
      );
      stop();
      process.exitCode = 1;
    }
  });
});
server.on("error", (error) => {
  console.error(error.message);
  stop();
  process.exitCode = 1;
});
server.on("exit", (code) => {
  if (!closing) {
    stop();
    process.exitCode = code || 1;
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
