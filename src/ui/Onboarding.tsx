/**
 * First start (plan 3): at most 3 screens, one question each, one big button, one sentence why.
 * Android: location → battery → ready · iPhone: location → ready · browser: ready.
 */
import { useState, type ReactElement } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { runAction, platform, isNative, tapFeedback } from '../native';
import { useStore, useT } from '../store';
import { IconBattery, IconCurveRight, IconPin } from './icons';

type Page = 'location' | 'battery' | 'ready';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useT();
  const pages: Page[] = !isNative ? ['ready'] : platform === 'android' ? ['location', 'battery', 'ready'] : ['location', 'ready'];
  const [i, setI] = useState(0);
  const page = pages[i];
  const finish = async () => {
    tapFeedback(true);
    // the ride notification (Android 13+ asks for it); explained on the screen
    // only the system question – a "no" is fine here, Help offers it again
    if (isNative) await LocalNotifications.requestPermissions().catch(() => {});
    next();
  };
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
    await runAction(page === 'location' ? 'locationAlways' : 'batteryUnrestricted');
    next();
  };

  const content: Record<Page, { icon: ReactElement; title: string; text: string }> = {
    location: { icon: <IconPin />, title: t.obLocationTitle, text: t.obLocationText },
    battery: { icon: <IconBattery />, title: t.obBatteryTitle, text: t.obBatteryText },
    ready: { icon: <IconCurveRight />, title: t.obReadyTitle, text: t.obReadyText },
  };
  const c = content[page];

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={c.title}>
      {/* key → each page fades in on its own */}
      <div className="ob-page" key={page}>
        {pages.length > 1 && <p className="ob-step">{t.obStep(i + 1, pages.length)}</p>}
        <div className={`ob-icon ob-icon-${page}`}>{c.icon}</div>
        <h1>{c.title}</h1>
        <p className="ob-text">{c.text}</p>
        {page === 'ready' && isNative && <p className="ob-text hint">{t.obReadyNotify}</p>}
        <div className="spacer" />
        {page === 'ready' ? (
          <button className="btn btn-go btn-huge" onClick={finish}>
            {t.letsGo}
          </button>
        ) : (
          <>
            <button className="btn btn-go btn-huge" onClick={allow}>
              {t.allow}
            </button>
            <button className="btn btn-link" onClick={next}>
              {t.later}
            </button>
          </>
        )}
        <div className="ob-dots" aria-hidden="true">
          {pages.map((p, k) => (
            <span key={p} className={k === i ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
