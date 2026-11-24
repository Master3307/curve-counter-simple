/**
 * Curve detector – the reference implementation of the algorithm (see docs/curve-detection.md).
 * The native Android/iOS trackers will be ports of this file and are checked against the same
 * fixtures in /fixtures/tracks.
 *
 * Idea: GPS positions → resampled every STEP metres (so speed doesn't matter) → heading change
 * per step → sliding window sum = "how hard are we turning" → small state machine.
 * Positive heading change = clockwise = RIGHT curve.
 *
 * Three sources of "how much did we turn", each with its own trust level, fused per step:
 *   1. position course  – bearing between smoothed positions. Always there, noisy at low speed
 *                          and with bad accuracy (multipath, trees, buildings).
 *   2. Doppler course    – the GPS chip's own course over ground. Calm while moving ≥ 3 m/s.
 *   3. gyroscope         – yaw rate around the gravity axis ("invisible compass"), works with the
 *                          phone in any position. Excellent short-term, drifts long-term.
 * When (2) or (3) are there, a position jump that the other sources don't confirm is ignored.
 *
 * What counts as ONE curve (the definition the ground truth is labelled with):
 * - a continuous change of direction ≥ MIN_ANGLE in one direction, driven while moving;
 * - a straight of ≥ 50 m between two same-direction bends makes them two curves
 *   (only if both parts are big enough to count on their own);
 * - an opposite-direction turn of ≥ ENTER always separates (S-bend = two curves);
 * - roundabout / hairpin / ramp loop = one curve; lane change / overtake = no curve;
 * - standing still (traffic light, bus stop) inside a curve doesn't break or cancel it;
 * - wide motorway sweepers count only from WIDE_MIN_ANGLE on and are marked `wide`.
 */
import { angleDiff, bearing, distance, type Fix } from './geo';

export type Dir = 'L' | 'R';
export type Sensitivity = 'few' | 'normal' | 'many';

export interface Curve {
  /** start of the turning, epoch ms */
  t: number;
  dir: Dir;
  /** total heading change in degrees (always positive) */
  angle: number;
  /** speeds in m/s */
  entrySpeed: number;
  minSpeed: number;
  avgSpeed: number;
  exitSpeed: number;
  /** middle of the turning (where a map marker goes) */
  lat: number;
  lon: number;
  /** end of the turning, epoch ms (missing in rides from v0.2) */
  endT?: number;
  /** length of the turning part along the road, m */
  lengthM?: number;
  /** found by the long-window pass (wide sweeper) */
  wide?: boolean;
  /** 0…1 how sure the detector is (sources agree, good GPS, clear angle) */
  confidence?: number;
  /** which sources saw this curve: p = position course, c = Doppler course, g = gyroscope */
  sources?: string;
  /** measured lean / body roll in degrees at the apex (phone held firmly only), + = right */
  leanDeg?: number;
}

/** Minimum total heading change for a curve to count. */
export const MIN_ANGLE: Record<Sensitivity, number> = { few: 45, normal: 30, many: 20 };
/** Wide sweepers (motorway bends, radius ≳ 500 m) only count from here on – a rider hardly leans. */
export const WIDE_MIN_ANGLE: Record<Sensitivity, number> = { few: 60, normal: 45, many: 30 };

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
  /** the turning must happen at least this fast on average (pushing the bike / walking don't count), m/s */
  minTurnSpeed: number;
  /** below this the vehicle stands: positions are frozen so GPS jitter can't draw curves, m/s */
  stopSpeed: number;
  /** fixes worse than this are ignored, m */
  maxAccuracy: number;
  /** a gap longer than this resets the detector (tunnel), s / m */
  maxGapS: number;
  maxGapM: number;
  /** a step turning more than this and straight back on the next step is a GPS spike, deg */
  spikeTurn: number;
  /** a straight at least this long splits two same-direction bends, m */
  splitGap: number;
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
  quietDist: 40,
  minTurnSpeed: 6 / 3.6,
  stopSpeed: 3.5 / 3.6,
  maxAccuracy: 30,
  maxGapS: 20,
  maxGapM: 300,
  spikeTurn: 100,
  splitGap: 50,
  wideWindow: 50,
  wideEnter: 6,
  wideExit: 2.5,
  wideQuietDist: 100,
};

/** One resampled step. */
interface Step {
  /** distance along the track since the detector started, m */
  d: number;
  t: number;
  lat: number;
  lon: number;
  speed: number;
  /** fused heading change of this step, deg */
  turn: number;
  /** turn from positions only / from the other sources (null = none) */
  posTurn: number;
  altTurn: number | null;
  /** 'c' Doppler course, 'g' gyroscope, '' none */
  alt: '' | 'c' | 'g';
  accuracy: number;
  g?: [number, number, number] | null;
}

interface Open {
  dir: Dir;
  /** every step since the turning started (first ones = the window that opened it) */
  steps: Step[];
  /** trailing opposite-direction steps (held back: they start the next curve of an S-bend) */
  pending: number;
  quiet: number;
}

/** A closed candidate, before the angle / speed rules are applied. */
interface Closed {
  dir: Dir;
  steps: Step[];
}

/** One sliding-window state machine. */
class Pass {
  private win: Step[] = [];
  private sum = 0;
  private open: Open | null = null;

  constructor(
    private window: number,
    private enter: number,
    private exit: number,
    private quietDist: number,
    private step: number,
  ) {}

  get current(): Open | null {
    return this.open;
  }

  reset() {
    this.win = [];
    this.sum = 0;
    this.open = null;
  }

  feed(s: Step, out: Closed[]) {
    this.win.push(s);
    this.sum += s.turn;
    if (this.win.length > this.window) this.sum -= this.win.shift()!.turn;
    const w = this.sum;
    const wDir: Dir = w >= 0 ? 'R' : 'L';

    const cur = this.open;
    if (!cur) {
      if (Math.abs(w) >= this.enter) this.open = { dir: wDir, steps: [...this.win], pending: 0, quiet: 0 };
      return;
    }

    cur.steps.push(s);
    // reversal over the last half window: catches an S-bend whose first half is still in the
    // long window (a big turn followed closely by a smaller opposite one)
    const short = this.win.slice(-Math.max(3, Math.round(this.window / 2)));
    const shortSum = short.reduce((a, x) => a + x.turn, 0);
    const shortDir: Dir = shortSum >= 0 ? 'R' : 'L';
    const sinceStart = Math.abs(sumTurn(cur.steps.slice(0, cur.steps.length - short.length)));
    const reversed =
      (wDir !== cur.dir && Math.abs(w) >= this.enter) ||
      (shortDir !== cur.dir &&
        Math.abs(shortSum) >= 2 * this.enter &&
        sinceStart >= 3 * this.enter &&
        // only at road speed: in town at walking/bus-stop pace this is mostly a bus bay or a jog
        mean(short.map((x) => x.speed)) >= 25 / 3.6);
    if (reversed) {
      // S-bend: close this one; the opposite curve starts with the opposite turning that was
      // held back (at the places where it happened)
      const n = Math.max(cur.pending + 1, short.length);
      let carried = cur.steps.slice(Math.max(1, cur.steps.length - n));
      const isSame = (x: Step) => (cur.dir === 'R' ? x.turn > 0 : x.turn < 0);
      while (carried.length > 1 && isSame(carried[0])) carried = carried.slice(1);
      cur.steps.length -= carried.length;
      out.push({ dir: cur.dir, steps: cur.steps });
      const dir: Dir = cur.dir === 'R' ? 'L' : 'R';
      this.open = { dir, steps: carried, pending: 0, quiet: 0 };
      // the window starts fresh from the new curve, so the old turning can't flip it back
      this.win = [...carried];
      this.sum = sumTurn(carried);
      return;
    }

    const same = cur.dir === 'R' ? s.turn >= 0 : s.turn <= 0;
    cur.pending = same ? 0 : cur.pending + 1;
    if (Math.abs(w) < this.exit) {
      cur.quiet += this.step;
      if (cur.quiet >= this.quietDist) this.closeInto(out);
    } else {
      cur.quiet = 0;
    }
  }

  /** End of track / gap: close what is open. */
  close(out: Closed[]) {
    this.closeInto(out);
    this.reset();
  }

  private closeInto(out: Closed[]) {
    const c = this.open;
    this.open = null;
    if (!c) return;
    // the quiet tail isn't part of the curve
    out.push({ dir: c.dir, steps: c.steps.slice(0, c.steps.length - c.pending) });
  }
}

const sumTurn = (steps: Step[]) => steps.reduce((a, s) => a + s.turn, 0);

/**
 * Where the turning really happens: indices at which the accumulated turn (in the curve's
 * direction) reaches 10 %, 50 % and 90 % of the total. Robust against the window smearing the
 * start and end.
 */
function turningIndices(steps: Step[], total: number): [number, number, number] {
  const sign = total >= 0 ? 1 : -1;
  const goal = Math.abs(total);
  const res: number[] = [];
  for (const frac of [0.1, 0.5, 0.9]) {
    let acc = 0;
    let idx = steps.length - 1;
    for (let i = 0; i < steps.length; i++) {
      acc += sign * steps[i].turn;
      if (acc >= goal * frac) {
        idx = i;
        break;
      }
    }
    res.push(idx);
  }
  return res as [number, number, number];
}

/**
 * Straight stretches inside a candidate: [first index, last index] where the heading stays within
 * 4° for at least `minLen`, and that turn clearly less (< 30 %) than the curve on average. The
 * second rule keeps a long, even motorway sweeper (≈ 1° per 10 m) in one piece.
 */
function straights(steps: Step[], step: number, minLen: number, meanTurnPerStep: number): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < steps.length) {
    let lo = 0;
    let hi = 0;
    let acc = 0;
    let j = i;
    for (; j < steps.length; j++) {
      acc += steps[j].turn;
      lo = Math.min(lo, acc);
      hi = Math.max(hi, acc);
      if (hi - lo > 4) break;
    }
    const n = j - i;
    const flat = Math.abs(sumTurn(steps.slice(i, j))) / Math.max(1, n) < 0.3 * meanTurnPerStep;
    if (n * step >= minLen && flat) {
      out.push([i, j - 1]);
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Lean / body roll from the phone's gravity vector, relative to the "upright" reference. */
export function tiltBetween(g: [number, number, number], ref: [number, number, number]): number {
  const dot = g[0] * ref[0] + g[1] * ref[1] + g[2] * ref[2];
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

export class CurveDetector {
  private o: CurveOptions;
  private last: Fix | null = null;
  /** last few accepted positions, for light smoothing */
  private recent: { lat: number; lon: number; speed: number; t: number }[] = [];
  private prevPos: { lat: number; lon: number; t: number } | null = null;
  private carry = 0;
  private dist = 0;
  private prevSample: { lat: number; lon: number } | null = null;
  private prevHeading: number | null = null;
  /** turning from the other sources since the last accepted fix, and which source */
  private altPending = 0;
  private altKind: '' | 'c' | 'g' = '';
  private prevBearing: number | null = null;
  /** one-step delay to catch spikes (turn hard, turn straight back) */
  private held: Step | null = null;
  /** standing since (epoch ms), and fixes held back until movement is confirmed */
  private stopT: number | null = null;
  private warm: { fix: Fix; speed: number }[] | null = null;
  /** 0…1 how well course / gyro agreed with the positions on clear turns so far */
  private altTrust = 1;
  private agreeBuf: [number, number][] = [];
  /** fixes rejected in a row for jumping too far */
  private rejected = 0;
  /** "upright" gravity reference, learned on straight stretches */
  private gRef: [number, number, number] | null = null;
  private normal: Pass;
  private wide: Pass | null;
  /** stretches [startD, endD] covered by curves of the normal pass (to merge the wide pass) */
  private covered: [number, number][] = [];

  constructor(options: Partial<CurveOptions> = {}) {
    this.o = { ...DEFAULT_CURVE_OPTIONS, ...options };
    this.normal = new Pass(this.o.window, this.o.enter, this.o.exit, this.o.quietDist, this.o.step);
    this.wide =
      this.o.wideWindow > 0 ? new Pass(this.o.wideWindow, this.o.wideEnter, this.o.wideExit, this.o.wideQuietDist, this.o.step) : null;
  }

  /** Feed one GPS fix. Returns the curves that were completed by it (usually none). */
  push(fix: Fix): Curve[] {
    const out: Curve[] = [];
    // the gyro turning of every fix counts, also of fixes that are skipped below
    if (fix.yaw != null && Number.isFinite(fix.yaw)) {
      this.altPending += fix.yaw;
      this.altKind = 'g';
    }
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
      } else if (fix.speed != null && d / dt > 2 * Math.max(fix.speed, this.last.speed ?? 0) + 8 && this.rejected < 3) {
        // the position jumped much further than the GPS's own (Doppler) speed allows:
        // multipath / reflection. Compared with the last good fix, so the jump back is fine.
        this.rejected++;
        return out;
      } else if (fix.speed == null) {
        speed = d / dt;
      }
    }
    this.last = fix;
    this.rejected = 0;

    // standing still: GPS jitter must not draw curves. Positions are frozen until it moves.
    if (speed < this.o.stopSpeed) {
      this.warm = null;
      this.stopT ??= fix.t;
      this.prevBearing = null;
      return out;
    }
    // after standing ≥ 30 s (indoors, long stop) GPS often "drives off" on its own when the
    // signal comes back: movement only counts once it is confirmed (≥ 4 fixes, ≥ 15 m, going
    // somewhere rather than zig-zagging). The held fixes are then used, so nothing is lost.
    if (this.stopT != null && fix.t - this.stopT >= 30_000) {
      const warm = (this.warm ??= []);
      warm.push({ fix, speed });
      let path = 0;
      for (let i = 1; i < warm.length; i++) path += distance(warm[i - 1].fix, warm[i].fix);
      const net = distance(warm[0].fix, warm[warm.length - 1].fix);
      if (warm.length < 4 || path < 15 || net < 0.5 * path) {
        if (warm.length > 30) this.warm = warm.slice(-10);
        return out;
      }
      this.warm = null;
      this.stopT = null;
      for (const w of warm) this.process(w.fix, w.speed, out);
      return out;
    }
    this.stopT = null;
    this.process(fix, speed, out);
    return out;
  }

  private process(fix: Fix, speed: number, out: Curve[]) {
    // Doppler course as the second source (only when there's no gyroscope)
    if (fix.bearing != null && Number.isFinite(fix.bearing) && speed >= 3) {
      if (this.altKind !== 'g' && this.prevBearing != null) {
        this.altPending += angleDiff(this.prevBearing, fix.bearing);
        this.altKind = 'c';
      }
      this.prevBearing = fix.bearing;
    } else {
      this.prevBearing = null;
    }

    // light smoothing: average of the last 3 positions
    this.recent.push({ lat: fix.lat, lon: fix.lon, speed, t: fix.t });
    if (this.recent.length > 3) this.recent.shift();
    const pos = {
      lat: mean(this.recent.map((p) => p.lat)),
      lon: mean(this.recent.map((p) => p.lon)),
      t: mean(this.recent.map((p) => p.t)),
    };
    // speed averaged the same way, so it belongs to the (smoothed) position
    speed = mean(this.recent.map((p) => p.speed));

    if (!this.prevPos) {
      this.prevPos = pos;
      this.prevSample = pos;
      this.altPending = 0;
      this.altKind = '';
      return;
    }

    // resample the segment prevPos → pos every `step` metres
    const seg = distance(this.prevPos, pos);
    const steps = Math.floor((seg + this.carry) / this.o.step);
    const altPerStep = this.altKind && steps > 0 ? this.altPending / steps : null;
    const altKind = this.altKind;
    if (steps > 0) {
      this.altPending = 0;
      this.altKind = '';
    }
    let at = this.o.step - this.carry;
    while (at <= seg) {
      const f = at / seg;
      this.dist += this.o.step;
      const s = {
        t: this.prevPos.t + (pos.t - this.prevPos.t) * f,
        lat: this.prevPos.lat + (pos.lat - this.prevPos.lat) * f,
        lon: this.prevPos.lon + (pos.lon - this.prevPos.lon) * f,
      };
      this.onSample(s, speed, altPerStep, altKind, fix, out);
      at += this.o.step;
    }
    this.carry = seg - (at - this.o.step);
    this.prevPos = pos;
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
    this.altPending = 0;
    this.altKind = '';
    this.prevBearing = null;
    this.held = null;
    this.stopT = null;
    this.warm = null;
    this.normal.reset();
    this.wide?.reset();
    this.covered = [];
  }

  private closeAll(out: Curve[]) {
    if (this.held) {
      this.feedPasses(this.held, out);
      this.held = null;
    }
    const closed: Closed[] = [];
    this.normal.close(closed);
    closed.forEach((c) => this.acceptNormal(c, out));
    const wide: Closed[] = [];
    this.wide?.close(wide);
    wide.forEach((c) => this.acceptWide(c, out));
  }

  private onSample(
    p: { t: number; lat: number; lon: number },
    speed: number,
    altTurn: number | null,
    alt: '' | 'c' | 'g',
    fix: Fix,
    out: Curve[],
  ) {
    const prev = this.prevSample;
    this.prevSample = p;
    if (!prev) return;
    const h = bearing(prev, p);
    const ph = this.prevHeading;
    this.prevHeading = h;
    if (ph == null) return;
    const posTurn = angleDiff(ph, h);

    // fuse: the other sources are calmer; a position jump they don't confirm is ignored
    let turn = posTurn;
    // a source that keeps disagreeing on clear turns (stuck sensor, phone turning in a pocket)
    // loses trust and is then ignored
    // judged over the last 100 m: a real curve keeps turning one way, a GPS drift goes out and back
    if (altTurn != null) {
      this.agreeBuf.push([posTurn, altTurn]);
      if (this.agreeBuf.length > 10) this.agreeBuf.shift();
      const ps = this.agreeBuf.reduce((a, x) => a + x[0], 0);
      const as = this.agreeBuf.reduce((a, x) => a + x[1], 0);
      if (Math.abs(ps) > 45 && speed > 3) {
        const ok = Math.sign(ps) === Math.sign(as) && Math.abs(as) > Math.abs(ps) * 0.4;
        this.altTrust = 0.9 * this.altTrust + 0.1 * (ok ? 1 : 0);
      }
    } else {
      this.agreeBuf = [];
    }
    if (altTurn != null && this.altTrust < 0.5) altTurn = null;
    if (altTurn != null) {
      const wAlt = alt === 'g' ? 0.65 : 0.5;
      turn = Math.abs(posTurn - altTurn) > 25 ? altTurn : (1 - wAlt) * posTurn + wAlt * altTurn;
    }
    const s: Step = { d: this.dist, t: p.t, lat: p.lat, lon: p.lon, speed, turn, posTurn, altTurn, alt: altTurn == null ? '' : alt, accuracy: fix.accuracy, g: fix.g };
    this.learnUpright(s);

    // spike: hard turn and straight back on the next step → GPS glitch, both cancel out
    const held = this.held;
    if (held && Math.abs(held.turn) > this.o.spikeTurn && Math.abs(s.turn) > this.o.spikeTurn && Math.sign(held.turn) !== Math.sign(s.turn)) {
      s.turn += held.turn;
      held.turn = 0;
    }
    if (held) this.feedPasses(held, out);
    this.held = s;
  }

  /** Learns the phone's "upright" gravity direction while riding straight (background calibration). */
  private learnUpright(s: Step) {
    if (!s.g || Math.abs(s.turn) > 1) return;
    if (!this.gRef) {
      this.gRef = [...s.g];
      return;
    }
    const k = 0.05;
    const r = this.gRef.map((v, i) => v + k * (s.g![i] - v)) as [number, number, number];
    const n = Math.hypot(...r) || 1;
    this.gRef = r.map((v) => v / n) as [number, number, number];
  }

  private feedPasses(s: Step, out: Curve[]) {
    const closed: Closed[] = [];
    this.normal.feed(s, closed);
    closed.forEach((c) => this.acceptNormal(c, out));
    if (this.wide) {
      const wide: Closed[] = [];
      this.wide.feed(s, wide);
      wide.forEach((c) => this.acceptWide(c, out));
    }
    // forget covered stretches that no open wide curve can reach any more
    const keepFrom = s.d - (this.o.wideWindow + 10) * this.o.step - 5000;
    while (this.covered.length && this.covered[0][1] < keepFrom) this.covered.shift();
  }

  private acceptNormal(c: Closed, out: Curve[]) {
    if (!c.steps.length) return;
    // even rejected candidates (too small, too slow) block the wide pass: that stretch
    // was looked at by the normal pass and judged
    this.covered.push([c.steps[0].d, c.steps[c.steps.length - 1].d]);
    for (const part of this.split(c)) {
      const curve = this.toCurve(part, false);
      if (curve) out.push(curve);
    }
  }

  private acceptWide(c: Closed, out: Curve[]) {
    if (!c.steps.length) return;
    const from = c.steps[0].d;
    const to = c.steps[c.steps.length - 1].d;
    const overlaps = (a: number, b: number) => a <= to && b >= from;
    if (this.covered.some(([a, b]) => overlaps(a, b))) return;
    const open = this.normal.current;
    if (open && open.steps.length && overlaps(open.steps[0].d, Infinity)) return;
    const curve = this.toCurve(c, true);
    if (curve) out.push(curve);
  }

  /** Two same-direction bends with a real straight between them are two curves. */
  private split(c: Closed): Closed[] {
    const min = MIN_ANGLE[this.o.sensitivity];
    const sign = c.dir === 'R' ? 1 : -1;
    const parts: Closed[] = [];
    let rest = c.steps;
    const total = Math.abs(sumTurn(c.steps));
    const [i10, , i90] = turningIndices(c.steps, sumTurn(c.steps));
    const meanTurn = total / Math.max(1, i90 - i10 + 1);
    for (const [a, b] of straights(c.steps, this.o.step, this.o.splitGap, meanTurn)) {
      const offset = c.steps.length - rest.length;
      const ia = a - offset;
      const ib = b - offset;
      if (ia <= 0 || ib >= rest.length - 1) continue;
      const left = rest.slice(0, ia);
      const right = rest.slice(ib + 1);
      if (sign * sumTurn(left) >= min && sign * sumTurn(right) >= min) {
        parts.push({ dir: c.dir, steps: left });
        rest = right;
      }
    }
    parts.push({ dir: c.dir, steps: rest });
    return parts;
  }

  private toCurve({ dir, steps }: Closed, wide: boolean): Curve | null {
    if (steps.length < 2) return null;
    const total = sumTurn(steps);
    const angle = Math.abs(total);
    const totalDir: Dir = total >= 0 ? 'R' : 'L';
    const min = wide ? WIDE_MIN_ANGLE[this.o.sensitivity] : MIN_ANGLE[this.o.sensitivity];
    if (totalDir !== dir || angle < min) return null;
    // speeds only from where the turning happens (not the straight in the window's tail)
    const [i10, i50, i90] = turningIndices(steps, total);
    const turning = steps.slice(i10, i90 + 1);
    const speeds = turning.map((s) => s.speed);
    // median: the speed in the curve, not pulled up by the faster approach
    const avg = [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length / 2)];
    if (avg < this.o.minTurnSpeed) return null;

    // confidence: clear angle, sources agree, good GPS
    const margin = Math.min(1, (angle - min) / min);
    const withAlt = turning.filter((s) => s.altTurn != null);
    const agree = withAlt.length
      ? withAlt.filter((s) => Math.sign(s.posTurn) === Math.sign(s.altTurn!) || Math.abs(s.posTurn - s.altTurn!) < 3).length / withAlt.length
      : 0.6;
    const acc = mean(turning.map((s) => s.accuracy));
    const accScore = Math.max(0, Math.min(1, (25 - acc) / 17));
    // slow and very tight (≥ 3°/m below 10 km/h): GPS can't tell manoeuvring from noise well
    const slowTight = avg < 10 / 3.6 && angle / Math.max(10, (i90 - i10 + 1) * this.o.step) > 3 ? 0.25 : 0;
    const confidence = Math.max(0, Math.round((0.35 * margin + 0.35 * agree + 0.3 * accScore - slowTight) * 100) / 100);
    const sources = 'p' + (withAlt.some((s) => s.alt === 'c') ? 'c' : '') + (withAlt.some((s) => s.alt === 'g') ? 'g' : '');

    const apex = steps[i50];
    const curve: Curve = {
      t: Math.round(steps[i10].t),
      dir,
      angle: Math.round(angle),
      entrySpeed: speeds[0],
      minSpeed: Math.min(...speeds),
      avgSpeed: avg,
      exitSpeed: speeds[speeds.length - 1],
      lat: apex.lat,
      lon: apex.lon,
      endT: Math.round(steps[i90].t),
      lengthM: Math.max(this.o.step, Math.round(((i90 - i10) * this.o.step) / 0.8)),
      confidence,
      sources,
    };
    if (wide) curve.wide = true;
    if (this.gRef) {
      const tilted = turning.filter((s) => s.g).map((s) => tiltBetween(s.g!, this.gRef!));
      if (tilted.length) curve.leanDeg = Math.round(Math.max(...tilted) * (dir === 'R' ? 1 : -1));
    }
    return curve;
  }
}
