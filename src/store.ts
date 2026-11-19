import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { Preferences } from '@capacitor/preferences';
import type { Curve, Sensitivity } from './logic/curves';
import type { HeightTotals } from './logic/height';
import { detectLang, STRINGS, type Lang } from './i18n/strings';

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
  /** the track file exists (tracks.ts) → can be recounted and exported */
  hasTrack?: boolean;
  /** analysis version and sensitivity the saved numbers were made with */
  algo?: number;
  sensitivity?: Sensitivity;
}

/**
 * off      – automatic off, nothing happens
 * watching – automatic on, waiting for the bike to move
 * armed    – user pressed Start, ride begins as soon as it's really moving
 * riding   – ride running
 */
export type Phase = 'off' | 'watching' | 'armed' | 'riding';
export type Tab = 'ride' | 'rides' | 'help';
export type TextScale = 1 | 1.15 | 1.3;
export type Units = 'metric' | 'imperial';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  lang: Lang;
  auto: boolean;
  sensitivity: Sensitivity;
  pauseMinutes: 5 | 10 | 20;
  units: Units;
  textScale: TextScale;
  theme: Theme;
  haptics: boolean;
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
}

export interface Live {
  /** m/s, smoothed */
  speed: number;
  gpsWeak: boolean;
  demo: boolean;
  /** shown on the ride screen in plain words, never silently ignored */
  problem: 'noLocation' | null;
}

interface State {
  rides: Ride[];
  activeId: string | null;
  phase: Phase;
  session: Session | null;
  settings: Settings;
  tab: Tab;
  live: Live;
  /** ride to show in the summary card right after it ended (not persisted) */
  summaryId: string | null;
  /** last deleted ride, for the undo bar (not persisted) */
  lastDeleted: { ride: Ride; index: number } | null;
  hydrated: boolean;

  setTab(tab: Tab): void;
  setPhase(phase: Phase): void;
  setSession(session: Session | null): void;
  setLive(live: Partial<Live>): void;
  beginRide(startedAt: number, mode: Ride['mode'], id?: string): string;
  updateRide(id: string, patch: Partial<Ride>): void;
  addCurves(id: string, curves: Curve[]): void;
  endRide(id: string, endedAt: number): void;
  deleteRide(id: string): void;
  /** Removes a ride without offering undo (used when the engine rebuilds a running ride). */
  dropRide(id: string): void;
  undoDelete(): void;
  clearUndo(): void;
  showSummary(id: string | null): void;
  deleteAll(): void;
  updateSettings(patch: Partial<Settings>): void;
}

/**
 * Writes are debounced (at most one per second, the latest state wins), so saving never slows
 * down counting. Nothing is lost on a crash: the raw fixes are in the recorder's log, and the
 * running ride is rebuilt from it on the next start.
 * TODO(milestone 2b): SQLite instead of one JSON blob, once there are many rides.
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
  lang: detectLang(),
  /** experimental automatic ride detection – off by default, manual is the main mode */
  auto: false,
  sensitivity: 'normal',
  pauseMinutes: 10,
  units: detectLang() === 'en' && navigator.language === 'en-US' ? 'imperial' : 'metric',
  textScale: 1,
  theme: 'system',
  haptics: true,
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      rides: [],
      activeId: null,
      phase: 'off',
      session: null,
      settings: DEFAULT_SETTINGS,
      tab: 'ride',
      live: { speed: 0, gpsWeak: false, demo: false, problem: null },
      lastDeleted: null,
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
        const rides = get().rides;
        const index = rides.findIndex((r) => r.id === id);
        if (index < 0) return;
        set({
          rides: rides.filter((r) => r.id !== id),
          lastDeleted: { ride: rides[index], index },
          ...(get().activeId === id ? { activeId: null, phase: get().settings.auto ? 'watching' : 'off' } : {}),
        });
      },
      dropRide(id) {
        set({ rides: get().rides.filter((r) => r.id !== id), ...(get().activeId === id ? { activeId: null } : {}) });
      },
      undoDelete() {
        const d = get().lastDeleted;
        if (!d) return;
        const rides = [...get().rides];
        rides.splice(d.index, 0, d.ride);
        set({ rides, lastDeleted: null });
      },
      clearUndo: () => set({ lastDeleted: null }),
      showSummary: (summaryId) => set({ summaryId }),
      deleteAll: () =>
        set({ rides: [], activeId: null, lastDeleted: null, phase: get().settings.auto ? 'watching' : 'off' }),
      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
    }),
    {
      name: 'curve-tracker',
      version: 1,
      storage: createJSONStorage(() => prefsStorage),
      partialize: (s) => ({ rides: s.rides, activeId: s.activeId, phase: s.phase, session: s.session, settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

export const useT = () => STRINGS[useStore((s) => s.settings.lang)];
