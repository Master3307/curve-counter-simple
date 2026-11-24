/**
 * Routes: rides that go from the same start to the same end.
 *
 * - Every ride keeps a small "shape" (≤ 150 points), enough for map previews and comparing.
 * - Two rides belong to the same route when their starts and their ends are close
 *   (≤ SAME_PLACE m – a parking spot, the same house).
 * - Inside a route, rides that took a clearly different road are a separate **variant**
 *   ("alternative route"); rides along the same roads are the same variant.
 * - Merging by hand: allowed straight away up to SAME_PLACE, with a question up to ASK_PLACE
 *   ("other side of the building?"), refused beyond.
 */
import { distance, type Fix } from './geo';

export type Shape = [number, number][];

/** m: same place (start / end of two rides) */
export const SAME_PLACE = 300;
/** m: maybe the same place – ask before merging */
export const ASK_PLACE = 1500;
/** share of the track that must run along the other one to be the same variant */
const SAME_ROAD = 0.85;
/** m: "along the same road" */
const NEAR = 45;

/** Every ~`step` m one point, at most `max` points (step grows for long rides). */
export function shapeOf(fixes: Fix[], max = 150): Shape {
  if (!fixes.length) return [];
  let total = 0;
  for (let i = 1; i < fixes.length; i++) total += distance(fixes[i - 1], fixes[i]);
  const step = Math.max(25, total / (max - 1));
  const out: Shape = [[fixes[0].lat, fixes[0].lon]];
  let acc = 0;
  for (let i = 1; i < fixes.length; i++) {
    acc += distance(fixes[i - 1], fixes[i]);
    if (acc >= step) {
      out.push([fixes[i].lat, fixes[i].lon]);
      acc = 0;
    }
  }
  const last = fixes[fixes.length - 1];
  out.push([last.lat, last.lon]);
  return out.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}

const pt = ([lat, lon]: [number, number]) => ({ lat, lon });

/** Distance from p to the segment a–b, m (flat-earth approximation, fine for < 10 km). */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111_320;
  const ax = (a[1] - p[1]) * k;
  const ay = (a[0] - p[0]) * 111_320;
  const bx = (b[1] - p[1]) * k;
  const by = (b[0] - p[0]) * 111_320;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Share (0…1) of shape a that runs within NEAR m of shape b. */
export function coverage(a: Shape, b: Shape): number {
  if (a.length < 2 || b.length < 2) return 0;
  let near = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 1; i < b.length && best > NEAR; i++) best = Math.min(best, segDist(p, b[i - 1], b[i]));
    if (best <= NEAR) near++;
  }
  return near / a.length;
}

/** Same roads in both directions of comparison. */
export const sameRoads = (a: Shape, b: Shape) => Math.min(coverage(a, b), coverage(b, a)) >= SAME_ROAD;

/** Largest of the start gap and the end gap, m. */
export function endpointGap(a: Shape, b: Shape): number {
  if (!a.length || !b.length) return Infinity;
  return Math.max(distance(pt(a[0]), pt(b[0])), distance(pt(a[a.length - 1]), pt(b[b.length - 1])));
}

export type MergeCheck = 'ok' | 'ask' | 'tooFar';
export function canMerge(a: Shape, b: Shape): { check: MergeCheck; gapM: number } {
  const gapM = Math.round(endpointGap(a, b));
  return { check: gapM <= SAME_PLACE ? 'ok' : gapM <= ASK_PLACE ? 'ask' : 'tooFar', gapM };
}

/** Too short to be a route (a ride around the block): start and end almost the same place. */
export const isLoop = (s: Shape) => s.length > 1 && distance(pt(s[0]), pt(s[s.length - 1])) < SAME_PLACE;

/**
 * Groups the rides of one route into variants (by the road they took). Returns lists of ride
 * ids; the variant with the most rides comes first.
 */
export function variants<T extends { id: string; shape?: Shape }>(rides: T[]): string[][] {
  const groups: { shape: Shape; ids: string[] }[] = [];
  for (const r of rides) {
    if (!r.shape?.length) continue;
    const g = groups.find((x) => sameRoads(x.shape, r.shape!));
    if (g) g.ids.push(r.id);
    else groups.push({ shape: r.shape, ids: [r.id] });
  }
  return groups.sort((a, b) => b.ids.length - a.ids.length).map((g) => g.ids);
}

/**
 * Suggests a route for a new ride: the route whose rides start and end at the same places.
 * Loops (start = end) only match routes whose rides also run along the same roads.
 */
export function findRoute<R extends { id: string; rideIds: string[] }, T extends { id: string; shape?: Shape }>(
  shape: Shape,
  routes: R[],
  rides: T[],
): R | null {
  if (shape.length < 2) return null;
  for (const route of routes) {
    const first = rides.find((r) => route.rideIds.includes(r.id) && r.shape?.length);
    if (!first?.shape) continue;
    if (endpointGap(shape, first.shape) > SAME_PLACE) continue;
    if (isLoop(shape) && !route.rideIds.some((id) => sameRoads(shape, rides.find((r) => r.id === id)?.shape ?? []))) continue;
    return route;
  }
  return null;
}
