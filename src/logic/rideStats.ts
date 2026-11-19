/** Accumulates track length, moving time and speeds for one ride. */
import { distance, type Fix } from './geo';

export interface RideTotals {
  distanceM: number;
  movingS: number;
  /** m/s, moving only */
  avgSpeed: number;
  /** m/s, 95th percentile of smoothed speed (ignores single GPS spikes) */
  topSpeed: number;
  /** m/s, smoothed current speed */
  speed: number;
}

const MOVING = 5 / 3.6;

export class RideStats {
  private last: Fix | null = null;
  private distanceM = 0;
  private movingS = 0;
  private recent: number[] = [];
  private speeds: number[] = [];
  private current = 0;

  push(fix: Fix): void {
    if (fix.accuracy > 25) return;
    const prev = this.last;
    let speed = fix.speed ?? 0;
    if (prev) {
      const dt = (fix.t - prev.t) / 1000;
      if (dt <= 0) return;
      const d = distance(prev, fix);
      if (d / dt > 70) return; // glitch
      if (fix.speed == null) speed = d / dt;
      if (speed >= MOVING && dt <= 15) {
        this.distanceM += d;
        this.movingS += dt;
      }
    }
    this.last = fix;
    // median of the last 3 → smooth current speed
    this.recent.push(speed);
    if (this.recent.length > 3) this.recent.shift();
    this.current = [...this.recent].sort((a, b) => a - b)[Math.floor(this.recent.length / 2)];
    if (this.current >= MOVING) this.speeds.push(this.current);
  }

  totals(): RideTotals {
    const sorted = [...this.speeds].sort((a, b) => a - b);
    const top = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return {
      distanceM: this.distanceM,
      movingS: this.movingS,
      avgSpeed: this.movingS > 0 ? this.distanceM / this.movingS : 0,
      topSpeed: top,
      speed: this.current,
    };
  }
}
