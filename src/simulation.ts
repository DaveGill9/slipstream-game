import Matter from "matter-js";
import { angleDiff, defaultTrack, PAD, type Track } from "./track";
/**
 * Boosts. Driving over a pad gives `pad` seconds of boost. Holding a slide
 * (Space + steering one way, at speed, on the road) charges a drift boost:
 * release after `driftLevels[0]` seconds for a small kick, or after
 * `driftLevels[1]` for a bigger one. Switching steering direction mid-slide
 * starts the charge again, so weaving down a straight earns nothing.
 */
export const BOOST = {
  pad: 1,
  driftLevels: [0.5, 1],
  driftBoost: [0.45, 0.85],
  /** Extra push while boosting, as a multiple of normal acceleration.
   * 1 takes a kart from 80 to about 100 km/h on a straight. */
  force: 1,
  /** Boosting can take a kart this far past its normal top speed. */
  speedCap: 1.3,
};
/** 0 = no charge yet, 1 = small boost ready, 2 = big boost ready. */
export const driftLevel = (k: { driftCharge: number }) =>
  k.driftCharge >= BOOST.driftLevels[1]
    ? 2
    : k.driftCharge >= BOOST.driftLevels[0]
      ? 1
      : 0;
/** Default race distance; online hosts can pick 1 to MAX_LAPS. */
export const LAPS = 6;
export const MAX_LAPS = 10;
/** Most karts on one grid (online rooms; solo practice uses 8). */
export const MAX_KARTS = 10;
/** Room leaderboard: points for a win. Each place below scores one less. */
export const WIN_POINTS = 10;
/** Bonus for the fastest single lap of the race. */
export const FASTEST_LAP_POINTS = 1;
/** Championship lengths a host can pick: 0 is free play (no end). */
export const SERIES = [0, 3, 5];
/**
 * Catch-up help (online rooms only, so solo lap records stay fair). A kart
 * more than `from` px of track behind the leader gets a little more top
 * speed and power and a longer pad boost, growing to the full amounts at
 * `fullAt` px behind. Nobody has to do anything: it just keeps races close.
 */
export const CATCH_UP = {
  from: 150,
  fullAt: 1500,
  /** Extra top speed at full help: 0.08 is 80 to about 86 km/h. */
  topSpeed: 0.08,
  power: 0.2,
  /** Extra pad boost time at full help: 0.6 makes 1 s into 1.6 s. */
  padBoost: 0.6,
};
/**
 * Easy mode (a host option online), for people who do not play many games.
 * The walls stand at the edge of the road, in front of the sand, and work
 * like the guard rails in bowling: a kart that reaches one is pushed back
 * towards the road and turned to face along it, losing a little speed. Karts
 * are slower and the countdown is longer. (The client also turns the camera
 * so the kart always drives up the screen; see src/main.ts.)
 */
export const EASY = {
  /** Share of the normal top speed: 70 km/h instead of 80. */
  speed: 0.836,
  countdown: 6,
  /** A kart is bounced when its body comes this close to the wall. */
  reach: 2,
  /** Sideways speed off the rail: this share of the speed it arrived with,
   * and never less than `push`. */
  bounce: 0.5,
  push: 1.3,
  /** Share of the speed along the road that is kept. */
  keep: 0.85,
  /** How far towards the middle of the road the kart is left pointing. */
  aim: 0.22,
  /** Share of the turn still to do that is made each step. */
  turn: 0.2,
};
// Collision categories. Where the road crosses itself, karts and walls on
// the bridge ignore the ones underneath it, and the other way round.
const WALL = 1,
  KART = 2,
  KART_OVER = 4,
  KART_UNDER = 8,
  WALL_OVER = 16,
  WALL_UNDER = 32;
export interface Input {
  throttle: number;
  steer: number;
  drift: boolean;
}
export const tuning = {
  acceleration: 0.00038,
  // Engine taper limit. With on-road drag, 7.95 gives an 80 km/h top speed
  // on the HUD (11.52 gives 100 km/h).
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
  /** Catch-up help in use, 0 (none) to 1 (full); see CATCH_UP. */
  help = 0;
  /** Seconds of boost left. */
  boost = 0;
  /** Seconds the current slide has been charging a drift boost. */
  driftCharge = 0;
  /** Steering direction of the current slide: -1 left, 1 right, 0 none. */
  driftDir = 0;
  /** Easy mode: turn (radians) a guard rail still has to give this kart. */
  railTurn = 0;
  /** Centreline segment the kart is on; keeps it on its own stretch of
   * road where the track crosses itself. */
  segment = 0;
  near = { distance: 0, index: 0, progress: 0, point: { x: 0, y: 0 } };
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
    public track: Track = defaultTrack,
    public laps = LAPS,
    /** Give karts behind the leader a little help (see CATCH_UP). */
    public catchUp = false,
    /** Guard rails and a lower top speed (see EASY). */
    public easy = false,
  ) {
    const { points, wallVertices, gridPosition } = track;
    for (let side of [-1, 1])
      for (let i = 0; i < points.length; i++) {
        const vertices = wallVertices(i, side, easy ? 0 : undefined);
        const options = {
          isStatic: true,
          friction: 0,
          frictionStatic: 0,
          restitution: 0.05,
          label: "wall",
          collisionFilter: {
            category: [WALL, WALL_UNDER, WALL_OVER][track.layer[i]],
            mask: 0xffffffff,
            group: 0,
          },
        };
        // On the inside of a tight bend several sections share one corner
        // point (see edge() in track.ts), which leaves triangles and
        // sections with no area at all. Triangulate so Matter never
        // substitutes a convex hull, and drop the empty pieces.
        const area = (p: Matter.Vector[]) =>
          Math.abs(
            (p[1].x - p[0].x) * (p[2].y - p[0].y) -
              (p[2].x - p[0].x) * (p[1].y - p[0].y),
          ) / 2;
        const triangles = [
          [vertices[0], vertices[1], vertices[2]],
          [vertices[0], vertices[2], vertices[3]],
        ];
        const solid = triangles.filter((t) => area(t) > 0.5);
        if (!solid.length) continue;
        const polygons =
          solid.length === 2 && Matter.Vertices.isConvex(vertices)
            ? [vertices]
            : solid;
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
      this.locate(k);
      this.karts.push(k);
      Matter.Composite.add(this.engine.world, k.body);
    }
  }
  /** Refreshes which piece of road the kart is on. */
  locate(k: Kart, hint?: number) {
    k.near = this.track.nearest(k.body.position, hint);
    k.segment = k.near.index;
  }
  resetKart(k: Kart) {
    if (k.resetRemaining > 0 || k.finish) return;
    const { atDistance, segmentAt } = this.track;
    this.locate(k, k.segment);
    const n = k.near;
    const p = atDistance(n.progress - 100),
      q = atDistance(n.progress - 85);
    k.resetRemaining = 1.5;
    k.draft = 0;
    k.boost = 0;
    k.driftCharge = 0;
    k.driftDir = 0;
    k.railTurn = 0;
    k.resetCount++;
    // A held kart is ghosted so traffic cannot move it or become blocked by it.
    Matter.Body.setStatic(k.body, true);
    k.body.isSensor = true;
    Matter.Body.setPosition(k.body, p);
    this.locate(k, segmentAt(n.progress - 100));
    k.previousPosition = { ...p };
    Matter.Body.setAngle(k.body, Math.atan2(q.y - p.y, q.x - p.x));
    Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(k.body, 0);
    k.stuck = 0;
  }
  bot(k: Kart): Input {
    const { atDistance } = this.track;
    const b = k.body,
      n = k.near,
      speed = Math.hypot(b.velocity.x, b.velocity.y);
    const look = atDistance(n.progress + 40 + speed * 13),
      far = atDistance(n.progress + 130);
    const desired = Math.atan2(look.y - b.position.y, look.x - b.position.x);
    const bend = Math.abs(
      angleDiff(Math.atan2(far.y - look.y, far.x - look.x), desired),
    );
    const err = angleDiff(desired, b.angle);
    // A boosted bot rides the boost out instead of braking against it.
    const target =
      tuning.topSpeed * 0.86 -
      bend * 1.6 -
      (k.id % 3) * 0.1 +
      (k.boost > 0 ? 1.5 : 0);
    return {
      throttle: speed > target ? -0.25 : 1,
      steer: Math.max(-1, Math.min(1, err * 2.1)),
      drift: false,
    };
  }
  draftStrength(k: Kart) {
    if (k.resetRemaining || k.respawnGrace || k.finish || k.body.speed < 1.5)
      return 0;
    const { ROAD, totalLength } = this.track;
    const n = this.track.nearest(k.body.position, k.segment);
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
      const ln = this.track.nearest(leader.body.position, leader.segment);
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
    const { ROAD, START, gatePosition } = this.track;
    this.time += 1 / 60;
    for (const k of this.karts) this.locate(k, k.segment);
    if (this.catchUp) {
      const lead = Math.max(...this.karts.map((k) => this.progress(k)));
      for (const k of this.karts)
        k.help = k.finish
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                (lead - this.progress(k) - CATCH_UP.from) /
                  (CATCH_UP.fullAt - CATCH_UP.from),
              ),
            );
    }
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
      if (k.respawnGrace > 0)
        k.respawnGrace = Math.max(0, k.respawnGrace - 1 / 60);
      const level = this.track.layer[k.segment];
      b.collisionFilter.category = [KART, KART_UNDER, KART_OVER][level];
      b.collisionFilter.mask =
        (k.respawnGrace > 0 ? WALL | WALL_OVER | WALL_UNDER : 0xffffffff) &
        ~[0, KART_OVER | WALL_OVER, KART_UNDER | WALL_UNDER][level];
      k.input = this.humans.has(k.id)
        ? (inputs?.get(k.id) ??
          (k.id === 0 ? player : { throttle: 0, steer: 0, drift: false }))
        : this.bot(k);
      const n = k.near,
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
      const topSpeed =
        tuning.topSpeed *
        (this.easy ? EASY.speed : 1) *
        (1 + CATCH_UP.topSpeed * k.help);
      // Smooth power taper limits engine speed without clamping impact momentum.
      const power =
        k.input.throttle > 0
          ? Math.max(0, 1 - (Math.max(0, forward) / topSpeed) ** 4) *
            (1 + CATCH_UP.power * k.help)
          : 1;
      const slipstream = k.input.throttle > 0 ? 1 + 0.2 * k.draft : 1;
      Matter.Body.applyForce(b, b.position, {
        x: f.x * accel * k.input.throttle * power * slipstream,
        y: f.y * accel * k.input.throttle * power * slipstream,
      });
      // Boost pads: a kart touching a pad gets a full pad boost.
      for (const pad of this.track.pads) {
        const dx = b.position.x - pad.x,
          dy = b.position.y - pad.y;
        const along = dx * Math.cos(pad.angle) + dy * Math.sin(pad.angle),
          across = -dx * Math.sin(pad.angle) + dy * Math.cos(pad.angle);
        if (
          Math.abs(along) < PAD.length / 2 + 6 &&
          Math.abs(across) < PAD.width / 2 + 6
        )
          k.boost = Math.max(
            k.boost,
            BOOST.pad * (1 + CATCH_UP.padBoost * k.help),
          );
      }
      // Drift boost: charge while sliding through a turn, spend on release.
      if (k.input.drift && !off && forward > 3) {
        const dir = Math.sign(k.input.steer);
        if (dir !== 0) {
          if (dir !== k.driftDir) k.driftCharge = 0;
          k.driftDir = dir;
          k.driftCharge += 1 / 60;
        }
      } else {
        const level = driftLevel(k);
        if (!k.input.drift && level > 0)
          k.boost = Math.max(k.boost, BOOST.driftBoost[level - 1]);
        k.driftCharge = 0;
        k.driftDir = 0;
      }
      if (k.boost > 0) {
        k.boost = Math.max(0, k.boost - 1 / 60);
        const cap = topSpeed * BOOST.speedCap;
        const push =
          tuning.acceleration *
          BOOST.force *
          Math.max(0, 1 - (Math.max(0, forward) / cap) ** 4);
        Matter.Body.applyForce(b, b.position, { x: f.x * push, y: f.y * push });
      }
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
      if (this.easy) this.guardRail(k);
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
          if (k.lap === this.laps && !k.finish) k.finish = this.time;
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
  /** Easy mode's guard rails: a kart that drifts out to the wall is sent
   * back towards the road and turned to face along it. */
  guardRail(k: Kart) {
    const { ROAD, atDistance } = this.track;
    const b = k.body,
      n = k.near;
    // Unit vector out from the centreline, and how far the kart's body
    // (22 x 14) reaches that way: more nose-on than side-on.
    const out = {
      x: (b.position.x - n.point.x) / (n.distance || 1),
      y: (b.position.y - n.point.y) / (n.distance || 1),
    };
    const cos = Math.cos(b.angle),
      sin = Math.sin(b.angle);
    const body =
      Math.abs(cos * out.x + sin * out.y) * 11 +
      Math.abs(-sin * out.x + cos * out.y) * 7;
    if (n.distance + body > ROAD / 2 - EASY.reach) {
      const a = atDistance(n.progress - 8),
        c = atDistance(n.progress + 8),
        length = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const along = { x: (c.x - a.x) / length, y: (c.y - a.y) / length };
      const leaving = b.velocity.x * out.x + b.velocity.y * out.y;
      if (leaving > 0.05) {
        const speed = b.velocity.x * along.x + b.velocity.y * along.y;
        const back = Math.max(EASY.push, leaving * EASY.bounce);
        Matter.Body.setVelocity(b, {
          x: along.x * speed * EASY.keep - out.x * back,
          y: along.y * speed * EASY.keep - out.y * back,
        });
        // Point the kart down the road, angled a little away from the rail.
        const side = Math.sign(along.x * out.y - along.y * out.x) || 1;
        const target = Math.atan2(along.y, along.x) - side * EASY.aim;
        k.railTurn = angleDiff(target, b.angle);
      }
    }
    if (k.railTurn) {
      const turn = k.railTurn * EASY.turn;
      Matter.Body.setAngle(b, b.angle + turn);
      k.railTurn = Math.abs(k.railTurn - turn) < 0.01 ? 0 : k.railTurn - turn;
    }
  }
  /** Roughly how far a kart has raced, in px of track. It counts timing
   * gates, so reversing over the start line gains nothing. */
  progress(k: Kart) {
    const spacing = this.track.totalLength / this.gateCount;
    const target = this.track.gatePosition(k.nextGate, this.gateCount);
    return (
      k.gates * spacing -
      Math.min(
        spacing,
        Math.hypot(k.body.position.x - target.x, k.body.position.y - target.y),
      )
    );
  }
  positions() {
    return [...this.karts].sort((a, b) => {
      if (a.finish || b.finish)
        return (a.finish || Infinity) - (b.finish || Infinity);
      const progress = (k: Kart) => {
        const target = this.track.gatePosition(k.nextGate, this.gateCount);
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
