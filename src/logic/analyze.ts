/**
 * Full analysis of one ride's track: the numbers that are saved (plan 1.7 "two passes": the
 * live pass is what you see while riding, this one runs over the whole track after the ride).
 *
 * After the ride the whole track is known, so it can do what the live pass can't:
 * - jog filter: a left-right (or right-left) pair that ends up going the same way, only a few
 *   metres to the side, is a lane change, an overtake or a bus bay – not two curves.
 *
 * TODO(plan 1.7): forward-backward (Rauch-Tung-Striebel) smoothing of the track before counting,
 * map matching.
 */
import { CurveDetector, type Curve, type Sensitivity } from './curves';
import { angleDiff, bearing, distance, type Fix } from './geo';
import { HeightStats, type HeightTotals } from './height';
import { RideStats } from './rideStats';
import { motionStats, type MotionStats } from './motion';

/**
 * Bump when the detector changes in a way that changes counts: saved rides with a track are
 * then recounted on the next app start.
 * 1 = v0.1/0.2 · 2 = wide-sweeper pass + curve length · 3 = curve speeds from the turning part,
 * S-bend length fix · 4 = v1.0: standstill freeze, slow turns count, spike/jump rejection,
 * course + gyro fusion, straight splitting, reversal check, jog filter, confidence
 */
export const ALGO_VERSION = 4;

export interface Analysis {
  curves: Curve[];
  left: number;
  right: number;
  distanceM: number;
  movingS: number;
  avgSpeed: number;
  topSpeed: number;
  height: HeightTotals | null;
  motion: MotionStats | null;
  algo: number;
  sensitivity: Sensitivity;
}

/** The fix closest to time t. Fixes are sorted by time. */
function fixAt(fixes: Fix[], t: number): number {
  let lo = 0;
  let hi = fixes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Point `dist` metres before (−) or after (+) fix i along the track. */
function along(fixes: Fix[], i: number, dist: number): Fix {
  let j = i;
  let d = 0;
  const step = dist < 0 ? -1 : 1;
  while (j + step >= 0 && j + step < fixes.length && d < Math.abs(dist)) {
    d += distance(fixes[j], fixes[j + step]);
    j += step;
  }
  return fixes[j];
}

/** Sideways offset of point p from the line through a with bearing h, m. */
function lateral(a: Fix, h: number, p: Fix): number {
  const d = distance(a, p);
  return Math.abs(d * Math.sin(((bearing(a, p) - h) * Math.PI) / 180));
}

/**
 * Lane change / overtake / bus bay: two opposite curves close together that cancel out – the
 * road goes on in the same direction, just a few metres to the side.
 */
export function dropJogs(curves: Curve[], fixes: Fix[]): Curve[] {
  if (fixes.length < 3) return curves;
  const sorted = [...curves].sort((a, b) => a.t - b.t);
  const drop = new Set<Curve>();
  for (let k = 0; k + 1 < sorted.length; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (a.dir === b.dir || drop.has(a) || a.wide || b.wide) continue;
    if (Math.max(a.angle, b.angle) > 75) continue;
    if (Math.abs(a.angle - b.angle) > 0.45 * Math.max(a.angle, b.angle)) continue;
    const ia = fixAt(fixes, a.t);
    const ib = fixAt(fixes, b.endT ?? b.t);
    // close together: the second starts at most ~80 m after the first ends
    const ja = fixAt(fixes, a.endT ?? a.t);
    const jb = fixAt(fixes, b.t);
    let gap = 0;
    for (let j = ja; j < jb && gap <= 80; j++) gap += distance(fixes[j], fixes[j + 1]);
    if (gap > 80) continue;
    const p0 = along(fixes, ia, -40);
    const p1 = along(fixes, ia, -5);
    const q0 = along(fixes, ib, 5);
    const q1 = along(fixes, ib, 40);
    if (distance(p0, p1) < 15 || distance(q0, q1) < 15) continue;
    const hIn = bearing(p0, p1);
    const hOut = bearing(q0, q1);
    if (Math.abs(angleDiff(hIn, hOut)) > 20) continue;
    if (lateral(p1, hIn, q0) > 12) continue;
    drop.add(a);
    drop.add(b);
  }
  return drop.size ? curves.filter((c) => !drop.has(c)) : curves;
}

export function analyzeTrack(fixes: Fix[], sensitivity: Sensitivity): Analysis {
  const curves = new CurveDetector({ sensitivity });
  const stats = new RideStats();
  const height = new HeightStats();
  let found: Curve[] = [];
  for (const f of fixes) {
    found.push(...curves.push(f));
    stats.push(f);
    height.push(f);
  }
  found.push(...curves.flush());
  found = dropJogs(found, fixes).sort((a, b) => a.t - b.t);
  const t = stats.totals();
  return {
    curves: found,
    left: found.filter((c) => c.dir === 'L').length,
    right: found.filter((c) => c.dir === 'R').length,
    distanceM: t.distanceM,
    movingS: t.movingS,
    avgSpeed: t.avgSpeed,
    topSpeed: t.topSpeed,
    height: height.totals(),
    motion: motionStats(fixes),
    algo: ALGO_VERSION,
    sensitivity,
  };
}
