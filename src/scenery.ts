// Decorations painted onto a track's ground texture (see makeTrack in
// src/main.ts): lakes, farms, a paddock, tents and so on. They are listed
// per track as `scenery` in the track's JSON and are pictures only: nothing
// here touches the physics. Everything is drawn with whole-pixel rectangles
// so it matches the rest of the pixel art.
import type { Track } from "./track";
export interface SceneryItem {
  type: string;
  x: number;
  y: number;
  /** Size, for the kinds that fill an area. */
  w?: number;
  h?: number;
  /** Fields: "wheat", "green" or "vines". */
  crop?: string;
}
type Box = { x: number; y: number; w: number; h: number };
type Ctx = CanvasRenderingContext2D;
type Random = () => number;

const PAINTS = ["#bd4c42", "#4b63d6", "#e3c66a", "#54716c", "#f08a3c"];
const CARS = ["#bd4c42", "#e7e4ca", "#4b63d6", "#2e3436", "#b9bba5", "#e3c66a"];
const CLOTHES = ["#e97262", "#f0d278", "#edf0da", "#6fa3c9", "#b38cde"];

const rect = (
  c: Ctx,
  colour: string,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  c.fillStyle = colour;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
/** A rough-edged oval built from 2 px rows, for water, sand and dirt. */
const blob = (
  c: Ctx,
  colour: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phase = 0,
) => {
  for (let y = -ry; y < ry; y += 2) {
    const half =
      rx *
      Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) *
      (1 + 0.07 * Math.sin(y * 0.07 + phase));
    const shift = Math.sin(y * 0.031 + phase * 2) * rx * 0.08;
    rect(
      c,
      colour,
      Math.round((cx - half + shift) / 2) * 2,
      cy + y,
      Math.round(half) * 2,
      2,
    );
  }
};
export function drawTree(c: Ctx, x: number, y: number, pine = false) {
  x = Math.round(x);
  y = Math.round(y);
  rect(c, "rgba(28, 38, 38, 0.25)", x - 3, y - 1, 13, 11);
  if (pine) {
    rect(c, "#3f5a3a", x - 5, y - 2, 11, 5);
    rect(c, "#3f5a3a", x - 2, y - 5, 5, 11);
    rect(c, "#3f5a3a", x - 4, y - 4, 9, 9);
    rect(c, "#587a48", x - 2, y - 2, 5, 5);
    rect(c, "#7c9a58", x - 1, y - 1, 2, 2);
    return;
  }
  rect(c, "#526a3b", x - 6, y - 3, 14, 11);
  rect(c, "#526a3b", x - 3, y - 6, 9, 17);
  rect(c, "#82964f", x - 4, y - 4, 8, 8);
  rect(c, "#9aab64", x - 2, y - 3, 3, 3);
}
const bush = (c: Ctx, x: number, y: number) => {
  rect(c, "#4c6338", x - 3, y - 2, 8, 6);
  rect(c, "#6f8a48", x - 2, y - 2, 5, 4);
};
const rock = (c: Ctx, x: number, y: number) => {
  rect(c, "rgba(28, 38, 38, 0.3)", x - 2, y, 8, 5);
  rect(c, "#8f958c", x - 3, y - 2, 7, 5);
  rect(c, "#b4b9ae", x - 2, y - 2, 3, 2);
};
const car = (c: Ctx, colour: string, x: number, y: number, upright = true) => {
  const [w, h] = upright ? [9, 16] : [16, 9];
  rect(c, "rgba(28, 38, 38, 0.3)", x + 2, y + 2, w, h);
  rect(c, colour, x, y, w, h);
  if (upright) rect(c, "#1f2a2a", x + 1, y + 4, 7, 4);
  else rect(c, "#1f2a2a", x + 4, y + 1, 4, 7);
};
const tyres = (c: Ctx, x: number, y: number) => {
  rect(c, "#1f2626", x - 3, y - 3, 6, 6);
  rect(c, "#5a6262", x - 1, y - 1, 2, 2);
};
/** A striped marquee seen from above. */
const marquee = (
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
) => {
  rect(c, "rgba(28, 38, 38, 0.35)", x + 5, y + 6, w, h);
  rect(c, "#edf0da", x, y, w, h);
  for (let sx = 0; sx < w; sx += 12) rect(c, colour, x + sx, y, 6, h);
  rect(c, "rgba(0, 0, 0, 0.14)", x, y + h / 2, w, h / 2);
  rect(c, "rgba(0, 0, 0, 0.3)", x, y + h / 2 - 1, w, 2);
};

const painters: Record<
  string,
  (c: Ctx, item: Required<SceneryItem>, random: Random) => void
> = {
  lake(c, { x, y, w, h }, random) {
    const cx = x + w / 2,
      cy = y + h / 2,
      rx = w / 2,
      ry = h / 2;
    blob(c, "#5d7242", cx, cy, rx, ry, 1);
    blob(c, "#c9b98a", cx, cy, rx - 4, ry - 4, 1);
    blob(c, "#6ba3ae", cx, cy, rx - 10, ry - 10, 1);
    blob(c, "#4f8a9b", cx, cy, rx - 18, ry - 18, 1);
    blob(c, "#437a8c", cx - 4, cy + 6, rx - 38, ry - 40, 2);
    const inside = (px: number, py: number, by: number) =>
      ((px - cx) / (rx - by)) ** 2 + ((py - cy) / (ry - by)) ** 2 < 1;
    for (let i = 0; i < (w * h) / 900; i++) {
      const px = x + random() * w,
        py = y + random() * h;
      if (inside(px, py, 30))
        rect(c, "#8fc0c6", px, py, 4 + Math.floor(random() * 6), 1);
    }
    for (let i = 0; i < (w * h) / 2600; i++) {
      const px = x + random() * w,
        py = y + random() * h;
      if (!inside(px, py, 24) || inside(px, py, 46)) continue;
      rect(c, "#5f8a4a", px, py, 4, 3);
      if (random() < 0.4) rect(c, "#eab0c0", px + 1, py + 1, 2, 1);
    }
    // Reeds around the bank.
    for (let i = 0; i < (w + h) / 5; i++) {
      const a = random() * Math.PI * 2;
      const px = cx + Math.cos(a) * (rx - 8),
        py = cy + Math.sin(a) * (ry - 8);
      rect(c, "#4c6338", px, py - 2, 2, 5);
      rect(c, "#8a7a45", px, py - 3, 2, 2);
    }
    // A jetty on the east bank with a rowing boat tied up beside it.
    const jx = cx + rx - 52,
      jy = Math.round(cy - 20);
    rect(c, "rgba(20, 40, 50, 0.35)", jx + 2, jy + 3, 62, 8);
    rect(c, "#8a6a45", jx, jy, 62, 8);
    for (let px = 0; px < 62; px += 6) rect(c, "#6f5336", jx + px, jy, 1, 8);
    rect(c, "#5a4630", jx - 1, jy - 1, 3, 3);
    rect(c, "#5a4630", jx - 1, jy + 6, 3, 3);
    rect(c, "#e7e4ca", jx + 6, jy + 12, 18, 8);
    rect(c, "#e7e4ca", jx + 4, jy + 14, 22, 4);
    rect(c, "#8a6a45", jx + 8, jy + 14, 14, 4);
    rect(c, "#bd4c42", jx + 13, jy + 13, 3, 6);
    // A second boat out on the water, with a wake.
    rect(c, "#8fc0c6", cx - 34, cy + ry * 0.35 + 3, 14, 1);
    rect(c, "#8fc0c6", cx - 30, cy + ry * 0.35 - 3, 10, 1);
    rect(c, "#e3c66a", cx - 18, cy + ry * 0.35 - 3, 16, 7);
    rect(c, "#7a5a3c", cx - 15, cy + ry * 0.35 - 1, 10, 3);
  },
  pond(c, { x, y, w, h }, random) {
    const cx = x + w / 2,
      cy = y + h / 2;
    blob(c, "#5d7242", cx, cy, w / 2, h / 2, 3);
    blob(c, "#6ba3ae", cx, cy, w / 2 - 5, h / 2 - 5, 3);
    blob(c, "#4f8a9b", cx, cy, w / 2 - 11, h / 2 - 11, 3);
    for (let i = 0; i < 7; i++) {
      const px = cx + (random() - 0.5) * (w - 44),
        py = cy + (random() - 0.5) * (h - 40);
      rect(c, "#8fc0c6", px, py, 5, 1);
    }
    for (let i = 0; i < 5; i++) {
      const a = random() * Math.PI * 2;
      rect(
        c,
        "#5f8a4a",
        cx + Math.cos(a) * (w / 2 - 20),
        cy + Math.sin(a) * (h / 2 - 20),
        4,
        3,
      );
    }
    // Ducks.
    for (let i = 0; i < 3; i++) {
      const px = cx - 12 + i * 9,
        py = cy - 2 + (i % 2) * 5;
      rect(c, "#edf0da", px, py, 4, 3);
      rect(c, "#f08a3c", px + 4, py + 1, 1, 1);
    }
    for (let i = 0; i < 6; i++) {
      const a = random() * Math.PI * 2;
      rock(c, cx + Math.cos(a) * (w / 2 + 2), cy + Math.sin(a) * (h / 2 + 2));
    }
  },
  field(c, { x, y, w, h, crop }, random) {
    rect(c, "#4c6338", x, y, w, h);
    const ix = x + 5,
      iy = y + 5,
      iw = w - 10,
      ih = h - 10;
    if (crop === "wheat") {
      rect(c, "#c9b05c", ix, iy, iw, ih);
      for (let py = 0; py < ih; py += 6) rect(c, "#b89c48", ix, iy + py, iw, 2);
      // The harvested end: stubble, bales and the tractor that made them.
      const cut = Math.round(iw * 0.36);
      rect(c, "#d6c480", ix, iy, cut, ih);
      for (let py = 3; py < ih; py += 6) rect(c, "#c4b06a", ix, iy + py, cut, 1);
      for (let i = 0; i < Math.floor((cut * ih) / 3800); i++) {
        const bx = ix + 8 + random() * (cut - 24),
          by = iy + 8 + random() * (ih - 24);
        rect(c, "rgba(28, 38, 38, 0.3)", bx + 2, by + 2, 9, 9);
        rect(c, "#e0c874", bx, by, 9, 9);
        rect(c, "#c2a850", bx + 2, by + 2, 5, 5);
        rect(c, "#e0c874", bx + 4, by + 4, 1, 1);
      }
      const tx = ix + cut + 4,
        ty = iy + Math.round(ih * 0.4);
      rect(c, "rgba(28, 38, 38, 0.3)", tx + 2, ty + 3, 20, 14);
      rect(c, "#1f2626", tx, ty - 2, 8, 4);
      rect(c, "#1f2626", tx, ty + 12, 8, 4);
      rect(c, "#1f2626", tx + 14, ty - 1, 5, 3);
      rect(c, "#1f2626", tx + 14, ty + 12, 5, 3);
      rect(c, "#bd4c42", tx, ty, 20, 14);
      rect(c, "#e7e4ca", tx + 2, ty + 3, 8, 8);
      rect(c, "#2e3436", tx + 3, ty + 4, 6, 6);
    } else if (crop === "vines") {
      rect(c, "#8f7f58", ix, iy, iw, ih);
      for (let px = 4; px < iw - 4; px += 10)
        for (let py = 3; py < ih - 6; py += 7) {
          rect(c, "#4f6d3c", ix + px, iy + py, 5, 5);
          rect(c, "#7c9a4e", ix + px + 1, iy + py + 1, 2, 2);
        }
    } else {
      rect(c, "#5f7a40", ix, iy, iw, ih);
      for (let px = 0; px < iw; px += 8) rect(c, "#7c9a4e", ix + px, iy, 3, ih);
      for (let px = 4; px < iw; px += 8)
        rect(c, "#6b5a3c", ix + px + 1, iy, 1, ih);
    }
    // A gap in the hedge for the gate.
    rect(c, "#a89b75", x + Math.round(w / 2) - 8, y + h - 5, 16, 5);
  },
  barn(c, { x, y }) {
    blob(c, "#a89b75", x + 70, y + 52, 96, 60, 4);
    rect(c, "rgba(28, 38, 38, 0.38)", x + 7, y + 9, 84, 50);
    rect(c, "#a8483c", x, y, 84, 50);
    rect(c, "rgba(0, 0, 0, 0.16)", x, y + 25, 84, 25);
    rect(c, "#d9d6bc", x, y + 24, 84, 2);
    for (let px = 12; px < 84; px += 12) rect(c, "#8f3c33", x + px, y, 1, 50);
    // The farmhouse.
    rect(c, "rgba(28, 38, 38, 0.38)", x + 106, y + 14, 44, 36);
    rect(c, "#b9bba5", x + 100, y + 6, 44, 36);
    rect(c, "rgba(0, 0, 0, 0.13)", x + 122, y + 6, 22, 36);
    rect(c, "#7a5a3c", x + 108, y + 10, 6, 6);
    // Two silos.
    for (const sx of [14, 44]) {
      blob(c, "rgba(28, 38, 38, 0.35)", x + sx + 5, y + 82, 13, 13);
      blob(c, "#c9ccc6", x + sx, y + 76, 13, 13);
      blob(c, "#e4e6de", x + sx - 3, y + 73, 6, 6);
      rect(c, "#858a86", x + sx - 1, y + 75, 3, 3);
    }
    for (let i = 0; i < 5; i++) {
      rect(c, "#e0c874", x + 96 + i * 11, y + 64, 9, 9);
      rect(c, "#c2a850", x + 98 + i * 11, y + 66, 5, 5);
    }
  },
  paddock(c, { x, y, w, h }, random) {
    rect(c, "#4c5352", x - 3, y - 3, w + 6, h + 6);
    rect(c, "#606665", x, y, w, h);
    for (let i = 0; i < (w * h) / 60; i++)
      rect(c, i % 2 ? "#676d6c" : "#595f5e", x + random() * w, y + random() * h, 1, 1);
    // Pit garages along the top, each with a painted box in front of it.
    const bay = 46;
    const bays = Math.floor((w - 16) / bay);
    for (let i = 0; i < bays; i++) {
      const gx = x + 8 + i * bay,
        colour = PAINTS[i % PAINTS.length];
      rect(c, "rgba(28, 38, 38, 0.4)", gx + 5, y + 12, bay - 4, 34);
      rect(c, "#d9dad2", gx, y + 6, bay - 4, 34);
      rect(c, colour, gx, y + 6, bay - 4, 8);
      rect(c, "rgba(0, 0, 0, 0.12)", gx, y + 24, bay - 4, 16);
      rect(c, "#858a86", gx + 6, y + 18, 10, 7);
      rect(c, "#2e3436", gx + 4, y + 40, bay - 12, 3);
      c.strokeStyle = "#c9ccc6";
      c.lineWidth = 1;
      c.strokeRect(gx + 8.5, y + 50.5, 24, 30);
      if (random() < 0.6) {
        // A kart on its box.
        rect(c, "#1f2626", gx + 13, y + 56, 15, 4);
        rect(c, "#1f2626", gx + 13, y + 71, 15, 4);
        rect(c, colour, gx + 16, y + 54, 9, 22);
        rect(c, "#1f2a2a", gx + 18, y + 63, 5, 5);
      } else {
        tyres(c, gx + 16, y + 60);
        tyres(c, gx + 24, y + 60);
        tyres(c, gx + 20, y + 68);
      }
    }
    // Transporters parked along the bottom.
    for (let tx = x + 14; tx + 84 < x + w; tx += 118) {
      const ty = y + h - 32,
        colour = PAINTS[Math.floor(random() * PAINTS.length)];
      rect(c, "rgba(28, 38, 38, 0.4)", tx + 4, ty + 5, 84, 22);
      rect(c, "#edf0da", tx, ty, 64, 22);
      rect(c, colour, tx, ty + 8, 64, 6);
      rect(c, colour, tx + 66, ty + 2, 18, 18);
      rect(c, "#1f2a2a", tx + 77, ty + 4, 5, 14);
    }
    // Cones marking the lane between the two rows.
    for (let cx = x + 20; cx < x + w - 10; cx += 40) {
      rect(c, "#f08a3c", cx, y + h - 46, 3, 3);
      rect(c, "#edf0da", cx + 1, y + h - 45, 1, 1);
    }
  },
  marquees(c, { x, y, w, h }, random) {
    rect(c, "#7a8a52", x, y, w, h);
    const tw = 50,
      th = 36;
    const across = Math.max(1, Math.floor((w + 14) / (tw + 14))),
      down = Math.max(1, Math.floor((h + 14) / (th + 14)));
    const gx = (w - across * tw) / (across + 1),
      gy = (h - down * th) / (down + 1);
    for (let i = 0; i < across; i++)
      for (let j = 0; j < down; j++)
        marquee(
          c,
          x + gx + i * (tw + gx),
          y + gy + j * (th + gy),
          tw,
          th,
          PAINTS[(i + j * 2) % PAINTS.length],
        );
    for (let i = 0; i < (w * h) / 700; i++) {
      const px = x + random() * w,
        py = y + random() * h;
      const lx = (px - x - gx) % (tw + gx),
        ly = (py - y - gy) % (th + gy);
      if (lx > -3 && lx < tw + 6 && ly > -3 && ly < th + 8) continue;
      rect(c, "rgba(28, 38, 38, 0.35)", px + 1, py + 1, 3, 3);
      rect(c, CLOTHES[Math.floor(random() * CLOTHES.length)], px, py, 3, 3);
    }
  },
  carpark(c, { x, y, w, h }, random) {
    rect(c, "#7a8a52", x, y, w, h);
    for (let py = y + 4; py + 18 <= y + h; py += 44) {
      rect(c, "#9c9070", x, py + 18, w, 8);
      for (const row of [0, 26])
        for (let px = x + 4; px + 9 <= x + w; px += 13) {
          if (py + row + 16 > y + h) continue;
          if (random() < 0.62)
            car(c, CARS[Math.floor(random() * CARS.length)], px, py + row);
        }
    }
    // A post-and-rope fence around it.
    for (let px = x; px <= x + w; px += 12) {
      rect(c, "#7a5a3c", px, y - 3, 2, 2);
      rect(c, "#7a5a3c", px, y + h + 1, 2, 2);
    }
  },
  camp(c, { x, y, w, h }, random) {
    const cx = x + w / 2,
      cy = y + h / 2;
    blob(c, "#7a8a52", cx, cy, w / 2, h / 2, 5);
    // The fire in the middle, with logs to sit on.
    blob(c, "#8f7f58", cx, cy, 16, 14, 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rect(c, "#8f958c", cx + Math.cos(a) * 7 - 1, cy + Math.sin(a) * 7 - 1, 3, 3);
    }
    rect(c, "#f08a3c", cx - 3, cy - 3, 6, 6);
    rect(c, "#f0d278", cx - 1, cy - 1, 3, 3);
    rect(c, "#7a5a3c", cx - 9, cy + 15, 18, 4);
    rect(c, "#7a5a3c", cx - 22, cy - 8, 4, 16);
    const count = Math.max(4, Math.round((w + h) / 46));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4,
        tx = Math.round(cx + Math.cos(a) * (w / 2 - 26) - 9),
        ty = Math.round(cy + Math.sin(a) * (h / 2 - 22) - 7),
        colour = PAINTS[i % PAINTS.length];
      rect(c, "rgba(28, 38, 38, 0.35)", tx + 3, ty + 4, 18, 14);
      rect(c, colour, tx, ty, 18, 14);
      rect(c, "rgba(0, 0, 0, 0.2)", tx, ty + 7, 18, 7);
      rect(c, "#edf0da", tx, ty + 6, 18, 1);
      rect(c, "#1f2a2a", tx + 15, ty + 5, 3, 4);
      if (random() < 0.5) car(c, CARS[i % CARS.length], tx + 22, ty - 2, false);
    }
  },
  helipad(c, { x, y }) {
    blob(c, "#9a9c96", x, y, 34, 34);
    blob(c, "#6f7674", x, y, 30, 30);
    blob(c, "#e3c66a", x, y, 24, 24);
    blob(c, "#6f7674", x, y, 21, 21);
    rect(c, "#edf0da", x - 9, y - 11, 4, 22);
    rect(c, "#edf0da", x + 5, y - 11, 4, 22);
    rect(c, "#edf0da", x - 9, y - 2, 18, 4);
    // The medical tent beside it.
    rect(c, "rgba(28, 38, 38, 0.35)", x + 55, y - 14, 36, 36);
    rect(c, "#edf0da", x + 50, y - 20, 36, 36);
    rect(c, "rgba(0, 0, 0, 0.12)", x + 68, y - 20, 18, 36);
    rect(c, "#bd4c42", x + 65, y - 12, 6, 20);
    rect(c, "#bd4c42", x + 58, y - 5, 20, 6);
    // A windsock on a pole.
    rect(c, "#2e3436", x - 46, y - 30, 2, 2);
    rect(c, "#f08a3c", x - 44, y - 31, 6, 4);
    rect(c, "#edf0da", x - 38, y - 30, 5, 3);
    rect(c, "#f08a3c", x - 33, y - 30, 4, 2);
  },
  flowers(c, { x, y, w, h }, random) {
    for (let i = 0; i < (w * h) / 70; i++) {
      const px = x + random() * w,
        py = y + random() * h;
      // Thin out towards the edges so the patch has no hard outline.
      const edge = Math.min(px - x, x + w - px, py - y, y + h - py);
      if (edge < 10 && random() < 0.6) continue;
      rect(c, CLOTHES[Math.floor(random() * 4)], px, py, 2, 2);
      if (random() < 0.3) rect(c, "#4c6338", px, py + 2, 2, 1);
    }
    for (let i = 0; i < (w * h) / 5000; i++)
      bush(c, x + 6 + random() * (w - 12), y + 6 + random() * (h - 12));
  },
  crowd(c, { x, y, w, h }, random) {
    rect(c, "#7a8a52", x, y, w, h);
    for (let py = 0; py < h; py += 10) rect(c, "#869660", x, y + py, w, 2);
    for (let i = 0; i < (w * h) / 5200; i++) {
      const bx = x + 4 + random() * (w - 22),
        by = y + 4 + random() * (h - 18);
      rect(c, CLOTHES[Math.floor(random() * CLOTHES.length)], bx, by, 14, 10);
      rect(c, "rgba(255, 255, 255, 0.35)", bx + 2, by + 2, 10, 1);
      rect(c, "rgba(255, 255, 255, 0.35)", bx + 2, by + 6, 10, 1);
    }
    for (let i = 0; i < (w * h) / 110; i++) {
      const px = x + 2 + random() * (w - 6),
        py = y + 2 + random() * (h - 6);
      rect(c, "rgba(28, 38, 38, 0.35)", px + 1, py + 1, 3, 3);
      rect(c, CLOTHES[Math.floor(random() * CLOTHES.length)], px, py, 3, 3);
    }
  },
  tower(c, { x, y }) {
    // A water tower: the long shadow gives it height.
    rect(c, "rgba(28, 38, 38, 0.3)", x + 4, y + 4, 34, 10);
    blob(c, "rgba(28, 38, 38, 0.3)", x + 40, y + 12, 15, 15);
    for (const [lx, ly] of [
      [-12, -12],
      [10, -12],
      [-12, 10],
      [10, 10],
    ])
      rect(c, "#4d5352", x + lx, y + ly, 3, 3);
    blob(c, "#b9bba5", x, y, 15, 15);
    blob(c, "#d9dad2", x - 2, y - 2, 11, 11);
    blob(c, "#edf0da", x - 5, y - 5, 4, 4);
    rect(c, "#bd4c42", x - 15, y - 1, 30, 2);
    // The pump house.
    rect(c, "rgba(28, 38, 38, 0.38)", x - 16, y + 36, 30, 22);
    rect(c, "#8f6a4c", x - 20, y + 30, 30, 22);
    rect(c, "rgba(0, 0, 0, 0.15)", x - 20, y + 41, 30, 11);
  },
  wood(c, { x, y, w, h }, random) {
    const trees: { x: number; y: number; pine: boolean }[] = [];
    for (let i = 0; i < (w * h) / 420; i++)
      trees.push({
        x: x + 8 + random() * (w - 16),
        y: y + 8 + random() * (h - 16),
        pine: random() < 0.6,
      });
    // Back to front, so nearer trees overlap the ones behind them.
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) drawTree(c, t.x, t.y, t.pine);
  },
  rocks(c, { x, y, w, h }, random) {
    for (let i = 0; i < (w * h) / 1500; i++) {
      const px = x + random() * w,
        py = y + random() * h;
      random() < 0.5 ? rock(c, px, py) : bush(c, px, py);
    }
  },
};

/** Where a decoration sits, so the scattered trees can keep off it. */
export function sceneryBox(item: SceneryItem): Box {
  const sizes: Record<string, [number, number, number, number]> = {
    barn: [-30, -12, 200, 126],
    helipad: [-50, -38, 144, 76],
    tower: [-24, -20, 84, 82],
  };
  const fixed = sizes[item.type];
  if (fixed)
    return { x: item.x + fixed[0], y: item.y + fixed[1], w: fixed[2], h: fixed[3] };
  return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 };
}

/** Paints a track's decorations and returns the ground they cover. */
export function paintScenery(c: Ctx, items: SceneryItem[]) {
  let seed = 4127;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const boxes: Box[] = [];
  for (const item of items) {
    const paint = painters[item.type];
    if (!paint) continue;
    paint(c, { w: 0, h: 0, crop: "green", ...item }, random);
    // Woods and rockeries are meant to blend into the scattered trees.
    if (item.type !== "wood" && item.type !== "rocks" && item.type !== "flowers")
      boxes.push(sceneryBox(item));
  }
  return boxes;
}

/**
 * Things that stand right beside the road, placed from its shape: stacks of
 * painted tyres around the outside of every bend and sponsor boards along
 * the straights.
 */
export function paintTrackside(c: Ctx, track: Track) {
  const { points, offset, nearest, ROAD, layer } = track;
  const count = points.length;
  const heading = (i: number) => {
    const a = points[(i - 1 + count) % count],
      b = points[(i + 1) % count];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // How far the road turns over the next few points: + is a right-hander.
  const turn = (i: number) => {
    const d = heading((i + 4) % count) - heading((i - 4 + count) % count);
    return Math.atan2(Math.sin(d), Math.cos(d));
  };
  const clear = (p: { x: number; y: number }) =>
    nearest(p).distance > ROAD / 2 + 32;
  let straight = 0;
  for (let i = 0; i < count; i++) {
    const bend = turn(i);
    if (layer[i] !== 0) {
      straight = 0;
      continue;
    }
    if (Math.abs(bend) > 0.3) {
      straight = 0;
      // Tyres go on the outside, where a kart running wide would end up:
      // two stacks to each section of road, close enough to read as a wall.
      const side = (bend > 0 ? -1 : 1) * (ROAD / 2 + 37);
      const a = offset(i, side),
        b = offset((i + 1) % count, side);
      for (let n = 0; n < 2; n++) {
        const p = {
          x: a.x + ((b.x - a.x) * n) / 2,
          y: a.y + ((b.y - a.y) * n) / 2,
        };
        if (!clear(p)) continue;
        const x = Math.round(p.x),
          y = Math.round(p.y);
        rect(c, "rgba(28, 38, 38, 0.35)", x - 2, y - 1, 7, 7);
        rect(c, "#1f2626", x - 3, y - 3, 7, 7);
        rect(c, (i * 2 + n) % 4 < 2 ? "#bd4c42" : "#e7e4ca", x - 2, y - 2, 5, 5);
        rect(c, "#1f2626", x - 1, y - 1, 3, 3);
      }
      continue;
    }
    if (Math.abs(bend) > 0.04) {
      straight = 0;
      continue;
    }
    // Boards in groups of three, a few lengths apart, on alternate sides.
    straight++;
    const slot = straight % 20;
    if (straight < 6 || slot >= 9 || slot % 3 !== 1) continue;
    const side = Math.floor(straight / 20) % 2 ? 1 : -1;
    const p = offset(i, side * (ROAD / 2 + 38));
    if (!clear(p)) continue;
    c.save();
    c.translate(Math.round(p.x), Math.round(p.y));
    c.rotate(heading(i));
    rect(c, "rgba(28, 38, 38, 0.35)", -15, -1, 32, 6);
    rect(c, PAINTS[Math.floor(i / 3) % PAINTS.length], -16, -3, 32, 6);
    rect(c, "#edf0da", -11, -1, 22, 2);
    c.restore();
  }
}
