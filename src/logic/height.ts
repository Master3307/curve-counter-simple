/**
 * Height meter (plan 1.10), GPS only for now.
 * - smoothing: median of 5 (kills single spikes) → highest / lowest point;
 *   then a slow exponential filter → climb / descent
 * - climb / descent with a 3 m hysteresis so noise doesn't add up to fake metres
 * - highest / lowest point (with time and place), height profile over distance
 *
 * TODO(plan 1.10): barometer fusion (shape from the barometer, level from GPS, τ ≈ 2 min),
 * terrain-model correction after the ride.
 */
import { distance, type Fix } from './geo';

export interface HeightPoint {
  t: number;
  lat: number;
  lon: number;
  altM: number;
}

export interface HeightTotals {
  maxAltM: number;
  minAltM: number;
  climbM: number;
  descentM: number;
  maxAltAt: HeightPoint;
  /** [distance m, height m], one point about every 100 m (at most ~500 points) */
  profile: [number, number][];
}

const HYSTERESIS = 3;
/** exponential filter factor per fix (~10 s time constant at 1 Hz) */
const SMOOTH = 0.1;
const PROFILE_STEP = 100;
const MAX_PROFILE = 500;

export class HeightStats {
  private window: number[] = [];
  private smooth: number | null = null;
  private anchor: number | null = null;
  private climb = 0;
  private descent = 0;
  private max: HeightPoint | null = null;
  private min: HeightPoint | null = null;
  private dist = 0;
  private last: Fix | null = null;
  private lastMedian: number | null = null;
  private profile: [number, number][] = [];
  private nextProfileAt = 0;

  push(fix: Fix): void {
    if (fix.accuracy > 25) return;
    if (this.last) {
      const d = distance(this.last, fix);
      const dt = (fix.t - this.last.t) / 1000;
      if (dt <= 0 || d / dt > 70) return;
      this.dist += d;
    }
    this.last = fix;
    if (fix.alt == null || !Number.isFinite(fix.alt)) return;

    this.window.push(fix.alt);
    if (this.window.length > 5) this.window.shift();
    const median = [...this.window].sort((a, b) => a - b)[Math.floor(this.window.length / 2)];
    this.lastMedian = median;
    this.smooth = this.smooth == null ? median : this.smooth + SMOOTH * (median - this.smooth);
    const h = this.smooth;

    if (this.anchor == null) this.anchor = h;
    else if (h - this.anchor >= HYSTERESIS) {
      this.climb += h - this.anchor;
      this.anchor = h;
    } else if (this.anchor - h >= HYSTERESIS) {
      this.descent += this.anchor - h;
      this.anchor = h;
    }

    // highest / lowest point from the median (no lag, so a summit isn't flattened);
    // climb / descent from the smoothed value (so noise doesn't add up)
    const p = { t: fix.t, lat: fix.lat, lon: fix.lon, altM: median };
    if (this.window.length >= 3) {
      if (!this.max || median > this.max.altM) this.max = p;
      if (!this.min || median < this.min.altM) this.min = p;
    }

    if (this.dist >= this.nextProfileAt) {
      this.profile.push([Math.round(this.dist), Math.round(h)]);
      this.nextProfileAt = this.dist + PROFILE_STEP;
      if (this.profile.length > MAX_PROFILE) this.profile = this.profile.filter((_, i) => i % 2 === 0);
    }
  }

  /** null when the ride had no height information at all */
  totals(): HeightTotals | null {
    if (!this.max || !this.min) return null;
    // the smoothed value lags behind: settle the last stretch against the current height
    let climb = this.climb;
    let descent = this.descent;
    if (this.anchor != null && this.lastMedian != null) {
      const rest = this.lastMedian - this.anchor;
      if (rest >= HYSTERESIS) climb += rest;
      else if (-rest >= HYSTERESIS) descent -= rest;
    }
    return {
      maxAltM: Math.round(this.max.altM),
      minAltM: Math.round(this.min.altM),
      climbM: Math.round(climb),
      descentM: Math.round(descent),
      maxAltAt: { ...this.max, altM: Math.round(this.max.altM) },
      profile: this.profile,
    };
  }
}
