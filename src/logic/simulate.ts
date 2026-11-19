/**
 * Builds synthetic GPS tracks for tests and the in-app demo ride.
 * A track is a list of legs: straight lines or arcs (radius, signed angle: + = right).
 */
import { destination, type Fix } from './geo';

export type Leg =
  | { kind: 'straight'; length: number; speedKmh: number }
  | { kind: 'arc'; radius: number; angle: number; speedKmh: number }
  | { kind: 'stop'; seconds: number };

export interface SimOptions {
  start?: { lat: number; lon: number };
  heading?: number;
  t0?: number;
  /** fix interval, s */
  interval?: number;
  /** random position noise, m (uniform ±) */
  noise?: number;
  seed?: number;
}

/** Tiny deterministic PRNG so tests are stable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(legs: Leg[], opts: SimOptions = {}): Fix[] {
  const interval = opts.interval ?? 1;
  const rnd = mulberry32(opts.seed ?? 1);
  let pos = opts.start ?? { lat: 47.6, lon: 11.9 };
  let heading = opts.heading ?? 0;
  let t = opts.t0 ?? Date.UTC(2026, 5, 1, 9);
  const fixes: Fix[] = [];

  const emit = (speed: number) => {
    const noise = opts.noise ?? 0;
    const p = noise ? destination(pos, rnd() * 360, rnd() * noise) : pos;
    fixes.push({ t, lat: p.lat, lon: p.lon, speed, accuracy: 5 });
  };

  emit(0);
  for (const leg of legs) {
    if (leg.kind === 'stop') {
      for (let s = 0; s < leg.seconds; s += interval) {
        t += interval * 1000;
        emit(0);
      }
      continue;
    }
    const v = leg.speedKmh / 3.6;
    const length = leg.kind === 'straight' ? leg.length : (Math.abs(leg.angle) * Math.PI * leg.radius) / 180;
    const steps = Math.max(1, Math.round(length / (v * interval)));
    const stepLen = length / steps;
    const stepTurn = leg.kind === 'arc' ? leg.angle / steps : 0;
    for (let i = 0; i < steps; i++) {
      // move along the chord with half the turn before and after → follows the arc
      heading += stepTurn / 2;
      pos = destination(pos, heading, stepLen);
      heading += stepTurn / 2;
      t += interval * 1000;
      emit(v);
    }
  }
  return fixes;
}
