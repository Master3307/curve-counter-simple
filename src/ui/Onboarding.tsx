/**
 * First start: one question per screen, one big button, one sentence why, and how important it
 * is. When the user comes back from the phone's settings the screen checks again by itself and
 * shows a green tick – no guessing whether it worked.
 * Browser: welcome → ready · iPhone: welcome → location → notifications → ready ·
 * Android: welcome → location → battery → notifications → ready
 */
import { useEffect, useState, type ReactElement } from 'react';
import { App as CapApp } from '@capacitor/app';
import { runAction, platform, isNative, tapFeedback, runChecks, type Checks, type Severity } from '../native';
import { useStore, useT } from '../store';
import { AppIcon, IconBattery, IconCheck, IconCurveRight, IconPin } from './icons';
import type { Action } from '../guides/guides';

type Page = 'welcome' | 'location' | 'battery' | 'notifications' | 'ready';

const META: Partial<Record<Page, { severity: Severity; action: Action; ok: (c: Checks) => boolean }>> = {
  location: { severity: 'must', action: 'locationAlways', ok: (c) => c.location === 'ok' && c.precise !== 'bad' },
  battery: { severity: 'important', action: 'batteryUnrestricted', ok: (c) => c.battery === 'ok' },
  notifications: { severity: 'optional', action: 'notifications', ok: (c) => c.notifications === 'ok' },
};

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const pages: Page[] = !isNative
    ? ['welcome', 'ready']
    : platform === 'android'
      ? ['welcome', 'location', 'battery', 'notifications', 'ready']
      : ['welcome', 'location', 'notifications', 'ready'];
  const [i, setI] = useState(0);
  const [checks, setChecks] = useState<Checks | null>(null);
  const page = pages[i];
  const meta = META[page];
  const ok = meta && checks ? meta.ok(checks) : false;

  // check again whenever the user comes back from the phone's settings
  useEffect(() => {
    const re = () => void runChecks().then(setChecks);
    re();
    const sub = isNative ? CapApp.addListener('resume', re) : null;
    return () => {
      sub?.then((s) => s.remove());
    };
  }, []);

  const next = () => {
    tapFeedback();
    if (i + 1 < pages.length) setI(i + 1);
    else {
      useStore.getState().updateSettings({ onboarded: true });
      onDone();
    }
  };
  const allow = async () => {
    tapFeedback(true);
    if (!meta) return;
    await runAction(meta.action);
    const c = await runChecks();
    setChecks(c);
    // the system dialog answered right away (no settings page) → go on by itself
    if (meta.ok(c)) setTimeout(next, 700);
  };

  const content: Record<Page, { icon: ReactElement; title: string; text: string }> = {
    welcome: { icon: <AppIcon className="ob-logo" />, title: t.obWelcomeTitle, text: t.obWelcomeText },
    location: { icon: <IconPin />, title: t.obLocationTitle, text: t.obLocationText },
    battery: { icon: <IconBattery />, title: t.obBatteryTitle, text: t.obBatteryText },
    notifications: { icon: <IconCurveRight />, title: t.obNotifyTitle, text: t.obNotifyText },
    ready: { icon: <IconCheck />, title: t.obReadyTitle, text: t.obReadyText },
  };
  const c = content[page];

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={c.title}>
      {/* key → each page fades in on its own */}
      <div className="ob-page" key={page}>
        {pages.length > 2 && <p className="ob-step">{t.obStep(i + 1, pages.length)}</p>}
        <div className={`ob-icon ob-icon-${page}`}>{c.icon}</div>
        <h1>{c.title}</h1>
        {meta && <span className={`pill pill-${meta.severity}`}>{t.severity[meta.severity]}</span>}
        <p className="ob-text">{c.text}</p>
        {meta && !ok && <p className="ob-text hint">{t.obSkip[page as 'location' | 'battery' | 'notifications']}</p>}
        {ok && (
          <p className="ob-ok" role="status">
            <IconCheck /> {t.obDone}
          </p>
        )}

        {page === 'welcome' && (
          <div className="segmented ob-lang" role="radiogroup" aria-label={t.language}>
            {(['de', 'en'] as const).map((l) => (
              <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => useStore.getState().updateSettings({ lang: l })}>
                {l === 'de' ? 'Deutsch' : 'English'}
              </button>
            ))}
          </div>
        )}
        <div className="spacer" />
        {meta && !ok ? (
          <>
            <button className="btn btn-go btn-huge" onClick={allow}>
              {t.allow}
            </button>
            <button className="btn btn-link" onClick={next}>
              {meta.severity === 'must' ? t.laterMust : t.later}
            </button>
          </>
        ) : (
          <button className="btn btn-go btn-huge" onClick={next}>
            {page === 'ready' ? t.letsGo : t.next}
          </button>
        )}
        <div className="ob-dots" aria-hidden="true">
          {pages.map((p, k) => (
            <span key={p} className={k === i ? 'on' : k < i ? 'done' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
