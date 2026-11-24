/**
 * Share / save sheet. The same format picker everywhere (share one ride, save all rides, send to
 * an app), so it looks familiar every time. GPX is picked and marked "recommended"; every other
 * format says in one line why you'd want it. Expert options (no picture, no curves, no times …)
 * are folded away.
 */
import { useCallback, useState } from 'react';
import { APP_GUIDES, type AppGuide } from '../guides/apps';
import { FORMATS, type Format } from '../logic/formats';
import { shareRides } from '../tracking/fileIo';
import { useStore, useT, type Ride } from '../store';
import { ExtLink, Sheet, Toggle } from './components';
import { tapFeedback } from '../native';

export function FormatPicker({ value, onChange, only }: { value: Format; onChange: (f: Format) => void; only?: Format[] }) {
  const t = useT();
  const list = only ?? FORMATS;
  return (
    <div className="format-picker" role="radiogroup" aria-label={t.fileFormat}>
      {list.map((f, i) => (
        <button
          key={f}
          role="radio"
          aria-checked={value === f}
          className={`format ${value === f ? 'on' : ''}`}
          onClick={() => {
            tapFeedback();
            onChange(f);
          }}
        >
          <span className="format-name">
            {f.toUpperCase()}
            {(only ? i === 0 : f === 'gpx') && <span className="pill pill-go">{t.recommended}</span>}
          </span>
          <span className="hint">{t.formatWhy[f]}</span>
        </button>
      ))}
    </div>
  );
}

export function ShareSheet({ rides, mode, onClose }: { rides: Ride[]; mode: 'share' | 'save'; onClose: () => void }) {
  const t = useT();
  const [format, setFormat] = useState<Format>('gpx');
  const [image, setImage] = useState(mode === 'share' && rides.length === 1);
  const [message, setMessage] = useState(mode === 'share');
  const [curves, setCurves] = useState(true);
  const [times, setTimes] = useState(true);
  const [sensors, setSensors] = useState(true);
  const [height, setHeight] = useState(true);
  const [expert, setExpert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [app, setApp] = useState<AppGuide | null>(null);

  const go = async (fmt = format) => {
    tapFeedback(true);
    setBusy(true);
    setNote(null);
    try {
      const ok = await shareRides(rides, { format: fmt, image: image && rides.length === 1, message, curves, times, sensors, height });
      if (!ok) setNote(t.noTrack);
    } catch (e) {
      console.error(e);
      setNote(t.exportFailed);
    } finally {
      setBusy(false);
    }
  };

  if (app) {
    return (
      <AppGuideSheet
        app={app}
        busy={busy}
        onBack={() => setApp(null)}
        onClose={onClose}
        onShare={(f) => {
          setFormat(f);
          void go(f);
        }}
      />
    );
  }

  const one = rides.length === 1;
  return (
    <Sheet title={mode === 'share' ? t.shareTitle : t.saveTitle(rides.length)} onClose={onClose}>
      <p className="hint">{mode === 'share' ? t.shareHint : t.saveHint}</p>
      <h3>{t.fileFormat}</h3>
      <FormatPicker value={format} onChange={setFormat} />
      {mode === 'share' && one && <Toggle label={t.withPicture} hint={t.withPictureHint} on={image} onChange={setImage} />}
      <button className="btn btn-link" aria-expanded={expert} onClick={() => setExpert(!expert)}>
        {expert ? '▾' : '▸'} {t.expertOptions}
      </button>
      {expert && (
        <div className="expert">
          <p className="hint">{t.expertHint}</p>
          {mode === 'share' && <Toggle label={t.withMessage} on={message} onChange={setMessage} />}
          <Toggle label={t.withCurves} on={curves} onChange={setCurves} />
          <Toggle label={t.withTimes} hint={t.withTimesHint} on={times} onChange={setTimes} />
          <Toggle label={t.withHeight} on={height} onChange={setHeight} />
          <Toggle label={t.withSensors} hint={t.withSensorsHint} on={sensors} onChange={setSensors} />
        </div>
      )}
      <button className="btn btn-go btn-huge" disabled={busy} onClick={() => go()}>
        {busy ? t.working : mode === 'share' ? t.shareNow : t.saveNow}
      </button>
      {note && <p className="hint warn-text">{note}</p>}

      <h3>{t.sendToApp}</h3>
      <p className="hint">{t.sendToAppHint}</p>
      <div className="app-grid">
        {APP_GUIDES.filter((a) => a.send).map((a) => (
          <button key={a.id} className="app-btn" onClick={() => setApp(a)}>
            {a.name}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function AppGuideSheet({
  app,
  busy,
  onBack,
  onClose,
  onShare,
}: {
  app: AppGuide;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  onShare: (f: Format) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const [format, setFormat] = useState<Format>(app.formats[0]);
  const back = useCallback(() => onBack(), [onBack]);
  return (
    <Sheet title={t.sendTo(app.name)} onClose={onClose}>
      <button className="btn btn-link" onClick={back}>
        ← {t.back}
      </button>
      <ol className="steps">
        {app.send![lang].map((s, i) => (
          <li key={i}>
            <span className="step-num">{i + 1}</span>
            <p>{s}</p>
          </li>
        ))}
      </ol>
      {app.url && (
        <p>
          <ExtLink href={app.url}>{app.url.replace(/^https:\/\/(www\.)?/, '')} ↗</ExtLink>
        </p>
      )}
      {app.formats.length > 1 && (
        <>
          <h3>{t.fileFormat}</h3>
          <FormatPicker value={format} onChange={setFormat} only={app.formats} />
        </>
      )}
      <button className="btn btn-go btn-huge" disabled={busy} onClick={() => onShare(format)}>
        {busy ? t.working : t.shareFile}
      </button>
    </Sheet>
  );
}
