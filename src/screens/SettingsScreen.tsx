import { useState } from 'react';
import { useStore, useT, type Power } from '../store';
import { setAutomatic, startDemo, stopRide } from '../tracking/engine';
import { ask, Card, Segmented, Toggle } from '../ui/components';
import { ShareSheet } from '../ui/Share';
import { platform } from '../native';

export function SettingsScreen() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const phase = useStore((st) => st.phase);
  const rides = useStore((st) => st.rides);
  const update = useStore((st) => st.updateSettings);
  const [saveAll, setSaveAll] = useState(false);
  const exportable = rides.filter((r) => r.hasTrack && r.endedAt != null);

  const onDeleteAll = async () => {
    const a = await ask({ title: t.deleteAll, text: t.deleteAllConfirm, yes: t.deleteAll, no: t.cancel, danger: true });
    if (a !== 'yes') return;
    // a running ride is thrown away first, so the recorder doesn't keep going without a ride
    if (useStore.getState().phase !== 'off') await stopRide(true);
    useStore.getState().deleteAll();
  };

  const setSensitivity = (sensitivity: typeof s.sensitivity) => {
    const before = s.sensitivity;
    update({ sensitivity });
    useStore.getState().offerUndo({ text: t.recountNote, rides: [], restore: (st) => ({ settings: { ...st.settings, sensitivity: before } }) });
  };

  return (
    <div className="screen">
      <h1>{t.tabSettings}</h1>

      <h2>{t.secLook}</h2>
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
          hint={t.themeIconHint}
        />
        <Segmented
          label={t.units}
          value={s.units}
          options={[
            { value: 'metric', label: t.unitsMetric },
            { value: 'imperial', label: t.unitsImperial },
          ]}
          onChange={(units) => update({ units })}
        />
        <Toggle label={t.scenery} hint={t.sceneryHint} on={s.scenery} onChange={(scenery) => update({ scenery })} />
        <Toggle label={t.haptics} on={s.haptics} onChange={(haptics) => update({ haptics })} />
      </Card>

      <h2>{t.secCounting}</h2>
      <Card>
        <Segmented
          label={t.sensitivity}
          value={s.sensitivity}
          options={[
            { value: 'few', label: t.sensFew },
            { value: 'normal', label: t.sensNormal },
            { value: 'many', label: t.sensMany },
          ]}
          onChange={setSensitivity}
          hint={t.sensExplain[s.sensitivity]}
        />
        <p className="hint">{t.sensitivityRecount}</p>
      </Card>

      <h2>{t.secBattery}</h2>
      <Card>
        <Segmented<Power>
          label={t.power}
          value={s.power}
          options={[
            { value: 'max', label: t.powerMax },
            { value: 'balanced', label: t.powerBalanced },
            { value: 'saver', label: t.powerSaver },
          ]}
          onChange={(power) => update({ power })}
          hint={t.powerExplain[s.power]}
        />
        <p className="hint">{t.powerNote}</p>
        {platform !== 'ios' && <Toggle label={t.watch} hint={t.watchHint} on={s.watch} onChange={(watch) => update({ watch })} />}
        {platform === 'ios' && <p className="hint">{t.watchIos}</p>}
      </Card>

      <h2>{t.secExperimental}</h2>
      <Card>
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

      <h2>{t.secData}</h2>
      <Card>
        <button className="btn btn-plain wide" disabled={phase === 'riding'} onClick={startDemo}>
          {t.demoRide}
        </button>
        {exportable.length > 0 && (
          <button className="btn btn-plain wide" onClick={() => setSaveAll(true)}>
            {t.exportAll}
          </button>
        )}
        <button className="btn btn-link danger" disabled={!rides.length} onClick={onDeleteAll}>
          {t.deleteAll}
        </button>
        <p className="hint">{t.privacy}</p>
      </Card>
      {saveAll && <ShareSheet rides={exportable} mode="save" onClose={() => setSaveAll(false)} />}
    </div>
  );
}
