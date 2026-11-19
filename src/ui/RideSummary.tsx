/** Big card right after a ride ended: "You rode 143 curves (71 ↰ / 72 ↱), 48.3 km, 1:23 h". */
import { useStore, useT } from '../store';
import { fmtDistance, fmtDuration } from './format';
import { IconCurveLeft, IconCurveRight } from './icons';
import { tapFeedback } from '../native';

export function RideSummary() {
  const t = useT();
  const id = useStore((s) => s.summaryId);
  const ride = useStore((s) => s.rides.find((r) => r.id === id) ?? null);
  const { units, lang } = useStore((s) => s.settings);
  if (!ride) return null;
  const close = () => {
    tapFeedback();
    useStore.getState().showSummary(null);
  };
  const total = ride.left + ride.right;
  return (
    <div className="scrim" onClick={close}>
      <div className="dialog summary" role="dialog" aria-modal="true" aria-label={t.summaryTitle} onClick={(e) => e.stopPropagation()}>
        <h2>{t.summaryTitle}</h2>
        <div className="lr-row big">
          <span className="lr lr-left">
            <IconCurveLeft /> {ride.left}
          </span>
          <span className="lr lr-total">{total}</span>
          <span className="lr lr-right">
            {ride.right} <IconCurveRight />
          </span>
        </div>
        <p className="dialog-text">{t.summaryCurves(total)}</p>
        <p className="meta">
          {fmtDistance(ride.distanceM, units, lang)} · {fmtDuration((ride.endedAt ?? Date.now()) - ride.startedAt)}
        </p>
        <button className="btn btn-go btn-huge" onClick={close}>
          {t.ok}
        </button>
      </div>
    </div>
  );
}
