/**
 * Numbers derived from a detected curve – pure physics, no extra sensors, phone anywhere.
 *
 * - radius r = length / angle (rad)
 * - cornering (lateral) g = v² / (r · g)            (plan 1.11)
 * - approx. lean angle = atan(v² / (r · g))          (plan 1.9 level 1, steady curve, upright rider)
 *   lateral g = tan(lean), so both are the same number in different units.
 * - strength class by angle: gentle / medium / tight / hairpin (plan 0.)
 *
 * TODO(plan 1.9 level 2): measured lean angle with a mounted phone (gravity vector).
 * TODO(plan 1.11): braking / acceleration g from Doppler speed (+ accelerometer when mounted).
 */
import type { Curve } from './curves';

const G = 9.81;
/** above this, it's a measurement error, not a curve (plan 1.11 plausibility limits) */
export const MAX_LAT_G = 1.3;

export type Strength = 'gentle' | 'medium' | 'tight' | 'hairpin';
export const STRENGTHS: Strength[] = ['gentle', 'medium', 'tight', 'hairpin'];

export function strengthOf(angle: number): Strength {
  if (angle > 150) return 'hairpin';
  if (angle > 90) return 'tight';
  if (angle > 45) return 'medium';
  return 'gentle';
}

export interface CurveMetrics {
  /** m, null when the curve length is unknown (rides from v0.2) */
  radiusM: number | null;
  /** g, null when implausible or unknown */
  latG: number | null;
  /** degrees, approx. */
  leanDeg: number | null;
  strength: Strength;
}

export function curveMetrics(c: Curve): CurveMetrics {
  const strength = strengthOf(c.angle);
  if (!c.lengthM || c.angle <= 0) return { radiusM: null, latG: null, leanDeg: null, strength };
  const radiusM = c.lengthM / ((c.angle * Math.PI) / 180);
  const latG = (c.avgSpeed * c.avgSpeed) / (radiusM * G);
  if (!Number.isFinite(latG) || latG > MAX_LAT_G) return { radiusM, latG: null, leanDeg: null, strength };
  return { radiusM, latG, leanDeg: (Math.atan(latG) * 180) / Math.PI, strength };
}

export interface RideCurveSummary {
  /** curves per class */
  classes: Record<Strength, number>;
  /** "twistiness": curves per 100 km, null for rides shorter than 1 km */
  per100km: number | null;
  /** strongest cornering of the ride */
  maxLatG: number | null;
  maxLeanDeg: number | null;
  /** average speed in curves, m/s, per direction */
  avgCurveSpeed: { L: number | null; R: number | null };
}

export function summarizeCurves(curves: Curve[], distanceM: number): RideCurveSummary {
  const classes: Record<Strength, number> = { gentle: 0, medium: 0, tight: 0, hairpin: 0 };
  let maxLatG: number | null = null;
  let maxLeanDeg: number | null = null;
  const speeds = { L: [] as number[], R: [] as number[] };
  for (const c of curves) {
    const m = curveMetrics(c);
    classes[m.strength]++;
    if (m.latG != null && (maxLatG == null || m.latG > maxLatG)) {
      maxLatG = m.latG;
      maxLeanDeg = m.leanDeg;
    }
    speeds[c.dir].push(c.avgSpeed);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    classes,
    per100km: distanceM >= 1000 ? (curves.length / distanceM) * 100_000 : null,
    maxLatG,
    maxLeanDeg,
    avgCurveSpeed: { L: avg(speeds.L), R: avg(speeds.R) },
  };
}
