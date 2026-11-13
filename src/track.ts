import foundryMap from "../assets/tracks/foundry.json";
import overpassData from "../assets/tracks/overpass.json";
import valenciaData from "../assets/tracks/valencia.json";
import type { SceneryItem } from "./scenery";
export type Point = { x: number; y: number };
export interface TrackData {
  id: string;
  name: string;
  width: number;
  height: number;
  road: number;
  /** Centreline control points, in driving order. The start straight must
   * run left to right (east) with room behind the line for the grid. */
  anchors: number[][];
  start: Point;
  grandstands: { x: number; y: number; width: number; height: number }[];
  sign?: Point;
  /** Scenery around the road: grass and trees ("park", the default) or
   * city blocks ("street"). Painted in makeTrack in src/main.ts. */
  theme?: "park" | "street";
  /** Decorations painted on the ground (see src/scenery.ts). */
  scenery?: SceneryItem[];
  /** Tyre stacks around the bends and sponsor boards along the straights. */
  trackside?: boolean;
  /** Boost pads: `at` is the distance after the start line, `offset` how far
   * right (+) or left (-) of the centreline the pad sits. */
  pads?: { at: number; offset: number }[];
}
/** Boost pad size: length along the road and width across it. */
export const PAD = { length: 30, width: 26 };
export const angleDiff = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Where one stretch of road passes over another, each stretch is a layer for
// this far either side of the crossing. Karts and walls on different layers
// ignore each other, which is what makes it a bridge and not a junction.
const BRIDGE_REACH = 190;
export const LAYER = { ground: 0, under: 1, over: 2 } as const;

export function buildTrack(data: TrackData) {
  const WORLD = { width: data.width, height: data.height };
  const ROAD = data.road;
  const anchors = data.anchors;
  const points: Point[] = [];
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
  const count = points.length;
  const lengths = [0];
  for (let i = 1; i <= count; i++) {
    const a = points[i - 1],
      b = points[i % count];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const totalLength = lengths.at(-1)!;
  const wrap = (s: number) => ((s % totalLength) + totalLength) % totalLength;
  /** Index of the centreline segment that contains distance `s`. */
  function segmentAt(s: number) {
    s = wrap(s);
    let i = 0;
    while (lengths[i + 1] < s) i++;
    return i;
  }
  function atDistance(s: number): Point {
    s = wrap(s);
    const i = segmentAt(s);
    const t = (s - lengths[i]) / (lengths[i + 1] - lengths[i]);
    const a = points[i],
      b = points[(i + 1) % count];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function scan(p: Point, from: number, span: number) {
    let best = Infinity,
      index = 0,
      progress = 0,
      q = points[0];
    for (let n = 0; n < span; n++) {
      const i = (((from + n) % count) + count) % count;
      const a = points[i],
        b = points[(i + 1) % count],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
        ),
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
  /**
   * Closest point on the centreline. Pass the segment a kart was last on as
   * `hint` so that, where the road crosses itself, the kart stays matched to
   * the stretch it is actually driving on.
   */
  function nearest(p: Point, hint?: number) {
    if (hint !== undefined) {
      const back = 6,
        span = 20;
      const local = scan(p, hint - back, span);
      const edge = (((local.index - hint + back) % count) + count) % count;
      // Trust the local answer unless the kart has clearly been moved.
      if (local.distance < ROAD && edge > 0 && edge < span - 1) return local;
    }
    return scan(p, 0, count);
  }
  /**
   * The line `d` to the right (+) or left (-) of the centreline, one point
   * per centreline point. On the inside of a bend tighter than `d` the plain
   * sideways offset doubles back on itself and pokes out behind the corner,
   * so that loop is cut off: its points all move to where the line crosses
   * itself, which leaves one clean corner.
   */
  const edges = new Map<number, Point[]>();
  function edge(d: number) {
    const known = edges.get(d);
    if (known) return known;
    const mod = (i: number) => ((i % count) + count) % count;
    const raw = points.map((p, i) => {
      const a = points[mod(i - 1)],
        b = points[mod(i + 1)];
      const h = Math.atan2(b.y - a.y, b.x - a.x);
      return { x: p.x - Math.sin(h) * d, y: p.y + Math.cos(h) * d };
    });
    const line = raw.map((p) => ({ ...p }));
    edges.set(d, line);
    // Segments of the offset line that run against the road's direction.
    const back = points.map((a, i) => {
      const b = points[mod(i + 1)],
        p = raw[i],
        q = raw[mod(i + 1)];
      return (b.x - a.x) * (q.x - p.x) + (b.y - a.y) * (q.y - p.y) <= 0;
    });
    // A bend can double back in two places; treat close ones as one loop.
    const JOIN = 8;
    let since = Infinity;
    const before = back.map(() => 0);
    for (let i = -JOIN; i < count; i++) {
      since = back[mod(i)] ? 0 : since + 1;
      if (i >= 0) before[i] = since;
    }
    since = Infinity;
    const folded = [...back];
    for (let i = count + JOIN; i >= 0; i--) {
      since = back[mod(i)] ? 0 : since + 1;
      if (i < count && before[i] + since <= JOIN + 1) folded[i] = true;
    }
    if (folded.every(Boolean)) return line;
    const crossing = (i: number, j: number) => {
      const a = raw[mod(i)],
        b = raw[mod(i + 1)],
        c = raw[mod(j)],
        e = raw[mod(j + 1)];
      const rx = b.x - a.x,
        ry = b.y - a.y,
        sx = e.x - c.x,
        sy = e.y - c.y;
      const cross = rx * sy - ry * sx;
      if (Math.abs(cross) < 1e-9) return null;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross,
        u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross;
      if (t < 0 || t > 1 || u < 0 || u > 1) return null;
      return { x: a.x + rx * t, y: a.y + ry * t };
    };
    for (let first = 0; first < count; first++) {
      if (!folded[first] || folded[mod(first - 1)]) continue;
      let last = first;
      while (folded[mod(last + 1)]) last++;
      // Walk outwards from the loop until the line before it meets the line
      // after it.
      let hit: Point | null = null,
        from = first,
        to = last + 1;
      search: for (let reach = 0; reach < 60; reach++)
        for (let k = 0; k <= reach; k++)
          for (let m = 0; m <= reach; m++) {
            if (Math.max(k, m) !== reach) continue;
            hit = crossing(first - 1 - k, last + 1 + m);
            if (!hit) continue;
            from = first - k;
            to = last + 1 + m;
            break search;
          }
      if (!hit) {
        const a = raw[mod(first)],
          b = raw[mod(last + 1)];
        hit = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      for (let i = from; i <= to; i++) line[mod(i)] = { ...hit };
    }
    // Loops that overlap can leave a point just past a corner; pull any such
    // point into the corner.
    for (let pass = 0, moved = true; moved && pass < 12; pass++) {
      moved = false;
      for (let i = 0; i < count; i++) {
        const a = points[i],
          b = points[mod(i + 1)],
          p = line[i],
          q = line[mod(i + 1)];
        if ((b.x - a.x) * (q.x - p.x) + (b.y - a.y) * (q.y - p.y) < -1e-6) {
          line[i] = { ...q };
          moved = true;
        }
      }
    }
    return line;
  }
  const offset = (i: number, d: number) => edge(d)[i];
  // Shared by timing gates, grid paint and physical spawn positions.
  const START = { ...data.start };
  const startDistance = nearest(START).progress;
  const gatePosition = (gate: number, gates = 24) =>
    atDistance(startDistance + (gate * totalLength) / gates);
  const gridPosition = (id: number) => ({
    x: START.x - 25 - Math.floor(id / 2) * 38,
    y: START.y + (id % 2 ? 23 : -23),
  });
  function wallVertices(index: number, side: number) {
    const next = (index + 1) % count;
    return [
      offset(index, side * (ROAD / 2 + 22)),
      offset(next, side * (ROAD / 2 + 22)),
      offset(next, side * (ROAD / 2 + 30)),
      offset(index, side * (ROAD / 2 + 30)),
    ];
  }
  // Find where the road crosses itself, if it does. The first pass through
  // the crossing goes under; the second goes over the bridge.
  const layer: number[] = Array(count).fill(LAYER.ground);
  let bridge: { x: number; y: number; over: number; under: number } | null =
    null;
  search: for (let i = 0; i < count; i++)
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const a = points[i],
        b = points[(i + 1) % count],
        c = points[j],
        d = points[(j + 1) % count];
      const rx = b.x - a.x,
        ry = b.y - a.y,
        sx = d.x - c.x,
        sy = d.y - c.y;
      const cross = rx * sy - ry * sx;
      if (Math.abs(cross) < 1e-9) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross,
        u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      bridge = {
        x: a.x + rx * t,
        y: a.y + ry * t,
        under: lengths[i] + t * (lengths[i + 1] - lengths[i]),
        over: lengths[j] + u * (lengths[j + 1] - lengths[j]),
      };
      break search;
    }
  if (bridge)
    for (let i = 0; i < count; i++) {
      const middle = (lengths[i] + lengths[i + 1]) / 2;
      const gap = (to: number) => {
        const d = Math.abs(middle - to);
        return Math.min(d, totalLength - d);
      };
      if (gap(bridge.under) < BRIDGE_REACH) layer[i] = LAYER.under;
      if (gap(bridge.over) < BRIDGE_REACH) layer[i] = LAYER.over;
    }
  const pads = (data.pads ?? []).map(({ at, offset: side }) => {
    const s = startDistance + at,
      a = atDistance(s - 6),
      b = atDistance(s + 6),
      angle = Math.atan2(b.y - a.y, b.x - a.x),
      c = atDistance(s);
    return {
      x: c.x - Math.sin(angle) * side,
      y: c.y + Math.cos(angle) * side,
      angle,
    };
  });
  return {
    id: data.id,
    name: data.name,
    WORLD,
    ROAD,
    points,
    lengths,
    totalLength,
    segmentAt,
    atDistance,
    nearest,
    offset,
    START,
    startDistance,
    gatePosition,
    gridPosition,
    wallVertices,
    grandstands: data.grandstands,
    sign: data.sign,
    theme: data.theme ?? "park",
    scenery: data.scenery ?? [],
    trackside: data.trackside ?? false,
    pads,
    /** Bridge layer of each centreline segment (see LAYER). */
    layer,
    bridge,
  };
}
export type Track = ReturnType<typeof buildTrack>;

// Foundry is a Tiled map (see README); newer tracks use the plain TrackData
// JSON shape directly.
function fromTiled(id: string, name: string, map: typeof foundryMap) {
  const property = (key: string) =>
    map.properties.find((p) => p.name === key)!.value;
  const objects = (layerName: string) =>
    map.layers.find((l) => l.name === layerName)!.objects;
  const line = objects("Racing line")[0];
  if (!("polyline" in line) || !line.polyline)
    throw new Error("Tiled Racing line layer needs a polyline");
  const start = objects("Timing")[0];
  return buildTrack({
    id,
    name,
    width: property("worldWidth"),
    height: property("worldHeight"),
    road: property("roadWidth"),
    anchors: line.polyline.map((p) => [p.x + line.x, p.y + line.y]),
    start: { x: start.x, y: start.y },
    grandstands: objects("Grandstands"),
    sign: { x: 780, y: 1195 },
    pads: [
      { at: 260, offset: -32 },
      { at: 3790, offset: 30 },
      { at: 7720, offset: 34 },
    ],
  });
}
export const tracks: Record<string, Track> = {
  foundry: fromTiled("foundry", "FOUNDRY CIRCUIT", foundryMap),
  overpass: buildTrack(overpassData as TrackData),
  // Traced from a circuit outline; see the anchors in valencia.json.
  valencia: buildTrack(valenciaData as TrackData),
};
export const trackIds = Object.keys(tracks);
export const defaultTrack = tracks.foundry;
