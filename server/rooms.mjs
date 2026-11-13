import { randomBytes } from "node:crypto";
import Matter from "matter-js";
import {
  Simulation,
  LAPS,
  MAX_LAPS,
  MAX_KARTS,
  WIN_POINTS,
  FASTEST_LAP_POINTS,
  SERIES,
} from "../src/simulation.ts";
import { tracks, defaultTrack } from "../src/track.ts";
const idle = () => ({ throttle: 0, steer: 0, drift: false });
const round = (value, scale) => Math.round(value * scale) / scale;
export class Room {
  constructor(code) {
    this.code = code;
    this.members = [];
    this.phase = "lobby";
    this.track = defaultTrack.id;
    this.laps = LAPS;
    this.hostId = "";
    this.sim = null;
    this.countdown = 0;
    this.raceId = 0;
    this.endAt = Infinity;
    this.age = 0;
    // Standings of the last race, sent with the podium (see award()).
    this.results = null;
    // Championship: races in the cup (0 = free play), races run so far, and
    // the name of the last cup's winner.
    this.series = 0;
    this.round = 0;
    this.champion = "";
  }
  join(name, token, send) {
    const returning = this.members.find((m) => m.token === token && token);
    if (returning) {
      if (returning.connected)
        throw Error("This racer is already connected in another tab.");
      if (returning.dnf)
        throw Error("Your reconnect window expired. Join the next race.");
      if (!this.hostId) this.hostId = returning.id;
      returning.connected = true;
      returning.send = send;
      returning.absent = 0;
      returning.input = idle();
      const kart = this.sim?.karts[returning.kart];
      if (kart && !kart.resetRemaining) {
        kart.body.isSensor = false;
        kart.body.collisionFilter.mask = 0xffffffff;
      }
      this.sendWelcome(returning);
      return returning;
    }
    if (this.phase !== "lobby")
      throw Error("This room is racing. Join after the podium.");
    if (this.members.length >= MAX_KARTS)
      throw Error(`Room is full (${MAX_KARTS} racers).`);
    const member = {
      id: randomBytes(8).toString("hex"),
      token: randomBytes(24).toString("hex"),
      name:
        String(name || "Racer")
          .replace(/[^a-zA-Z0-9 _-]/g, "")
          .trim()
          .slice(0, 12) || "Racer",
      ready: false,
      connected: true,
      send,
      input: idle(),
      lastInput: 0,
      seq: -1,
      absent: 0,
      dnf: false,
      points: 0,
      kart: this.members.length,
    };
    this.members.push(member);
    if (!this.hostId) this.hostId = member.id;
    this.sendWelcome(member);
    return member;
  }
  sendWelcome(m) {
    m.send({ type: "welcome", id: m.id, token: m.token, code: this.code });
    this.broadcast();
  }
  disconnect(m, leave = false) {
    m.connected = false;
    m.input = idle();
    m.ready = false;
    if (this.phase === "lobby") {
      this.members = this.members.filter((p) => p !== m);
      this.members.forEach((p, i) => (p.kart = i));
    } else {
      if (leave) m.dnf = true;
      const k = this.sim?.karts[m.kart];
      if (k) {
        Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
        k.body.isSensor = true;
      }
    }
    if (this.hostId === m.id)
      this.hostId = this.members.find((p) => p.connected)?.id || "";
    this.broadcast();
    // Nobody is left waiting on a racer who has gone.
    this.nextIfReady();
  }
  /** Between the races of a cup the room stays on the podium: racers ready
   * up there and the next race starts without a trip to the lobby. */
  get betweenRaces() {
    return (
      this.phase === "podium" &&
      this.series > 0 &&
      !!this.results &&
      !this.results.final
    );
  }
  /** Starts the cup's next race once everyone still here is ready. */
  nextIfReady() {
    if (!this.betweenRaces) return;
    const here = this.members.filter((p) => p.connected);
    if (here.length < 2 || !here.every((p) => p.ready)) return;
    this.members = here;
    this.startRace();
  }
  startRace() {
    this.sim?.destroy();
    this.sim = new Simulation(
      this.members.length,
      new Set(this.members.map((_, i) => i)),
      tracks[this.track],
      this.laps,
      true,
    );
    this.members.forEach((p, i) => {
      p.kart = i;
      p.dnf = false;
      p.input = idle();
      p.seq = -1;
      p.absent = 0;
    });
    this.phase = "countdown";
    this.countdown = 3;
    this.raceId++;
    this.endAt = Infinity;
    this.results = null;
    this.broadcast();
  }
  message(m, data) {
    if (data.type === "ready" && (this.phase === "lobby" || this.betweenRaces)) {
      m.ready = !!data.ready;
      this.broadcast();
      this.nextIfReady();
    } else if (data.type === "track") {
      if (m.id !== this.hostId)
        throw Error("Only the room host picks the track.");
      // The host may also pick the next track from a cup's podium.
      if (
        (this.phase !== "lobby" && !this.betweenRaces) ||
        !Object.hasOwn(tracks, data.track)
      )
        return;
      this.track = data.track;
      this.broadcast();
    } else if (data.type === "laps") {
      if (m.id !== this.hostId)
        throw Error("Only the room host picks the race distance.");
      const laps = data.laps;
      if (
        this.phase !== "lobby" ||
        !Number.isInteger(laps) ||
        laps < 1 ||
        laps > MAX_LAPS
      )
        return;
      this.laps = laps;
      this.broadcast();
    } else if (data.type === "series") {
      if (m.id !== this.hostId)
        throw Error("Only the room host picks the race format.");
      if (this.phase !== "lobby" || !SERIES.includes(data.series)) return;
      // A new format starts everyone from zero.
      this.series = data.series;
      this.round = 0;
      for (const p of this.members) p.points = 0;
      this.broadcast();
    } else if (data.type === "start") {
      if (m.id !== this.hostId) throw Error("Only the room host can start.");
      if (
        this.phase !== "lobby" ||
        this.members.length < 2 ||
        !this.members.every((p) => p.ready && p.connected)
      )
        throw Error("At least two racers must be connected and ready.");
      this.startRace();
    } else if (data.type === "rematch") {
      // Anyone may leave the podium. The first to do so reopens the lobby;
      // the others keep their podium on screen until they follow.
      if (this.phase !== "podium") return;
      this.phase = "lobby";
      this.members = this.members.filter((p) => p.connected);
      this.members.forEach((p, i) => {
        p.ready = false;
        p.dnf = false;
        p.kart = i;
      });
      this.sim?.destroy();
      this.sim = null;
      // The cup is over: the next race starts a new one from zero.
      if (this.results?.final) {
        this.round = 0;
        for (const p of this.members) p.points = 0;
      }
      this.broadcast();
    } else if (data.type === "input" && this.phase === "racing" && !m.dnf) {
      if (!Number.isSafeInteger(data.seq) || data.seq <= m.seq) return;
      const t = data.throttle,
        s = data.steer;
      if (!Number.isFinite(t) || !Number.isFinite(s)) return;
      m.seq = data.seq;
      m.lastInput = this.age;
      m.input = {
        throttle: Math.max(-0.65, Math.min(1, t)),
        steer: Math.max(-1, Math.min(1, s)),
        drift: data.drift === true,
      };
      if (data.reset === true) this.sim.resetKart(this.sim.karts[m.kart]);
    }
  }
  tick(dt = 1 / 60) {
    this.age += dt;
    for (const m of this.members)
      if (!m.connected) {
        m.absent += dt;
        if (m.absent > 30) m.dnf = true;
      }
    if (this.phase === "countdown") {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown < 1e-8) {
        this.phase = "racing";
        this.countdown = 0;
      }
    } else if (this.phase === "racing") {
      const inputs = new Map(
        this.members.map((m) => [
          m.kart,
          m.connected && !m.dnf && this.age - m.lastInput < 0.5
            ? m.input
            : idle(),
        ]),
      );
      this.sim.step(idle(), inputs);
      for (const m of this.members) {
        const k = this.sim.karts[m.kart];
        if (!m.connected || m.dnf || k.finish) {
          Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
          k.body.isSensor = true;
        }
      }
      if (this.sim.karts.some((k) => k.finish) && !Number.isFinite(this.endAt))
        this.endAt = this.sim.time + 45;
      if (
        this.members.every((m) => m.dnf || this.sim.karts[m.kart].finish) ||
        this.sim.time >= this.endAt ||
        // Hard stop so an abandoned room cannot race forever.
        this.sim.time >= 120 + this.laps * 90
      ) {
        for (const m of this.members)
          if (!this.sim.karts[m.kart].finish) m.dnf = true;
        // "Ready" now means ready for the next race.
        for (const m of this.members) m.ready = false;
        this.phase = "podium";
        this.award();
        this.broadcast();
      }
    }
  }
  /** Room leaderboard. A win scores WIN_POINTS (10), second place one less
   * and so on; racers who did not finish score nothing for their place. The
   * fastest single lap of the race earns a bonus point. Points add up over
   * every race in the room. */
  award() {
    let fastestLap = null;
    for (const k of this.sim.karts)
      for (const time of k.lapTimes)
        if (!fastestLap || time < fastestLap.time)
          fastestLap = { kart: k.id, time };
    const rows = this.sim.positions().map((k, place) => {
      const member = this.members.find((m) => m.kart === k.id);
      const points =
        (k.finish ? Math.max(0, WIN_POINTS - place) : 0) +
        (fastestLap?.kart === k.id ? FASTEST_LAP_POINTS : 0);
      if (member) member.points += points;
      return {
        kart: k.id,
        name: member?.name || "Racer",
        finish: k.finish,
        points,
        total: member?.points ?? points,
      };
    });
    this.round++;
    // The cup ends after its last race; most points wins, and a tie goes to
    // whoever finished higher in that last race.
    const final = this.series > 0 && this.round >= this.series;
    const best = [...rows].sort((a, b) => b.total - a.total)[0];
    if (final) this.champion = best.name;
    this.results = {
      rows,
      fastestLap,
      round: this.round,
      series: this.series,
      final,
    };
  }
  snapshot() {
    return {
      type: "state",
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      track: this.track,
      laps: this.laps,
      countdown: this.countdown,
      raceId: this.raceId,
      time: this.sim?.time || 0,
      finishRemaining: Number.isFinite(this.endAt)
        ? Math.max(0, this.endAt - (this.sim?.time || 0))
        : null,
      results: this.results,
      series: this.series,
      round: this.round,
      champion: this.champion,
      members: this.members.map(
        ({ id, name, kart, ready, connected, dnf, seq, points }) => ({
          id,
          name,
          kart,
          ready,
          connected,
          dnf,
          seq,
          points,
        }),
      ),
      karts:
        // Physics values are rounded well below a visible pixel, which
        // roughly halves snapshot size for hosts with slower upload.
        this.sim?.karts.map((k) => ({
          id: k.id,
          x: round(k.body.position.x, 100),
          y: round(k.body.position.y, 100),
          vx: round(k.body.velocity.x, 1000),
          vy: round(k.body.velocity.y, 1000),
          angle: round(k.body.angle, 10000),
          angular: round(k.body.angularVelocity, 10000),
          grip: round(k.grip, 10000),
          lap: k.lap,
          gates: k.gates,
          nextGate: k.nextGate,
          finish: k.finish,
          lapTimes: k.lapTimes,
          lapStartedAt: k.lapStartedAt,
          resetRemaining: k.resetRemaining,
          respawnGrace: k.respawnGrace,
          draft: k.draft,
          boost: round(k.boost, 1000),
          driftCharge: round(k.driftCharge, 1000),
          driftDir: k.driftDir,
          segment: k.segment,
          input: k.input,
        })) || [],
      order:
        this.sim?.positions().map((k) => k.id) ||
        this.members.map((m) => m.kart),
    };
  }
  broadcast() {
    const state = this.snapshot();
    for (const m of this.members) if (m.connected) m.send(state);
  }
  destroy() {
    this.sim?.destroy();
  }
}
