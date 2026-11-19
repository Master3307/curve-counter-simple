/**
 * Full analysis of one ride's track: the numbers that are saved (plan 1.7 "two passes": the
 * live pass is what you see while riding, this one runs over the whole track after the ride).
 * Same algorithm as the live pass for now, so both agree exactly.
 *
 * TODO(plan 1.7): forward-backward (Rauch-Tung-Striebel) smoothing of the track before counting,
 * gyro fusion, map matching.
 */
import { CurveDetector, type Curve, type Sensitivity } from './curves';
import type { Fix } from './geo';
import { HeightStats, type HeightTotals } from './height';
import { RideStats } from './rideStats';

/**
 * Bump when the detector changes in a way that changes counts: saved rides with a track are
 * then recounted on the next app start.
 * 1 = v0.1/0.2 · 2 = wide-sweeper pass + curve length · 3 = curve speeds from the turning part,
 * S-bend length fix
 */
export const ALGO_VERSION = 3;

export interface Analysis {
  curves: Curve[];
  left: number;
  right: number;
  distanceM: number;
  movingS: number;
  avgSpeed: number;
  topSpeed: number;
  height: HeightTotals | null;
  algo: number;
  sensitivity: Sensitivity;
}

export function analyzeTrack(fixes: Fix[], sensitivity: Sensitivity): Analysis {
  const curves = new CurveDetector({ sensitivity });
  const stats = new RideStats();
  const height = new HeightStats();
  const found: Curve[] = [];
  for (const f of fixes) {
    found.push(...curves.push(f));
    stats.push(f);
    height.push(f);
  }
  found.push(...curves.flush());
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
    algo: ALGO_VERSION,
    sensitivity,
  };
}
