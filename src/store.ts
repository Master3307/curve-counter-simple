import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { Preferences } from '@capacitor/preferences';
import type { Curve, Sensitivity } from './logic/curves';
import type { HeightTotals } from './logic/height';
import type { MotionStats } from './logic/motion';
import type { RideExtras } from './logic/gpx';
import type { Shape } from './logic/routes';
import { DEFAULT_LANG, STRINGS, type Lang } from './i18n/strings';

export interface Ride {
  id: string;
  startedAt: number;
  endedAt: number | null;
  mode: 'auto' | 'manual';
  left: number;
  right: number;
  /** track length, m */
  distanceM: number;
  /** time actually moving, s */
  movingS: number;
  /** m/s */
  avgSpeed: number;
  topSpeed: number;
  curves: Curve[];
  /** height meter (plan 1.10); null/missing when the GPS gave no height */
  height?: HeightTotals | null;
  /** braking / acceleration, stops, phone holder, tilt */
  motion?: MotionStats | null;
  /** small outline of the track (map previews, routes) */
  shape?: Shape;
  /** the track file exists (tracks.ts) → can be recounted, shown on the map and exported */
  hasTrack?: boolean;
  /** analysis version and sensitivity the saved numbers were made with */
  algo?: number;
  sensitivity?: Sensitivity;
  /** where the ride comes from (plan 1.12); missing = recorded by this app */
  source?: 'recorded' | 'gpx' | 'route';
  /** file name / app it was imported from */
  sourceName?: string;
  fileHash?: string;
  /** 'approx' = imported with few points */
  quality?: 'good' | 'approx';
  /** everything else an imported file carried (description, heart rate, waypoints …) */
  extras?: RideExtras;
  /** own name given by the user */
  name?: string;
}

/** Rides from the same start to the same end (logic/routes.ts). */
export interface Route {
  id: string;
  name: string;
  rideIds: string[];
}

/**
 * off      – automatic off, nothing happens
 * watching – automatic on, waiting for the bike to move
 * armed    – user pressed Start, ride begins as soon as it's really moving
 * riding   – ride running
 */
export type Phase = 'off' | 'watching' | 'armed' | 'riding';
export type Tab = 'ride' | 'rides' | 'settings' | 'help';
export const TABS: Tab[] = ['ride', 'rides', 'settings', 'help'];
export type TextScale = 1 | 1.15 | 1.3;
export type Units = 'metric' | 'imperial';
export type Theme = 'system' | 'light' | 'dark';
/** max = most accurate (GPS 1 s + sensors 50 Hz) · balanced · saver (GPS 2 s, no sensors) */
export type Power = 'max' | 'balanced' | 'saver';

export interface Settings {
  lang: Lang;
  auto: boolean;
  sensitivity: Sensitivity;
  pauseMinutes: 5 | 10 | 20;
  units: Units;
  textScale: TextScale;
  theme: Theme;
  haptics: boolean;
  power: Power;
  /** show the running ride on a smart watch (Android: extra notification) */
  watch: boolean;
  /** calm background picture with slow movement */
  scenery: boolean;
  /** the first-start guide was shown */
  onboarded: boolean;
  /** steps the app can't check by itself, confirmed by the user ("I did it") */
  confirmed: string[];
}

/**
 * The running recording. `from` = first fix of the current detection epoch in the source's
 * log: after a cold start the engine replays the log from there and rebuilds the ride.
 */
export interface Session {
  id: string;
  from: number;
  /** what started it: the Start button (manual) or the experimental auto mode */
  mode: 'manual' | 'auto';
  /** when recording started (epoch ms; missing in v0.2 sessions) */
  startedAt?: number;
}

export interface Live {
  /** m/s, smoothed */
  speed: number;
  gpsWeak: boolean;
  demo: boolean;
  /** shown on the ride screen in plain words, never silently ignored */
  problem: 'noLocation' | null;
  /** no GPS fix for a while although recording */
  noGps: boolean;
}

/** Something that can be taken back from the undo bar. */
export interface UndoEntry {
  text: string;
  /** rides that are gone for now: their track files must stay until the bar is gone */
  rides: Ride[];
  restore: (s: State) => Partial<State>;
}

export interface State {
  rides: Ride[];
  routes: Route[];
  activeId: string | null;
  phase: Phase;
  session: Session | null;
  settings: Settings;
  tab: Tab;
  live: Live;
  /** ride to show in the summary card right after it ended (not persisted) */
  summaryId: string | null;
  /** last undoable action (not persisted) */
  undo: UndoEntry | null;
  hydrated: boolean;

  setTab(tab: Tab): void;
  setPhase(phase: Phase): void;
  setSession(session: Session | null): void;
  setLive(live: Partial<Live>): void;
  beginRide(startedAt: number, mode: Ride['mode'], id?: string): string;
  updateRide(id: string, patch: Partial<Ride>): void;
  addCurves(id: string, curves: Curve[]): void;
  endRide(id: string, endedAt: number): void;
  /** Adds finished rides (import), sorted in by start time. */
  addRide(ride: Ride): void;
  deleteRide(id: string): void;
  /** Removes a ride without offering undo (used when the engine rebuilds a running ride). */
  dropRide(id: string): void;
  /** Takes back the last action. */
  undoDelete(): void;
  clearUndo(): void;
  /** Offers an undo bar for any action. */
  offerUndo(entry: UndoEntry): void;
  showSummary(id: string | null): void;
  deleteAll(): void;
  updateSettings(patch: Partial<Settings>): void;
  setRoutes(routes: Route[], undoText?: string): void;
}

/**
 * Writes are debounced (at most one per second, the latest state wins), so saving never slows
 * down counting. Nothing is lost on a crash: the raw fixes are in the recorder's log, and the
 * running ride is rebuilt from it on the next start.
 */
const pending = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flushPrefs() {
  flushTimer = null;
  const items = [...pending];
  pending.clear();
  return Promise.all(items.map(([key, value]) => Preferences.set({ key, value })));
}
const prefsStorage: StateStorage = {
  getItem: async (k) => pending.get(k) ?? (await Preferences.get({ key: k })).value,
  setItem: (k, v) => {
    pending.set(k, v);
    flushTimer ??= setTimeout(flushPrefs, 1000);
  },
  removeItem: async (k) => {
    pending.delete(k);
    await Preferences.remove({ key: k });
  },
};
/** Write pending state now (app goes to the background). */
export const flushStorage = () => {
  if (flushTimer) clearTimeout(flushTimer);
  return flushPrefs();
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const DEFAULT_SETTINGS: Settings = {
  lang: DEFAULT_LANG,
  /** experimental automatic ride detection – off by default, manual is the main mode */
  auto: false,
  sensitivity: 'normal',
  pauseMinutes: 10,
  /** European default; miles can be picked in Settings */
  units: 'metric',
  textScale: 1,
  theme: 'system',
  haptics: true,
  power: 'balanced',
  watch: true,
  scenery: true,
  onboarded: false,
  confirmed: [],
};

const tr = () => STRINGS[useStore.getState().settings.lang];

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      rides: [],
      routes: [],
      activeId: null,
      phase: 'off',
      session: null,
      settings: DEFAULT_SETTINGS,
      tab: 'ride',
      live: { speed: 0, gpsWeak: false, demo: false, problem: null, noGps: false },
      undo: null,
      summaryId: null,
      hydrated: false,

      setTab: (tab) => set({ tab }),
      setPhase: (phase) => set({ phase }),
      setSession: (session) => set({ session }),
      setLive: (live) => set({ live: { ...get().live, ...live } }),

      beginRide(startedAt, mode, id = uid()) {
        const ride: Ride = {
          id,
          startedAt,
          endedAt: null,
          mode,
          left: 0,
          right: 0,
          distanceM: 0,
          movingS: 0,
          avgSpeed: 0,
          topSpeed: 0,
          curves: [],
        };
        set({ rides: [ride, ...get().rides], activeId: ride.id, phase: 'riding' });
        return ride.id;
      },
      updateRide: (id, patch) => set({ rides: get().rides.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
      addCurves(id, curves) {
        if (!curves.length) return;
        set({
          rides: get().rides.map((r) =>
            r.id === id
              ? {
                  ...r,
                  curves: [...r.curves, ...curves],
                  left: r.left + curves.filter((c) => c.dir === 'L').length,
                  right: r.right + curves.filter((c) => c.dir === 'R').length,
                }
              : r,
          ),
        });
      },
      endRide(id, endedAt) {
        get().updateRide(id, { endedAt });
        set({ activeId: null, phase: get().settings.auto ? 'watching' : 'off' });
      },
      deleteRide(id) {
        const { rides, routes } = get();
        const index = rides.findIndex((r) => r.id === id);
        if (index < 0) return;
        const ride = rides[index];
        set({
          rides: rides.filter((r) => r.id !== id),
          routes: routes.map((x) => ({ ...x, rideIds: x.rideIds.filter((i) => i !== id) })).filter((x) => x.rideIds.length),
          undo: {
            text: tr().deleted,
            rides: [ride],
            restore: (s) => {
              const list = [...s.rides];
              list.splice(Math.min(index, list.length), 0, ride);
              return { rides: list, routes };
            },
          },
          ...(get().activeId === id ? { activeId: null, phase: get().settings.auto ? 'watching' : 'off' } : {}),
        });
      },
      addRide(ride) {
        set({ rides: [...get().rides, ride].sort((a, b) => b.startedAt - a.startedAt) });
      },
      dropRide(id) {
        set({ rides: get().rides.filter((r) => r.id !== id), ...(get().activeId === id ? { activeId: null } : {}) });
      },
      undoDelete() {
        const u = get().undo;
        if (!u) return;
        set({ ...u.restore(get()), undo: null });
      },
      clearUndo: () => set({ undo: null }),
      offerUndo: (undo) => set({ undo }),
      showSummary: (summaryId) => set({ summaryId }),
      deleteAll() {
        const { rides, routes, activeId } = get();
        const kept = rides.filter((r) => r.id === activeId);
        const gone = rides.filter((r) => r.id !== activeId);
        set({
          rides: kept,
          routes: [],
          undo: { text: tr().deletedAll, rides: gone, restore: (s) => ({ rides: [...s.rides, ...gone].sort((a, b) => b.startedAt - a.startedAt), routes }) },
        });
      },
      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      setRoutes(routes, undoText) {
        const before = get().routes;
        set({ routes, ...(undoText ? { undo: { text: undoText, rides: [], restore: () => ({ routes: before }) } } : {}) });
      },
    }),
    {
      name: 'curve-tracker',
      version: 2,
      storage: createJSONStorage(() => prefsStorage),
      partialize: (s) => ({ rides: s.rides, routes: s.routes, activeId: s.activeId, phase: s.phase, session: s.session, settings: s.settings }),
      migrate: (persisted) => persisted as State,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, routes: p.routes ?? [], settings: { ...DEFAULT_SETTINGS, ...p.settings } };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

export const useT = () => STRINGS[useStore((s) => s.settings.lang)];

/** Display name of a ride. */
export const rideName = (r: Ride) => r.name ?? r.sourceName ?? null;
