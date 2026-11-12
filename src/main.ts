import Phaser from "phaser";
import Matter from "matter-js";
import { OnlineClient, RoomPanel, type RoomState } from "./network";
import { GameAudio } from "./audio";
import { Menu } from "./menu";
const defaultHandling = { ...tuning };
const audio = new GameAudio();
const menu = new Menu();
// Phaser listens for keys on the whole window and blocks the browser's
// default for driving keys (WASD, arrows, Space...), even while the game is
// paused. That made those letters impossible to type into the lobby's name
// and address boxes. Key presses inside a form field stop here instead, so
// they type normally and never reach the game. Escape still gets through.
for (const type of ["keydown", "keyup"] as const)
  document.addEventListener(type, (event) => {
    const field = event.target as HTMLElement;
    if (
      event.key !== "Escape" &&
      field.matches?.("input, textarea, select, [contenteditable]")
    )
      event.stopPropagation();
  });
// Every HTML menu and lobby button gets the same click sound.
document.addEventListener("click", (event) => {
  if ((event.target as Element).closest?.(".room-board button")) audio.click();
});
import { readRecords, improveRecord, recordKey, formatTime } from "./records";
import {
  Simulation,
  tuning,
  LAPS,
  driftLevel,
  type Input,
  type Kart,
} from "./simulation";
import {
  tracks,
  trackIds,
  defaultTrack,
  LAYER,
  PAD,
  type Track,
} from "./track";
type Pad = Track["pads"][number];
/** One painted chevron on a boost pad, `along` px from the pad's centre. */
function chevron(pad: Pad, along: number) {
  const c = Math.cos(pad.angle),
    s = Math.sin(pad.angle);
  return [
    [along - 6, -15],
    [along + 1, -15],
    [along + 10, 0],
    [along + 1, 15],
    [along - 6, 15],
    [along + 3, 0],
  ].map(([x, y]) => ({ x: pad.x + x * c - y * s, y: pad.y + x * s + y * c }));
}
const CHEVRONS = [-13, -1, 11];
// Drift spark colours by charge: warming up, small boost, big boost.
const SPARKS = [0xeef2e6, 0x6cc6ff, 0xffa24a];
const soloTrackKey = "slipstream-track";
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
// Online smoothing: how many unacknowledged local steps to replay on each
// server snapshot (20 steps covers ~330 ms of round-trip time), and how
// quickly a correction is blended away.
const MAX_REPLAY_STEPS = 20;
const SMOOTHING_MS = 150;
// Every screen shows the same height of track, so nobody gets a closer or
// wider view than anyone else. The old whole-number zoom jumped between
// steps: a window just under 1440 px tall saw 20% more track than one just
// over it, which made big 4K screens look zoomed in. Wider screens still see
// a little more to the sides, as in most games.
const VIEW_HEIGHT = 432;
const pixelScale = () => Math.max(0.5, innerHeight / VIEW_HEIGHT);
// HTML menus grow with the window too, so they are not tiny on 4K screens.
const menuScale = () => Math.min(2.5, Math.max(1, innerHeight / 1100));
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
  inputLog: { seq: number; input: Input }[] = [];
  smoothing = Array.from({ length: 8 }, () => ({ x: 0, y: 0, a: 0 }));
  podiumHostId = "";
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
  /** Animated shine on the boost pads. */
  padShine!: Phaser.GameObjects.Graphics;
  /** Boost flames and drift sparks: one layer for the ground (and under
   * the bridge), one above the bridge deck for karts driving over it. */
  fx: Phaser.GameObjects.Graphics[] = [];
  lastBoost = 0;
  lastDriftLevel = 0;
  records: { lap: number | null; race: number | null } = {
    lap: null,
    race: null,
  };
  recordedLaps = 0;
  tunedSession = false;
  lapNotice = "";
  lapNoticeUntil = 0;
  // Which HTML menu is showing; Enter and M only act on the main one.
  menuScreen: "" | "main" | "settings" | "pause" = "";
  heardLaps = 0;
  lastCount = "";
  wasCounting = false;
  listeningTo?: Simulation;
  track: Track = defaultTrack;
  // The solo choice; online rooms use whatever the host picked.
  soloTrack: Track = defaultTrack;
  trackImage!: Phaser.GameObjects.Image;
  deck?: Phaser.GameObjects.Image;
  constructor() {
    super("Race");
  }
  create() {
    try {
      this.soloTrack =
        tracks[localStorage.getItem(soloTrackKey) || ""] ?? defaultTrack;
    } catch {
      /* Storage may be disabled. */
    }
    this.effects = this.add.graphics().setDepth(2);
    this.trails = this.add.graphics().setDepth(4);
    this.padShine = this.add.graphics().setDepth(1.5);
    this.fx = [
      this.add.graphics().setDepth(4.5),
      this.add.graphics().setDepth(7.5),
    ];
    this.makeKarts();
    this.setTrack(this.soloTrack, true);
    this.sprites = this.sim.karts.map((k) =>
      this.add
        .image(k.body.position.x, k.body.position.y, `kart-${k.id}`)
        .setDepth(5),
    );
    this.kartLabels = this.sprites.map(() =>
      this.label(0, 0, "", 9).setOrigin(0.5).setDepth(9),
    );
    this.cameras.main.setRoundPixels(true);
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
  /** Switches circuit: scenery, skid-mark layer, camera limits and a fresh
   * grid of karts. */
  setTrack(track: Track, force = false) {
    if (track === this.track && !force) return;
    this.track = track;
    const { WORLD } = track;
    if (!this.textures.exists(`track-${track.id}`)) this.makeTrack();
    this.trackImage ??= this.add.image(0, 0, "__DEFAULT").setOrigin(0);
    this.trackImage.setTexture(`track-${track.id}`);
    this.marks?.destroy();
    this.marks = this.add
      .renderTexture(0, 0, WORLD.width, WORLD.height)
      .setOrigin(0)
      .setDepth(1);
    this.deck?.destroy();
    this.deck = undefined;
    if (track.bridge)
      this.deck = this.add
        .image(track.bridge.x, track.bridge.y, `deck-${track.id}`)
        .setDepth(7);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.sim?.destroy();
    this.sim = new Simulation(8, new Set([0]), track);
    const grid = track.gridPosition(0);
    this.cameras.main.centerOn(grid.x, grid.y);
    try {
      this.records = readRecords(localStorage, track.id);
    } catch {
      this.records = { lap: null, race: null };
    }
  }
  /** The stretch of road on top of the bridge, drawn on any canvas. */
  paintDeck(c: CanvasRenderingContext2D, half: number) {
    const { ROAD, atDistance, bridge } = this.track;
    if (!bridge) return;
    const stroke = (width: number, colour: string, dash: number[] = []) => {
      c.beginPath();
      for (let d = -half; d <= half; d += 10) {
        const p = atDistance(bridge.over + d);
        d === -half ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y);
      }
      c.lineCap = "butt";
      c.lineWidth = width;
      c.strokeStyle = colour;
      c.setLineDash(dash);
      c.stroke();
      c.setLineDash([]);
    };
    stroke(ROAD + 64, "#40574e");
    stroke(ROAD + 60, "#a9b5a5");
    stroke(ROAD + 44, "#7d8a80");
    stroke(ROAD + 16, "#e7e4ca");
    stroke(ROAD, "#4a5252");
    stroke(1, "#939887", [12, 22]);
  }
  makeTrack() {
    const {
      WORLD,
      ROAD,
      points,
      offset,
      nearest,
      START,
      gridPosition,
      wallVertices,
      grandstands,
      bridge,
      sign,
      name,
    } = this.track;
    const tex = this.textures.createCanvas(
      `track-${this.track.id}`,
      WORLD.width,
      WORLD.height,
    )!;
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
    if (sign) {
      c.font = "bold 18px monospace";
      c.fillStyle = "#d0b963";
      c.fillRect(sign.x, sign.y, c.measureText(name).width + 28, 30);
      c.fillStyle = "#293e35";
      c.fillText(name, sign.x + 14, sign.y + 22);
    }
    // Boost pads: a dark plate with a yellow rim and three chevrons. The
    // moving shine is drawn on top each frame (see drawPads).
    for (const pad of this.track.pads) {
      c.save();
      c.translate(pad.x, pad.y);
      c.rotate(pad.angle);
      c.fillStyle = "#1f2a2a";
      c.fillRect(
        -PAD.length / 2 - 2,
        -PAD.width / 2 - 2,
        PAD.length + 4,
        PAD.width + 4,
      );
      c.fillStyle = "#e3c66a";
      c.fillRect(-PAD.length / 2, -PAD.width / 2, PAD.length, PAD.width);
      c.fillStyle = "#2c3638";
      c.fillRect(
        -PAD.length / 2 + 2,
        -PAD.width / 2 + 2,
        PAD.length - 4,
        PAD.width - 4,
      );
      c.restore();
      for (const along of CHEVRONS) {
        c.beginPath();
        chevron(pad, along).forEach((p, i) =>
          i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y),
        );
        c.closePath();
        c.fillStyle = "#a88f3e";
        c.fill();
      }
    }
    if (bridge) {
      // The bridge's shadow falls on the road underneath. The deck itself
      // is a separate image drawn above the karts that pass below it.
      const half = ROAD / 2 + 34;
      c.save();
      c.translate(7, 9);
      c.globalAlpha = 0.3;
      c.beginPath();
      for (let d = -half; d <= half; d += 10) {
        const p = this.track.atDistance(bridge.over + d);
        d === -half ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y);
      }
      c.lineWidth = ROAD + 64;
      c.strokeStyle = "#101c1a";
      c.stroke();
      c.restore();
      const size = Math.ceil(half * 2 + ROAD + 80);
      const deck = this.textures.createCanvas(
        `deck-${this.track.id}`,
        size,
        size,
      )!;
      deck.context.translate(size / 2 - bridge.x, size / 2 - bridge.y);
      this.paintDeck(deck.context, half);
      deck.refresh();
    }
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
    this.hudText = this.label(23, 21, "", 11);
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
    // Phaser hit-tests each child with its own scroll factor, not the
    // container's, so the zone must be fixed to the screen like its panel.
    const zone = this.add
      .zone(24, y, width, 30)
      .setOrigin(0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        audio.click();
        action();
      });
    zone
      .on("pointerover", () => t.setAlpha(0.65))
      .on("pointerout", () => t.setAlpha(1));
    p.add([g, t, zone]);
  }
  openMenu(title: string, subtitle: string, screen: Race["menuScreen"]) {
    this.panel?.destroy();
    this.panel = undefined;
    this.menuScreen = screen;
    return menu.open(title, subtitle);
  }
  closeMenus() {
    this.panel?.destroy();
    this.panel = undefined;
    this.menuScreen = "";
    menu.close();
  }
  garage() {
    this.state = "garage";
    this.openMenu("SLIPSTREAM", `8 KARTS  /  ${LAPS} LAPS`, "main")
      .button("SOLO PRACTICE", () => this.start(), {
        primary: true,
        key: "ENTER",
      })
      .button(
        "TRACK",
        () => {
          const next =
            trackIds[(trackIds.indexOf(this.track.id) + 1) % trackIds.length];
          this.soloTrack = tracks[next];
          try {
            localStorage.setItem(soloTrackKey, next);
          } catch {
            /* The choice still applies for this visit. */
          }
          this.setTrack(this.soloTrack);
          this.garage();
        },
        { key: `${this.track.name}  \u25B8` },
      )
      .button("RACE WITH FRIENDS", () => this.openOnline(), { key: "M" })
      .button("SETTINGS", () => this.settings(() => this.garage()));
  }
  settings(back: () => void) {
    this.openMenu("SETTINGS", "AUDIO  /  CONTROLS", "settings")
      .heading("AUDIO")
      .slider("MUSIC", audio.settings.music, (music) => audio.set({ music }))
      .slider(
        "EFFECTS",
        audio.settings.sfx,
        (sfx) => audio.set({ sfx }),
        () => audio.beep(),
      )
      .toggle("MUTE ALL SOUND", audio.settings.muted, (muted) =>
        audio.set({ muted }),
      )
      .heading("CONTROLS")
      .keys([
        ["W / ↑", "ACCELERATE"],
        ["S / ↓", "BRAKE / REVERSE"],
        ["A D / ← →", "STEER"],
        ["SPACE", "HOLD TO SLIDE, RELEASE TO GRIP"],
        ["DRIFT BOOST", "SLIDE THROUGH A TURN, LET GO FOR A KICK"],
        ["R", "RESET TO TRACK (1.5s PENALTY)"],
        ["ESC", "PIT MENU"],
        ["F2", "ENGINEERING PANEL (SOLO ONLY)"],
      ])
      .note(
        "Drive over the yellow arrow pads for a one-second boost. Sparks show your drift charge: blue for a small boost, orange for a big one. Follow close behind another kart for a slipstream: +20% power.",
      )
      .button("BACK", back, { primary: true });
  }
  start() {
    if (this.online) return;
    this.playerId = 0;
    this.sprites.forEach((s) => s.setVisible(true));
    this.sim.destroy();
    this.sim = new Simulation(8, new Set([0]), this.track);
    this.marks.clear();
    this.recordedLaps = 0;
    this.lapNotice = "";
    this.lapNoticeUntil = 0;
    this.closeMenus();
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
    const settings = () => this.settings(() => this.showPause());
    if (this.online) {
      this.online.input({ throttle: 0, steer: 0, drift: false });
      this.openMenu(
        "PIT MENU",
        "THE ONLINE RACE CONTINUES WHILE THIS MENU IS OPEN",
        "pause",
      )
        .button("BACK ON TRACK", () => this.resume(), {
          primary: true,
          key: "ESC",
        })
        .button("SETTINGS", settings)
        .button("LEAVE ROOM", () => this.leaveOnline());
      return;
    }
    this.openMenu("IN THE PITS", "SESSION PAUSED", "pause")
      .button("BACK ON TRACK", () => this.resume(), {
        primary: true,
        key: "ESC",
      })
      .button("RESTART RACE", () => this.start())
      .button("SETTINGS", settings)
      .button("GARAGE", () => this.garage());
  }
  resume() {
    this.closeMenus();
    this.state = this.countdown > 0 ? "countdown" : "race";
    this.accumulator = 0;
  }
  results() {
    this.state = "results";
    this.closeMenus();
    const p = this.board(
      "RACE PODIUM",
      this.online
        ? `${this.track.name} / ROOM ${this.online.code}`
        : `${this.track.name} / SOLO PRACTICE`,
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
      if (this.isRoomHost())
        this.button(
          p,
          300,
          "BACK TO LOBBY / RACE AGAIN          ENTER",
          () => this.rematch(),
          true,
        );
      else {
        p.add(
          this.label(
            25,
            289,
            "WAITING FOR THE HOST TO RETURN TO THE LOBBY",
            9,
            "#aebb9d",
          ),
        );
        this.button(p, 305, "LEAVE ROOM", () => this.leaveOnline());
      }
    } else
      this.button(
        p,
        300,
        "RACE AGAIN                         ENTER",
        () => this.start(),
        true,
      );
  }
  clearSmoothing() {
    for (const s of this.smoothing) s.x = s.y = s.a = 0;
  }
  // One online physics step, mirroring the server: our kart uses local
  // input, other karts keep their last known input, and finished or absent
  // karts are held still.
  stepOnline(input: Input) {
    const inputs = new Map(
      this.sim.karts.map((k) => [
        k.id,
        k.id === this.playerId ? input : k.input,
      ]),
    );
    this.sim.step(input, inputs);
    for (const k of this.sim.karts) {
      const member = this.roomState?.members.find((m) => m.kart === k.id);
      if (k.finish || !member?.connected || member.dnf) {
        Matter.Body.setVelocity(k.body, { x: 0, y: 0 });
        k.body.isSensor = true;
      }
    }
  }
  isRoomHost() {
    return !!this.online && this.roomState?.hostId === this.online.id;
  }
  rematch() {
    if (!this.online?.connected) {
      this.networkMessage = "Not connected to the PC server.";
      return;
    }
    this.online.send({ type: "rematch" });
  }
  openOnline() {
    Object.assign(tuning, defaultHandling);
    this.debugOn = false;
    this.debug?.destroy();
    this.closeMenus();
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
    this.setTrack(this.soloTrack, true);
    this.sprites.forEach((s) => s.setVisible(true));
    this.kartLabels.forEach((t) => t.setVisible(false));
    this.inputLog = [];
    this.clearSmoothing();
    this.input.keyboard!.enabled = true;
    this.networkMessage = "";
    this.garage();
  }
  receiveRoom(state: RoomState) {
    if (!this.online) return;
    this.roomState = state;
    const me = state.members.find((m) => m.id === this.online!.id);
    if (!me) return;
    this.setTrack(tracks[state.track] ?? defaultTrack);
    if (state.phase === "lobby") {
      this.state = "lobby";
      this.closeMenus();
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
        this.track,
        state.laps,
      );
      this.networkRaceId = state.raceId;
      this.accumulator = 0;
      this.marks.clear();
      this.closeMenus();
      this.sprites.forEach((sprite, i) =>
        sprite.setVisible(i < state.karts.length),
      );
      this.kartLabels.forEach((label, i) =>
        label.setVisible(i < state.karts.length),
      );
      const p = state.karts[this.playerId];
      this.cameras.main.centerOn(p.x, p.y);
      this.state = "countdown";
      this.inputLog = [];
      this.clearSmoothing();
    }
    // Where each kart is drawn right now, so the correction below can be
    // blended in over a few frames instead of popping.
    const drawn = this.sim.karts.map((k, i) => ({
      x: k.body.position.x + this.smoothing[i].x,
      y: k.body.position.y + this.smoothing[i].y,
      a: k.body.angle + this.smoothing[i].a,
    }));
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
        "boost",
        "driftCharge",
        "segment",
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
    // Client-side prediction: the snapshot is a little old by the time it
    // arrives. Re-run the local inputs the server had not processed yet so
    // our own kart stays where we steered it instead of rubber-banding.
    this.inputLog = this.inputLog.filter((entry) => entry.seq > me.seq);
    if (
      state.phase === "racing" &&
      this.state === "race" &&
      this.online.connected
    )
      for (const entry of this.inputLog.slice(-MAX_REPLAY_STEPS))
        this.stepOnline(entry.input);
    this.sim.karts.forEach((k, i) => {
      const s = this.smoothing[i],
        d = drawn[i];
      s.x = d.x - k.body.position.x;
      s.y = d.y - k.body.position.y;
      s.a = Phaser.Math.Angle.Wrap(d.a - k.body.angle);
      // Resets and big desyncs teleport rather than slide across the map.
      if (Math.hypot(s.x, s.y) > 120) s.x = s.y = s.a = 0;
    });
    if (state.phase === "podium") {
      this.inputLog = [];
      // Redraw if the host changed so a new host gets the lobby button.
      if (this.state !== "results" || this.podiumHostId !== state.hostId) {
        this.podiumHostId = state.hostId;
        this.results();
      }
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
        const t = this.label(x, 32 + i * 23, sign < 0 ? "−" : "+", 16)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
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
  /** A bright chevron sweeps along each pad, pointing the way. */
  drawPads() {
    const g = this.padShine.clear();
    const cam = this.cameras.main.worldView;
    const step = Math.floor(this.time.now / 110) % (CHEVRONS.length + 1);
    for (const pad of this.track.pads) {
      if (!Phaser.Geom.Rectangle.Contains(cam, pad.x, pad.y)) {
        const grown = Phaser.Geom.Rectangle.Clone(cam);
        Phaser.Geom.Rectangle.Inflate(grown, 40, 40);
        if (!Phaser.Geom.Rectangle.Contains(grown, pad.x, pad.y)) continue;
      }
      CHEVRONS.forEach((along, i) => {
        const lit = i === step ? 0.95 : i === step - 1 ? 0.45 : 0;
        if (!lit) return;
        g.fillStyle(0xfff2b3, lit).fillPoints(chevron(pad, along), true);
      });
    }
  }
  /** Boost flames from the exhausts and sparks off the rear tyres. */
  drawKartFx(k: Kart) {
    const g = this.fx[this.track.layer[k.segment] === LAYER.over ? 1 : 0];
    const { x, y } = this.sprites[k.id];
    const fx = Math.cos(k.body.angle),
      fy = Math.sin(k.body.angle);
    const at = (along: number, across: number) => ({
      x: x + fx * along - fy * across,
      y: y + fy * along + fx * across,
    });
    if (k.boost > 0) {
      // Flames flicker in length and shrink as the boost runs out.
      const fade = Math.min(1, k.boost / 0.25);
      for (const side of [-4, 4]) {
        const length = (7 + Math.random() * 8) * (0.5 + 0.5 * fade);
        const root = at(-12, side),
          tip = at(-12 - length, side),
          mid = at(-12 - length * 0.55, side);
        g.lineStyle(4, 0xff6a2b, 0.85).lineBetween(
          root.x,
          root.y,
          tip.x,
          tip.y,
        );
        g.lineStyle(2, 0xffd25e, 1).lineBetween(root.x, root.y, mid.x, mid.y);
        g.fillStyle(0xfffbe6, 1).fillRect(
          Math.round(root.x) - 1,
          Math.round(root.y) - 1,
          2,
          2,
        );
      }
    }
    if (k.input.drift && k.driftCharge > 0.12) {
      const level = driftLevel(k),
        size = level === 2 ? 2 : 1;
      for (const side of [-8, 8]) {
        const wheel = at(-7, side);
        if (level > 0)
          g.fillStyle(SPARKS[level], 0.35).fillRect(
            Math.round(wheel.x) - 2,
            Math.round(wheel.y) - 2,
            4,
            4,
          );
        for (let i = 0; i < 2 + level * 2; i++) {
          const spark = at(
            -7 - Math.random() * (6 + level * 4),
            side + (Math.random() - 0.5) * 7,
          );
          g.fillStyle(SPARKS[level], 1).fillRect(
            Math.round(spark.x),
            Math.round(spark.y),
            size,
            size,
          );
        }
      }
    }
  }
  update(_time: number, delta: number) {
    if (!this.sim) return;
    const pressed = (k: string) => Phaser.Input.Keyboard.JustDown(this.keys[k]);
    if (
      pressed("ENTER") &&
      !this.online &&
      (this.menuScreen === "main" || this.state === "results")
    )
      this.start();
    if (pressed("ENTER") && this.state === "results" && this.isRoomHost())
      this.rematch();
    if (pressed("M") && this.menuScreen === "main") this.openOnline();
    if (pressed("ESC")) {
      if (this.state === "race" || this.state === "countdown") this.pause();
      else if (this.state === "pause") this.resume();
    }
    if (pressed("F2") && !this.online) {
      this.debugOn = !this.debugOn;
      this.showDebug();
    }
    if (pressed("R") && this.state === "race") {
      const me = this.sim.karts[this.playerId];
      if (me && !me.resetRemaining && !me.finish) audio.reset();
      if (this.online) this.pendingReset = true;
      else this.sim.resetKart(this.sim.karts[0]);
    }
    if (this.state === "countdown") {
      if (!this.online) this.countdown -= Math.min(delta, 100) / 1000;
      const count = this.online
        ? String(Math.max(1, Math.ceil(this.countdown)))
        : this.countdown > 0.6
          ? String(Math.ceil(this.countdown - 0.6))
          : "GO!";
      this.countText.setText(count);
      if (count !== this.lastCount) {
        this.lastCount = count;
        if (count === "GO!") audio.go();
        else audio.beep();
      }
      if (this.countdown <= 0) {
        this.state = "race";
        this.countText.setText("");
      }
    } else {
      this.countText.setText("");
      this.lastCount = "";
    }
    // Online has no "GO!" frame: the server moves straight to racing.
    if (this.online && this.wasCounting && this.state === "race") audio.go();
    this.wasCounting = this.state === "countdown";
    // Online races keep running (with our kart idle) while the pit menu is open.
    const onlineRunning =
      !!this.online && (this.state === "race" || this.state === "pause");
    if (this.state === "race" || onlineRunning) {
      this.accumulator += Math.min(delta, 100);
      const down = (...ks: string[]) => ks.some((k) => this.keys[k].isDown);
      const input =
        this.state === "race"
          ? {
              throttle: down("W", "UP") ? 1 : down("S", "DOWN") ? -0.65 : 0,
              steer: (down("D", "RIGHT") ? 1 : 0) - (down("A", "LEFT") ? 1 : 0),
              drift: down("SPACE"),
            }
          : { throttle: 0, steer: 0, drift: false };
      while (this.accumulator >= 1000 / 60) {
        if (this.online) {
          // Send every physics step so the server sees input changes within
          // one tick, and log it for replay when the next snapshot arrives.
          if (this.online.connected) {
            const seq = this.online.input(input, this.pendingReset);
            this.pendingReset = false;
            this.inputLog.push({ seq, input });
            if (this.inputLog.length > 120) this.inputLog.shift();
            this.stepOnline(input);
          }
        } else this.sim.step(input);
        this.accumulator -= 1000 / 60;
      }
    }
    if (this.state === "race") {
      const kart = this.sim.karts[this.playerId];
      const laps = kart.lapTimes.length;
      if (laps > this.heardLaps) {
        if (kart.finish) audio.finish();
        else
          audio.lap(
            !this.online &&
              !this.tunedSession &&
              (this.records.lap === null ||
                kart.lapTimes[laps - 1] < this.records.lap),
          );
      }
      this.heardLaps = laps;
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
            localStorage.setItem(
              recordKey(this.track.id),
              JSON.stringify(this.records),
            );
          } catch {
            /* Race remains playable. */
          }
        }
      }
      if (kart.finish && !this.online) this.results();
    }
    const player = this.sim.karts[this.playerId] || this.sim.karts[0],
      b = player.body;
    this.effects.clear();
    this.trails.clear();
    for (const g of this.fx) g.clear();
    this.drawPads();
    // Knocks against walls and other karts, heard for our own kart only.
    if (this.listeningTo !== this.sim) {
      this.listeningTo = this.sim;
      Matter.Events.on(this.sim.engine, "collisionStart", (event) => {
        if (this.state !== "race") return;
        const mine = `kart-${this.playerId}`;
        for (const pair of event.pairs) {
          const one = pair.bodyA.parent,
            other = pair.bodyB.parent;
          if (pair.isSensor || (one.label !== mine && other.label !== mine))
            continue;
          const normal = pair.collision.normal;
          audio.bump(
            Math.abs(
              (one.velocity.x - other.velocity.x) * normal.x +
                (one.velocity.y - other.velocity.y) * normal.y,
            ) / 4,
          );
        }
      });
    }
    const onTrack = this.state === "race" || this.state === "countdown";
    audio.drive(
      onTrack && !player.finish
        ? {
            speed: Math.hypot(b.velocity.x, b.velocity.y) / tuning.topSpeed,
            throttle: Math.abs(player.input.throttle),
            skid:
              player.input.drift && Math.hypot(b.velocity.x, b.velocity.y) > 2,
            draft: player.draft,
          }
        : null,
    );
    // Server corrections are drawn as an offset that fades out, so karts
    // glide to their corrected spot with no added steering lag.
    const fade = Math.exp(-Math.min(delta, 100) / SMOOTHING_MS);
    for (const k of this.sim.karts) {
      const s = this.sprites[k.id],
        smooth = this.smoothing[k.id];
      smooth.x *= fade;
      smooth.y *= fade;
      smooth.a *= fade;
      s.setPosition(
        Math.round(k.body.position.x + smooth.x),
        Math.round(k.body.position.y + smooth.y),
      )
        .setRotation(k.body.angle + smooth.a)
        // Karts on the bridge are drawn above its deck; the rest pass below.
        .setDepth(this.track.layer[k.segment] === LAYER.over ? 8 : 5);
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
              k.boost > 0 ? 0xffd36b : k.draft > 0.1 ? 0xf5d982 : 0xd8e5d4,
              (k.boost > 0 ? 0.7 : k.draft > 0.1 ? 0.45 : 0.2) *
                (1 - segment / 3),
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
      if (this.state === "race" && !k.resetRemaining) this.drawKartFx(k);
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
    const drawnX = b.position.x + this.smoothing[player.id].x,
      drawnY = b.position.y + this.smoothing[player.id].y;
    const tx =
        drawnX +
        Phaser.Math.Clamp(
          b.velocity.x * 22,
          -cam.width * 0.25,
          cam.width * 0.25,
        ) -
        cam.width / 2,
      ty =
        drawnY +
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
      `P${pos} / ${this.sim.karts.length}     LAP ${Math.min(this.sim.laps, player.lap + 1)} / ${this.sim.laps}\n${this.sim.time.toFixed(1).padStart(5, "0")}   ${this.track.name}`,
    );
    this.timingText.setText(
      `LAP  ${formatTime(player.finish ? player.lapTimes.at(-1)! : this.sim.time - player.lapStartedAt)}\nLAST ${formatTime(player.lapTimes.at(-1) ?? null)}\nPB   ${formatTime(this.records.lap)}${this.tunedSession ? " *" : ""}`,
    );
    const level = driftLevel(player);
    if (this.state === "race") {
      if (player.boost > this.lastBoost + 0.05) audio.boost();
      if (level > this.lastDriftLevel) audio.charge(level);
    }
    this.lastBoost = player.boost;
    this.lastDriftLevel = level;
    const [status, colour] =
      player.boost > 0
        ? ["BOOST!", "#ffd36b"]
        : player.input.drift && player.driftCharge > 0
          ? [
              ["DRIFT", "DRIFT  >", "DRIFT  >>"][level],
              ["#edf0da", "#7cc8ff", "#ffb057"][level],
            ]
          : player.draft > 0.1
            ? ["DRAFT +" + Math.round(player.draft * 20) + "%", "#f5d982"]
            : ["SLIPSTREAM", "#edf0da"];
    this.speedText.setColor(colour);
    this.speedText.setText(
      `${String(Math.round(Math.hypot(b.velocity.x, b.velocity.y) * 13)).padStart(3, "0")} KM/H\n${status}`,
    );
    const { points, WORLD } = this.track;
    // Fit the whole circuit inside the 104 x 64 map window.
    const scale = Math.min(104 / WORLD.width, 64 / WORLD.height);
    const mx = this.scale.width - 124 + (104 - WORLD.width * scale) / 2,
      my = this.scale.height - 88 + (64 - WORLD.height * scale) / 2;
    this.map
      .clear()
      .fillStyle(0x203630, 0.85)
      .fillRect(this.scale.width - 132, this.scale.height - 96, 120, 80)
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
// Pixel scaling goes through Phaser's own zoom so its pointer
// mapping matches the enlarged canvas (setting the canvas CSS size directly
// left mouse clicks landing 2-3x away from where the cursor was).
const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "game",
  scale: {
    mode: Phaser.Scale.NONE,
    width: Math.ceil(innerWidth / pixelScale()),
    height: Math.ceil(innerHeight / pixelScale()),
    zoom: pixelScale(),
  },
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#6e834c",
  scene: Race,
  audio: { noAudio: true },
});
function resize() {
  const s = pixelScale();
  game.scale.resize(Math.ceil(innerWidth / s), Math.ceil(innerHeight / s));
  // setZoom refreshes the canvas CSS size and pointer scale for the new size.
  game.scale.setZoom(s);
  document.documentElement.style.setProperty("--ui-zoom", String(menuScale()));
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
