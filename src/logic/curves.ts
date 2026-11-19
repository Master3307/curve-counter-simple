/**
 * Curve detector – the reference implementation of the algorithm (see README "How curves are
 * counted"). The native Android/iOS trackers will be ports of this file and are checked
 * against the same fixtures in /fixtures/tracks.
 *
 * Idea: GPS positions → resampled every STEP metres (so speed doesn't matter) → heading change
 * per step → sliding window sum = "how hard are we turning" → small state machine.
 * Positive heading change = clockwise = RIGHT curve.
 */
import { angleDiff, bearing, distance, type Fix } from './geo';

export type Dir = 'L' | 'R';
export type Sensitivity = 'few' | 'normal' | 'many';

export interface Curve {
  /** start of the curve, epoch ms */
  t: number;
  dir: Dir;
  /** total heading change in degrees (always positive) */
  angle: number;
  /** speeds in m/s */
  entrySpeed: number;
  minSpeed: number;
  avgSpeed: number;
  exitSpeed: number;
  /** apex position (sharpest point) */
  lat: number;
  lon: number;
}

/** Minimum total heading change for a curve to count. */
export const MIN_ANGLE: Record<Sensitivity, number> = { few: 45, normal: 30, many: 20 };

export interface CurveOptions {
  sensitivity: Sensitivity;
  /** resampling step, m */
  step: number;
  /** window length in steps */
  window: number;
  /** enter a curve when |window sum| ≥ this (deg) */
  enter: number;
  /** curve is "quiet" when |window sum| < this (deg) */
  exit: number;
  /** close the curve after this much quiet distance, m */
  quietDist: number;
  /** curves whose slowest point (apex) is slower than this don't count (junctions, parking), m/s */
  minApexSpeed: number;
  /** fixes worse than this are ignored, m */
  maxAccuracy: number;
  /** a gap longer than this resets the detector (tunnel), s / m */
  maxGapS: number;
  maxGapM: number;
  /** a single step turning more than this is a GPS glitch, deg */
  maxStepTurn: number;
}

export const DEFAULT_CURVE_OPTIONS: CurveOptions = {
  sensitivity: 'normal',
  step: 10,
  window: 10,
  enter: 10,
  exit: 4,
  quietDist: 30,
  minApexSpeed: 15 / 3.6,
  maxAccuracy: 25,
  maxGapS: 15,
  maxGapM: 300,
  maxStepTurn: 75,
};

interface Sample {
  t: number;
  lat: number;
  lon: number;
  speed: number;
}

interface Open {
  dir: Dir;
  total: number;
  /** opposite-direction turning since the last same-direction step (held back) */
  pending: number;
  t: number;
  speeds: number[];
  quiet: number;
  apex: Sample;
  apexTurn: number;
}

export class CurveDetector {
  private o: CurveOptions;
  private last: Fix | null = null;
  /** last few accepted positions, for light smoothing */
  private recent: { lat: number; lon: number }[] = [];
  private prevPos: { lat: number; lon: number } | null = null;
  private carry = 0;
  private prevSample: Sample | null = null;
  private prevHeading: number | null = null;
  private win: number[] = [];
  private open: Open | null = null;

  constructor(options: Partial<CurveOptions> = {}) {
    this.o = { ...DEFAULT_CURVE_OPTIONS, ...options };
  }

  /** Feed one GPS fix. Returns the curves that were completed by it (usually none). */
  push(fix: Fix): Curve[] {
    const out: Curve[] = [];
    if (fix.accuracy > this.o.maxAccuracy) return out;

    let speed = fix.speed ?? 0;
    if (this.last) {
      const dt = (fix.t - this.last.t) / 1000;
      if (dt <= 0) return out;
      const d = distance(this.last, fix);
      if (dt > this.o.maxGapS || d > this.o.maxGapM) {
        this.closeInto(out);
        this.resetTrack();
      } else if (d / dt > 70) {
        return out; // impossible jump → glitch
      } else if (fix.speed == null) {
        speed = d / dt;
      }
    }
    this.last = fix;

    // light smoothing: average of the last 3 positions
    this.recent.push({ lat: fix.lat, lon: fix.lon });
    if (this.recent.length > 3) this.recent.shift();
    const pos = {
      lat: this.recent.reduce((s, p) => s + p.lat, 0) / this.recent.length,
      lon: this.recent.reduce((s, p) => s + p.lon, 0) / this.recent.length,
    };

    if (!this.prevPos) {
      this.prevPos = pos;
      this.prevSample = { t: fix.t, ...pos, speed };
      return out;
    }

    // resample the segment prevPos → pos every `step` metres
    const seg = distance(this.prevPos, pos);
    let at = this.o.step - this.carry;
    while (at <= seg) {
      const f = at / seg;
      const s: Sample = {
        t: fix.t,
        lat: this.prevPos.lat + (pos.lat - this.prevPos.lat) * f,
        lon: this.prevPos.lon + (pos.lon - this.prevPos.lon) * f,
        speed,
      };
      this.onSample(s, out);
      at += this.o.step;
    }
    this.carry = seg - (at - this.o.step);
    this.prevPos = pos;
    return out;
  }

  /** End of ride: close a curve that is still open. */
  flush(): Curve[] {
    const out: Curve[] = [];
    this.closeInto(out);
    this.resetTrack();
    return out;
  }

  private resetTrack() {
    this.last = null;
    this.recent = [];
    this.prevPos = null;
    this.carry = 0;
    this.prevSample = null;
    this.prevHeading = null;
    this.win = [];
    this.open = null;
  }

  private onSample(s: Sample, out: Curve[]) {
    const prev = this.prevSample;
    this.prevSample = s;
    if (!prev) return;
    const h = bearing(prev, s);
    const ph = this.prevHeading;
    this.prevHeading = h;
    if (ph == null) return;

    let turn = angleDiff(ph, h);
    if (Math.abs(turn) > this.o.maxStepTurn) turn = 0;

    this.win.push(turn);
    if (this.win.length > this.o.window) this.win.shift();
    const w = this.win.reduce((a, b) => a + b, 0);
    const wDir: Dir = w >= 0 ? 'R' : 'L';

    const cur = this.open;
    if (!cur) {
      if (Math.abs(w) >= this.o.enter) this.start(s, w, wDir);
      return;
    }

    if (wDir !== cur.dir && Math.abs(w) >= this.o.enter) {
      // S-bend: close this one, the opposite curve starts right away with the opposite
      // turning that was held back
      const carried = cur.pending + turn;
      this.closeInto(out);
      this.start(s, carried, wDir);
      return;
    }

    const same = cur.dir === 'R' ? turn >= 0 : turn <= 0;
    if (same) {
      cur.total += cur.pending + turn;
      cur.pending = 0;
    } else {
      cur.pending += turn;
    }
    cur.speeds.push(s.speed);
    if (Math.abs(turn) > cur.apexTurn) {
      cur.apexTurn = Math.abs(turn);
      cur.apex = s;
    }
    if (Math.abs(w) < this.o.exit) {
      cur.quiet += this.o.step;
      if (cur.quiet >= this.o.quietDist) this.closeInto(out);
    } else {
      cur.quiet = 0;
    }
  }

  private start(s: Sample, w: number, dir: Dir) {
    this.open = { dir, total: w, pending: 0, t: s.t, speeds: [s.speed], quiet: 0, apex: s, apexTurn: 0 };
  }

  private closeInto(out: Curve[]) {
    const c = this.open;
    this.open = null;
    if (!c) return;
    const angle = Math.abs(c.total);
    const totalDir: Dir = c.total >= 0 ? 'R' : 'L';
    if (totalDir !== c.dir || angle < MIN_ANGLE[this.o.sensitivity]) return;
    const avg = c.speeds.reduce((a, b) => a + b, 0) / c.speeds.length;
    const min = Math.min(...c.speeds);
    if (min < this.o.minApexSpeed) return;
    out.push({
      t: c.t,
      dir: c.dir,
      angle: Math.round(angle),
      entrySpeed: c.speeds[0],
      minSpeed: min,
      avgSpeed: avg,
      exitSpeed: c.speeds[c.speeds.length - 1],
      lat: c.apex.lat,
      lon: c.apex.lon,
    });
  }
}
