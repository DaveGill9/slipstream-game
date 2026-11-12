import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { resolve, relative, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
export function makeServer(directory = root) {
  return createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    try {
      const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rawPath.includes("\\") || rawPath.includes("\0")) {
        res.writeHead(400);
        return res.end();
      }
      const filename = resolve(
        directory,
        "." + (rawPath === "/" ? "/index.html" : rawPath),
      );
      const canonicalRoot = await realpath(directory);
      const canonical = await realpath(filename);
      const path = relative(canonicalRoot, canonical);
      if (path.startsWith("..") || isAbsolute(path)) {
        res.writeHead(403);
        return res.end();
      }
      const info = await stat(canonical);
      if (!info.isFile()) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, {
        "Content-Type": types[extname(canonical)] || "application/octet-stream",
        "Content-Length": info.size,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": path.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(canonical));
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404);
      res.end();
    }
  });
}
if (
  process.argv[1]?.endsWith("serve.mjs") &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1";
  const port = Number(process.env.PORT || 8080);
  try {
    await stat(resolve(root, "index.html"));
  } catch {
    console.error(
      "Build first with npm run build (or extract the complete PC hosting bundle).",
    );
    process.exit(1);
  }
  const server = makeServer();
  server.on("error", (error) => {
    console.error(`Cannot serve Slipstream: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Slipstream: http://localhost:${port}/`);
    if (host === "0.0.0.0")
      for (const addresses of Object.values(networkInterfaces()))
        for (const address of addresses || [])
          if (address.family === "IPv4" && !address.internal)
            console.log(
              `Same-network players: http://${address.address}:${port}/`,
            );
    console.log(
      "Keep this terminal open. Press Ctrl+C to stop. Each browser runs its own race.",
    );
  });
}
