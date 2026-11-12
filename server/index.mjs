import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { makeServer } from "../scripts/serve.mjs";
import { Room } from "./rooms.mjs";
export function startServer({
  port = Number(process.env.PORT || 8080),
  host = "127.0.0.1",
  directory = resolve("dist"),
} = {}) {
  const http = makeServer(directory),
    rooms = new Map();
  const wss = new WebSocketServer({
    server: http,
    path: "/race",
    maxPayload: 4096,
  });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128000)
      ws.send(JSON.stringify(data));
  };
  wss.on("connection", (ws) => {
    let room = null,
      member = null,
      count = 0,
      windowAt = Date.now();
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    ws.on("message", (raw) => {
      try {
        if (Date.now() - windowAt > 1000) {
          windowAt = Date.now();
          count = 0;
        }
        // Clients send input every 60 Hz physics step; leave headroom for
        // pings and for bursts after a brief network stall.
        if (++count > 200) {
          ws.close(1008, "Too many messages");
          return;
        }
        const data = JSON.parse(raw.toString());
        if (!data || typeof data !== "object") return;
        if (data.type === "ping") {
          send(ws, { type: "pong", at: data.at });
          return;
        }
        if (!member) {
          if (data.type === "create") {
            if (rooms.size >= 100)
              throw Error("Server is busy. Try again shortly.");
            let code;
            do {
              code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
            } while (rooms.has(code));
            room = new Room(code);
            rooms.set(code, room);
          } else if (data.type === "join") {
            room = rooms.get(String(data.code || "").toUpperCase());
            if (!room)
              throw Error(
                "Room not found. Check the code or ask for a new invite.",
              );
          } else throw Error("Create or join a room first.");
          member = room.join(data.name, data.token, (data) => send(ws, data));
        } else if (data.type === "leave") {
          room.disconnect(member, true);
          member = null;
          room = null;
          ws.close(1000);
        } else room.message(member, data);
      } catch (e) {
        send(ws, {
          type: "error",
          message: e instanceof Error ? e.message : "Invalid request",
        });
      }
    });
    ws.on("close", () => {
      if (room && member) room.disconnect(member);
    });
    ws.on("error", () => {});
  });
  let prev = performance.now(),
    acc = 0,
    ticks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min(250, now - prev);
    prev = now;
    const ticksBefore = ticks;
    while (acc >= 1000 / 60) {
      for (const room of rooms.values()) room.tick();
      acc -= 1000 / 60;
      ticks++;
    }
    // ~20 snapshots a second. Windows timers often fire late and run two
    // ticks at once; sending after the catch-up loop avoids back-to-back
    // duplicate snapshots that made remote karts stutter.
    if (Math.floor(ticks / 3) !== Math.floor(ticksBefore / 3))
      for (const room of rooms.values())
        if (room.phase !== "lobby") room.broadcast();
    for (const [code, room] of rooms) {
      if (!room.members.some((m) => m.connected)) {
        room.emptyAt ??= now;
        if (now - room.emptyAt > 60000) {
          room.destroy();
          rooms.delete(code);
        }
      } else room.emptyAt = null;
    }
  }, 1000 / 60);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 10000);
  const ready = new Promise((done, fail) => {
    http.once("error", fail);
    http.listen(port, host, () => done(http.address()));
  });
  async function close() {
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => http.close(r));
    for (const room of rooms.values()) room.destroy();
  }
  return { ready, close, rooms, http };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = startServer({ host: process.env.HOST || "0.0.0.0" });
  server.ready
    .then((address) =>
      console.log(
        `Slipstream multiplayer ready at http://localhost:${address.port}/ (WebSocket /race)`,
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close().then(() => process.exit(0)));
}
