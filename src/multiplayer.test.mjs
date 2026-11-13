import { test } from "node:test";
import assert from "node:assert/strict";
import Matter from "matter-js";
import { WebSocket } from "ws";
import { Room } from "../server/rooms.mjs";
import { startServer } from "../server/index.mjs";
function setup() {
  const room = new Room("ABC123");
  const a = room.join("Dave", null, () => {}),
    b = room.join("Friend", null, () => {});
  return { room, a, b };
}
function start(room, a, b) {
  room.message(a, { type: "ready", ready: true });
  room.message(b, { type: "ready", ready: true });
  room.message(a, { type: "start" });
  for (let i = 0; i < 180; i++) room.tick();
}
test("rooms require two ready players and host permission; inputs control distinct karts", () => {
  const { room, a, b } = setup();
  assert.throws(() => room.message(b, { type: "start" }), /host/);
  assert.throws(() => room.message(a, { type: "start" }), /ready/);
  assert.throws(
    () => room.message(b, { type: "track", track: "overpass" }),
    /host/,
  );
  room.message(a, { type: "track", track: "nowhere" });
  assert.equal(room.snapshot().track, "foundry");
  room.message(a, { type: "track", track: "overpass" });
  assert.equal(room.snapshot().track, "overpass");
  assert.throws(() => room.message(b, { type: "laps", laps: 3 }), /host/);
  for (const bad of [0, 11, 2.5, "4"])
    room.message(a, { type: "laps", laps: bad });
  assert.equal(room.snapshot().laps, 6);
  room.message(a, { type: "laps", laps: 3 });
  assert.equal(room.snapshot().laps, 3);
  start(room, a, b);
  assert.equal(room.sim.track.id, "overpass");
  assert.equal(room.sim.laps, 3);
  assert.equal(room.phase, "racing");
  assert.equal(room.sim.karts.length, 2);
  const before = room.sim.karts.map((k) => k.body.position.x);
  for (let i = 0; i < 60; i++) {
    room.message(a, { type: "input", seq: i, throttle: 1, steer: 0 });
    room.message(b, { type: "input", seq: i, throttle: -0.65, steer: 0 });
    room.tick();
  }
  assert.ok(room.sim.karts[0].body.position.x > before[0] + 50);
  assert.ok(room.sim.karts[1].body.position.x < before[1] - 20);
  assert.equal(room.sim.humans.size, 2);
  room.destroy();
});
test("stale controls stop, forged state is ignored, and reconnect tokens keep the correct seat", () => {
  const { room, a, b } = setup();
  start(room, a, b);
  room.message(a, { type: "input", seq: 1, throttle: 99, steer: -99 });
  assert.equal(a.input.throttle, 1);
  assert.equal(a.input.steer, -1);
  room.message(a, { type: "input", seq: 0, throttle: -1, steer: 1 });
  assert.equal(a.seq, 1);
  room.message(a, { type: "finish", time: 1 });
  assert.equal(room.sim.karts[0].finish, 0);
  for (let i = 0; i < 40; i++) room.tick();
  assert.equal(room.sim.karts[0].input.throttle, 0);
  room.disconnect(a);
  assert.equal(room.hostId, b.id);
  assert.equal(a.input.throttle, 0);
  assert.throws(() => room.join("Intruder", "wrong", () => {}), /racing/);
  const back = room.join("Dave", a.token, () => {});
  assert.equal(back.id, a.id);
  assert.equal(back.kart, 0);
  assert.throws(
    () => room.join("Other tab", a.token, () => {}),
    /already connected/,
  );
  room.destroy();
});
test("server orders podium by finish times, marks timeouts DNF and rematches in the same room", () => {
  const { room, a, b } = setup();
  start(room, a, b);
  room.sim.karts[1].finish = 10;
  room.sim.karts[0].finish = 12;
  room.tick();
  assert.equal(room.phase, "podium");
  assert.deepEqual(room.snapshot().order, [1, 0]);
  // 10 points for the win, 9 for second.
  assert.deepEqual([a.points, b.points], [9, 10]);
  assert.equal(room.snapshot().results.fastestLap, null);
  room.message(b, { type: "rematch" });
  assert.equal(room.phase, "lobby");
  room.message(a, { type: "rematch" });
  assert.equal(room.phase, "lobby");
  assert.ok(room.members.every((m) => !m.ready));
  start(room, a, b);
  room.sim.karts[0].finish = 1;
  room.sim.karts[0].lapTimes = [31, 30];
  room.sim.karts[1].lapTimes = [29.5];
  room.tick();
  room.sim.time = room.endAt;
  room.tick();
  assert.equal(room.phase, "podium");
  assert.equal(b.dnf, true);
  // Points carry over. a wins (+10); b did not finish, so scores nothing
  // for the place but still takes the fastest-lap point.
  assert.deepEqual([a.points, b.points], [19, 11]);
  const { results } = room.snapshot();
  assert.deepEqual(results.fastestLap, { kart: 1, time: 29.5 });
  assert.equal(results.final, false);
  assert.deepEqual(
    results.rows.map((r) => [r.name, r.points, r.total]),
    [
      [a.name, 10, 19],
      [b.name, 1, 11],
    ],
  );
  room.destroy();
});
test("a cup ends after its last race, names a champion and then starts again from zero", () => {
  const { room, a, b } = setup();
  assert.throws(() => room.message(b, { type: "series", series: 3 }), /host/);
  room.message(a, { type: "series", series: 4 });
  assert.equal(room.series, 0);
  a.points = 7;
  room.message(a, { type: "series", series: 3 });
  assert.deepEqual([room.series, room.round, a.points], [3, 0, 0]);
  for (let race = 1; race <= 3; race++) {
    start(room, a, b);
    // b wins the first race, a the next two.
    room.sim.karts[race === 1 ? 1 : 0].finish = 10;
    room.sim.karts[race === 1 ? 0 : 1].finish = 12;
    room.tick();
    const { results } = room.snapshot();
    assert.deepEqual(
      [results.round, results.series, results.final],
      [race, 3, race === 3],
    );
    if (race < 3) room.message(a, { type: "rematch" });
  }
  assert.deepEqual([a.points, b.points], [29, 28]);
  assert.equal(room.snapshot().champion, a.name);
  room.message(b, { type: "rematch" });
  assert.deepEqual([room.round, a.points, b.points], [0, 0, 0]);
  assert.equal(room.snapshot().champion, a.name);
  room.destroy();
});
test("between the races of a cup everyone readies up on the podium and the next race starts by itself", () => {
  const { room, a, b } = setup();
  const c = room.join("Third", null, () => {});
  room.message(a, { type: "series", series: 3 });
  room.message(c, { type: "ready", ready: true });
  start(room, a, b);
  const finish = () => {
    room.sim.karts.forEach((k, i) => (k.finish = 10 + i));
    room.tick();
  };
  finish();
  assert.equal(room.phase, "podium");
  // Being ready in the lobby does not count as ready for the next race.
  assert.ok(room.members.every((m) => !m.ready));
  // The host can line up a different track for the next race.
  assert.throws(
    () => room.message(b, { type: "track", track: "overpass" }),
    /host/,
  );
  room.message(a, { type: "track", track: "overpass" });
  room.message(a, { type: "ready", ready: true });
  room.message(b, { type: "ready", ready: true });
  assert.equal(room.phase, "podium");
  const race = room.raceId;
  // The last racer leaving does not strand the two who are ready.
  room.disconnect(c);
  assert.equal(room.phase, "countdown");
  assert.equal(room.raceId, race + 1);
  assert.equal(room.sim.track.id, "overpass");
  assert.equal(room.sim.karts.length, 2);
  assert.deepEqual([a.points, b.points], [10, 9]);
  for (let i = 0; i < 180; i++) room.tick();
  finish();
  room.message(a, { type: "ready", ready: true });
  room.message(b, { type: "ready", ready: true });
  for (let i = 0; i < 180; i++) room.tick();
  finish();
  // After the last race there is no next race to ready up for.
  assert.equal(room.snapshot().results.final, true);
  room.message(a, { type: "ready", ready: true });
  room.message(b, { type: "ready", ready: true });
  assert.equal(room.phase, "podium");
  // In free play the podium still leads back to the lobby.
  room.message(a, { type: "rematch" });
  room.message(a, { type: "series", series: 0 });
  start(room, a, b);
  finish();
  room.message(a, { type: "ready", ready: true });
  room.message(b, { type: "ready", ready: true });
  assert.equal(room.phase, "podium");
  room.destroy();
});
test("room isolation, capacity, reset penalty and disconnect expiry", () => {
  const { room, a, b } = setup();
  const other = new Room("ZZZZZZ");
  other.join("Other", null, () => {});
  for (let i = 2; i < 10; i++) room.join("R" + i, null, () => {});
  assert.throws(() => room.join("Eleventh", null, () => {}), /full/);
  for (const m of room.members) room.message(m, { type: "ready", ready: true });
  room.message(a, { type: "start" });
  for (let i = 0; i < 180; i++) room.tick();
  room.message(a, {
    type: "input",
    seq: 0,
    throttle: 0,
    steer: 0,
    reset: true,
  });
  assert.equal(room.sim.karts[0].resetRemaining, 1.5);
  assert.equal(other.phase, "lobby");
  room.disconnect(b);
  for (let i = 0; i < 1801; i++) room.tick();
  assert.equal(b.dnf, true);
  assert.throws(() => room.join("Friend", b.token, () => {}), /expired/);
  room.destroy();
  other.destroy();
});
test("two real WebSocket clients join, ready and receive the same countdown", async () => {
  const server = startServer({ port: 0 });
  const address = await server.ready;
  const sockets = [];
  const connect = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/race`);
      sockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  const wait = (ws, predicate) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", listener);
        reject(Error("Timed out waiting for server"));
      }, 5000);
      const listener = (raw) => {
        const data = JSON.parse(raw);
        if (predicate(data)) {
          clearTimeout(timeout);
          ws.off("message", listener);
          resolve(data);
        }
      };
      ws.on("message", listener);
    });
  try {
    const a = await connect(),
      b = await connect();
    let welcome = wait(a, (d) => d.type === "welcome");
    a.send(JSON.stringify({ type: "create", name: "Dave" }));
    const joined = await welcome;
    welcome = wait(b, (d) => d.type === "welcome");
    b.send(JSON.stringify({ type: "join", code: joined.code, name: "Friend" }));
    await welcome;
    a.send(JSON.stringify({ type: "ready", ready: true }));
    const ready = wait(
      a,
      (d) =>
        d.type === "state" &&
        d.members.length === 2 &&
        d.members.every((m) => m.ready),
    );
    b.send(JSON.stringify({ type: "ready", ready: true }));
    await ready;
    const sa = wait(a, (d) => d.type === "state" && d.phase === "countdown"),
      sb = wait(b, (d) => d.type === "state" && d.phase === "countdown");
    a.send(JSON.stringify({ type: "start" }));
    const [x, y] = await Promise.all([sa, sb]);
    assert.equal(x.raceId, y.raceId);
    assert.equal(x.code, y.code);
    assert.deepEqual(x.karts, y.karts);
  } finally {
    for (const ws of sockets) ws.terminate();
    await server.close();
  }
});
