/**
 * Curve detector – the reference implementation of the algorithm (see README "How curves are
 * counted"). The native Android/iOS trackers will be ports of this file and are checked
 * against the same fixtures in /fixtures/tracks.
 *
 * Idea: GPS positions → resampled every STEP metres (so speed doesn't matter) → heading change
 * per step → sliding window sum = "how hard are we turning" → small state machine.
 * Positive heading change = clockwise = RIGHT curve.
 *
 * What counts as ONE curve (the definition the ground truth is labelled with, plan 1.8):
 * - a continuous change of direction ≥ MIN_ANGLE in one direction;
 * - a straight of ≥ 60 m between two same-direction bends makes them two curves;
 * - an opposite-direction turn of ≥ ENTER always separates (S-bend = two curves);
 * - roundabout / hairpin = one curve; lane change / overtake = no curve.
 * Two passes run on the same samples: the normal 100 m window, and a 500 m window for wide
 * sweepers. A curve found by both counts once (the normal pass wins).
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
  /** end of the curve, epoch ms (missing in rides from v0.2) */
  endT?: number;
  /** length along the road, m */
  lengthM?: number;
  /** found by the long-window pass (wide sweeper) */
  wide?: boolean;
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
  /**
   * Second pass for wide sweepers (motorway bends with a large radius, which turn too little
   * per 100 m for the normal pass). Window in steps, enter/exit in degrees, quiet distance in m.
   * Set `wideWindow: 0` to switch it off.
   */
  wideWindow: number;
  wideEnter: number;
  wideExit: number;
  wideQuietDist: number;
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
  wideWindow: 50,
  wideEnter: 6,
  wideExit: 2.5,
  wideQuietDist: 100,
};

interface Sample {
  t: number;
  lat: number;
  lon: number;
  speed: number;
  /** distance along the track since the detector started, m */
  d: number;
}

interface Open {
  dir: Dir;
  total: number;
  /** opposite-direction turning since the last same-direction step (held back) */
  pending: number;
  /** where that held-back turning happened, [distance, turn] – starts the next curve of an S-bend */
  pendingSteps: [number, number][];
  t: number;
  /** where the turning started (window start), m */
  startD: number;
  /** [distance, speed] of every sample while the curve is open */
  speeds: [number, number][];
  quiet: number;
  apex: Sample;
  apexTurn: number;
  /** [distance, accumulated turning] along the curve, to measure its real length */
  trace: [number, number][];
}

/**
 * Where the turning really happens: distances at which the accumulated turn reaches 10 % and
 * 90 % of the total. Robust against the window smearing the start and end.
 */
function turningRange(trace: [number, number][], total: number): [number, number] {
  const at = (frac: number) => {
    const target = Math.abs(total) * frac;
    for (let i = 1; i < trace.length; i++) {
      const [d0, a0] = trace[i - 1];
      const [d1, a1] = trace[i];
      const v0 = Math.abs(a0);
      const v1 = Math.abs(a1);
      if (v1 >= target) return v1 === v0 ? d1 : d0 + ((target - v0) / (v1 - v0)) * (d1 - d0);
    }
    return trace[trace.length - 1][0];
  };
  return [at(0.1), at(0.9)];
}

/** A closed candidate, before the angle / speed rules are applied. */
interface Closed {
  open: Open;
  end: Sample;
  /** where the turning ended (without the quiet tail), m */
  endD: number;
}

/** One sliding-window state machine. */
class Pass {
  private win: number[] = [];
  private open: Open | null = null;

  constructor(
    private step: number,
    private window: number,
    private enter: number,
    private exit: number,
    private quietDist: number,
  ) {}

  get current(): Open | null {
    return this.open;
  }

  reset() {
    this.win = [];
    this.open = null;
  }

  feed(s: Sample, turn: number, out: Closed[]) {
    this.win.push(turn);
    if (this.win.length > this.window) this.win.shift();
    const w = this.win.reduce((a, b) => a + b, 0);
    const wDir: Dir = w >= 0 ? 'R' : 'L';
    const windowStart = s.d - this.win.length * this.step;

    const cur = this.open;
    if (!cur) {
      if (Math.abs(w) >= this.enter) this.start(s, w, wDir, windowStart, true);
      return;
    }

    if (wDir !== cur.dir && Math.abs(w) >= this.enter) {
      // S-bend: close this one, the opposite curve starts right away with the opposite
      // turning that was held back (at the places where it happened)
      const steps: [number, number][] = [...cur.pendingSteps, [s.d, turn]];
      const carried = cur.pending + turn;
      this.closeInto(s, out);
      this.start(s, carried, wDir, steps[0][0] - this.step, false, steps);
      return;
    }

    const same = cur.dir === 'R' ? turn >= 0 : turn <= 0;
    if (same) {
      cur.total += cur.pending + turn;
      cur.pending = 0;
      cur.pendingSteps = [];
      cur.trace.push([s.d, cur.total]);
    } else {
      cur.pending += turn;
      cur.pendingSteps.push([s.d, turn]);
    }
    cur.speeds.push([s.d, s.speed]);
    if (Math.abs(turn) > cur.apexTurn) {
      cur.apexTurn = Math.abs(turn);
      cur.apex = s;
    }
    if (Math.abs(w) < this.exit) {
      cur.quiet += this.step;
      if (cur.quiet >= this.quietDist) this.closeInto(s, out);
    } else {
      cur.quiet = 0;
    }
  }

  /** End of track / gap: close what is open. */
  close(last: Sample | null, out: Closed[]) {
    if (this.open && last) this.closeInto(last, out);
    this.reset();
  }

  /**
   * `fromWindow`: the opening turning `w` is the whole window; otherwise it was carried over from
   * an S-bend and `carriedSteps` says where it happened.
   */
  private start(s: Sample, w: number, dir: Dir, startD: number, fromWindow: boolean, carriedSteps: [number, number][] = []) {
    // the turning that opened the curve, step by step (not as one lump at the end)
    const trace: [number, number][] = [[startD, 0]];
    let acc = 0;
    if (fromWindow) {
      this.win.forEach((x, i) => {
        acc += x;
        trace.push([s.d - (this.win.length - 1 - i) * this.step, acc]);
      });
    } else {
      for (const [d, x] of carriedSteps) {
        acc += x;
        trace.push([d, acc]);
      }
    }
    this.open = { dir, total: w, pending: 0, pendingSteps: [], t: s.t, startD, speeds: [[s.d, s.speed]], quiet: 0, apex: s, apexTurn: 0, trace };
  }

  private closeInto(s: Sample, out: Closed[]) {
    const c = this.open;
    this.open = null;
    if (c) out.push({ open: c, end: s, endD: s.d - c.quiet });
  }
}

export class CurveDetector {
  private o: CurveOptions;
  private last: Fix | null = null;
  /** last few accepted positions, for light smoothing */
  private recent: { lat: number; lon: number; speed: number }[] = [];
  private prevPos: { lat: number; lon: number } | null = null;
  private carry = 0;
  private dist = 0;
  private prevSample: Sample | null = null;
  private prevHeading: number | null = null;
  private normal: Pass;
  private wide: Pass | null;
  /** stretches [startD, endD] covered by curves of the normal pass (to merge the wide pass) */
  private covered: [number, number][] = [];

  constructor(options: Partial<CurveOptions> = {}) {
    this.o = { ...DEFAULT_CURVE_OPTIONS, ...options };
    this.normal = new Pass(this.o.step, this.o.window, this.o.enter, this.o.exit, this.o.quietDist);
    this.wide = this.o.wideWindow > 0 ? new Pass(this.o.step, this.o.wideWindow, this.o.wideEnter, this.o.wideExit, this.o.wideQuietDist) : null;
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
        this.closeAll(out);
        this.resetTrack();
      } else if (d / dt > 70) {
        return out; // impossible jump → glitch
      } else if (fix.speed == null) {
        speed = d / dt;
      }
    }
    this.last = fix;

    // light smoothing: average of the last 3 positions
    this.recent.push({ lat: fix.lat, lon: fix.lon, speed });
    if (this.recent.length > 3) this.recent.shift();
    const pos = {
      lat: this.recent.reduce((s, p) => s + p.lat, 0) / this.recent.length,
      lon: this.recent.reduce((s, p) => s + p.lon, 0) / this.recent.length,
    };
    // speed averaged the same way, so it belongs to the (smoothed) position
    speed = this.recent.reduce((s, p) => s + p.speed, 0) / this.recent.length;

    if (!this.prevPos) {
      this.prevPos = pos;
      this.prevSample = { t: fix.t, ...pos, speed, d: this.dist };
      return out;
    }

    // resample the segment prevPos → pos every `step` metres
    const seg = distance(this.prevPos, pos);
    let at = this.o.step - this.carry;
    while (at <= seg) {
      const f = at / seg;
      this.dist += this.o.step;
      const s: Sample = {
        t: fix.t,
        lat: this.prevPos.lat + (pos.lat - this.prevPos.lat) * f,
        lon: this.prevPos.lon + (pos.lon - this.prevPos.lon) * f,
        speed,
        d: this.dist,
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
    this.closeAll(out);
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
    this.normal.reset();
    this.wide?.reset();
    this.covered = [];
  }

  private closeAll(out: Curve[]) {
    const closed: Closed[] = [];
    this.normal.close(this.prevSample, closed);
    closed.forEach((c) => this.acceptNormal(c, out));
    const wide: Closed[] = [];
    this.wide?.close(this.prevSample, wide);
    wide.forEach((c) => this.acceptWide(c, out));
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

    const closed: Closed[] = [];
    this.normal.feed(s, turn, closed);
    closed.forEach((c) => this.acceptNormal(c, out));
    if (this.wide) {
      const wide: Closed[] = [];
      this.wide.feed(s, turn, wide);
      wide.forEach((c) => this.acceptWide(c, out));
    }
    // forget covered stretches that no open wide curve can reach any more
    const keepFrom = s.d - (this.o.wideWindow + 10) * this.o.step - 5000;
    while (this.covered.length && this.covered[0][1] < keepFrom) this.covered.shift();
  }

  private acceptNormal(c: Closed, out: Curve[]) {
    // even rejected candidates (too small, too slow) block the wide pass: that stretch
    // was looked at by the normal pass and judged
    this.covered.push([c.open.startD, c.endD]);
    const curve = this.toCurve(c, false);
    if (curve) out.push(curve);
  }

  private acceptWide(c: Closed, out: Curve[]) {
    const from = c.open.startD;
    const to = c.endD;
    const overlaps = (a: number, b: number) => a <= to && b >= from;
    if (this.covered.some(([a, b]) => overlaps(a, b))) return;
    const open = this.normal.current;
    if (open && overlaps(open.startD, Infinity)) return;
    const curve = this.toCurve(c, true);
    if (curve) out.push(curve);
  }

  private toCurve({ open: c, end }: Closed, wide: boolean): Curve | null {
    const angle = Math.abs(c.total);
    const totalDir: Dir = c.total >= 0 ? 'R' : 'L';
    if (totalDir !== c.dir || angle < MIN_ANGLE[this.o.sensitivity]) return null;
    // speeds only from where the turning happens (not the straight in the window's tail)
    const [d10, d90] = turningRange(c.trace, c.total);
    let inCurve = c.speeds.filter(([d]) => d >= d10 - this.o.step && d <= d90 + this.o.step).map(([, v]) => v);
    if (!inCurve.length) inCurve = c.speeds.map(([, v]) => v);
    const avg = inCurve.reduce((a, b) => a + b, 0) / inCurve.length;
    const min = Math.min(...inCurve);
    if (min < this.o.minApexSpeed) return null;
    const curve: Curve = {
      t: c.t,
      dir: c.dir,
      angle: Math.round(angle),
      entrySpeed: inCurve[0],
      minSpeed: min,
      avgSpeed: avg,
      exitSpeed: inCurve[inCurve.length - 1],
      lat: c.apex.lat,
      lon: c.apex.lon,
      endT: end.t,
      lengthM: Math.max(this.o.step, Math.round((d90 - d10) / 0.8)),
    };
    if (wide) curve.wide = true;
    return curve;
  }
}
