/**
 * Where GPS fixes come from.
 *
 * Placeholder: @capacitor/geolocation (works while the app is open / in the foreground).
 * Planned: the native `SimpleCurveCounter` plugin (see ./plugin.ts) which keeps running in a
 * foreground service (Android) / background location mode (iOS) and does the counting natively.
 */
import { Geolocation } from '@capacitor/geolocation';
import type { Fix } from '../logic/geo';
import { simulate, type Leg } from '../logic/simulate';

export type FixHandler = (fix: Fix) => void;
export type Stop = () => void;

export async function watchGps(onFix: FixHandler, onError?: (e: unknown) => void): Promise<Stop> {
  const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }, (pos, err) => {
    if (err || !pos) {
      onError?.(err);
      return;
    }
    onFix({
      t: pos.timestamp,
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      speed: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : null,
      accuracy: pos.coords.accuracy,
    });
  });
  return () => {
    Geolocation.clearWatch({ id }).catch(() => {});
  };
}

const DEMO_ROUTE: Leg[] = [
  { kind: 'stop', seconds: 20 },
  { kind: 'straight', length: 600, speedKmh: 60 },
  { kind: 'arc', radius: 80, angle: 70, speedKmh: 55 },
  { kind: 'straight', length: 250, speedKmh: 70 },
  { kind: 'arc', radius: 60, angle: -90, speedKmh: 50 },
  { kind: 'arc', radius: 60, angle: 80, speedKmh: 50 },
  { kind: 'straight', length: 400, speedKmh: 80 },
  { kind: 'arc', radius: 20, angle: -160, speedKmh: 25 },
  { kind: 'straight', length: 300, speedKmh: 60 },
  { kind: 'arc', radius: 120, angle: 55, speedKmh: 75 },
  { kind: 'straight', length: 300, speedKmh: 70 },
  { kind: 'arc', radius: 90, angle: -65, speedKmh: 60 },
  { kind: 'straight', length: 500, speedKmh: 90 },
];

/** Plays a synthetic ride, `speedUp` times faster than real time, with real-time timestamps. */
export function playDemo(onFix: FixHandler, onDone: () => void, speedUp = 8): Stop {
  const fixes = simulate(DEMO_ROUTE, { noise: 1, seed: 42, t0: Date.now() });
  const t0 = fixes[0].t;
  const wall0 = Date.now();
  let i = 0;
  const timer = setInterval(() => {
    const virtual = t0 + (Date.now() - wall0) * speedUp;
    while (i < fixes.length && fixes[i].t <= virtual) onFix(fixes[i++]);
    if (i >= fixes.length) {
      clearInterval(timer);
      onDone();
    }
  }, 100);
  return () => clearInterval(timer);
}
