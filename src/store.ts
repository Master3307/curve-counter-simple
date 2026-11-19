import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { Preferences } from '@capacitor/preferences';
import type { Curve, Sensitivity } from './logic/curves';
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

export interface Live {
  /** m/s, smoothed */
  speed: number;
  gpsWeak: boolean;
  demo: boolean;
}

interface State {
  rides: Ride[];
  activeId: string | null;
  phase: Phase;
  settings: Settings;
  tab: Tab;
  live: Live;
  /** last deleted ride, for the undo bar (not persisted) */
  lastDeleted: { ride: Ride; index: number } | null;
  hydrated: boolean;

  setTab(tab: Tab): void;
  setPhase(phase: Phase): void;
  setLive(live: Partial<Live>): void;
  beginRide(startedAt: number, mode: Ride['mode']): string;
  updateRide(id: string, patch: Partial<Ride>): void;
  addCurves(id: string, curves: Curve[]): void;
  endRide(id: string, endedAt: number): void;
  deleteRide(id: string): void;
  undoDelete(): void;
  clearUndo(): void;
  deleteAll(): void;
  updateSettings(patch: Partial<Settings>): void;
}

const prefsStorage: StateStorage = {
  getItem: async (k) => (await Preferences.get({ key: k })).value,
  setItem: async (k, v) => Preferences.set({ key: k, value: v }),
  removeItem: async (k) => Preferences.remove({ key: k }),
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
      settings: DEFAULT_SETTINGS,
      tab: 'ride',
      live: { speed: 0, gpsWeak: false, demo: false },
      lastDeleted: null,
      hydrated: false,

      setTab: (tab) => set({ tab }),
      setPhase: (phase) => set({ phase }),
      setLive: (live) => set({ live: { ...get().live, ...live } }),

      beginRide(startedAt, mode) {
        const ride: Ride = {
          id: uid(),
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
      undoDelete() {
        const d = get().lastDeleted;
        if (!d) return;
        const rides = [...get().rides];
        rides.splice(d.index, 0, d.ride);
        set({ rides, lastDeleted: null });
      },
      clearUndo: () => set({ lastDeleted: null }),
      deleteAll: () =>
        set({ rides: [], activeId: null, lastDeleted: null, phase: get().settings.auto ? 'watching' : 'off' }),
      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
    }),
    {
      name: 'curve-tracker',
      version: 1,
      storage: createJSONStorage(() => prefsStorage),
      partialize: (s) => ({ rides: s.rides, activeId: s.activeId, phase: s.phase, settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

export const useT = () => STRINGS[useStore((s) => s.settings.lang)];
