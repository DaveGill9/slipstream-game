// In-race HUD. It is HTML drawn over the game, not part of the pixel canvas:
// the canvas is only 432 px tall and stretched to fit the window, which made
// HUD text blurry and blocky. Here a pixel font is drawn at the screen's own
// resolution, with every font pixel a whole number of screen pixels, so the
// HUD keeps the retro look but stays sharp.
const fontUrl = new URL("../assets/fonts/press-start-2p.woff2", import.meta.url)
  .href;
// Without the font the HUD falls back to bold monospace.
try {
  const font = new FontFace("Press Start 2P", `url(${fontUrl})`);
  // (The project's TypeScript DOM types leave out FontFaceSet.add.)
  (document.fonts as unknown as { add(font: FontFace): void }).add(font);
  font.load().catch(() => {});
} catch {
  /* Very old browsers: the fallback font is used. */
}
/** Screen pixels per HUD pixel: 2 on a 1080p screen, 5 on 4K. */
const unit = () =>
  Math.max(1, Math.round((innerHeight * devicePixelRatio) / 450));
const MAP = { width: 120, height: 80, pad: 8 };
export interface HudMap {
  points: { x: number; y: number }[];
  world: { width: number; height: number };
  karts: { x: number; y: number; color: string; me: boolean }[];
}
export class Hud {
  root = document.createElement("div");
  private nodes: Record<string, HTMLElement> = {};
  private shown: Record<string, string> = {};
  private canvas: HTMLCanvasElement;
  private tagLayer!: HTMLElement;
  private tagNodes: HTMLElement[] = [];
  constructor() {
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-tags"></div>
      <div class="hud-left">
        <div class="hud-panel hud-race">
          <span><span data-hud="position"></span><i class="hud-arrow"></i></span><span data-hud="lap"></span>
          <span data-hud="time"></span><span data-hud="track" class="hud-dim"></span>
        </div>
        <div class="hud-panel hud-timing">
          <span class="hud-dim">LAP</span><span data-hud="lapTime"></span>
          <span class="hud-dim">LAST</span><span data-hud="lastLap"></span>
          <span class="hud-dim">BEST</span><span data-hud="bestLap"></span>
        </div>
      </div>
      <div class="hud-panel hud-speed"><span data-hud="speed"></span> <span class="hud-dim">KM/H</span></div>
      <div class="hud-callout" data-hud="callout"></div>
      <div class="hud-banner" data-hud="banner"></div>
      <div class="hud-watch"><span class="hud-keycap">A</span><span class="hud-dim">WATCHING</span> <span data-hud="watch"></span><span class="hud-keycap">D</span></div>
      <div class="hud-network" data-hud="network"></div>
      <div class="hud-hint"><span class="hud-keycap">ESC</span> PIT MENU</div>
      <canvas class="hud-panel hud-map"></canvas>`;
    this.root
      .querySelectorAll<HTMLElement>("[data-hud]")
      .forEach((node) => (this.nodes[node.dataset.hud!] = node));
    this.canvas = this.root.querySelector("canvas")!;
    this.tagLayer = this.root.querySelector(".hud-tags")!;
    document.body.append(this.root);
    addEventListener("resize", () => this.resize());
    this.resize();
  }
  resize() {
    this.root.style.setProperty("--u", `${unit() / devicePixelRatio}px`);
    this.canvas.width = MAP.width * unit();
    this.canvas.height = MAP.height * unit();
  }
  /** "race" shows everything; "status" only the connection message (podium);
   * "off" hides the HUD (menus and lobby). */
  mode(mode: "race" | "status" | "off") {
    if (this.root.dataset.mode !== mode) this.root.dataset.mode = mode;
  }
  /** Sets one readout, touching the page only when its text changes. */
  set(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values))
      if (this.shown[key] !== value) {
        this.shown[key] = value;
        this.nodes[key].textContent = value;
      }
  }
  speedColor(color: string) {
    if (this.shown.speedColor === color) return;
    this.shown.speedColor = color;
    this.nodes.speed.style.color = color;
  }
  /** A short race message at the top of the screen ("FINAL LAP"). The
   * tone picks its colour: "lead", "fastest" or "final". */
  callout(text: string, tone = "") {
    this.set({ callout: text });
    if (this.nodes.callout.dataset.tone !== tone)
      this.nodes.callout.dataset.tone = tone;
  }
  /** Arrow beside the position: 1 gained a place, -1 lost one, 0 none. */
  arrow(direction: number) {
    const arrow = this.root.querySelector<HTMLElement>(".hud-arrow")!;
    const value = direction > 0 ? "up" : direction < 0 ? "down" : "";
    if (arrow.dataset.way !== value) arrow.dataset.way = value;
  }
  /** Who we are watching after our own race is over ("" hides it). */
  watch(name: string) {
    this.set({ watch: name });
    const bar = this.root.querySelector<HTMLElement>(".hud-watch")!;
    if (bar.hidden !== !name) bar.hidden = !name;
  }
  /** Centre-screen text: big for the countdown, small for notices. */
  banner(text: string, small = false) {
    this.set({ banner: text });
    this.nodes.banner.classList.toggle("hud-banner-small", small);
  }
  /** Name tags above karts. x and y are CSS pixels on the page, at the
   * bottom centre of each tag. */
  tags(tags: { x: number; y: number; text: string; me: boolean }[]) {
    tags.forEach((tag, i) => {
      let node = this.tagNodes[i];
      if (!node) {
        node = this.tagNodes[i] = document.createElement("span");
        this.tagLayer.append(node);
      }
      if (node.textContent !== tag.text) node.textContent = tag.text;
      node.hidden = false;
      node.classList.toggle("hud-tag-me", tag.me);
      // Whole screen pixels keep the pixel font sharp while it moves.
      const snap = (value: number) =>
        Math.round(value * devicePixelRatio) / devicePixelRatio;
      node.style.transform = `translate(${snap(tag.x)}px, ${snap(tag.y)}px) translate(-50%, -100%)`;
    });
    for (let i = tags.length; i < this.tagNodes.length; i++)
      this.tagNodes[i].hidden = true;
  }
  map({ points, world, karts }: HudMap) {
    const u = unit(),
      c = this.canvas.getContext("2d")!;
    const inner = {
      width: MAP.width - MAP.pad * 2,
      height: MAP.height - MAP.pad * 2,
    };
    // Fit the whole circuit inside the map window.
    const scale =
      Math.min(inner.width / world.width, inner.height / world.height) * u;
    const ox = (this.canvas.width - world.width * scale) / 2,
      oy = (this.canvas.height - world.height * scale) / 2;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.strokeStyle = "#7b8c78";
    c.lineWidth = 4 * u;
    c.lineJoin = "round";
    c.beginPath();
    points.forEach((p, i) =>
      i
        ? c.lineTo(ox + p.x * scale, oy + p.y * scale)
        : c.moveTo(ox + p.x * scale, oy + p.y * scale),
    );
    c.closePath();
    c.stroke();
    // Our own kart is drawn last and larger so it is never hidden.
    for (const kart of [...karts].sort((a, b) => Number(a.me) - Number(b.me))) {
      const size = (kart.me ? 5 : 3) * u;
      const x = Math.round(ox + kart.x * scale - size / 2),
        y = Math.round(oy + kart.y * scale - size / 2);
      if (kart.me) {
        c.fillStyle = "#172f2b";
        c.fillRect(x - u, y - u, size + 2 * u, size + 2 * u);
      }
      c.fillStyle = kart.color;
      c.fillRect(x, y, size, size);
    }
  }
}
