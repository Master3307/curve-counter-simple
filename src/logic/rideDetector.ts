/**
 * Automatic ride start / end from speed alone.
 * - start: ≥ startSpeed for ≥ startSeconds within the last 60 s → ride starts, backdated to the
 *   first fast fix; buffered fixes are returned so no curve is lost.
 * - end: slower than stopSpeed for ≥ pauseMinutes (fuel/coffee stops stay inside one ride),
 *   or no GPS at all for that long → ride ends at the moment it stopped.
 */
import type { Fix } from './geo';

export interface RideDetectorOptions {
  startSpeed: number; // m/s
  startSeconds: number;
  stopSpeed: number; // m/s
  pauseMinutes: number;
}

export const DEFAULT_RIDE_OPTIONS: RideDetectorOptions = {
  startSpeed: 20 / 3.6,
  startSeconds: 30,
  stopSpeed: 5 / 3.6,
  pauseMinutes: 10,
};

/** Used after the user pressed "Start": they already said they ride, so react faster. */
export const MANUAL_START: Partial<RideDetectorOptions> = {
  startSpeed: 15 / 3.6,
  startSeconds: 5,
};

export type RideEvent = { type: 'start'; at: number; backlog: Fix[] } | { type: 'end'; at: number };

export class RideDetector {
  private o: RideDetectorOptions;
  private riding = false;
  private buffer: Fix[] = [];
  private stoppedSince: number | null = null;
  private lastFixT: number | null = null;

  constructor(options: Partial<RideDetectorOptions> = {}) {
    this.o = { ...DEFAULT_RIDE_OPTIONS, ...options };
  }

  get isRiding() {
    return this.riding;
  }

  /** speed: m/s for this fix (already derived if GPS gave none). */
  push(fix: Fix, speed: number): RideEvent | null {
    this.lastFixT = fix.t;
    if (!this.riding) {
      this.buffer.push({ ...fix, speed });
      while (this.buffer.length && fix.t - this.buffer[0].t > 60_000) this.buffer.shift();
      let fast = 0;
      let firstFast: number | null = null;
      for (let i = 1; i < this.buffer.length; i++) {
        if ((this.buffer[i].speed ?? 0) >= this.o.startSpeed) {
          fast += (this.buffer[i].t - this.buffer[i - 1].t) / 1000;
          if (firstFast == null) firstFast = i - 1;
        }
      }
      if (fast >= this.o.startSeconds && firstFast != null) {
        const backlog = this.buffer.slice(firstFast);
        this.buffer = [];
        this.riding = true;
        this.stoppedSince = null;
        return { type: 'start', at: backlog[0].t, backlog };
      }
      return null;
    }

    if (speed < this.o.stopSpeed) this.stoppedSince ??= fix.t;
    else this.stoppedSince = null;
    return this.tick(fix.t);
  }

  /** Call regularly (e.g. every 30 s) so a ride also ends when GPS goes silent. */
  tick(now: number): RideEvent | null {
    if (!this.riding) return null;
    const pause = this.o.pauseMinutes * 60_000;
    const since = this.stoppedSince ?? (this.lastFixT != null && now - this.lastFixT >= pause ? this.lastFixT : null);
    if (since != null && now - since >= pause) {
      this.riding = false;
      this.stoppedSince = null;
      return { type: 'end', at: since };
    }
    return null;
  }

  /** Manual start/stop keeps the detector in sync. */
  force(riding: boolean) {
    this.riding = riding;
    this.buffer = [];
    this.stoppedSince = null;
  }
}
