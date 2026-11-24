import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { App as CapApp } from '@capacitor/app';
import { TABS, useStore, useT, type Tab } from './store';
import { RideScreen } from './screens/RideScreen';
import { RidesScreen } from './screens/RidesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { closeDialog, DialogHost, UndoBar } from './ui/components';
import { RideSummary } from './ui/RideSummary';
import { Onboarding } from './ui/Onboarding';
import { Scenery } from './ui/Scenery';
import { IconHelp, IconList, IconRide, IconSettings } from './ui/icons';
import { checkItems, detectBrand, EMPTY_CHECKS, problems, runChecks, tapFeedback, type Checks } from './native';
import { initEngine } from './tracking/engine';
import { watchInbox } from './tracking/fileIo';
import type { Brand } from './guides/guides';
import { setupShot, shot } from './dev/screenshots';

/**
 * Swiping between tabs: only clearly sideways swipes count (more sideways than up/down, and
 * either a third of the screen or a quick flick), never on maps, sliders or open sheets.
 */
function useSwipe(index: number, count: number, go: (i: number) => void, ready: boolean) {
  const strip = useRef<HTMLDivElement>(null);
  const st = useRef<{ x: number; y: number; t: number; lock: 'x' | 'y' | null; dx: number } | null>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const width = () => el.parentElement!.clientWidth || 1;
    const set = (dx: number, anim: boolean) => {
      el.style.transition = anim ? '' : 'none';
      el.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
    };
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-noswipe], input, textarea, .segmented, .leaflet-container')) return;
      st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), lock: null, dx: 0 };
    };
    const move = (e: TouchEvent) => {
      const s = st.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.7 ? 'x' : 'y';
      }
      if (s.lock !== 'x') return;
      e.preventDefault();
      // rubber band at the first and last tab
      const edge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
      s.dx = edge ? dx / 4 : dx;
      set(s.dx, false);
    };
    const up = () => {
      const s = st.current;
      st.current = null;
      if (!s || s.lock !== 'x') return;
      const v = Math.abs(s.dx) / Math.max(1, Date.now() - s.t);
      const far = Math.abs(s.dx) > width() * 0.33 || (Math.abs(s.dx) > 60 && v > 0.45);
      const next = far ? Math.max(0, Math.min(count - 1, index + (s.dx < 0 ? 1 : -1))) : index;
      set(0, true);
      if (next !== index) go(next);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    set(0, true);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [index, count, go, ready]);
  return strip;
}

export function App() {
  const t = useT();
  const hydrated = useStore((s) => s.hydrated);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const { textScale, lang, theme, scenery, onboarded } = useStore((s) => s.settings);
  const confirmed = useStore((s) => s.settings.confirmed);
  const [checks, setChecks] = useState<Checks>(EMPTY_CHECKS);
  const [brand, setBrand] = useState<Brand | null>(null);

  const recheck = useCallback(() => {
    runChecks().then(setChecks);
  }, []);

  useEffect(() => {
    detectBrand().then(setBrand);
  }, []);
  useEffect(recheck, [recheck, confirmed]);

  useEffect(() => {
    if (!hydrated) return;
    if (shot) {
      void setupShot();
      return;
    }
    void initEngine();
    watchInbox();
  }, [hydrated]);

  useEffect(() => {
    const sub = CapApp.addListener('resume', recheck);
    const back = CapApp.addListener('backButton', () => {
      if (closeDialog()) return;
      if (useStore.getState().summaryId) return useStore.getState().showSummary(null);
      if (useStore.getState().tab !== 'ride') useStore.getState().setTab('ride');
      else CapApp.minimizeApp();
    });
    return () => {
      sub.then((s) => s.remove());
      back.then((s) => s.remove());
    };
  }, [recheck]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${18 * textScale}px`;
  }, [textScale]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const index = TABS.indexOf(tab);
  const go = useCallback(
    (i: number) => {
      tapFeedback();
      setTab(TABS[i]);
    },
    [setTab],
  );
  const strip = useSwipe(index, TABS.length, go, hydrated && onboarded);

  if (!hydrated) return null;
  if (!onboarded) return <Onboarding onDone={recheck} />;

  const open = problems(checkItems(brand), checks, 'important').length;
  const tabs: { id: Tab; label: string; icon: ReactElement }[] = [
    { id: 'ride', label: t.tabRide, icon: <IconRide /> },
    { id: 'rides', label: t.tabRides, icon: <IconList /> },
    { id: 'settings', label: t.tabSettings, icon: <IconSettings /> },
    { id: 'help', label: t.tabHelp, icon: <IconHelp /> },
  ];

  return (
    <div className="app">
      {scenery && <Scenery />}
      <main className="main">
        <div className="strip" ref={strip}>
          <section className="panel" aria-hidden={tab !== 'ride'}>
            <RideScreen problems={open} />
          </section>
          <section className="panel" aria-hidden={tab !== 'rides'}>
            <RidesScreen />
          </section>
          <section className="panel" aria-hidden={tab !== 'settings'}>
            <SettingsScreen />
          </section>
          <section className="panel" aria-hidden={tab !== 'help'}>
            <HelpScreen checks={checks} onRecheck={recheck} />
          </section>
        </div>
      </main>
      <nav className="tabbar">
        {tabs.map((x) => (
          <button
            key={x.id}
            className={tab === x.id ? 'on' : ''}
            aria-current={tab === x.id ? 'page' : undefined}
            onClick={() => {
              tapFeedback();
              setTab(x.id);
            }}
          >
            {x.icon}
            <span>{x.label}</span>
            {x.id === 'help' && open > 0 && <span className="badge">{open}</span>}
          </button>
        ))}
      </nav>
      <RideSummary />
      <UndoBar />
      <DialogHost />
    </div>
  );
}
