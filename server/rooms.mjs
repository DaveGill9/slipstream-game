import { randomBytes } from "node:crypto";
import Matter from "matter-js";
import { Simulation } from "../src/simulation.ts";
import { tracks, defaultTrack } from "../src/track.ts";
const idle = () => ({ throttle: 0, steer: 0, drift: false });
const round = (value, scale) => Math.round(value * scale) / scale;
export class Room {
  constructor(code) {
    this.code = code;
    this.members = [];
    this.phase = "lobby";
    this.track = defaultTrack.id;
    this.hostId = "";
    this.sim = null;
    this.countdown = 0;
    this.raceId = 0;
    this.endAt = Infinity;
    this.age = 0;
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
    if (this.members.length >= 8) throw Error("Room is full (8 racers).");
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
  }
  message(m, data) {
    if (data.type === "ready" && this.phase === "lobby") {
      m.ready = !!data.ready;
      this.broadcast();
    } else if (data.type === "track") {
      if (m.id !== this.hostId)
        throw Error("Only the room host picks the track.");
      if (this.phase !== "lobby" || !Object.hasOwn(tracks, data.track)) return;
      this.track = data.track;
      this.broadcast();
    } else if (data.type === "start") {
      if (m.id !== this.hostId) throw Error("Only the room host can start.");
      if (
        this.phase !== "lobby" ||
        this.members.length < 2 ||
        !this.members.every((p) => p.ready && p.connected)
      )
        throw Error("At least two racers must be connected and ready.");
      this.sim?.destroy();
      this.sim = new Simulation(
        this.members.length,
        new Set(this.members.map((_, i) => i)),
        tracks[this.track],
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
      this.broadcast();
    } else if (data.type === "rematch") {
      if (m.id !== this.hostId || this.phase !== "podium")
        throw Error("Only the host can return this room to the lobby.");
      this.phase = "lobby";
      this.members = this.members.filter((p) => p.connected);
      this.members.forEach((p, i) => {
        p.ready = false;
        p.dnf = false;
        p.kart = i;
      });
      this.sim?.destroy();
      this.sim = null;
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
        this.sim.time >= 600
      ) {
        for (const m of this.members)
          if (!this.sim.karts[m.kart].finish) m.dnf = true;
        this.phase = "podium";
        this.broadcast();
      }
    }
  }
  snapshot() {
    return {
      type: "state",
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      track: this.track,
      countdown: this.countdown,
      raceId: this.raceId,
      time: this.sim?.time || 0,
      finishRemaining: Number.isFinite(this.endAt)
        ? Math.max(0, this.endAt - (this.sim?.time || 0))
        : null,
      members: this.members.map(
        ({ id, name, kart, ready, connected, dnf, seq }) => ({
          id,
          name,
          kart,
          ready,
          connected,
          dnf,
          seq,
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
