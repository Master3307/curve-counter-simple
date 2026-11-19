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

// app-private files (track storage), also survive a "kill"
const files = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path, data }: { path: string; data: string }) => void files.set(path, data),
    readFile: async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error('not found');
      return { data: files.get(path)! };
    },
    deleteFile: async ({ path }: { path: string }) => void files.delete(path),
  },
}));

const notes = vi.hoisted(() => [] as string[]);
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: async ({ notifications }: { notifications: { title: string }[] }) => void notes.push(...notifications.map((n) => n.title)),
    requestPermissions: async () => ({ display: 'granted' }),
    checkPermissions: async () => ({ display: 'granted' }),
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
  if (fresh) {
    disk.clear();
    files.clear();
  }
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

  it('saves the track with the ride; numbers match the live count', async () => {
    const ride = await uninterrupted();
    expect(ride.hasTrack).toBe(true);
    expect(ride.algo).toBeGreaterThanOrEqual(2);
    expect(files.has(`tracks/${ride.id}.csv`)).toBe(true);
    const { decodeTrack } = await import('./tracks');
    const track = decodeTrack(files.get(`tracks/${ride.id}.csv`)!);
    expect(track.length).toBeGreaterThan(100);
    expect(track[0].t).toBe(ride.startedAt);
  });

  it('changing the sensitivity recounts saved rides', async () => {
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    FIXES.forEach((f) => rec.push(f));
    await e.pump();
    await e.stopRide();
    const before = e.useStore.getState().rides[0];
    expect(before.sensitivity).toBe('normal');
    e.useStore.getState().updateSettings({ sensitivity: 'few' });
    await e.recountRides();
    const after = e.useStore.getState().rides[0];
    expect(after.sensitivity).toBe('few');
    expect(after.id).toBe(before.id);
    expect(after.startedAt).toBe(before.startedAt);
    // 'few' = only curves ≥ 45°: all four curves of the route are bigger, so they stay
    expect(after.left + after.right).toBe(4);
  });

  it('rides from an older algorithm are recounted on start', async () => {
    const rec = fakeRecorder();
    let e = await boot(rec);
    await e.startRide();
    FIXES.forEach((f) => rec.push(f));
    await e.pump();
    await e.stopRide();
    const id = e.useStore.getState().rides[0].id;
    e.useStore.getState().updateRide(id, { algo: 1, left: 99 });
    await e.flushStorage();
    e = await boot(rec, false);
    await e.recountRides();
    const r = e.useStore.getState().rides[0];
    expect(r.left).toBe(2);
    expect(r.algo).toBeGreaterThanOrEqual(2);
  });

  it('a deleted ride loses its track only after the undo time is over', async () => {
    const rec = fakeRecorder();
    const e = await boot(rec);
    await e.startRide();
    FIXES.forEach((f) => rec.push(f));
    await e.pump();
    await e.stopRide();
    const id = e.useStore.getState().rides[0].id;
    e.useStore.getState().deleteRide(id);
    await settle();
    expect(files.has(`tracks/${id}.csv`)).toBe(true); // undo still possible
    e.useStore.getState().undoDelete();
    await settle();
    expect(files.has(`tracks/${id}.csv`)).toBe(true);
    e.useStore.getState().deleteRide(id);
    e.useStore.getState().clearUndo();
    await settle();
    expect(files.has(`tracks/${id}.csv`)).toBe(false);
  });

  describe('reminders (plan 1.4) and "never fail silently"', () => {
    beforeEach(() => {
      notes.length = 0;
    });

    it('armed for 30 min without riding off: asks, then stops waiting', async () => {
      const rec = fakeRecorder();
      const e = await boot(rec);
      await e.startRide();
      await e.checkReminders(Date.now() + 29 * 60_000);
      expect(e.useStore.getState().phase).toBe('armed');
      await e.checkReminders(Date.now() + 31 * 60_000);
      expect(e.useStore.getState().phase).toBe('off');
      expect(rec.session).toBeNull();
      expect(notes).toEqual(['Willst du noch fahren?']);
    });

    it('standing still for an hour during a manual ride: asks once, never ends the ride', async () => {
      const rec = fakeRecorder();
      const e = await boot(rec);
      await e.startRide();
      FIXES.forEach((f) => rec.push(f));
      await e.pump();
      const end = FIXES[FIXES.length - 1].t;
      await e.checkReminders(end + 61 * 60_000);
      await e.checkReminders(end + 62 * 60_000);
      expect(notes).toEqual(['Fahrt vergessen zu beenden?']);
      expect(e.useStore.getState().phase).toBe('riding');
    });

    it('no GPS for a minute is shown, and clears when fixes come back', async () => {
      const rec = fakeRecorder();
      const e = await boot(rec);
      await e.startRide();
      FIXES.slice(0, 40).forEach((f) => rec.push(f));
      await e.pump();
      const last = FIXES[39].t;
      await e.checkReminders(last + 30_000);
      expect(e.useStore.getState().live.noGps).toBe(false);
      await e.checkReminders(last + 70_000);
      expect(e.useStore.getState().live.noGps).toBe(true);
      FIXES.slice(40, 41).forEach((f) => rec.push(f));
      await e.pump();
      await e.checkReminders(FIXES[40].t + 1000);
      expect(e.useStore.getState().live.noGps).toBe(false);
    });
  });
});
