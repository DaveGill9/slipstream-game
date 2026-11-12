import circuit from "../assets/tracks/foundry.json";
export type Point = { x: number; y: number };
const property = (name: string) =>
  circuit.properties.find((p) => p.name === name)!.value;
export const WORLD = {
  width: property("worldWidth"),
  height: property("worldHeight"),
};
export const ROAD = property("roadWidth");
// Clockwise from the long southern straight. Original geometry inspired by reference 1.
const racingLine = circuit.layers.find((l) => l.name === "Racing line")!
  .objects[0];
if (!("polyline" in racingLine))
  throw new Error("Tiled Racing line layer needs a polyline");
const anchors: [number, number][] = racingLine.polyline!.map((p) => [
  p.x + racingLine.x,
  p.y + racingLine.y,
]);
export const points: Point[] = [];
for (let i = 0; i < anchors.length; i++) {
  const a = anchors[(i - 1 + anchors.length) % anchors.length],
    b = anchors[i],
    c = anchors[(i + 1) % anchors.length],
    d = anchors[(i + 2) % anchors.length];
  for (let j = 0; j < 12; j++) {
    const t = j / 12,
      t2 = t * t,
      t3 = t2 * t;
    const f = (k: number) =>
      0.5 *
      (2 * b[k] +
        (-a[k] + c[k]) * t +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
    points.push({ x: f(0), y: f(1) });
  }
}
export const lengths = [0];
for (let i = 1; i <= points.length; i++) {
  const a = points[i - 1],
    b = points[i % points.length];
  lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
}
export const totalLength = lengths.at(-1)!;
export function atDistance(s: number): Point {
  s = ((s % totalLength) + totalLength) % totalLength;
  let i = 0;
  while (lengths[i + 1] < s) i++;
  const t = (s - lengths[i]) / (lengths[i + 1] - lengths[i]);
  const a = points[i],
    b = points[(i + 1) % points.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function nearest(p: Point) {
  let best = Infinity,
    index = 0,
    progress = 0,
    q = points[0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    const x = a.x + t * dx,
      y = a.y + t * dy,
      dist = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dist < best) {
      best = dist;
      index = i;
      progress = lengths[i] + t * (lengths[i + 1] - lengths[i]);
      q = { x, y };
    }
  }
  return { distance: Math.sqrt(best), index, progress, point: q };
}
export function offset(i: number, d: number) {
  const p = points[i],
    a = points[(i - 1 + points.length) % points.length],
    b = points[(i + 1) % points.length];
  const h = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: p.x - Math.sin(h) * d, y: p.y + Math.cos(h) * d };
}
export const angleDiff = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Shared by timing gates, grid paint and physical spawn positions.
const start = circuit.layers.find((l) => l.name === "Timing")!.objects[0];
export const START = { x: start.x, y: start.y };
export const grandstands = circuit.layers.find(
  (l) => l.name === "Grandstands",
)!.objects;
export const startDistance = nearest(START).progress;
export const gatePosition = (gate: number, count = 24) =>
  atDistance(startDistance + (gate * totalLength) / count);
export const gridPosition = (id: number) => ({
  x: START.x - 25 - Math.floor(id / 2) * 38,
  y: START.y + (id % 2 ? 23 : -23),
});
export function wallVertices(index: number, side: number) {
  const next = (index + 1) % points.length;
  return [
    offset(index, side * (ROAD / 2 + 22)),
    offset(next, side * (ROAD / 2 + 22)),
    offset(next, side * (ROAD / 2 + 30)),
    offset(index, side * (ROAD / 2 + 30)),
  ];
}
