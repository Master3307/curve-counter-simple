/**
 * Where GPS fixes come from.
 *
 * Every source keeps a numbered **fix log** for the running session. The engine never relies on
 * live callbacks alone: it pulls `read(from)` whenever it gets a chance (data ping, app resume,
 * cold start). So fixes recorded while the WebView was frozen or the app was killed are not lost:
 * they are simply processed later, in order.
 *
 * - `nativeSource`: Android foreground service (see android/.../tracking). Log lives in a file,
 *   survives the app being killed. Keeps recording with the screen off.
 * - `webSource`: @capacitor/geolocation, log in memory. Browser / iOS placeholder: only works
 *   while the app is open.
 *   TODO(milestone 5): native iOS recorder (CLLocationManager background mode).
 * - `demoSource`: plays a simulated ride (Help → "Simulate a test ride").
 */
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { Fix } from '../logic/geo';
import { simulate, type Leg } from '../logic/simulate';
import { Recorder } from './plugin';

export type Stop = () => void;

export interface FixSource {
  readonly kind: 'native' | 'web' | 'demo';
  /** Starts recording a new session (clears the previous log). */
  start(sessionId: string): Promise<void>;
  /** Stops recording and drops the log. */
  stop(): Promise<void>;
  /** Up to `limit` fixes with sequence number ≥ `from` (sequence numbers start at 0). */
  read(from: number, limit: number): Promise<{ fixes: Fix[] }>;
  /** Session that is still being recorded (e.g. after the app was killed), or null. */
  active(): Promise<string | null>;
  /** Called when new fixes are available. */
  onData(cb: () => void): Stop;
  /** Live text for the permanent notification (no-op where there is none). */
  notify?(title: string, text: string): void;
}

/** In-memory log, shared by the web and demo sources. */
class MemoryLog {
  fixes: Fix[] = [];
  session: string | null = null;
  private listeners = new Set<() => void>();

  push(fix: Fix) {
    this.fixes.push(fix);
    this.listeners.forEach((l) => l());
  }
  read(from: number, limit: number) {
    return Promise.resolve({ fixes: this.fixes.slice(from, from + limit) });
  }
  onData(cb: () => void): Stop {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  reset(session: string | null) {
    this.fixes = [];
    this.session = session;
  }
}

export function webSource(): FixSource {
  const log = new MemoryLog();
  let watchId: string | null = null;
  return {
    kind: 'web',
    async start(sessionId) {
      await this.stop();
      log.reset(sessionId);
      watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }, (pos, err) => {
        if (err || !pos) return;
        log.push({
          t: pos.timestamp,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : null,
          accuracy: pos.coords.accuracy,
        });
      });
    },
    async stop() {
      if (watchId) await Geolocation.clearWatch({ id: watchId }).catch(() => {});
      watchId = null;
      log.reset(null);
    },
    read: (from, limit) => log.read(from, limit),
    // the in-memory log is gone after a reload
    active: () => Promise.resolve(watchId ? log.session : null),
    onData: (cb) => log.onData(cb),
  };
}

export function nativeSource(): FixSource {
  return {
    kind: 'native',
    start: (sessionId) => Recorder.start({ sessionId }),
    stop: () => Recorder.stop(),
    read: (from, limit) => Recorder.read({ from, limit }),
    active: async () => (await Recorder.status()).sessionId,
    onData(cb) {
      const sub = Recorder.addListener('fix', cb);
      return () => {
        sub.then((s) => s.remove());
      };
    },
    notify(title, text) {
      Recorder.updateNotification({ title, text }).catch(() => {});
    },
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

/** Plays a synthetic ride, `speedUp` times faster than real time, then calls `onDone`. */
export function demoSource(onDone: () => void, speedUp = 8): FixSource {
  const log = new MemoryLog();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    kind: 'demo',
    async start(sessionId) {
      log.reset(sessionId);
      const fixes = simulate(DEMO_ROUTE, { noise: 1, seed: 42, t0: Date.now() });
      const t0 = fixes[0].t;
      const wall0 = Date.now();
      let i = 0;
      timer = setInterval(() => {
        const virtual = t0 + (Date.now() - wall0) * speedUp;
        while (i < fixes.length && fixes[i].t <= virtual) log.push(fixes[i++]);
        if (i >= fixes.length) {
          clearInterval(timer!);
          timer = null;
          onDone();
        }
      }, 100);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      log.reset(null);
    },
    read: (from, limit) => log.read(from, limit),
    active: () => Promise.resolve(timer ? log.session : null),
    onData: (cb) => log.onData(cb),
  };
}

/** The source for real rides on this platform. */
export function defaultSource(): FixSource {
  return Capacitor.getPlatform() === 'android' ? nativeSource() : webSource();
}
