import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useStore, useT, type Tab } from './store';
import { RideScreen } from './screens/RideScreen';
import { RidesScreen } from './screens/RidesScreen';
import { HelpScreen } from './screens/HelpScreen';
import { closeDialog, DialogHost } from './ui/components';
import { RideSummary } from './ui/RideSummary';
import { IconHelp, IconList, IconRide } from './ui/icons';
import { runChecks, tapFeedback, type Checks } from './native';
import { initEngine } from './tracking/engine';

export function App() {
  const t = useT();
  const hydrated = useStore((s) => s.hydrated);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const { textScale, lang, theme } = useStore((s) => s.settings);
  const [checks, setChecks] = useState<Checks>({ location: 'unknown', notifications: 'unknown', battery: 'unknown' });

  const recheck = useCallback(() => {
    runChecks().then(setChecks);
  }, []);

  useEffect(() => {
    if (hydrated) initEngine();
  }, [hydrated]);

  useEffect(() => {
    recheck();
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

  if (!hydrated) return null;

  const problems = Object.values(checks).filter((c) => c === 'bad').length;
  const tabs: { id: Tab; label: string; icon: ReactElement }[] = [
    { id: 'ride', label: t.tabRide, icon: <IconRide /> },
    { id: 'rides', label: t.tabRides, icon: <IconList /> },
    { id: 'help', label: t.tabHelp, icon: <IconHelp /> },
  ];

  return (
    <div className="app">
      <main className="main">
        {tab === 'ride' && <RideScreen problems={problems} />}
        {tab === 'rides' && <RidesScreen />}
        {tab === 'help' && <HelpScreen checks={checks} onRecheck={recheck} />}
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
            {x.id === 'help' && problems > 0 && <span className="badge">{problems}</span>}
          </button>
        ))}
      </nav>
      <RideSummary />
      <DialogHost />
    </div>
  );
}
