import Matter from "matter-js";
import {
  points,
  wallVertices,
  gridPosition,
  gatePosition,
  nearest,
  atDistance,
  totalLength,
  START,
  angleDiff,
  ROAD,
} from "./track";
export interface Input {
  throttle: number;
  steer: number;
  drift: boolean;
}
export const tuning = {
  acceleration: 0.00038,
  // Engine taper limit. With on-road drag, 7.95 gives an 80 km/h top speed
  // on the HUD (5.8 gave about 63 km/h).
  topSpeed: 7.95,
  braking: 0.0009,
  steering: 0.042,
  grip: 0.2,
  driftGrip: 0.035,
  recovery: 0.035,
  bounce: 0.25,
  angularDamping: 0.8,
};
export class Kart {
  body: Matter.Body;
  previousPosition: { x: number; y: number };
  input: Input = { throttle: 0, steer: 0, drift: false };
  grip = tuning.grip;
  nextGate = 1;
  gates = 0;
  lap = 0;
  finish = 0;
  stuck = 0;
  resetRemaining = 0;
  resetCount = 0;
  respawnGrace = 0;
  draft = 0;
  lapTimes: number[] = [];
  lapStartedAt = 0;
  constructor(
    public id: number,
    x: number,
    y: number,
  ) {
    this.previousPosition = { x, y };
    this.body = Matter.Bodies.rectangle(x, y, 22, 14, {
      mass: 1.1,
      frictionAir: 0.012,
      friction: 0.03,
      restitution: tuning.bounce,
      label: `kart-${id}`,
      collisionFilter: { category: 2, mask: 0xffffffff, group: 0 },
    });
  }
}
export class Simulation {
  engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  karts: Kart[] = [];
  time = 0;
  gateCount = 24;
  constructor(
    public count = 8,
    public humans = new Set([0]),
  ) {
    for (let side of [-1, 1])
      for (let i = 0; i < points.length; i++) {
        const vertices = wallVertices(i, side);
        const options = {
          isStatic: true,
          friction: 0,
          frictionStatic: 0,
          restitution: 0.05,
          label: "wall",
        };
        // Tight offset bends can produce concave quads. Triangulate those
        // explicitly so Matter never substitutes a convex hull for the wall.
        const polygons = Matter.Vertices.isConvex(vertices)
          ? [vertices]
          : [
              [vertices[0], vertices[1], vertices[2]],
              [vertices[0], vertices[2], vertices[3]],
            ];
        const parts = polygons.map((polygon) => {
          const centre = Matter.Vertices.centre(polygon);
          return Matter.Bodies.fromVertices(
            centre.x,
            centre.y,
            [polygon],
            options,
          );
        });
        const wall =
          parts.length === 1
            ? parts[0]
            : Matter.Body.create({ ...options, parts });
        Matter.Composite.add(this.engine.world, wall);
      }
    for (let i = 0; i < count; i++) {
      const p = gridPosition(i);
      const k = new Kart(i, p.x, p.y);
      this.karts.push(k);
      Matter.Composite.add(this.engine.world, k.body);
    }
  }
  resetKart(k: Kart) {
    if (k.resetRemaining > 0 || k.finish) return;
    const n = nearest(k.body.position);
    const p = atDistance(n.progress - 100),
      q = atDistance(n.progress - 85);
    k.resetRemaining = 1.5;
    k.draft = 0;
    k.resetCount++;
    // A held kart is ghosted so traffic cannot move it or become blocked by it.
    Matter.Body.setStatic(k.body, true);
    k.body.isSensor = true;
    Matter.Body.setPosition(k.body, p);
    k.previousPosition = { ...p };
    Matter.Body.setAngle(k.body, Math.atan2(q.y - p.y, q.x - p.x));
    Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(k.body, 0);
    k.stuck = 0;
  }
  bot(k: Kart): Input {
    const b = k.body,
      n = nearest(b.position),
      speed = Math.hypot(b.velocity.x, b.velocity.y);
    const look = atDistance(n.progress + 40 + speed * 13),
      far = atDistance(n.progress + 130);
    const desired = Math.atan2(look.y - b.position.y, look.x - b.position.x);
    const bend = Math.abs(
      angleDiff(Math.atan2(far.y - look.y, far.x - look.x), desired),
    );
    const err = angleDiff(desired, b.angle);
    const target = tuning.topSpeed * 0.86 - bend * 1.6 - (k.id % 3) * 0.1;
    return {
      throttle: speed > target ? -0.25 : 1,
      steer: Math.max(-1, Math.min(1, err * 2.1)),
      drift: false,
    };
  }
  draftStrength(k: Kart) {
    if (k.resetRemaining || k.respawnGrace || k.finish || k.body.speed < 1.5)
      return 0;
    const n = nearest(k.body.position);
    if (n.distance > ROAD / 2) return 0;
    let strength = 0;
    for (const leader of this.karts) {
      if (
        leader === k ||
        leader.resetRemaining ||
        leader.respawnGrace ||
        leader.finish ||
        leader.body.speed < 2
      )
        continue;
      if (Math.abs(angleDiff(k.body.angle, leader.body.angle)) > 0.35) continue;
      const dx = leader.body.position.x - k.body.position.x;
      const dy = leader.body.position.y - k.body.position.y;
      const along =
        dx * Math.cos(leader.body.angle) + dy * Math.sin(leader.body.angle);
      const across = Math.abs(
        -dx * Math.sin(leader.body.angle) + dy * Math.cos(leader.body.angle),
      );
      if (along < 24 || along > 130 || across > 17) continue;
      const ln = nearest(leader.body.position);
      const gap = (ln.progress - n.progress + totalLength) % totalLength;
      // Nearby parallel sections separated by a wall cannot share a draft.
      if (ln.distance > ROAD / 2 || gap > 150 || Math.abs(gap - along) > 30)
        continue;
      const forward =
        leader.body.velocity.x * Math.cos(leader.body.angle) +
        leader.body.velocity.y * Math.sin(leader.body.angle);
      if (forward < 2) continue;
      strength = Math.max(
        strength,
        (1 - across / 20) * (1 - (0.4 * (along - 24)) / 106),
      );
    }
    return strength;
  }
  step(player: Input, inputs?: Map<number, Input>) {
    this.time += 1 / 60;
    const drafts = this.karts.map((k) => this.draftStrength(k));
    for (const k of this.karts) {
      const b = k.body;
      k.draft = drafts[k.id];
      if (k.resetRemaining > 0) {
        k.resetRemaining = Math.max(0, k.resetRemaining - 1 / 60);
        k.input = { throttle: 0, steer: 0, drift: false };
        if (k.resetRemaining < 1e-8) {
          k.resetRemaining = 0;
          Matter.Body.setStatic(b, false);
          k.respawnGrace = 1;
          b.isSensor = false;
          b.collisionFilter.mask = 1;
        }
        continue;
      }
      // Brief collision grace lets the recovering kart safely rejoin traffic.
      if (k.respawnGrace > 0) {
        k.respawnGrace = Math.max(0, k.respawnGrace - 1 / 60);
        if (!k.respawnGrace) b.collisionFilter.mask = 0xffffffff;
      }
      k.input = this.humans.has(k.id)
        ? (inputs?.get(k.id) ??
          (k.id === 0 ? player : { throttle: 0, steer: 0, drift: false }))
        : this.bot(k);
      const n = nearest(b.position),
        off = n.distance > ROAD / 2;
      const f = { x: Math.cos(b.angle), y: Math.sin(b.angle) },
        r = { x: -f.y, y: f.x };
      const forward = b.velocity.x * f.x + b.velocity.y * f.y,
        side = b.velocity.x * r.x + b.velocity.y * r.y;
      const targetGrip = k.input.drift && !off ? tuning.driftGrip : tuning.grip;
      k.grip += (targetGrip - k.grip) * tuning.recovery * 10;
      Matter.Body.setVelocity(b, {
        x: b.velocity.x - r.x * side * k.grip,
        y: b.velocity.y - r.y * side * k.grip,
      });
      b.frictionAir = off ? 0.055 : 0.01;
      b.restitution = tuning.bounce;
      const accel =
        k.input.throttle < 0 && forward > 0.5
          ? tuning.braking
          : tuning.acceleration;
      // Smooth power taper limits engine speed without clamping impact momentum.
      const power =
        k.input.throttle > 0
          ? Math.max(0, 1 - (Math.max(0, forward) / tuning.topSpeed) ** 4)
          : 1;
      const boost = k.input.throttle > 0 ? 1 + 0.2 * k.draft : 1;
      Matter.Body.applyForce(b, b.position, {
        x: f.x * accel * k.input.throttle * power * boost,
        y: f.y * accel * k.input.throttle * power * boost,
      });
      // Let a kart turn away from a wall under throttle without changing
      // normal moving steering or allowing free rotation at a standstill.
      const wallRecovery =
        n.distance > ROAD / 2 && Math.abs(k.input.throttle) > 0.1 ? 0.22 : 0;
      const steering =
        k.input.steer *
        tuning.steering *
        Math.max(wallRecovery, Math.min(1, Math.abs(forward) / 2.3)) *
        Math.sign(forward || 1) *
        (k.input.drift ? 1.2 : 1);
      Matter.Body.setAngularVelocity(
        b,
        b.angularVelocity * (1 - tuning.angularDamping) +
          steering * tuning.angularDamping,
      );
      const gate = gatePosition(k.nextGate, this.gateCount);
      const crossed =
        k.nextGate === 0
          ? k.previousPosition.x < START.x &&
            b.position.x >= START.x &&
            Math.abs(b.position.y - START.y) < ROAD / 2
          : Math.hypot(b.position.x - gate.x, b.position.y - gate.y) < 85;
      if (!k.finish && crossed) {
        k.gates++;
        k.nextGate = (k.nextGate + 1) % this.gateCount;
        if (k.nextGate === 1) {
          k.lap++;
          k.lapTimes.push(this.time - k.lapStartedAt);
          k.lapStartedAt = this.time;
          if (k.lap === 3 && !k.finish) k.finish = this.time;
        }
      }
      k.previousPosition = { ...b.position };
      if (!this.humans.has(k.id)) {
        k.stuck = Math.abs(forward) < 0.6 ? k.stuck + 1 / 60 : 0;
        if (k.stuck > 2.5) this.resetKart(k);
      }
    }
    Matter.Engine.update(this.engine, 1000 / 60);
  }
  positions() {
    return [...this.karts].sort((a, b) => {
      if (a.finish || b.finish)
        return (a.finish || Infinity) - (b.finish || Infinity);
      const progress = (k: Kart) => {
        const target = gatePosition(k.nextGate, this.gateCount);
        return (
          k.gates * 10000 -
          Math.hypot(k.body.position.x - target.x, k.body.position.y - target.y)
        );
      };
      return progress(b) - progress(a);
    });
  }
  destroy() {
    Matter.Engine.clear(this.engine);
    Matter.Composite.clear(this.engine.world, false);
  }
}
