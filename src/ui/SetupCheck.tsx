/**
 * "Is everything set up right?" – one row per setting: traffic light, how important it really
 * is (in words), why, what happens if it stays off, and one big button that fixes it.
 * Settings the phone doesn't report (Xiaomi autostart …) get an "I did it" button.
 * Also the warning before a ride when something important is missing.
 */
import { useEffect, useState } from 'react';
import { checkItems, detectBrand, problems, runAction, runChecks, type CheckItem, type Checks, type CheckState } from '../native';
import { useStore, useT } from '../store';
import { ask } from './components';
import { IconAlert, IconCheck } from './icons';
import { STRINGS } from '../i18n/strings';
import type { Brand } from '../guides/guides';
import { tapFeedback } from '../native';

export function useBrand() {
  const [brand, setBrand] = useState<Brand | null>(null);
  useEffect(() => {
    detectBrand().then(setBrand);
  }, []);
  return brand;
}

export function SetupCheck({ checks, onRecheck, compact = false }: { checks: Checks; onRecheck: () => void; compact?: boolean }) {
  const t = useT();
  const brand = useBrand();
  const confirmed = useStore((s) => s.settings.confirmed);
  const items = checkItems(brand);
  if (!items.length) return <p className="hint">{t.checkBrowser}</p>;
  const act = async (i: CheckItem) => {
    tapFeedback(true);
    await runAction(i.action);
    onRecheck();
  };
  const confirm = (i: CheckItem, yes: boolean) => {
    tapFeedback();
    const set = new Set(confirmed);
    if (yes) set.add(i.key);
    else set.delete(i.key);
    useStore.getState().updateSettings({ confirmed: [...set] });
    onRecheck();
  };
  const allOk = items.every((i) => checks[i.key] === 'ok' || (i.severity === 'optional' && checks[i.key] !== 'bad'));
  return (
    <div className="checks">
      {items.map((i) => (
        <CheckRow key={i.key} item={i} state={checks[i.key]} compact={compact} onFix={() => act(i)} onConfirm={(y) => confirm(i, y)} />
      ))}
      {allOk && <p className="all-good">{t.allGood}</p>}
    </div>
  );
}

function CheckRow({
  item,
  state,
  compact,
  onFix,
  onConfirm,
}: {
  item: CheckItem;
  state: CheckState;
  compact: boolean;
  onFix: () => void;
  onConfirm: (yes: boolean) => void;
}) {
  const t = useT();
  const c = t.checks[item.key];
  const [open, setOpen] = useState(false);
  const ok = state === 'ok';
  return (
    <div className={`check check-${state} sev-${item.severity}`}>
      <span className="check-icon">{ok ? <IconCheck /> : <IconAlert />}</span>
      <div className="check-body">
        <div className="check-label">
          {c.label}
          <span className={`pill pill-${item.severity}`}>{t.severity[item.severity]}</span>
        </div>
        {!ok && <p className="hint">{c.why}</p>}
        {!ok && !compact && (
          <button className="btn btn-link small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'} {t.canISkip}
          </button>
        )}
        {open && !ok && <p className="hint">{c.skip}</p>}
        {!ok && (
          <div className="check-buttons">
            <button className="btn btn-small btn-go" onClick={onFix}>
              {item.manual ? t.openIt : t.fix}
            </button>
            {item.manual && (
              <button className="btn btn-small btn-plain" onClick={() => onConfirm(true)}>
                {t.iDidIt}
              </button>
            )}
          </div>
        )}
        {ok && item.manual && (
          <button className="btn btn-link small" onClick={() => onConfirm(false)}>
            {t.undoDone}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Before a ride: if something that matters is missing, say so in plain words.
 * Returns true when the ride may start (all fine, or "Ride anyway").
 */
export async function startGuard(goToHelp: () => void): Promise<boolean> {
  const s = useStore.getState();
  const t = STRINGS[s.settings.lang];
  const items = checkItems(await detectBrand());
  if (!items.length) return true;
  const checks = await runChecks();
  const bad = problems(items, checks, 'important');
  if (!bad.length) return true;
  const must = bad.some((b) => b.severity === 'must');
  const a = await ask({
    title: must ? t.warnTitleMust : t.warnTitle,
    text: must ? t.warnTextMust : t.warnText,
    items: bad.map((b) => ({ text: t.checks[b.key].label, tag: t.severity[b.severity], tone: b.severity === 'must' ? 'bad' : 'warn' })),
    yes: t.fixNow,
    no: t.cancel,
    // the quiet third button, so tapping next to the dialog never starts a ride by accident
    other: t.rideAnyway,
  });
  if (a === 'yes') goToHelp();
  return a === 'other';
}
