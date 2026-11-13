import { test } from "node:test";
import assert from "node:assert/strict";
import Matter from "matter-js";
import {
  Simulation,
  tuning,
  LAPS,
  BOOST,
  CATCH_UP,
  driftLevel,
} from "./simulation.ts";
import { tracks, LAYER } from "./track.ts";
const {
  atDistance,
  gatePosition,
  startDistance,
  nearest,
  gridPosition,
  wallVertices,
  points,
} = tracks.foundry;
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
test("catch-up help: only when switched on, only for karts behind, and it raises top speed", () => {
  const topSpeed = (catchUp, behind) => {
    const s = new Simulation(2, new Set([0, 1]), tracks.foundry, LAPS, catchUp);
    const [me, leader] = s.karts;
    // Put the other kart a long way up the road, with its gates counted.
    if (behind) {
      leader.gates = 12;
      leader.nextGate = 13;
      Matter.Body.setPosition(leader.body, gatePosition(12));
    }
    const inputs = new Map([
      [0, { ...idle, throttle: 1 }],
      [1, idle],
    ]);
    let best = 0;
    for (let i = 0; i < 240; i++) {
      s.step(idle, inputs);
      Matter.Body.setVelocity(leader.body, { x: 0, y: 0 });
      best = Math.max(best, me.body.speed);
    }
    const help = [me.help, leader.help];
    s.destroy();
    return { best, help };
  };
  const off = topSpeed(false, true),
    level = topSpeed(true, false),
    helped = topSpeed(true, true);
  assert.deepEqual(off.help, [0, 0]);
  assert.equal(level.help[0], 0);
  assert.deepEqual(helped.help, [1, 0]);
  assert.ok(Math.abs(off.best - level.best) < 0.05);
  assert.ok(helped.best > off.best * (1 + CATCH_UP.topSpeed / 2));
  assert.ok(helped.best < off.best * (1 + CATCH_UP.topSpeed * 1.5));
});
test("finish line shortcuts do not count; ordered gates complete exactly the race distance", () => {
  const s = new Simulation(),
    k = s.karts[0];
  Matter.Body.setPosition(k.body, gatePosition(0));
  s.step(idle);
  assert.equal(k.lap, 0);
  for (let lap = 0; lap < LAPS; lap++)
    for (let i = 1; i <= 24; i++) {
      Matter.Body.setPosition(k.body, gatePosition(i % 24));
      Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
      if (i === 24) Matter.Body.setPosition(k.body, { x: 1361, y: 1330 });
      if (i === 24)
        k.previousPosition = { x: k.body.position.x - 2, y: k.body.position.y };
      s.step(idle);
    }
  assert.equal(k.lap, LAPS);
  assert.ok(k.finish > 0);
  s.destroy();
});
for (const track of Object.values(tracks))
  test(`seven bots navigate a full race on ${track.id} and remain numerically stable`, () => {
    const s = new Simulation(8, new Set([0]), track);
    for (let i = 0; i < 40000; i++) {
      s.step(idle);
      if (s.karts.slice(1).every((k) => k.finish)) break;
    }
    for (const k of s.karts.slice(1)) {
      assert.ok(Number.isFinite(k.body.position.x));
      assert.ok(k.finish > 0, `bot ${k.id}: ${k.lap} laps, ${k.gates} gates`);
      assert.ok(k.resetCount <= 2, `bot ${k.id} reset ${k.resetCount} times`);
    }
    s.destroy();
  });
test("the overpass bridge keeps the two roads apart", () => {
  const track = tracks.overpass;
  assert.ok(track.bridge, "the figure-eight track crosses itself");
  const s = new Simulation(2, new Set([0, 1]), track),
    [low, high] = s.karts;
  const place = (k, distance, speed) => {
    const p = track.atDistance(distance),
      q = track.atDistance(distance + 5);
    Matter.Body.setPosition(k.body, p);
    Matter.Body.setAngle(k.body, Math.atan2(q.y - p.y, q.x - p.x));
    Matter.Body.setVelocity(k.body, {
      x: ((q.x - p.x) / 5) * speed,
      y: ((q.y - p.y) / 5) * speed,
    });
    s.locate(k, track.segmentAt(distance));
  };
  // Both karts reach the crossing point at the same moment.
  place(low, track.bridge.under - 60, 6);
  place(high, track.bridge.over - 60, 6);
  const input = { ...idle, throttle: 1 };
  const drive = () =>
    s.step(
      idle,
      new Map([
        [0, input],
        [1, input],
      ]),
    );
  for (let i = 0; i < 10; i++) drive();
  assert.equal(track.layer[low.segment], LAYER.under);
  assert.equal(track.layer[high.segment], LAYER.over);
  assert.ok(
    Math.hypot(
      low.body.position.x - high.body.position.x,
      low.body.position.y - high.body.position.y,
    ) < 20,
    "the karts overlap at the crossing",
  );
  for (let i = 0; i < 30; i++) drive();
  // Neither was knocked off line or stopped by the other road's walls.
  assert.ok(low.near.progress > track.bridge.under + 100);
  assert.ok(high.near.progress > track.bridge.over + 100);
  assert.ok(low.near.distance < 5 && high.near.distance < 5);
  // A kart that turns hard on the bridge is still held in by its rails.
  place(high, track.bridge.over, 0);
  Matter.Body.setAngle(high.body, high.body.angle + Math.PI / 2);
  for (let i = 0; i < 120; i++)
    s.step(
      idle,
      new Map([
        [0, idle],
        [1, input],
      ]),
    );
  assert.ok(high.near.distance < track.ROAD / 2 + 30, "rail contains the kart");
  assert.equal(track.layer[high.segment], LAYER.over);
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
test("a boost pad pushes a kart past its normal top speed for about a second", () => {
  const track = tracks.foundry,
    s = new Simulation(1, new Set([0]), track),
    k = s.karts[0],
    pad = track.pads[0];
  // Line up 150 px before the first pad at 80 km/h (HUD km/h = speed x 13).
  const start = {
    x: pad.x - Math.cos(pad.angle) * 150,
    y: pad.y - Math.sin(pad.angle) * 150,
  };
  Matter.Body.setPosition(k.body, start);
  Matter.Body.setAngle(k.body, pad.angle);
  Matter.Body.setVelocity(k.body, {
    x: Math.cos(pad.angle) * (80 / 13),
    y: Math.sin(pad.angle) * (80 / 13),
  });
  s.locate(k);
  let peak = 0,
    boosted = 0;
  for (let i = 0; i < 90; i++) {
    s.step({ ...idle, throttle: 1 });
    peak = Math.max(peak, k.body.speed);
    if (k.boost > 0) boosted++;
  }
  assert.ok(boosted >= 55 && boosted <= 70, `boosted for ${boosted} steps`);
  assert.ok(peak * 13 > 92, `peak ${peak * 13} km/h`);
  assert.ok(peak <= tuning.topSpeed * BOOST.speedCap);
  s.destroy();
});
test("holding a slide charges a drift boost that fires on release", () => {
  const s = new Simulation(1),
    k = s.karts[0];
  Matter.Composite.remove(
    s.engine.world,
    s.engine.world.bodies.filter((b) => b !== k.body),
  );
  // Slide in place on the straight so the kart never leaves the road.
  const slide = (steps, input) => {
    for (let i = 0; i < steps; i++) {
      Matter.Body.setPosition(k.body, { x: 1500, y: 1330 });
      if (k.body.speed < 6)
        Matter.Body.setVelocity(k.body, {
          x: Math.cos(k.body.angle) * 6,
          y: Math.sin(k.body.angle) * 6,
        });
      s.step(input);
    }
  };
  const drifting = { throttle: 1, steer: 1, drift: true },
    release = { throttle: 1, steer: 0, drift: false };
  // A short slide earns nothing.
  slide(20, drifting);
  assert.equal(driftLevel(k), 0);
  slide(1, release);
  assert.equal(k.boost, 0);
  // A long slide reaches level 2 and releases the big boost.
  slide(70, drifting);
  assert.equal(driftLevel(k), 2);
  slide(1, release);
  assert.equal(k.driftCharge, 0);
  assert.ok(k.boost > BOOST.driftBoost[1] - 0.05);
  // Weaving left and right never builds a charge, however long it lasts.
  slide(60, release);
  for (let i = 0; i < 8; i++)
    slide(20, { throttle: 1, steer: i % 2 ? 1 : -1, drift: true });
  assert.equal(driftLevel(k), 0);
  slide(1, release);
  assert.equal(k.boost, 0);
  // Straight-line drifting with no steering does not charge.
  slide(60, release);
  slide(100, { throttle: 1, steer: 0, drift: true });
  assert.equal(k.driftCharge, 0);
  s.destroy();
});
