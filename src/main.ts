import Phaser from "phaser";
import Matter from "matter-js";
import { OnlineClient, RoomPanel, type RoomState } from "./network";
const defaultHandling = { ...tuning };
import { readRecords, improveRecord, recordKey, formatTime } from "./records";
import { Simulation, tuning } from "./simulation";
import {
  WORLD,
  ROAD,
  points,
  offset,
  nearest,
  START,
  gridPosition,
  wallVertices,
  grandstands,
} from "./track";
const colors = [
  0xffd35a, 0x70bfff, 0xe97262, 0x91c876, 0xb38cde, 0xe7eee2, 0xec91b4,
  0x64d7c4,
];
const names = [
  "YOU",
  "BLUE",
  "EMBER",
  "MOSS",
  "VIOLET",
  "GHOST",
  "ROSE",
  "MINT",
];
const pixelScale = () =>
  Math.max(1, Math.floor(Math.min(innerWidth / 640, innerHeight / 360)));
class Race extends Phaser.Scene {
  sim!: Simulation;
  sprites: Phaser.GameObjects.Image[] = [];
  marks!: Phaser.GameObjects.RenderTexture;
  effects!: Phaser.GameObjects.Graphics;
  hud!: Phaser.GameObjects.Container;
  panel?: Phaser.GameObjects.Container;
  debug?: Phaser.GameObjects.Container;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  state: "garage" | "countdown" | "race" | "pause" | "results" | "lobby" =
    "garage";
  online?: OnlineClient;
  roomPanel?: RoomPanel;
  roomState?: RoomState;
  playerId = 0;
  networkRaceId = -1;
  sendElapsed = 0;
  pendingReset = false;
  networkMessage = "";
  networkText!: Phaser.GameObjects.Text;
  kartLabels: Phaser.GameObjects.Text[] = [];
  accumulator = 0;
  countdown = 0;
  hudText!: Phaser.GameObjects.Text;
  speedText!: Phaser.GameObjects.Text;
  countText!: Phaser.GameObjects.Text;
  map!: Phaser.GameObjects.Graphics;
  debugOn = false;
  timingText!: Phaser.GameObjects.Text;
  trails!: Phaser.GameObjects.Graphics;
  records: { lap: number | null; race: number | null } = {
    lap: null,
    race: null,
  };
  recordedLaps = 0;
  tunedSession = false;
  lapNotice = "";
  lapNoticeUntil = 0;
  constructor() {
    super("Race");
  }
  create() {
    try {
      this.records = readRecords(localStorage);
    } catch {
      /* Storage may be disabled. */
    }
    this.makeTrack();
    this.add.image(0, 0, "track").setOrigin(0);
    this.marks = this.add
      .renderTexture(0, 0, WORLD.width, WORLD.height)
      .setOrigin(0);
    this.effects = this.add.graphics();
    this.trails = this.add.graphics().setDepth(4);
    this.makeKarts();
    this.sim = new Simulation();
    this.sprites = this.sim.karts.map((k) =>
      this.add
        .image(k.body.position.x, k.body.position.y, `kart-${k.id}`)
        .setDepth(5),
    );
    this.kartLabels = this.sprites.map(() =>
      this.label(0, 0, "", 9).setOrigin(0.5).setDepth(6),
    );
    this.cameras.main
      .setBounds(0, 0, WORLD.width, WORLD.height)
      .setRoundPixels(true);
    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,R,ESC,ENTER,F2,M",
    ) as typeof this.keys;
    this.input.keyboard!.addCapture(["SPACE", "UP", "DOWN", "LEFT", "RIGHT"]);
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(30);
    this.scale.on("resize", () => this.layout());
    this.layout();
    this.garage();
    if (
      new URLSearchParams(location.search).has("room") ||
      new URLSearchParams(location.search).has("server")
    )
      this.openOnline();
    this.game.events.on("blur", () => {
      if (this.state === "race" || this.state === "countdown") this.pause();
    });
  }
  label(x: number, y: number, text: string, size = 12, color = "#edf0da") {
    return this.add.text(x, y, text, {
      fontFamily: "monospace",
      fontSize: size,
      color,
      fontStyle: "bold",
      lineSpacing: 6,
    });
  }
  makeTrack() {
    const tex = this.textures.createCanvas("track", WORLD.width, WORLD.height)!;
    const c = tex.context;
    let seed = 73;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    c.fillStyle = "#6e834c";
    c.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 47000; i++) {
      c.fillStyle = ["#748952", "#677e46", "#7a8d55"][i % 3];
      c.fillRect(
        Math.floor(random() * WORLD.width),
        Math.floor(random() * WORLD.height),
        2,
        2,
      );
    }
    const path = () => {
      c.beginPath();
      points.forEach((p, i) =>
        i ? c.lineTo(Math.round(p.x), Math.round(p.y)) : c.moveTo(p.x, p.y),
      );
      c.closePath();
    };
    c.lineJoin = "round";
    path();
    c.strokeStyle = "#a89b75";
    c.lineWidth = ROAD + 38;
    c.stroke();
    path();
    c.strokeStyle = "#e7e4ca";
    c.lineWidth = ROAD + 16;
    c.stroke();
    for (let side of [-1, 1])
      for (let i = 0; i < points.length; i++) {
        const a = offset(i, side * (ROAD / 2 + 4)),
          b = offset((i + 1) % points.length, side * (ROAD / 2 + 4));
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.strokeStyle = Math.floor(i / 2) % 2 ? "#dfded0" : "#bd4c42";
        c.lineWidth = 9;
        c.stroke();
      }
    path();
    c.strokeStyle = "#444c4c";
    c.lineWidth = ROAD;
    c.stroke();
    path();
    c.strokeStyle = "#939887";
    c.lineWidth = 1;
    c.setLineDash([12, 22]);
    c.stroke();
    c.setLineDash([]);
    for (let i = 0; i < 26000; i++) {
      const p = { x: random() * WORLD.width, y: random() * WORLD.height };
      if (nearest(p).distance < ROAD / 2 - 3) {
        c.fillStyle = i % 2 ? "#4b5251" : "#3f4747";
        c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < points.length; i++) {
        const vertices = wallVertices(i, side);
        c.beginPath();
        vertices.forEach((p, j) =>
          j ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y),
        );
        c.closePath();
        c.fillStyle = "#a9b5a5";
        c.fill();
      }
      c.beginPath();
      points.forEach((_, i) => {
        const p = offset(i, side * (ROAD / 2 + 22));
        i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y);
      });
      c.closePath();
      c.lineWidth = 2;
      c.strokeStyle = "#40574e";
      c.stroke();
    }
    // Chequered timing line and grid boxes, painted on the southern straight.
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 16; y++) {
        c.fillStyle = (x + y) % 2 ? "#e9e8d4" : "#243634";
        c.fillRect(START.x + x * 5, START.y - 64 + y * 8, 5, 8);
      }
    for (let i = 0; i < 8; i++) {
      const { x, y } = gridPosition(i);
      c.strokeStyle = "#a3a797";
      c.lineWidth = 1;
      c.strokeRect(x - 15, y - 10, 26, 20);
    }
    for (let i = 0; i < 230; i++) {
      const p = {
        x: 40 + random() * (WORLD.width - 80),
        y: 40 + random() * (WORLD.height - 80),
      };
      if (nearest(p).distance < 125) continue;
      c.fillStyle = "#526a3b";
      c.fillRect(p.x - 6, p.y - 3, 14, 11);
      c.fillRect(p.x - 3, p.y - 6, 9, 17);
      c.fillStyle = "#82964f";
      c.fillRect(p.x - 4, p.y - 4, 8, 8);
      c.fillStyle = "#9aab64";
      c.fillRect(p.x - 2, p.y - 3, 3, 3);
    }
    // Grandstands seen directly from above.
    for (const { x, y, width: w, height: h } of grandstands) {
      c.fillStyle = "#263d38";
      c.fillRect(x + 5, y + 6, w, h);
      c.fillStyle = "#b9bba5";
      c.fillRect(x, y, w, h);
      for (let row = 0; row < 4; row++) {
        c.fillStyle = row % 2 ? "#6a8982" : "#54716c";
        c.fillRect(x + 7, y + 7 + row * 12, w - 14, 8);
      }
    }
    c.fillStyle = "#d0b963";
    c.fillRect(780, 1195, 255, 30);
    c.fillStyle = "#293e35";
    c.font = "bold 18px monospace";
    c.fillText("FOUNDRY CIRCUIT", 794, 1217);
    tex.refresh();
  }
  makeKarts() {
    for (let i = 0; i < 8; i++) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x1c2b29, 0.5);
      g.fillRect(3, 5, 22, 15);
      g.fillStyle(0x172b2c);
      g.fillRect(5, 3, 5, 5);
      g.fillRect(5, 16, 5, 5);
      g.fillRect(19, 3, 4, 5);
      g.fillRect(19, 16, 4, 5);
      g.fillStyle(0x9bafa2);
      g.fillRect(7, 7, 2, 10);
      g.fillRect(20, 7, 2, 10);
      g.fillStyle(colors[i]);
      g.fillRect(3, 8, 21, 8);
      g.fillRect(19, 6, 4, 12);
      g.fillRect(2, 6, 3, 12);
      g.fillStyle(0xf1e8c7);
      g.fillRect(16, 9, 6, 5);
      g.fillStyle(0x263a3d);
      g.fillRect(8, 8, 7, 8);
      g.fillStyle(colors[i]);
      g.fillRect(9, 9, 5, 6);
      g.fillStyle(0xf5edda);
      g.fillRect(11, 9, 4, 5);
      g.fillStyle(0x30494c);
      g.fillRect(14, 10, 2, 3);
      g.generateTexture(`kart-${i}`, 28, 24);
      g.destroy();
    }
  }
  layout() {
    this.hud.removeAll(true);
    const w = this.scale.width,
      h = this.scale.height;
    const g = this.add.graphics().fillStyle(0x203630, 0.95);
    g.fillRect(12, 12, 186, 46);
    g.fillRect(w - 136, 12, 124, 46);
    g.lineStyle(1, 0x83937a)
      .strokeRect(12, 12, 186, 46)
      .strokeRect(w - 136, 12, 124, 46);
    this.hud.add(g);
    this.hudText = this.label(23, 21, "FOUNDRY / PRACTICE", 11);
    this.speedText = this.label(w - 125, 21, "000 KM/H", 12);
    this.hud.add([this.hudText, this.speedText]);
    g.fillRect(12, 64, 186, 58);
    this.timingText = this.label(23, 72, "", 10);
    this.hud.add(this.timingText);
    this.hud.add(this.label(16, h - 22, "ESC  PIT MENU", 10, "#ecedce"));
    this.countText = this.label(w / 2, h / 2 - 38, "", 52).setOrigin(0.5);
    this.hud.add(this.countText);
    this.networkText = this.label(w / 2, h - 41, "", 10, "#f0d278").setOrigin(
      0.5,
    );
    this.hud.add(this.networkText);
    this.map = this.add.graphics();
    this.hud.add(this.map);
    if (this.state === "garage") this.garage();
    if (this.state === "pause") this.showPause();
    if (this.state === "results") this.results();
    if (this.debugOn) this.showDebug();
  }
  board(title: string, subtitle: string, height = 278) {
    this.panel?.destroy();
    const w = Math.min(414, this.scale.width - 24),
      h = height,
      x = Math.round((this.scale.width - w) / 2),
      y = Math.round((this.scale.height - h) / 2);
    const p = this.add.container(x, y).setScrollFactor(0).setDepth(50);
    const g = this.add.graphics();
    g.fillStyle(0x122d29, 0.5).fillRect(
      -this.scale.width,
      -this.scale.height,
      this.scale.width * 3,
      this.scale.height * 3,
    );
    g.fillStyle(0x172f2b).fillRect(5, 6, w, h);
    g.fillStyle(0xc5bea0).fillRect(0, 0, w, h);
    g.fillStyle(0x263e35).fillRect(5, 5, w - 10, h - 10);
    g.fillStyle(0xe3c66a).fillRect(5, 5, w - 10, 4);
    for (const sx of [11, w - 14])
      for (const sy of [14, h - 15])
        g.fillStyle(0x8f947d).fillRect(sx, sy, 3, 3);
    p.add(g);
    p.add(this.label(24, 25, title, 28, "#f0d278"));
    p.add(this.label(25, 64, subtitle, 10, "#aebb9d"));
    this.panel = p;
    return p;
  }
  button(
    p: Phaser.GameObjects.Container,
    y: number,
    text: string,
    action: () => void,
    primary = false,
  ) {
    const width = Math.min(366, this.scale.width - 72);
    const g = this.add
      .graphics()
      .fillStyle(primary ? 0xe3c66a : 0x365346)
      .fillRect(24, y, width, 30);
    const t = this.label(36, y + 8, text, 12, primary ? "#233d32" : "#e8e9cf");
    const zone = this.add
      .zone(24, y, width, 30)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", action);
    zone
      .on("pointerover", () => t.setAlpha(0.65))
      .on("pointerout", () => t.setAlpha(1));
    p.add([g, t, zone]);
  }
  garage() {
    this.state = "garage";
    const p = this.board(
      "SLIPSTREAM",
      "FOUNDRY CIRCUIT     /     LOCAL PROTOTYPE 01",
    );
    p.add(this.label(25, 94, "8 KARTS. 3 LAPS. FIND YOUR LINE.", 12));
    this.button(
      p,
      123,
      "SOLO PRACTICE                      ENTER",
      () => this.start(),
      true,
    );
    this.button(p, 161, "RACE WITH FRIENDS                      M", () =>
      this.openOnline(),
    );
    this.button(p, 199, "PIT SETUP", () => this.settings());
    p.add(
      this.label(
        25,
        246,
        "NORTH UP  /  KEYBOARD  /  F2 ENGINEERING",
        9,
        "#9eae92",
      ),
    );
  }
  tutorial() {
    const p = this.board("DRIVING SCHOOL", "PIT BOARD   /   THE QUICK BRIEF");
    p.add(
      this.label(
        25,
        94,
        "W / ↑       ACCELERATE\nS / ↓       BRAKE / REVERSE\nA D / ← →   STEER\nSPACE       HOLD TO SLIDE; RELEASE TO GRIP\nR           RESET: 1.5s HOLD + SETBACK\nESC         PAUSE / PIT MENU\nDRAFT       FOLLOW CLOSE FOR +20% POWER",
        11,
      ),
    );
    this.button(p, 231, "GOT IT — START RACE", () => this.start(), true);
  }
  settings() {
    const p = this.board(
      "PIT SETUP",
      "LOCAL SESSION   /   SEVEN COMPUTER DRIVERS",
    );
    p.add(
      this.label(
        25,
        100,
        "RACE DISTANCE       3 LAPS\nCAMERA              NORTH UP / FOLLOW\nASSISTS             BOT AUTO-RECOVERY\nENGINEERING         F2 WHILE DRIVING",
        11,
      ),
    );
    this.button(p, 192, "DRIVING SCHOOL", () => this.tutorial());
    this.button(p, 230, "BACK TO GARAGE", () => this.garage(), true);
  }
  start() {
    if (this.online) return;
    this.playerId = 0;
    this.sprites.forEach((s) => s.setVisible(true));
    this.sim.destroy();
    this.sim = new Simulation();
    this.marks.clear();
    this.recordedLaps = 0;
    this.lapNotice = "";
    this.lapNoticeUntil = 0;
    this.panel?.destroy();
    this.panel = undefined;
    this.state = "countdown";
    this.countdown = 3.6;
    const p = this.sim.karts[0].body.position;
    this.cameras.main.centerOn(p.x, p.y);
    this.accumulator = 0;
  }
  pause() {
    this.state = "pause";
    this.showPause();
  }
  showPause() {
    if (this.online) {
      this.online.input({ throttle: 0, steer: 0, drift: false });
      const p = this.board(
        "PIT MENU",
        "ONLINE RACE CONTINUES WHILE THIS MENU IS OPEN",
      );
      this.button(p, 110, "BACK ON TRACK", () => this.resume(), true);
      this.button(p, 160, "LEAVE ROOM", () => this.leaveOnline());
      p.add(
        this.label(25, 215, "WASD / ARROWS  ·  SPACE DRIFT  ·  R RESET", 10),
      );
      return;
    }
    const p = this.board("IN THE PITS", "SESSION PAUSED");
    this.button(
      p,
      100,
      "BACK ON TRACK                        ESC",
      () => this.resume(),
      true,
    );
    this.button(p, 138, "RESTART RACE", () => this.start());
    this.button(p, 176, "CONTROLS", () => {
      this.tutorial();
      if (this.panel)
        this.button(
          this.panel,
          231,
          "RETURN TO PAUSED RACE",
          () => this.showPause(),
          true,
        );
    });
    this.button(p, 214, "GARAGE", () => this.garage());
  }
  resume() {
    this.panel?.destroy();
    this.panel = undefined;
    this.state = this.countdown > 0 ? "countdown" : "race";
    this.accumulator = 0;
  }
  results() {
    this.state = "results";
    const p = this.board(
      "RACE PODIUM",
      this.online
        ? "FOUNDRY CIRCUIT / ROOM " + this.online.code
        : "FOUNDRY CIRCUIT / SOLO PRACTICE",
      348,
    );
    const order = this.online
      ? this.roomState!.order.map((id) => this.sim.karts[id])
      : this.sim.positions();
    const finishers = order.filter((k) => k.finish > 0);
    const name = (id: number) =>
      this.online
        ? this.roomState?.members.find((m) => m.kart === id)?.name || "Racer"
        : names[id];
    const g = this.add.graphics();
    p.add(g);
    for (const [rank, x, h] of [
      [1, 29, 45],
      [0, 151, 66],
      [2, 273, 32],
    ]) {
      const kart = finishers[rank];
      g.fillStyle([0xd6b655, 0xa8b4ad, 0xaf805a][rank]).fillRect(
        x,
        201 - h,
        110,
        h,
      );
      p.add(
        this.label(x + 55, 205 - h, String(rank + 1), 22, "#233d32").setOrigin(
          0.5,
          0,
        ),
      );
      if (kart) {
        p.add(this.add.image(x + 55, 189 - h, `kart-${kart.id}`).setScale(1));
        p.add(this.label(x + 55, 169 - h, name(kart.id), 10).setOrigin(0.5, 0));
        p.add(
          this.label(
            x + 55,
            185,
            formatTime(kart.finish),
            9,
            "#233d32",
          ).setOrigin(0.5, 0),
        );
      } else p.add(this.label(x + 55, 143 - h, "—", 14).setOrigin(0.5, 0));
    }
    order.forEach((k, i) => {
      const x = 25 + (i >= 4 ? 187 : 0),
        y = 216 + (i % 4) * 17;
      p.add(
        this.label(
          x,
          y,
          `${i + 1} ${name(k.id).slice(0, 10).padEnd(10)} ${k.finish ? formatTime(k.finish) : this.online ? "DNF" : "RACING"}`,
          9,
          k.id === this.playerId ? "#f0d278" : "#edf0da",
        ),
      );
    });
    if (this.online) {
      if (this.roomState?.hostId === this.online.id)
        this.button(
          p,
          300,
          "BACK TO LOBBY / RACE AGAIN",
          () => this.online?.send({ type: "rematch" }),
          true,
        );
      else this.button(p, 300, "LEAVE ROOM", () => this.leaveOnline(), true);
    } else
      this.button(
        p,
        300,
        "RACE AGAIN                         ENTER",
        () => this.start(),
        true,
      );
  }
  openOnline() {
    Object.assign(tuning, defaultHandling);
    this.debugOn = false;
    this.debug?.destroy();
    this.panel?.destroy();
    this.panel = undefined;
    this.state = "lobby";
    this.networkRaceId = -1;
    this.input.keyboard!.enabled = false;
    this.online = new OnlineClient(
      (state) => this.receiveRoom(state),
      (message) => {
        this.networkMessage = message;
        if (this.roomPanel) this.roomPanel.status.textContent = message;
      },
    );
    this.roomPanel = new RoomPanel(this.online, () => this.leaveOnline());
    this.roomPanel.setup();
  }
  leaveOnline() {
    this.online?.close();
    this.online = undefined;
    this.roomState = undefined;
    this.roomPanel?.destroy();
    this.roomPanel = undefined;
    this.playerId = 0;
    this.sim.destroy();
    this.sim = new Simulation();
    this.sprites.forEach((s) => s.setVisible(true));
    this.kartLabels.forEach((t) => t.setVisible(false));
    this.input.keyboard!.enabled = true;
    this.networkMessage = "";
    this.garage();
  }
  receiveRoom(state: RoomState) {
    if (!this.online) return;
    this.roomState = state;
    const me = state.members.find((m) => m.id === this.online!.id);
    if (!me) return;
    if (state.phase === "lobby") {
      this.state = "lobby";
      this.panel?.destroy();
      this.panel = undefined;
      this.input.keyboard!.enabled = false;
      this.roomPanel?.lobby(state);
      return;
    }
    this.roomPanel?.hide();
    this.input.keyboard!.enabled = true;
    this.playerId = me.kart;
    if (this.networkRaceId !== state.raceId) {
      this.sim.destroy();
      this.sim = new Simulation(
        state.karts.length,
        new Set(state.karts.map((k) => k.id)),
      );
      this.networkRaceId = state.raceId;
      this.accumulator = 0;
      this.marks.clear();
      this.panel?.destroy();
      this.panel = undefined;
      this.sprites.forEach((sprite, i) =>
        sprite.setVisible(i < state.karts.length),
      );
      this.kartLabels.forEach((label, i) =>
        label.setVisible(i < state.karts.length),
      );
      const p = state.karts[this.playerId];
      this.cameras.main.centerOn(p.x, p.y);
      this.state = "countdown";
    }
    this.sim.time = state.time;
    this.countdown = state.countdown;
    for (const remote of state.karts) {
      const k = this.sim.karts[remote.id];
      Matter.Body.setStatic(k.body, remote.resetRemaining > 0);
      Matter.Body.setPosition(k.body, { x: remote.x, y: remote.y });
      Matter.Body.setVelocity(k.body, { x: remote.vx, y: remote.vy });
      Matter.Body.setAngle(k.body, remote.angle);
      Matter.Body.setAngularVelocity(k.body, remote.angular);
      k.previousPosition = { x: remote.x, y: remote.y };
      for (const key of [
        "grip",
        "lap",
        "gates",
        "nextGate",
        "finish",
        "lapStartedAt",
        "resetRemaining",
        "respawnGrace",
        "draft",
      ] as const)
        k[key] = remote[key];
      k.lapTimes = [...remote.lapTimes];
      k.input = { ...remote.input };
      const member = state.members.find((m) => m.kart === k.id);
      k.body.isSensor =
        remote.resetRemaining > 0 ||
        !!remote.finish ||
        !member?.connected ||
        !!member?.dnf;
    }
    if (state.phase === "podium") {
      if (this.state !== "results") this.results();
    } else if (this.state !== "pause")
      this.state = state.phase === "countdown" ? "countdown" : "race";
  }
  showDebug() {
    this.debug?.destroy();
    if (!this.debugOn) return;
    const p = this.add.container(12, 130).setScrollFactor(0).setDepth(60);
    this.debug = p;
    const g = this.add
      .graphics()
      .fillStyle(0x162c28, 0.96)
      .fillRect(0, 0, 285, 260);
    p.add(g);
    p.add(this.label(10, 10, "ENGINEERING  /  CLICK − OR +", 11, "#f0d278"));
    const steps = {
      acceleration: 0.00005,
      topSpeed: 0.25,
      braking: 0.0001,
      steering: 0.004,
      grip: 0.02,
      driftGrip: 0.005,
      recovery: 0.005,
      bounce: 0.05,
      angularDamping: 0.05,
    };
    Object.entries(tuning).forEach(([key, value], i) => {
      p.add(
        this.label(
          10,
          35 + i * 23,
          `${key.padEnd(15)} ${value.toFixed(value < 0.01 ? 5 : 3)}`,
          10,
        ),
      );
      for (const [x, sign] of [
        [241, -1],
        [265, 1],
      ]) {
        const t = this.label(
          x,
          32 + i * 23,
          sign < 0 ? "−" : "+",
          16,
        ).setInteractive({ useHandCursor: true });
        t.on("pointerdown", () => {
          const k = key as keyof typeof tuning;
          this.tunedSession = true;
          tuning[k] = Math.max(0.00001, tuning[k] + sign * steps[k]);
          this.showDebug();
        });
        p.add(t);
      }
    });
  }
  update(_time: number, delta: number) {
    if (!this.sim) return;
    const pressed = (k: string) => Phaser.Input.Keyboard.JustDown(this.keys[k]);
    if (
      pressed("ENTER") &&
      !this.online &&
      (this.state === "garage" || this.state === "results")
    )
      this.start();
    if (pressed("M") && this.state === "garage") this.openOnline();
    if (pressed("ESC")) {
      if (this.state === "race" || this.state === "countdown") this.pause();
      else if (this.state === "pause") this.resume();
    }
    if (pressed("F2") && !this.online) {
      this.debugOn = !this.debugOn;
      this.showDebug();
    }
    if (pressed("R") && this.state === "race") {
      if (this.online) this.pendingReset = true;
      else this.sim.resetKart(this.sim.karts[0]);
    }
    if (this.state === "countdown") {
      if (!this.online) this.countdown -= Math.min(delta, 100) / 1000;
      this.countText.setText(
        this.online
          ? String(Math.max(1, Math.ceil(this.countdown)))
          : this.countdown > 0.6
            ? String(Math.ceil(this.countdown - 0.6))
            : "GO!",
      );
      if (this.countdown <= 0) {
        this.state = "race";
        this.countText.setText("");
      }
    } else this.countText.setText("");
    if (this.state === "race") {
      this.accumulator += Math.min(delta, 100);
      const down = (...ks: string[]) => ks.some((k) => this.keys[k].isDown);
      const input = {
        throttle: down("W", "UP") ? 1 : down("S", "DOWN") ? -0.65 : 0,
        steer: (down("D", "RIGHT") ? 1 : 0) - (down("A", "LEFT") ? 1 : 0),
        drift: down("SPACE"),
      };
      if (this.online) {
        this.sendElapsed += delta;
        if (this.sendElapsed >= 33 || this.pendingReset) {
          this.online.input(input, this.pendingReset);
          this.pendingReset = false;
          this.sendElapsed = 0;
        }
      }
      while (this.accumulator >= 1000 / 60) {
        if (this.online) {
          const inputs = new Map(
            this.sim.karts.map((k) => [
              k.id,
              k.id === this.playerId ? input : k.input,
            ]),
          );
          if (this.online.connected && !this.sim.karts[this.playerId].finish)
            this.sim.step(input, inputs);
        } else this.sim.step(input);
        this.accumulator -= 1000 / 60;
      }
      const kart = this.sim.karts[this.playerId];
      if (!this.online && kart.lapTimes.length > this.recordedLaps) {
        const last = kart.lapTimes.at(-1)!;
        const pb =
          !this.tunedSession &&
          (this.records.lap === null || last < this.records.lap);
        this.lapNotice = `${pb ? "PERSONAL BEST" : "LAP " + kart.lap}  ${formatTime(last)}`;
        this.lapNoticeUntil = this.sim.time + 4;
        this.recordedLaps = kart.lapTimes.length;
        if (!this.tunedSession) {
          this.records.lap = improveRecord(this.records.lap, last);
          if (kart.finish)
            this.records.race = improveRecord(this.records.race, kart.finish);
          try {
            localStorage.setItem(recordKey, JSON.stringify(this.records));
          } catch {
            /* Race remains playable. */
          }
        }
      }
      if (kart.finish && !this.online) this.results();
    }
    if (this.online && this.state === "pause") {
      this.sendElapsed += delta;
      if (this.sendElapsed > 100) {
        this.online.input({ throttle: 0, steer: 0, drift: false });
        this.sendElapsed = 0;
      }
    }
    const player = this.sim.karts[this.playerId] || this.sim.karts[0],
      b = player.body;
    this.effects.clear();
    this.trails.clear();
    for (const k of this.sim.karts) {
      const s = this.sprites[k.id];
      const snap =
        !this.online ||
        Math.hypot(s.x - k.body.position.x, s.y - k.body.position.y) > 120;
      const alpha = 1 - Math.exp(-Math.min(delta, 100) / 30);
      s.setPosition(
        Math.round(
          snap
            ? k.body.position.x
            : Phaser.Math.Linear(s.x, k.body.position.x, alpha),
        ),
        Math.round(
          snap
            ? k.body.position.y
            : Phaser.Math.Linear(s.y, k.body.position.y, alpha),
        ),
      ).setRotation(k.body.angle);
      const member = this.roomState?.members.find((m) => m.kart === k.id);
      this.kartLabels[k.id]
        .setVisible(!!this.online && !!member)
        .setPosition(s.x, s.y - 21)
        .setText(
          member
            ? `${member.name}${k.id === this.playerId ? " · YOU" : ""}${!member.connected ? " · OFFLINE" : ""}`
            : "",
        );
      const speed = Math.hypot(k.body.velocity.x, k.body.velocity.y);
      if (this.state === "race" && speed > 2.8 && !k.resetRemaining) {
        const fx = Math.cos(k.body.angle),
          fy = Math.sin(k.body.angle);
        const length = Math.min(16, (speed - 2.8) * 5);
        for (const side of [-1, 1]) {
          for (let segment = 0; segment < 3; segment++) {
            const start = 13 + (length * segment) / 3;
            const end = start + length / 3;
            this.trails.lineStyle(
              1,
              k.draft > 0.1 ? 0xf5d982 : 0xd8e5d4,
              (k.draft > 0.1 ? 0.45 : 0.2) * (1 - segment / 3),
            );
            this.trails.beginPath();
            this.trails.moveTo(
              Math.round(k.body.position.x - fx * start - fy * side * 6),
              Math.round(k.body.position.y - fy * start + fx * side * 6),
            );
            this.trails.lineTo(
              Math.round(k.body.position.x - fx * end - fy * side * 6),
              Math.round(k.body.position.y - fy * end + fx * side * 6),
            );
            this.trails.strokePath();
          }
        }
      }
      if (this.state === "race" && k.input.drift && speed > 2) {
        this.effects.fillStyle(0x1c2b2b, 0.24);
        for (const side of [-1, 1]) {
          const x =
              k.body.position.x -
              Math.cos(k.body.angle) * 7 -
              Math.sin(k.body.angle) * side * 6,
            y =
              k.body.position.y -
              Math.sin(k.body.angle) * 7 +
              Math.cos(k.body.angle) * side * 6;
          this.effects.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
        this.marks.draw(this.effects);
        this.effects.clear();
        this.effects.fillStyle(0xdfdfbf, 0.35);
        this.effects.fillRect(
          k.body.position.x - 12 * Math.cos(k.body.angle),
          k.body.position.y - 12 * Math.sin(k.body.angle),
          4,
          4,
        );
      }
    }
    const cam = this.cameras.main;
    const tx =
        b.position.x +
        Phaser.Math.Clamp(
          b.velocity.x * 22,
          -cam.width * 0.25,
          cam.width * 0.25,
        ) -
        cam.width / 2,
      ty =
        b.position.y +
        Phaser.Math.Clamp(
          b.velocity.y * 22,
          -cam.height * 0.25,
          cam.height * 0.25,
        ) -
        cam.height / 2;
    const blend = 1 - Math.exp(-Math.min(delta, 100) / 160);
    cam.setScroll(
      Math.round(Phaser.Math.Linear(cam.scrollX, tx, blend)),
      Math.round(Phaser.Math.Linear(cam.scrollY, ty, blend)),
    );
    if (this.state === "race" && player.resetRemaining > 0) {
      this.countText
        .setFontSize(20)
        .setText(`RESET PENALTY\n${player.resetRemaining.toFixed(1)}s`)
        .setAlign("center");
    } else if (this.state === "race" && this.sim.time < this.lapNoticeUntil) {
      this.countText.setFontSize(16).setText(this.lapNotice);
    } else this.countText.setFontSize(52);
    this.sprites.forEach((sprite, i) =>
      sprite.setAlpha(
        (this.sim.karts[i]?.resetRemaining ?? 0) > 0 ||
          (this.sim.karts[i]?.respawnGrace ?? 0) > 0
          ? 0.45
          : 1,
      ),
    );
    const pos = this.online
      ? (this.roomState?.order.indexOf(this.playerId) ?? 0) + 1
      : this.sim.positions().findIndex((k) => k.id === 0) + 1;
    this.networkText.setText(
      this.online
        ? this.networkMessage ||
            (player.finish
              ? "FINISHED — WAITING FOR THE PODIUM"
              : `ROOM ${this.online.code}  /  ${this.online.latency}ms${this.roomState?.finishRemaining !== null && this.roomState?.finishRemaining !== undefined ? "  /  FINISH IN " + Math.ceil(this.roomState.finishRemaining) + "s" : ""}`)
        : "",
    );
    this.hudText.setText(
      `P${pos} / ${this.sim.karts.length}     LAP ${Math.min(3, player.lap + 1)} / 3\n${this.sim.time.toFixed(1).padStart(5, "0")}   FOUNDRY CIRCUIT`,
    );
    this.timingText.setText(
      `LAP  ${formatTime(player.finish ? player.lapTimes.at(-1)! : this.sim.time - player.lapStartedAt)}\nLAST ${formatTime(player.lapTimes.at(-1) ?? null)}\nPB   ${formatTime(this.records.lap)}${this.tunedSession ? " *" : ""}`,
    );
    this.speedText.setColor(player.draft > 0.1 ? "#f5d982" : "#edf0da");
    this.speedText.setText(
      `${String(Math.round(Math.hypot(b.velocity.x, b.velocity.y) * 13)).padStart(3, "0")} KM/H\n${player.draft > 0.1 ? "DRAFT +" + Math.round(player.draft * 20) + "%" : player.input.drift ? "DRIFT" : "SLIPSTREAM"}`,
    );
    const mx = this.scale.width - 124,
      my = this.scale.height - 88,
      scale = 0.043;
    this.map
      .clear()
      .fillStyle(0x203630, 0.85)
      .fillRect(mx - 8, my - 8, 120, 80)
      .lineStyle(5, 0x7b8c78);
    this.map.beginPath();
    points.forEach((p, i) =>
      i
        ? this.map.lineTo(mx + p.x * scale, my + p.y * scale)
        : this.map.moveTo(mx + p.x * scale, my + p.y * scale),
    );
    this.map.closePath().strokePath();
    for (const k of this.sim.karts)
      this.map
        .fillStyle(colors[k.id])
        .fillRect(
          mx + k.body.position.x * scale - 1,
          my + k.body.position.y * scale - 1,
          k.id !== this.playerId ? 2 : 4,
          k.id !== this.playerId ? 2 : 4,
        );
  }
}
const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "game",
  width: Math.ceil(innerWidth / pixelScale()),
  height: Math.ceil(innerHeight / pixelScale()),
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#6e834c",
  scene: Race,
  audio: { noAudio: true },
});
function resize() {
  const s = pixelScale();
  game.scale.resize(Math.ceil(innerWidth / s), Math.ceil(innerHeight / s));
  game.canvas.style.width = `${Math.ceil(innerWidth / s) * s}px`;
  game.canvas.style.height = `${Math.ceil(innerHeight / s) * s}px`;
}
game.canvas.style.outline = "none";
game.canvas.tabIndex = 0;
game.canvas.setAttribute(
  "aria-label",
  "Slipstream racing game. Press Enter to start; WASD to drive, Space to drift, Escape to pause.",
);
game.canvas.addEventListener("pointerdown", () => game.canvas.focus());
game.events.once("ready", resize);
window.addEventListener("resize", resize);
resize();
