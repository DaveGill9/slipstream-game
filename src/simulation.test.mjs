import { test } from "node:test";
import assert from "node:assert/strict";
import Matter from "matter-js";
import { Simulation, tuning } from "./simulation.ts";
import {
  atDistance,
  totalLength,
  gatePosition,
  startDistance,
  nearest,
  gridPosition,
  wallVertices,
  points,
} from "./track.ts";
const idle = { throttle: 0, steer: 0, drift: false };
test("throttle accelerates, brake slows, reset removes velocity without awarding gates", () => {
  const s = new Simulation(),
    k = s.karts[0];
  for (let i = 0; i < 50; i++) s.step({ ...idle, throttle: 1 });
  const speed = k.body.speed;
  assert.ok(speed > 2);
  for (let i = 0; i < 15; i++) s.step({ ...idle, throttle: -1 });
  assert.ok(k.body.speed < speed);
  const gates = k.gates;
  s.resetKart(k);
  assert.equal(k.body.speed, 0);
  assert.equal(k.gates, gates);
  s.destroy();
});
test("finish line shortcuts do not count; ordered gates complete exactly three laps", () => {
  const s = new Simulation(),
    k = s.karts[0];
  Matter.Body.setPosition(k.body, gatePosition(0));
  s.step(idle);
  assert.equal(k.lap, 0);
  for (let lap = 0; lap < 3; lap++)
    for (let i = 1; i <= 24; i++) {
      Matter.Body.setPosition(k.body, gatePosition(i % 24));
      Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
      if (i === 24) Matter.Body.setPosition(k.body, { x: 1361, y: 1330 });
      if (i === 24)
        k.previousPosition = { x: k.body.position.x - 2, y: k.body.position.y };
      s.step(idle);
    }
  assert.equal(k.lap, 3);
  assert.ok(k.finish > 0);
  s.destroy();
});
test("seven bots navigate a full race and remain numerically stable", () => {
  const s = new Simulation();
  for (let i = 0; i < 25000; i++) {
    s.step(idle);
    if (s.karts.slice(1).every((k) => k.finish)) break;
  }
  for (const k of s.karts.slice(1)) {
    assert.ok(Number.isFinite(k.body.position.x));
    assert.ok(k.finish > 0, `bot ${k.id}: ${k.lap} laps, ${k.gates} gates`);
  }
  s.destroy();
});
test("rear contact transfers momentum and a barrier contains a kart", () => {
  const s = new Simulation(),
    a = s.karts[0],
    b = s.karts[1];
  Matter.Body.setPosition(a.body, { x: 1000, y: 1330 });
  Matter.Body.setPosition(b.body, { x: 1025, y: 1330 });
  Matter.Body.setVelocity(a.body, { x: 6, y: 0 });
  for (let i = 0; i < 10; i++) Matter.Engine.update(s.engine, 1000 / 60);
  assert.ok(b.body.velocity.x > 1, "rear impact moves target");
  assert.ok(a.body.velocity.x < 6, "striker loses speed");
  Matter.Body.setPosition(a.body, { x: 1200, y: 1330 });
  Matter.Body.setVelocity(a.body, { x: 0, y: 8 });
  for (let i = 0; i < 40; i++) Matter.Engine.update(s.engine, 1000 / 60);
  assert.ok(a.body.position.y < 1424, "barrier prevents escape");
  s.destroy();
});

test("reset moves backwards, holds for 1.5 seconds and cannot stack while held", () => {
  const s = new Simulation(),
    k = s.karts[0];
  Matter.Body.setPosition(k.body, atDistance(startDistance + 240));
  s.resetKart(k);
  assert.ok(
    Math.abs(nearest(k.body.position).progress - (startDistance + 140)) < 1,
  );
  const p = { ...k.body.position };
  for (let i = 0; i < 89; i++) s.step({ ...idle, throttle: 1 });
  assert.deepEqual(k.body.position, p);
  assert.ok(k.resetRemaining > 0);
  s.resetKart(k);
  assert.equal(k.resetCount, 1);
  s.step(idle);
  assert.equal(k.resetRemaining, 0);
  for (let i = 0; i < 30; i++) s.step({ ...idle, throttle: 1 });
  assert.ok(k.body.position.x > p.x + 5);
  assert.equal(
    k.body.isSensor,
    false,
    "walls remain solid during rejoin grace",
  );
  s.destroy();
});
test("engine tapers to the slower top speed without changing steering or drift", () => {
  const s = new Simulation(),
    k = s.karts[0];
  Matter.Composite.remove(
    s.engine.world,
    s.engine.world.bodies.filter((b) => b !== k.body),
  );
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    Matter.Body.setPosition(k.body, { x: 1500, y: 1330 });
    s.step({ ...idle, throttle: 1 });
    peak = Math.max(peak, k.body.speed);
  }
  assert.ok(peak > 3 && peak <= tuning.topSpeed);
  assert.equal(tuning.steering, 0.042);
  assert.equal(tuning.driftGrip, 0.035);
  s.destroy();
});
test("entire grid sits on the flat straight and wall sections share flush endpoints", () => {
  for (let i = 0; i < 8; i++) {
    const p = gridPosition(i),
      n = nearest(p);
    assert.ok(p.x > 1100 && p.x < 1530);
    assert.ok(Math.abs(n.point.y - 1330) < 0.01);
  }
  for (const side of [-1, 1])
    for (let i = 0; i < points.length; i++) {
      const a = wallVertices(i, side),
        b = wallVertices((i + 1) % points.length, side);
      assert.deepEqual(a[1], b[0]);
      assert.deepEqual(a[2], b[3]);
    }
});

test("draft boosts acceleration only behind a moving aligned kart on the same road", () => {
  const s = new Simulation(),
    k = s.karts[0],
    leader = s.karts[1];
  const setup = () => {
    for (const other of s.karts.slice(2))
      Matter.Body.setPosition(other.body, { x: 0, y: 0 });
    Matter.Body.setPosition(k.body, { x: 1400, y: 1330 });
    Matter.Body.setPosition(leader.body, { x: 1460, y: 1330 });
    for (const kart of [k, leader]) {
      Matter.Body.setAngle(kart.body, 0);
      Matter.Body.setVelocity(kart.body, { x: 3, y: 0 });
    }
  };
  setup();
  assert.ok(s.draftStrength(k) > 0.7);
  s.step({ ...idle, throttle: 1 });
  const boosted = k.body.velocity.x;
  setup();
  Matter.Body.setPosition(leader.body, { x: 1460, y: 1370 });
  assert.equal(s.draftStrength(k), 0);
  s.step({ ...idle, throttle: 1 });
  assert.ok(boosted > k.body.velocity.x);
  setup();
  Matter.Body.setVelocity(leader.body, { x: 0, y: 0 });
  assert.equal(s.draftStrength(k), 0);
  setup();
  Matter.Body.setAngle(leader.body, Math.PI);
  assert.equal(s.draftStrength(k), 0);
  setup();
  leader.resetRemaining = 1;
  assert.equal(s.draftStrength(k), 0);
  s.destroy();
});
test("lap timing requires the forward finish-line crossing and includes reset delay", () => {
  const s = new Simulation(),
    k = s.karts[0];
  k.nextGate = 0;
  const line = gatePosition(0);
  Matter.Body.setPosition(k.body, { x: line.x - 40, y: line.y });
  s.step(idle);
  assert.equal(k.lap, 0, "being near the line is not finishing");
  s.resetKart(k);
  for (let i = 0; i < 90; i++) s.step(idle);
  Matter.Body.setPosition(k.body, { x: line.x + 1, y: line.y });
  k.previousPosition = { x: line.x - 1, y: line.y };
  s.step(idle);
  assert.equal(k.lap, 1);
  assert.ok(k.lapTimes[0] >= 1.5);
  const lapEnd = k.lapStartedAt;
  s.step(idle);
  assert.equal(k.lapTimes.length, 1);
  assert.ok(s.time > lapEnd);
  s.destroy();
});
test("a stopped kart can steer off a wall under throttle without stationary free rotation", () => {
  const s = new Simulation(),
    k = s.karts[0];
  Matter.Body.setPosition(k.body, { x: 1500, y: 1410 });
  s.step({ ...idle, throttle: 1, steer: -1 });
  assert.ok(k.body.angularVelocity < -0.005);
  Matter.Body.setPosition(k.body, { x: 1500, y: 1330 });
  Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(k.body, 0);
  s.step({ ...idle, steer: 1 });
  assert.equal(k.body.angularVelocity, 0);
  s.destroy();
});
