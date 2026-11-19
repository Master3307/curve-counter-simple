import { useEffect, useState } from 'react';
import { useStore, useT, type Ride } from '../store';
import { Card, confirm } from '../ui/components';
import { fmtDate, fmtDistance, fmtDuration, fmtSpeed, fmtTime, speedUnit } from '../ui/format';
import { IconCurveLeft, IconCurveRight, IconTrash } from '../ui/icons';
import { RideDetails } from '../ui/RideDetails';
import { exportRides, importFiles } from '../tracking/gpxIo';
import { tapFeedback } from '../native';

export function RidesScreen() {
  const t = useT();
  const rides = useStore((s) => s.rides);
  const activeId = useStore((s) => s.activeId);
  const lastDeleted = useStore((s) => s.lastDeleted);
  const { units, lang } = useStore((s) => s.settings);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(id);
  }, [note]);

  const onImport = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const n = await importFiles([...list]);
      if (n) setNote(t.importDone(n));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (rs: Ride[]) => {
    tapFeedback();
    setBusy(true);
    try {
      if (!(await exportRides(rs))) setNote(t.noTrack);
    } catch {
      setNote(t.exportFailed);
    } finally {
      setBusy(false);
    }
  };

  // the undo bar disappears after 5 seconds
  useEffect(() => {
    if (!lastDeleted) return;
    const id = setTimeout(() => useStore.getState().clearUndo(), 5000);
    return () => clearTimeout(id);
  }, [lastDeleted]);

  const sum = rides.reduce(
    (a, r) => ({
      left: a.left + r.left,
      right: a.right + r.right,
      distanceM: a.distanceM + r.distanceM,
      timeMs: a.timeMs + ((r.endedAt ?? Date.now()) - r.startedAt),
    }),
    { left: 0, right: 0, distanceM: 0, timeMs: 0 },
  );

  const onDelete = async (r: Ride) => {
    if (await confirm(t.deleteConfirm, t.delete, t.keep, true)) useStore.getState().deleteRide(r.id);
  };

  return (
    <div className="screen">
      <h1>{t.tabRides}</h1>
      {rides.length === 0 && <p className="empty">{t.noRides}</p>}

      <label className={`btn btn-plain wide file-btn ${busy ? 'busy' : ''}`}>
        {t.importRide}
        <input
          type="file"
          accept=".gpx,application/gpx+xml,application/octet-stream,text/xml"
          multiple
          onChange={(e) => {
            void onImport(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {rides.length > 0 && (
        <Card className="sum-card">
          <div className="sum-title">
            {t.allRides} · {t.rides(rides.length)}
          </div>
          <div className="lr-row big">
            <span className="lr lr-left">
              <IconCurveLeft /> {sum.left}
            </span>
            <span className="lr lr-total">{sum.left + sum.right}</span>
            <span className="lr lr-right">
              {sum.right} <IconCurveRight />
            </span>
          </div>
          <div className="meta">
            {fmtDistance(sum.distanceM, units, lang)} · {fmtDuration(sum.timeMs)}
          </div>
        </Card>
      )}

      {rides.map((r) => (
        <Card key={r.id} className="ride-card">
          <div className="ride-head">
            <div>
              <div className="ride-date">{fmtDate(r.startedAt, lang)}</div>
              <div className="meta">
                {r.source === 'route' ? (
                  <>
                    {t.plannedRoute} · {r.sourceName}
                  </>
                ) : (
                  <>
                    {fmtTime(r.startedAt, lang)} – {r.endedAt ? fmtTime(r.endedAt, lang) : t.running} ·{' '}
                    {r.source === 'gpx' ? `${t.imported} · ${r.sourceName}` : r.mode === 'auto' ? t.auto : t.manual}
                  </>
                )}
              </div>
            </div>
            {r.id !== activeId && (
              <button className="icon-btn" aria-label={t.delete} onClick={() => onDelete(r)}>
                <IconTrash />
              </button>
            )}
          </div>
          <div className="lr-row">
            <span className="lr lr-left">
              <IconCurveLeft /> {r.left}
            </span>
            <span className="lr lr-total">
              {r.left + r.right} <small>{t.curves}</small>
            </span>
            <span className="lr lr-right">
              {r.right} <IconCurveRight />
            </span>
          </div>
          {r.quality === 'approx' && <p className="hint">{t.importApprox}</p>}
          <dl className="facts">
            <div>
              <dt>{t.distance}</dt>
              <dd>{fmtDistance(r.distanceM, units, lang)}</dd>
            </div>
            {r.source !== 'route' && (
              <>
            <div>
              <dt>{t.onTheRoad}</dt>
              <dd>{fmtDuration((r.endedAt ?? Date.now()) - r.startedAt)}</dd>
            </div>
            <div>
              <dt>{t.riding}</dt>
              <dd>{fmtDuration(r.movingS * 1000)}</dd>
            </div>
            <div>
              <dt>{t.avgSpeed}</dt>
              <dd>
                {fmtSpeed(r.avgSpeed, units)} {speedUnit(units)}
              </dd>
            </div>
            <div>
              <dt>{t.topSpeed}</dt>
              <dd>
                {fmtSpeed(r.topSpeed, units)} {speedUnit(units)}
              </dd>
            </div>
              </>
            )}
          </dl>
          <button className="btn btn-plain wide" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            {open === r.id ? t.hideDetails : t.details}
          </button>
          {open === r.id && (
            <RideDetails
              ride={r}
              actions={
                r.hasTrack && r.id !== activeId ? (
                  <button className="btn btn-go wide" disabled={busy} onClick={() => onExport([r])}>
                    {t.exportGpx}
                  </button>
                ) : null
              }
            />
          )}
        </Card>
      ))}

      {rides.some((r) => r.hasTrack) && (
        <button className="btn btn-link" disabled={busy} onClick={() => onExport(rides.filter((r) => r.hasTrack && r.id !== activeId))}>
          {t.exportAll}
        </button>
      )}

      {note && (
        <div className="toast" role="status">
          <span>{note}</span>
        </div>
      )}

      {lastDeleted && (
        <div className="toast" role="status">
          <span>{t.deleted}</span>
          <button className="btn btn-small" onClick={() => useStore.getState().undoDelete()}>
            {t.undo}
          </button>
        </div>
      )}
    </div>
  );
}
