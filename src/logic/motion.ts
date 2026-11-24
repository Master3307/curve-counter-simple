/**
 * Ride-level motion numbers (plan 1.11 + tilt), pure functions on the saved track.
 *
 * - braking / acceleration in g from the GPS's Doppler speed (smoothed over ~3 s; above the
 *   plausibility limits it's a measurement error and ignored)
 * - stops: how often and how long the vehicle stood (traffic lights, coffee …)
 * - phone holder: was the phone fixed (mount, tank bag, flat on the dash) or loose (pocket)?
 *   Decided from how much the gravity direction wobbles on straight, steady stretches.
 * - measured tilt (lean / body roll) when the phone was fixed: angle between the current
 *   gravity direction and the "upright" one learned on straights (background calibration).
 */
import type { Fix } from './geo';

const G = 9.81;
const MAX_BRAKE_G = 1.3;
const MAX_ACCEL_G = 1.0;

export interface MotionStats {
  /** g, positive numbers; null when the track has no usable speed */
  maxBrakeG: number | null;
  maxAccelG: number | null;
  /** stops of ≥ 10 s while the ride was running */
  stops: number;
  stoppedS: number;
  /** 'fixed' = mount / dash / tank bag, 'loose' = pocket / bag; null = no tilt data */
  holder: 'fixed' | 'loose' | null;
  /** measured, only when holder = fixed; degrees */
  maxTiltL: number | null;
  maxTiltR: number | null;
  /** sources that were recorded: c = Doppler course, g = gyroscope, t = tilt */
  sensors: string;
}

const norm = (v: [number, number, number]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n) as [number, number, number];
};
const angleBetween = (a: [number, number, number], b: [number, number, number]) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

export function motionStats(fixes: Fix[]): MotionStats | null {
  if (fixes.length < 5) return null;
  // braking / acceleration: speed smoothed with a centred 3-fix mean, then dv/dt over ≥ 2 s
  let maxBrake: number | null = null;
  let maxAccel: number | null = null;
  const sp = fixes.map((_, i) => {
    const w = fixes.slice(Math.max(0, i - 1), i + 2).map((x) => x.speed).filter((x): x is number => x != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  for (let i = 0, j = 0; i < fixes.length; i++) {
    while (j < i && fixes[i].t - fixes[j].t > 3000) j++;
    const dt = (fixes[i].t - fixes[j].t) / 1000;
    if (dt < 2 || dt > 4 || sp[i] == null || sp[j] == null) continue;
    const g = (sp[i]! - sp[j]!) / dt / G;
    if (g < 0 && -g <= MAX_BRAKE_G) maxBrake = Math.max(maxBrake ?? 0, -g);
    if (g > 0 && g <= MAX_ACCEL_G) maxAccel = Math.max(maxAccel ?? 0, g);
  }

  // stops
  let stops = 0;
  let stoppedS = 0;
  let since: number | null = null;
  for (const f of fixes) {
    const slow = (f.speed ?? 99) < 1;
    if (slow) since ??= f.t;
    else if (since != null) {
      const s = (f.t - since) / 1000;
      if (s >= 10) {
        stops++;
        stoppedS += s;
      }
      since = null;
    }
  }

  // tilt: upright reference = mean gravity on steady straights (gyro calm, moving)
  const steady = fixes.filter((f) => f.g && (f.speed ?? 0) > 5 && (f.yaw == null || Math.abs(f.yaw) < 1));
  let holder: MotionStats['holder'] = null;
  let maxTiltL: number | null = null;
  let maxTiltR: number | null = null;
  if (steady.length >= 20) {
    const ref = norm(steady.reduce<[number, number, number]>((a, f) => [a[0] + f.g![0], a[1] + f.g![1], a[2] + f.g![2]], [0, 0, 0]));
    const wobble = steady.map((f) => angleBetween(f.g!, ref)).sort((a, b) => a - b);
    // a fixed phone stays within a few degrees on a straight; a pocket swings around
    holder = wobble[Math.floor(wobble.length * 0.8)] < 6 ? 'fixed' : 'loose';
    if (holder === 'fixed') {
      for (const f of fixes) {
        if (!f.g || f.yaw == null || Math.abs(f.yaw) < 2) continue;
        const tilt = angleBetween(f.g, ref);
        if (tilt > 65) continue; // not plausible for riding
        if (f.yaw > 0) maxTiltR = Math.max(maxTiltR ?? 0, tilt);
        else maxTiltL = Math.max(maxTiltL ?? 0, tilt);
      }
    }
  }

  const sensors =
    (fixes.some((f) => f.bearing != null) ? 'c' : '') + (fixes.some((f) => f.yaw != null) ? 'g' : '') + (fixes.some((f) => f.g) ? 't' : '');
  return {
    maxBrakeG: maxBrake == null ? null : Math.round(maxBrake * 100) / 100,
    maxAccelG: maxAccel == null ? null : Math.round(maxAccel * 100) / 100,
    stops,
    stoppedS: Math.round(stoppedS),
    holder,
    maxTiltL: maxTiltL == null ? null : Math.round(maxTiltL),
    maxTiltR: maxTiltR == null ? null : Math.round(maxTiltR),
    sensors,
  };
}
