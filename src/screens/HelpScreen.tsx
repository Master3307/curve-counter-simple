import { useEffect, useState } from 'react';
import { useStore, useT } from '../store';
import { GUIDES, guideFor, type Brand } from '../guides/guides';
import { detectBrand, platform, runAction, type Checks, type CheckState } from '../native';
import { setAutomatic, startDemo } from '../tracking/engine';
import { Card, confirm, Segmented, Toggle } from '../ui/components';
import { IconAlert, IconCheck } from '../ui/icons';
import type { Action } from '../guides/guides';

export function HelpScreen({ checks, onRecheck }: { checks: Checks; onRecheck: () => void }) {
  const t = useT();
  const s = useStore((st) => st.settings);
  const phase = useStore((st) => st.phase);
  const update = useStore((st) => st.updateSettings);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    detectBrand().then(setBrand);
  }, []);

  const guide = guideFor(brand ?? 'android');
  const act = async (a: Action) => {
    await runAction(a);
    onRecheck();
  };

  const rows: { key: keyof Checks; label: string; action: Action; hide?: boolean }[] = [
    { key: 'location', label: t.checkLocation, action: 'locationAlways' },
    { key: 'notifications', label: t.checkNotifications, action: 'notifications' },
    { key: 'battery', label: t.checkBattery, action: 'batteryUnrestricted', hide: platform === 'ios' },
  ];

  const onDeleteAll = async () => {
    if (!(await confirm(t.deleteAllConfirm, t.deleteAll, t.cancel, true))) return;
    if (!(await confirm(t.deleteAllConfirm2, t.deleteAll, t.cancel, true))) return;
    useStore.getState().deleteAll();
  };

  return (
    <div className="screen">
      <h1>{t.checkTitle}</h1>
      <p className="hint">{t.checkHint}</p>
      <Card>
        {rows
          .filter((r) => !r.hide)
          .map((r) => (
            <CheckRow key={r.key} state={checks[r.key]} label={r.label} fix={t.fix} unknown={t.checkUnknown} onFix={() => act(r.action)} />
          ))}
      </Card>

      <h2>{t.guideFor(guide.name)}</h2>
      <Card>
        <ol className="steps">
          {guide.steps.map((step, i) => (
            <li key={i}>
              <span className="step-num" aria-label={`${t.step} ${i + 1}`}>
                {i + 1}
              </span>
              <div>
                <p>{step.text[s.lang]}</p>
                {step.action && (
                  <button className="btn btn-small btn-go" onClick={() => act(step.action!)}>
                    {t.openIt}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-link" onClick={() => setPicking(!picking)}>
          {t.otherPhone}
        </button>
        {picking && (
          <div className="brand-grid" aria-label={t.pickPhone}>
            {GUIDES.map((g) => (
              <button
                key={g.brand}
                className={g.brand === guide.brand ? 'on' : ''}
                onClick={() => {
                  setBrand(g.brand);
                  setPicking(false);
                }}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      <h2>{t.settings}</h2>
      <Card>
        <Segmented
          label={t.language}
          value={s.lang}
          options={[
            { value: 'de', label: 'Deutsch' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(lang) => update({ lang })}
        />
        <Segmented
          label={t.sensitivity}
          value={s.sensitivity}
          options={[
            { value: 'few', label: t.sensFew },
            { value: 'normal', label: t.sensNormal },
            { value: 'many', label: t.sensMany },
          ]}
          onChange={(sensitivity) => update({ sensitivity })}
        />
        <p className="hint">{t.sensitivityRecount}</p>
        <Segmented
          label={t.units}
          value={s.units}
          options={[
            { value: 'metric', label: t.unitsMetric },
            { value: 'imperial', label: t.unitsImperial },
          ]}
          onChange={(units) => update({ units })}
        />
        <Segmented
          label={t.textSize}
          value={s.textScale}
          options={[
            { value: 1, label: 'A' },
            { value: 1.15, label: 'A+' },
            { value: 1.3, label: 'A++' },
          ]}
          onChange={(textScale) => update({ textScale })}
        />
        <Segmented
          label={t.theme}
          value={s.theme}
          options={[
            { value: 'system', label: t.themeSystem },
            { value: 'light', label: t.themeLight },
            { value: 'dark', label: t.themeDark },
          ]}
          onChange={(theme) => update({ theme })}
        />
        <Toggle label={t.automatic} hint={t.automaticHint} on={s.auto} onChange={setAutomatic} />
        {s.auto && (
          <Segmented
            label={t.pause}
            value={s.pauseMinutes}
            options={[5, 10, 20].map((n) => ({ value: n as 5 | 10 | 20, label: t.pauseMin(n) }))}
            onChange={(pauseMinutes) => update({ pauseMinutes })}
          />
        )}
      </Card>

      <Card>
        <button className="btn btn-plain wide" disabled={phase === 'riding'} onClick={startDemo}>
          {t.demoRide}
        </button>
        <button className="btn btn-link danger" onClick={onDeleteAll}>
          {t.deleteAll}
        </button>
      </Card>

      <p className="hint">{t.placeholderNote}</p>
      <p className="hint center">
        {t.appName} · {t.version} {__APP_VERSION__}
      </p>
    </div>
  );
}

function CheckRow({ state, label, fix, unknown, onFix }: { state: CheckState; label: string; fix: string; unknown: string; onFix: () => void }) {
  return (
    <div className={`check check-${state}`}>
      <span className="check-icon">{state === 'ok' ? <IconCheck /> : <IconAlert />}</span>
      <span className="check-label">
        {label}
        {state === 'unknown' && <span className="hint">{unknown}</span>}
      </span>
      {state !== 'ok' && (
        <button className="btn btn-small btn-go" onClick={onFix}>
          {fix}
        </button>
      )}
    </div>
  );
}


