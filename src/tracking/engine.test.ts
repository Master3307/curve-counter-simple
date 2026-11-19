/**
 * Engine robustness (Rule 1: never lose a ride).
 * A fake "native" recorder keeps its log across a simulated app kill, like the Android service.
 */
import { vi } from 'vitest';
import type { Fix } from '../logic/geo';
import { simulate, type Leg } from '../logic/simulate';
import type { FixSource } from './source';

// Preferences → in-memory map that survives vi.resetModules() (= the phone's disk)
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: disk.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void disk.set(key, value),
    remove: async ({ key }: { key: string }) => void disk.delete(key),
  },
}));

const ROUTE: Leg[] = [
  { kind: 'stop', seconds: 30 },
  { kind: 'straight', length: 500, speedKmh: 60 },
  { kind: 'arc', radius: 80, angle: 70, speedKmh: 55 },
  { kind: 'straight', length: 300, speedKmh: 70 },
  { kind: 'arc', radius: 60, angle: -90, speedKmh: 50 },
  { kind: 'arc', radius: 60, angle: 80, speedKmh: 50 },
  { kind: 'straight', length: 400, speedKmh: 80 },
  { kind: 'arc', radius: 25, angle: -150, speedKmh: 25 },
  { kind: 'straight', length: 400, speedKmh: 60 },
];
const FIXES = simulate(ROUTE, { noise: 2, seed: 7, t0: 1_700_000_000_000 });

/** Recorder whose log lives outside the engine module (survives a "kill"). */
function fakeRecorder() {
  const rec = {
    session: null as string | null,
    log: [] as Fix[],
    listeners: new Set<() => void>(),
    push(f: Fix, ping = true) {
      rec.log.push(f);
      if (ping) rec.listeners.forEach((l) => l());
    },
    source(): FixSource {
      return {
        kind: 'native',
        start: async (id) => {
          rec.session = id;
          rec.log = [];
        },
        stop: async () => {
          rec.session = null;
          rec.log = [];
        },
        read: async (from, limit) => ({ fixes: rec.log.slice(from, from + limit) }),
        active: async () => rec.session,
        onData: (cb) => {
          rec.listeners.add(cb);
          return () => rec.listeners.delete(cb);
        },
      };
    },
  };
  return rec;
}

/** Starts the app. `fresh` = first install (empty disk); otherwise a restart after a kill. */
async function boot(rec: ReturnType<typeof fakeRecorder>, fresh = true) {
  if (fresh) disk.clear();
  rec.listeners.clear();
  vi.resetModules();
  const store = await import('../store');
  await store.useStore.persist.rehydrate();
  const engine = await import('./engine');
  engine.setSource(rec.source());
  await engine.initEngine();
  return { ...engine, ...store };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** what a ride must look like: curves found + same totals, no matter how it was processed */
const summary = (r: { left: number; right: number; curves: unknown[]; distanceM: number; startedAt: number; endedAt: number | null }) => ({
  left: r.left,
  right: r.right,
  curves: r.curves.length,
  distanceM: Math.round(r.distanceM),
  startedAt: r.startedAt,
  endedAt: r.endedAt != null,
});

beforeEach(() => {
  disk.clear();
});
afterEach(() => {
  vi.clearAllTimers();
});

describe('engine', () => {
  async function uninterrupted() {
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    expect(e.useStore.getState().phase).toBe('armed');
    for (const f of FIXES) rec.push(f);
    await e.pump();
    expect(e.useStore.getState().phase).toBe('riding');
    await e.stopRide();
    const s = e.useStore.getState();
    expect(s.phase).toBe('off');
    expect(s.session).toBeNull();
    expect(s.rides).toHaveLength(1);
    expect(s.summaryId).toBe(s.rides[0].id); // summary card right after Stop
    return s.rides[0];
  }

  it('records a manual ride: starts when rolling, counts both directions', async () => {
    const ride = await uninterrupted();
    expect(ride.left).toBe(2);
    expect(ride.right).toBe(2);
    // armed during the 30 s stop → ride starts when rolling off, not at the button press
    expect(ride.startedAt).toBeGreaterThanOrEqual(FIXES[0].t + 25_000);
    // true track length: 500 + 97.7 + 300 + 94.2 + 83.8 + 400 + 65.4 + 400 ≈ 1941 m
    expect(Math.abs(ride.distanceM - 1941) / 1941).toBeLessThan(0.03);
  });

  it('screen off: fixes recorded without any JS ping are processed later, same result', async () => {
    const reference = summary(await uninterrupted());
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    for (const f of FIXES) rec.push(f, false); // WebView frozen, nobody listens
    expect(e.useStore.getState().rides).toHaveLength(0);
    await e.pump(); // app comes back
    await e.stopRide();
    expect(summary(e.useStore.getState().rides[0])).toEqual(reference);
  });

  it('app killed mid-ride: ride is rebuilt from the recorder log, nothing lost or doubled', async () => {
    const reference = summary(await uninterrupted());
    const rec = fakeRecorder();
    let e = await boot(rec);
    await e.startRide();
    const half = Math.floor(FIXES.length / 2);
    FIXES.slice(0, half).forEach((f) => rec.push(f));
    await settle();
    await e.pump();
    expect(e.useStore.getState().phase).toBe('riding');
    await e.flushStorage();

    // killed. The recorder keeps going while the app is gone …
    FIXES.slice(half).forEach((f) => rec.push(f, false));
    // … and the app is started again
    e = await boot(rec, false);
    expect(e.useStore.getState().phase).toBe('riding');
    expect(e.useStore.getState().rides).toHaveLength(1);
    await e.stopRide();
    const s = e.useStore.getState();
    expect(s.rides).toHaveLength(1);
    expect(summary(s.rides[0])).toEqual(reference);
  });

  it('discard throws the running ride away', async () => {
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    FIXES.forEach((f) => rec.push(f));
    await e.pump();
    await e.stopRide(true);
    expect(e.useStore.getState().rides).toHaveLength(0);
    expect(e.useStore.getState().summaryId).toBeNull();
    expect(rec.session).toBeNull();
  });

  it('"not riding after all" while armed stops recording, saves nothing', async () => {
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    expect(rec.session).not.toBeNull();
    await e.stopRide();
    expect(rec.session).toBeNull();
    expect(e.useStore.getState().phase).toBe('off');
    expect(e.useStore.getState().rides).toHaveLength(0);
  });
});
