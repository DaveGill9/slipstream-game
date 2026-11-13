import Phaser from "phaser";
import Matter from "matter-js";
import {
  OnlineClient,
  RoomPanel,
  type RoomState,
  type RaceResults,
} from "./network";
import { podiumContent, championContent } from "./podium";
import { GameAudio } from "./audio";
import { Menu } from "./menu";
import { Hud } from "./hud";
import { paintScenery, paintTrackside } from "./scenery";
const defaultHandling = { ...tuning };
const audio = new GameAudio();
const menu = new Menu();
const hud = new Hud();
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
  MAX_KARTS,
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
  WALL_GAP,
  type Track,
} from "./track";
type Pad = Track["pads"][number];
/** One painted chevron on a boost pad, `along` px from the pad's centre. */
function chevron(pad: Pad, along: number) {
  const c = Math.cos(pad.angle),
    s = Math.sin(pad.angle);
  return [
    [along - 4, -9],
    [along + 1, -9],
    [along + 6, 0],
    [along + 1, 9],
    [along - 4, 9],
    [along + 2, 0],
  ].map(([x, y]) => ({ x: pad.x + x * c - y * s, y: pad.y + x * s + y * c }));
}
/** Colours of the striped guard rails of easy mode. */
const RAIL = ["#f0c94a", "#ece9d8"];
const CHEVRONS = [-9, -1, 7];
// Drift spark colours by charge: warming up, small boost, big boost.
const SPARKS = [0xeef2e6, 0x6cc6ff, 0xffa24a];
const soloTrackKey = "slipstream-track";
const colors = [
  0xffd35a, 0x70bfff, 0xe97262, 0x91c876, 0xb38cde, 0xe7eee2, 0xec91b4,
  0x64d7c4, 0xf08a3c, 0x4b63d6,
];
const cssColors = colors.map((c) => `#${c.toString(16).padStart(6, "0")}`);
/** Karts in a solo practice race; online rooms hold up to MAX_KARTS. */
const SOLO_KARTS = 8;
const noResults: RaceResults = {
  rows: [],
  fastestLap: null,
  round: 0,
  series: 0,
  final: false,
};
// Race callouts: how long a lead or place change must hold before it is
// announced (online positions can flicker for a frame), and how long a
// callout or position arrow stays up.
const CALLOUT = { settle: 0.6, show: 3, arrow: 2.5 };
// Zebra crossings on street circuits, as distances after the start line.
const CROSSINGS = [1100, 4650, 7300, 10600];
const ROOFS = [
  "#b9694d",
  "#c98a5b",
  "#d8ccb0",
  "#e3ddc9",
  "#9aa3a6",
  "#6f7c88",
  "#b25a48",
  "#c7b48a",
];
const PARKED = ["#c8553d", "#e7eee2", "#3f6c8f", "#e3c66a", "#2f3a3c"];
const names = [
  "YOU",
  "BLUE",
  "EMBER",
  "MOSS",
  "VIOLET",
  "GHOST",
  "ROSE",
  "MINT",
  "TANGO",
  "COBALT",
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
  smoothing = Array.from({ length: MAX_KARTS }, () => ({ x: 0, y: 0, a: 0 }));
  /** The online race whose podium we have already shown. */
  podiumRaceId = -1;
  /** Final standings, kept so the podium survives the room reopening. */
  podium: RaceResults = noResults;
  /** A cup's last race shows the race podium first, then the champion. */
  podiumStage: "race" | "champion" = "race";
  /** The parts of a cup podium that change as racers ready up. */
  nextRace?: { status: HTMLElement; label: HTMLElement };
  /** After finishing online: the kart the camera follows (-1 = our own). */
  watching = -1;
  lastView = -1;
  /** Taps of A / D (or the arrows) not yet used to change who we watch. */
  watchStep = 0;
  /** Easy mode (online, set by the host): guard rails are painted at the
   * road edge and the camera turns so the kart always drives up the screen. */
  easy = false;
  /** Whether the camera was turning with the kart last frame. */
  turned = false;
  /** How far the camera is turned, in radians. */
  camTurn = 0;
  /** What the race callouts have seen so far (see callouts()). */
  notes = this.freshNotes();
  networkMessage = "";
  /** Centre-screen text: the countdown, or a lap / penalty notice. */
  banner = "";
  accumulator = 0;
  countdown = 0;
  debugOn = false;
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
  menuScreen: "" | "main" | "settings" | "pause" | "podium" = "";
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
    this.sprites = colors.map((_, id) =>
      this.add
        .image(0, 0, `kart-${id}`)
        .setDepth(5)
        .setVisible(id < SOLO_KARTS),
    );
    this.cameras.main.setRoundPixels(true);
    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,R,ESC,ENTER,F2,M",
    ) as typeof this.keys;
    this.input.keyboard!.addCapture(["SPACE", "UP", "DOWN", "LEFT", "RIGHT"]);
    // Spectator camera: every tap counts, however short (see update()).
    this.input.keyboard!.on("keydown", (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "KeyA" || event.code === "ArrowLeft") this.watchStep--;
      if (event.code === "KeyD" || event.code === "ArrowRight")
        this.watchStep++;
    });
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
  setTrack(track: Track, force = false, easy = false) {
    if (track === this.track && easy === this.easy && !force) return;
    this.track = track;
    this.easy = easy;
    const { WORLD } = track;
    // Easy mode has its own picture of each track (walls at the road edge).
    const key = track.id + (easy ? "-easy" : "");
    if (!this.textures.exists(`track-${key}`)) this.makeTrack();
    this.trackImage ??= this.add.image(0, 0, "__DEFAULT").setOrigin(0);
    this.trackImage.setTexture(`track-${key}`);
    this.marks?.destroy();
    this.marks = this.add
      .renderTexture(0, 0, WORLD.width, WORLD.height)
      .setOrigin(0)
      .setDepth(1);
    this.deck?.destroy();
    this.deck = undefined;
    if (track.bridge)
      this.deck = this.add
        .image(track.bridge.x, track.bridge.y, `deck-${key}`)
        .setDepth(7);
    // The turning camera of easy mode shows past the edge of the map, so it
    // is not held inside it and the surroundings carry on in the same colour.
    if (easy) this.cameras.main.removeBounds();
    else this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBackgroundColor(
      track.theme === "street" ? "#8e908a" : "#6e834c",
    );
    this.sim?.destroy();
    this.sim = new Simulation(SOLO_KARTS, new Set([0]), track);
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
    if (this.easy) {
      stroke(ROAD + 20, "#40574e");
      stroke(ROAD + 16, RAIL[0]);
    } else {
      stroke(ROAD + 64, "#40574e");
      stroke(ROAD + 60, "#a9b5a5");
      stroke(ROAD + 44, "#7d8a80");
      stroke(ROAD + 16, "#e7e4ca");
    }
    stroke(ROAD, "#4a5252");
    stroke(1, "#939887", [12, 22]);
  }
  /** City blocks for a street circuit: side streets on a grid, with
   * buildings, small parks and car parks on every lot clear of the road. */
  paintCity(c: CanvasRenderingContext2D, random: () => number) {
    const { WORLD, ROAD, nearest, grandstands, sign } = this.track;
    const clear = ROAD / 2 + 46,
      BLOCK = { width: 236, height: 212, street: 30 };
    c.fillStyle = "#7b7f7b";
    for (let x = 20; x < WORLD.width; x += BLOCK.width)
      c.fillRect(x, 0, BLOCK.street, WORLD.height);
    for (let y = 20; y < WORLD.height; y += BLOCK.height)
      c.fillRect(0, y, WORLD.width, BLOCK.street);
    c.fillStyle = "#a5a79f";
    for (let x = 20; x < WORLD.width; x += BLOCK.width)
      for (let y = 0; y < WORLD.height; y += 26)
        c.fillRect(x + BLOCK.street / 2 - 1, y, 2, 12);
    for (let y = 20; y < WORLD.height; y += BLOCK.height)
      for (let x = 0; x < WORLD.width; x += 26)
        c.fillRect(x, y + BLOCK.street / 2 - 1, 12, 2);
    const reserved = grandstands.map((g) => ({
      x: g.x - 14,
      y: g.y - 14,
      w: g.width + 28,
      h: g.height + 28,
    }));
    if (sign) reserved.push({ x: sign.x - 10, y: sign.y - 10, w: 340, h: 52 });
    const free = (x: number, y: number, w: number, h: number) => {
      for (let i = 0; i <= 3; i++)
        for (let j = 0; j <= 3; j++)
          if (
            nearest({ x: x + (w * i) / 3, y: y + (h * j) / 3 }).distance < clear
          )
            return false;
      return !reserved.some(
        (r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y,
      );
    };
    const tree = (x: number, y: number) => {
      c.fillStyle = "#526a3b";
      c.fillRect(x - 6, y - 3, 14, 11);
      c.fillRect(x - 3, y - 6, 9, 17);
      c.fillStyle = "#82964f";
      c.fillRect(x - 4, y - 4, 8, 8);
      c.fillStyle = "#9aab64";
      c.fillRect(x - 2, y - 3, 3, 3);
    };
    const lot = (x: number, y: number, w: number, h: number) => {
      const kind = random();
      if (kind < 0.13) {
        // A small park.
        c.fillStyle = "#5d7242";
        c.fillRect(x, y, w, h);
        c.fillStyle = "#6e834c";
        c.fillRect(x + 3, y + 3, w - 6, h - 6);
        for (let i = 0; i < 2 + Math.floor((w * h) / 4500); i++)
          tree(x + 12 + random() * (w - 24), y + 12 + random() * (h - 24));
        return;
      }
      if (kind < 0.22) {
        // A car park: bays along the top and bottom, some of them taken.
        c.fillStyle = "#585d5d";
        c.fillRect(x, y, w, h);
        for (let bx = x + 6; bx < x + w - 14; bx += 14)
          for (const by of [y + 5, y + h - 25]) {
            c.fillStyle = "#b9bcb4";
            c.fillRect(bx, by, 1, 20);
            if (random() < 0.55) {
              c.fillStyle = PARKED[Math.floor(random() * PARKED.length)];
              c.fillRect(bx + 3, by + 2, 9, 16);
              c.fillStyle = "#1f2a2a";
              c.fillRect(bx + 4, by + 5, 7, 4);
            }
          }
        return;
      }
      // A building seen from above: shadow, roof, parapet, rooftop units.
      c.fillStyle = "rgba(28, 38, 38, 0.38)";
      c.fillRect(x + 6, y + 8, w, h);
      c.fillStyle = ROOFS[Math.floor(random() * ROOFS.length)];
      c.fillRect(x, y, w, h);
      if (random() < 0.4) {
        // A pitched roof: one half in shade.
        c.fillStyle = "rgba(0, 0, 0, 0.13)";
        if (w > h) c.fillRect(x, y + h / 2, w, h / 2);
        else c.fillRect(x + w / 2, y, w / 2, h);
      }
      c.lineWidth = 2;
      c.strokeStyle = "rgba(0, 0, 0, 0.28)";
      c.strokeRect(x + 1, y + 1, w - 2, h - 2);
      c.strokeStyle = "rgba(255, 255, 255, 0.25)";
      c.strokeRect(x + 4, y + 4, w - 8, h - 8);
      for (let i = 0; i < 1 + Math.floor(random() * 3); i++) {
        const ux = Math.round(x + 10 + random() * (w - 30)),
          uy = Math.round(y + 10 + random() * (h - 28));
        c.fillStyle = "rgba(0, 0, 0, 0.3)";
        c.fillRect(ux + 2, uy + 3, 10, 8);
        c.fillStyle = "#c9ccc6";
        c.fillRect(ux, uy, 10, 8);
        c.fillStyle = "#858a86";
        c.fillRect(ux + 2, uy + 2, 6, 4);
      }
    };
    const gap = 8,
      w = BLOCK.width - BLOCK.street - gap * 2,
      h = BLOCK.height - BLOCK.street - gap * 2;
    for (
      let bx = 20 + BLOCK.street + gap - BLOCK.width;
      bx < WORLD.width;
      bx += BLOCK.width
    )
      for (
        let by = 20 + BLOCK.street + gap - BLOCK.height;
        by < WORLD.height;
        by += BLOCK.height
      ) {
        // One big lot if the whole block is clear (sometimes), else quarters.
        if (random() < 0.4 && free(bx, by, w, h)) {
          lot(bx, by, w, h);
          continue;
        }
        const hw = (w - 6) / 2,
          hh = (h - 6) / 2;
        for (const qx of [bx, bx + hw + 6])
          for (const qy of [by, by + hh + 6])
            if (free(qx, qy, hw, hh)) lot(qx, qy, hw, hh);
      }
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
    const easy = this.easy,
      key = this.track.id + (easy ? "-easy" : "");
    const tex = this.textures.createCanvas(
      `track-${key}`,
      WORLD.width,
      WORLD.height,
    )!;
    const c = tex.context;
    const street = this.track.theme === "street";
    let seed = 73;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    c.fillStyle = street ? "#8e908a" : "#6e834c";
    c.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 47000; i++) {
      c.fillStyle = street
        ? ["#949690", "#888a84", "#9a9c96"][i % 3]
        : ["#748952", "#677e46", "#7a8d55"][i % 3];
      c.fillRect(
        Math.floor(random() * WORLD.width),
        Math.floor(random() * WORLD.height),
        2,
        2,
      );
    }
    if (street) this.paintCity(c, random);
    const decorated = paintScenery(c, this.track.scenery);
    const path = () => {
      c.beginPath();
      points.forEach((p, i) =>
        i ? c.lineTo(Math.round(p.x), Math.round(p.y)) : c.moveTo(p.x, p.y),
      );
      c.closePath();
    };
    c.lineJoin = "round";
    path();
    c.strokeStyle = street ? "#b3b5ad" : "#a89b75";
    c.lineWidth = ROAD + 38;
    c.stroke();
    path();
    c.strokeStyle = street ? "#d9dad2" : "#e7e4ca";
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
        const vertices = wallVertices(i, side, easy ? 0 : undefined);
        c.beginPath();
        vertices.forEach((p, j) =>
          j ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y),
        );
        c.closePath();
        // Guard rails are striped so they stand out from an ordinary wall.
        c.fillStyle = easy
          ? RAIL[Math.floor(i / 3) % 2]
          : street
            ? "#d0d2ca"
            : "#a9b5a5";
        c.fill();
      }
      c.beginPath();
      points.forEach((_, i) => {
        const p = offset(i, side * (ROAD / 2 + (easy ? 0 : WALL_GAP)));
        i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y);
      });
      c.closePath();
      c.lineWidth = 2;
      c.strokeStyle = street ? "#4d5352" : "#40574e";
      c.stroke();
    }
    if (street) {
      // Zebra crossings, and street lamps outside the barriers.
      for (const at of CROSSINGS) {
        const s = this.track.startDistance + at,
          a = this.track.atDistance(s - 5),
          b = this.track.atDistance(s + 5);
        c.save();
        c.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
        c.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        c.fillStyle = "#d4d5c9";
        for (let y = -ROAD / 2 + 7; y < ROAD / 2 - 10; y += 14)
          c.fillRect(-12, y, 24, 7);
        c.restore();
      }
      for (const side of [-1, 1])
        for (let i = 0; i < points.length; i += 27) {
          const p = offset(i, side * (ROAD / 2 + 38));
          c.fillStyle = "#2e3436";
          c.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5);
          c.fillStyle = "#f6e9a8";
          c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
        }
    }
    if (this.track.trackside) paintTrackside(c, this.track);
    // Chequered timing line and grid boxes, painted on the southern straight.
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 16; y++) {
        c.fillStyle = (x + y) % 2 ? "#e9e8d4" : "#243634";
        c.fillRect(START.x + x * 5, START.y - 64 + y * 8, 5, 8);
      }
    for (let i = 0; i < MAX_KARTS; i++) {
      const { x, y } = gridPosition(i);
      c.strokeStyle = "#a3a797";
      c.lineWidth = 1;
      c.strokeRect(x - 15, y - 10, 26, 20);
    }
    // Trees. A street circuit has its own, in the city's parks.
    for (let i = 0; i < (street ? 0 : 230); i++) {
      const p = {
        x: 40 + random() * (WORLD.width - 80),
        y: 40 + random() * (WORLD.height - 80),
      };
      if (nearest(p).distance < 125) continue;
      if (
        decorated.some(
          (b) =>
            p.x > b.x - 12 &&
            p.x < b.x + b.w + 12 &&
            p.y > b.y - 12 &&
            p.y < b.y + b.h + 12,
        )
      )
        continue;
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
        `deck-${key}`,
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
    for (let i = 0; i < colors.length; i++) {
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
  /** Redraws the canvas panels for a new window size. The race HUD is HTML
   * (src/hud.ts) and sizes itself. */
  layout() {
    if (this.debugOn) this.showDebug();
  }
  openMenu(title: string, subtitle: string, screen: Race["menuScreen"]) {
    this.menuScreen = screen;
    return menu.open(title, subtitle);
  }
  closeMenus() {
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
    this.sprites.forEach((s, i) => s.setVisible(i < SOLO_KARTS));
    this.sim.destroy();
    this.sim = new Simulation(SOLO_KARTS, new Set([0]), this.track);
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
    this.podiumStage = "race";
    // Solo practice has no room points: build the same standings locally.
    let results = this.podium;
    if (!this.online) {
      let fastestLap: RaceResults["fastestLap"] = null;
      for (const k of this.sim.karts)
        for (const time of k.lapTimes)
          if (!fastestLap || time < fastestLap.time)
            fastestLap = { kart: k.id, time };
      results = {
        ...noResults,
        fastestLap,
        rows: this.sim.positions().map((k) => ({
          kart: k.id,
          name: names[k.id],
          finish: k.finish,
          points: 0,
          total: 0,
        })),
      };
    }
    const board = this.openMenu(
      "RACE PODIUM",
      this.online
        ? `${this.track.name}  /  ${results.series ? `RACE ${results.round} OF ${results.series}` : `ROOM ${this.online.code}`}`
        : `${this.track.name}  /  SOLO PRACTICE`,
      "podium",
    ).add(
      podiumContent(results, {
        me: this.playerId,
        points: !!this.online,
        unfinished: this.online ? "DNF" : "RACING",
        colors: cssColors,
        icon: (kart) => this.textures.getBase64(`kart-${kart}`),
      }),
      true,
    );
    this.nextRace = undefined;
    if (this.online && this.cupContinues()) {
      // Mid-cup: everyone readies up here and the next race starts by itself.
      const box = document.createElement("div"),
        status = document.createElement("p");
      box.className = "podium-next";
      status.className = "room-hint";
      if (this.roomState?.hostId === this.online.id) {
        const row = document.createElement("label"),
          select = document.createElement("select");
        row.textContent = "NEXT TRACK";
        for (const t of Object.values(tracks))
          select.add(new Option(t.name, t.id));
        select.value = this.roomState.track;
        select.addEventListener("change", () =>
          this.online?.send({ type: "track", track: select.value }),
        );
        row.append(select);
        box.append(row);
      }
      box.append(status);
      board
        .add(box, true)
        .button("READY FOR NEXT RACE", () => this.podiumNext(), {
          primary: true,
          key: "ENTER",
        })
        .button("RETURN TO LOBBY", () => this.backToLobby());
      this.nextRace = {
        status,
        label: board.board.querySelector<HTMLElement>(
          "button.menu-button:not(.room-back) span",
        )!,
      };
      if (this.roomState) this.showNextRace(this.roomState);
    } else if (this.online)
      // Everyone goes back to the room on their own; leaving is done there.
      // The last race of a cup shows the champion first.
      board.button(
        results.final ? "SEE THE CHAMPION" : "RETURN TO LOBBY",
        () => this.podiumNext(),
        { primary: true, key: "ENTER" },
      );
    else
      board
        .button("RACE AGAIN", () => this.start(), {
          primary: true,
          key: "ENTER",
        })
        .button("GARAGE", () => this.garage());
  }
  /** The podium's main button: on to the champion screen after a cup's
   * last race, otherwise back to the lobby. */
  podiumNext() {
    if (this.cupContinues()) {
      const me = this.roomState?.members.find((m) => m.id === this.online?.id);
      this.online?.send({ type: "ready", ready: !me?.ready });
      return;
    }
    if (!this.podium.final || this.podiumStage === "champion")
      return this.backToLobby();
    this.podiumStage = "champion";
    audio.finish();
    this.openMenu(
      "CHAMPION",
      `${this.podium.series} RACE CUP  /  ROOM ${this.online?.code ?? ""}`,
      "podium",
    )
      .add(
        championContent(this.podium, {
          me: this.playerId,
          colors: cssColors,
          icon: (kart) => this.textures.getBase64(`kart-${kart}`),
        }),
        true,
      )
      .button("RETURN TO LOBBY", () => this.backToLobby(), {
        primary: true,
        key: "ENTER",
      });
  }
  /** A cup with races still to run: the podium leads to the next race. */
  cupContinues() {
    return (
      this.podium.series > 0 &&
      !this.podium.final &&
      this.roomState?.phase === "podium"
    );
  }
  /** Who is ready for the next race, on the cup podium. */
  showNextRace(state: RoomState) {
    if (!this.nextRace) return;
    const here = state.members.filter((m) => m.connected),
      waiting = here.filter((m) => !m.ready),
      me = state.members.find((m) => m.id === this.online?.id);
    const next = `NEXT: ${tracks[state.track]?.name ?? ""}`;
    this.nextRace.label.textContent = me?.ready
      ? "READY - CLICK TO CANCEL"
      : "READY FOR NEXT RACE";
    this.nextRace.status.textContent =
      here.length < 2
        ? "The next race needs at least two racers."
        : `${next}  /  ${here.length - waiting.length} OF ${here.length} READY${
            waiting.length
              ? `  /  WAITING FOR ${waiting.map((m) => m.name).join(", ")}`
              : ""
          }`;
  }
  freshNotes() {
    return {
      sim: undefined as Simulation | undefined,
      leader: -1,
      leaderSince: 0,
      announced: -1,
      place: 0,
      placeSince: 0,
      shownPlace: 0,
      bestLap: Infinity,
      laps: [] as number[],
      finalLap: false,
      text: "",
      tone: "",
      until: 0,
      arrow: 0,
      arrowUntil: 0,
    };
  }
  driverName(kart: number) {
    return this.online
      ? this.roomState?.members.find((m) => m.kart === kart)?.name || "Racer"
      : names[kart];
  }
  /** Works out the race callouts: final lap, a new leader, a new fastest
   * lap, and the arrow for a place gained or lost. Lead and place changes
   * stay quiet until the leader has finished the first lap, because
   * everyone is bunched together off the start. */
  callouts(player: Kart) {
    if (this.notes.sim !== this.sim)
      this.notes = { ...this.freshNotes(), sim: this.sim };
    const n = this.notes,
      now = this.sim.time;
    const say = (text: string, tone: string) => {
      n.text = text;
      n.tone = tone;
      n.until = now + CALLOUT.show;
    };
    const order = this.sim.positions(),
      leader = order[0],
      settled = leader.lap >= 1;
    if (leader.id !== n.leader) {
      n.leader = leader.id;
      n.leaderSince = now;
    }
    if (!settled || n.announced < 0) n.announced = n.leader;
    else if (
      n.leader !== n.announced &&
      now - n.leaderSince > CALLOUT.settle &&
      !leader.finish
    ) {
      n.announced = n.leader;
      say(
        leader.id === this.playerId
          ? "YOU TAKE THE LEAD"
          : `${this.driverName(leader.id).toUpperCase()} TAKES THE LEAD`,
        "lead",
      );
    }
    const place = order.indexOf(player) + 1;
    if (place !== n.place) {
      n.place = place;
      n.placeSince = now;
    }
    if (!settled || !n.shownPlace) n.shownPlace = place;
    else if (place !== n.shownPlace && now - n.placeSince > CALLOUT.settle) {
      if (!player.finish) {
        n.arrow = place < n.shownPlace ? 1 : -1;
        n.arrowUntil = now + CALLOUT.arrow;
      }
      n.shownPlace = place;
    }
    for (const k of this.sim.karts) {
      const done = k.lapTimes.length;
      if (done <= (n.laps[k.id] ?? 0)) continue;
      n.laps[k.id] = done;
      const time = k.lapTimes[done - 1];
      if (time >= n.bestLap) continue;
      n.bestLap = time;
      // Everyone's first lap is a "fastest lap" for a moment: skip those.
      if (done >= 2)
        say(
          `FASTEST LAP  ${this.driverName(k.id).toUpperCase()}  ${formatTime(time)}`,
          "fastest",
        );
    }
    if (
      !n.finalLap &&
      this.sim.laps > 1 &&
      player.lap === this.sim.laps - 1 &&
      !player.finish
    ) {
      n.finalLap = true;
      say("FINAL LAP", "final");
      audio.beep();
    }
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
  /** Leaves the podium for the room lobby. The first racer to do this
   * reopens the lobby on the server; the rest follow when they are ready. */
  backToLobby() {
    if (!this.online?.connected) {
      this.networkMessage = "Not connected to the game server.";
      return;
    }
    if (this.roomState?.phase === "podium")
      this.online.send({ type: "rematch" });
    this.state = "lobby";
    this.closeMenus();
    if (this.roomState?.phase === "lobby") this.receiveRoom(this.roomState);
  }
  /** Sound settings from the lobby; the room keeps updating underneath. */
  lobbySettings() {
    this.roomPanel?.hide();
    this.settings(() => {
      this.closeMenus();
      this.roomPanel?.show();
    });
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
    this.roomPanel = new RoomPanel(this.online, {
      leave: () => this.leaveOnline(),
      settings: () => this.lobbySettings(),
      colors: cssColors,
    });
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
    this.sprites.forEach((s, i) => s.setVisible(i < SOLO_KARTS));
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
    // Still reading the podium: the lobby opens on RETURN TO LOBBY. (Not
    // mid-cup, where everyone is waiting for the next race: if somebody
    // takes the room back to the lobby, the others follow.)
    if (
      state.phase === "lobby" &&
      this.state === "results" &&
      !(this.nextRace && this.podiumStage === "race")
    )
      return;
    // On a cup podium the host may already have picked the next track; the
    // scene only changes once that race starts.
    if (state.phase !== "podium" || this.networkRaceId !== state.raceId)
      this.setTrack(tracks[state.track] ?? defaultTrack, false, state.easy);
    if (state.phase === "lobby") {
      this.state = "lobby";
      this.input.keyboard!.enabled = false;
      this.roomPanel?.lobby(state);
      // Keep the sound settings open if they are being changed.
      if (this.menuScreen !== "settings") {
        this.closeMenus();
        this.roomPanel?.show();
      }
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
        true,
        state.easy,
      );
      this.networkRaceId = state.raceId;
      this.watching = -1;
      this.nextRace = undefined;
      this.accumulator = 0;
      this.marks.clear();
      this.closeMenus();
      this.sprites.forEach((sprite, i) =>
        sprite.setVisible(i < state.karts.length),
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
        "driftDir",
        "railTurn",
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
      if (this.podiumRaceId !== state.raceId) {
        this.podiumRaceId = state.raceId;
        this.podium = state.results ?? noResults;
        this.results();
      }
      this.showNextRace(state);
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
    // Anything within the screen's diagonal may be in view, whichever way
    // the camera is turned.
    const cam = this.cameras.main,
      reach = Math.hypot(cam.width, cam.height) / 2 + 40;
    const step = Math.floor(this.time.now / 110) % (CHEVRONS.length + 1);
    for (const pad of this.track.pads) {
      if (
        Math.hypot(
          pad.x - cam.scrollX - cam.width / 2,
          pad.y - cam.scrollY - cam.height / 2,
        ) > reach
      )
        continue;
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
    if (pressed("ENTER") && this.state === "results" && this.online)
      this.podiumNext();
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
      this.banner = count;
      if (count !== this.lastCount) {
        this.lastCount = count;
        if (count === "GO!") audio.go();
        else audio.beep();
      }
      if (this.countdown <= 0) {
        this.state = "race";
        this.banner = "";
      }
    } else {
      this.banner = "";
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
    const racingNow = this.state === "race" || this.state === "pause";
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
    // Once our own race is over the camera rides with someone still racing;
    // A / D or the arrow keys move on to the next racer.
    let view = player;
    const live =
      this.online && player.finish && racingNow
        ? this.sim.karts.filter((k) => {
            const m = this.roomState?.members.find((p) => p.kart === k.id);
            return !k.finish && !!m?.connected && !m.dnf;
          })
        : [];
    if (live.length) {
      let i = live.findIndex((k) => k.id === this.watching);
      if (i < 0) {
        // Start with whoever is furthest ahead of those still out there.
        const ahead = this.roomState?.order.find((id) =>
          live.some((k) => k.id === id),
        );
        i = Math.max(
          0,
          live.findIndex((k) => k.id === ahead),
        );
      } else if (this.state === "race")
        i =
          (((i + this.watchStep) % live.length) + live.length) % live.length;
      view = live[i];
      this.watching = view.id;
    } else this.watching = -1;
    this.watchStep = 0;
    hud.watch(
      this.watching < 0
        ? ""
        : (this.roomState?.members.find((m) => m.kart === this.watching)
            ?.name ?? "RACER"),
    );
    const vb = view.body;
    const drawnX = vb.position.x + this.smoothing[view.id].x,
      drawnY = vb.position.y + this.smoothing[view.id].y;
    // Easy mode: the camera turns with the kart, so the kart always points
    // up the screen and left / right always mean what they look like.
    const turned =
      this.easy &&
      !!this.online &&
      (racingNow || this.state === "countdown");
    const heading = vb.angle + this.smoothing[view.id].a;
    const tx = turned
        ? // The kart sits below the middle, with more road in view ahead.
          drawnX + Math.cos(heading) * cam.height * 0.2 - cam.width / 2
        : drawnX +
          Phaser.Math.Clamp(
            vb.velocity.x * 22,
            -cam.width * 0.25,
            cam.width * 0.25,
          ) -
          cam.width / 2,
      ty = turned
        ? drawnY + Math.sin(heading) * cam.height * 0.2 - cam.height / 2
        : drawnY +
          Phaser.Math.Clamp(
            vb.velocity.y * 22,
            -cam.height * 0.25,
            cam.height * 0.25,
          ) -
          cam.height / 2;
    // Cut straight to a newly chosen kart instead of panning across the map.
    const blend =
      view.id === this.lastView && turned === this.turned
        ? 1 - Math.exp(-Math.min(delta, 100) / 160)
        : 1;
    this.lastView = view.id;
    this.turned = turned;
    const facing = turned ? -Math.PI / 2 - heading : 0;
    this.camTurn +=
      Phaser.Math.Angle.Wrap(facing - this.camTurn) *
      (blend === 1 ? 1 : 1 - Math.exp(-Math.min(delta, 100) / 110));
    cam.setRotation(this.camTurn);
    cam.setScroll(
      Math.round(Phaser.Math.Linear(cam.scrollX, tx, blend)),
      Math.round(Phaser.Math.Linear(cam.scrollY, ty, blend)),
    );
    // Name tags (online): HTML over the canvas, placed after the camera
    // has moved so they stay glued to their karts.
    const zoom = this.scale.zoom;
    const cos = Math.cos(this.camTurn),
      sin = Math.sin(this.camTurn);
    /** Where a point of the world is on screen, allowing for the turn. */
    const onScreen = (x: number, y: number) => {
      const dx = x - cam.scrollX - cam.width / 2,
        dy = y - cam.scrollY - cam.height / 2;
      return {
        x: cam.width / 2 + dx * cos - dy * sin,
        y: cam.height / 2 + dx * sin + dy * cos,
      };
    };
    hud.tags(
      this.online
        ? this.sim.karts.flatMap((k) => {
            const member = this.roomState?.members.find((m) => m.kart === k.id);
            const at = onScreen(this.sprites[k.id].x, this.sprites[k.id].y);
            return member
              ? [
                  {
                    x: at.x * zoom,
                    y: (at.y - 15) * zoom,
                    text: member.name + (member.connected ? "" : " (OFFLINE)"),
                    me: k.id === this.playerId,
                  },
                ]
              : [];
          })
        : [],
    );
    let notice = true;
    if (this.state === "race" && player.resetRemaining > 0)
      this.banner = `RESET PENALTY\n${player.resetRemaining.toFixed(1)}s`;
    else if (this.state === "race" && this.sim.time < this.lapNoticeUntil)
      this.banner = this.lapNotice;
    else notice = false;
    hud.banner(this.banner, notice);
    hud.mode(
      this.state === "race" ||
        this.state === "countdown" ||
        this.state === "pause"
        ? "race"
        : this.state === "results" && this.online
          ? "status"
          : "off",
    );
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
    if (this.state === "race") this.callouts(player);
    const racing = this.state === "race" || this.state === "pause";
    hud.callout(
      racing && this.sim.time < this.notes.until ? this.notes.text : "",
      this.notes.tone,
    );
    hud.arrow(
      racing && this.sim.time < this.notes.arrowUntil ? this.notes.arrow : 0,
    );
    const finishIn = this.roomState?.finishRemaining;
    hud.set({
      network: this.online
        ? this.networkMessage ||
          (this.state === "results"
            ? ""
            : player.finish
              ? this.watching < 0
                ? "FINISHED - WAITING FOR THE PODIUM"
                : `FINISHED${typeof finishIn === "number" ? " / RACE ENDS IN " + Math.ceil(finishIn) + "s" : ""}`
              : `ROOM ${this.online.code} / ${this.online.latency}ms${typeof finishIn === "number" ? " / FINISH IN " + Math.ceil(finishIn) + "s" : ""}`)
        : "",
      position: `P${pos}/${this.sim.karts.length}`,
      lap: `LAP ${Math.min(this.sim.laps, player.lap + 1)}/${this.sim.laps}`,
      time: formatTime(this.sim.time),
      track: this.track.name,
      lapTime: formatTime(
        player.finish
          ? player.lapTimes.at(-1)!
          : this.sim.time - player.lapStartedAt,
      ),
      lastLap: formatTime(player.lapTimes.at(-1) ?? null),
      bestLap: formatTime(this.records.lap) + (this.tunedSession ? "*" : ""),
      speed: String(
        Math.round(Math.hypot(b.velocity.x, b.velocity.y) * 13),
      ).padStart(3, "0"),
    });
    const level = driftLevel(player);
    if (this.state === "race") {
      if (player.boost > this.lastBoost + 0.05) audio.boost();
      if (level > this.lastDriftLevel) audio.charge(level);
    }
    this.lastBoost = player.boost;
    this.lastDriftLevel = level;
    // Speed only; its colour hints at boost (gold), drift charge (blue,
    // then orange) and slipstream (pale gold).
    hud.speedColor(
      player.boost > 0
        ? "#ffd36b"
        : player.input.drift && level > 0
          ? ["#edf0da", "#7cc8ff", "#ffb057"][level]
          : player.draft > 0.1
            ? "#f5d982"
            : "#edf0da",
    );
    hud.map({
      points: this.track.points,
      world: this.track.WORLD,
      karts: this.sim.karts.map((k) => ({
        x: k.body.position.x,
        y: k.body.position.y,
        color: cssColors[k.id],
        me: k.id === this.playerId,
      })),
    });
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
// For looking at the game from the browser console while developing.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV)
  Object.assign(window, { slipstream: game });
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
