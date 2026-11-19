import { useEffect, useState } from 'react';
import { useStore, useT } from '../store';
import { startRide, stopRide } from '../tracking/engine';
import { confirm } from '../ui/components';
import { fmtDistance, fmtDuration, fmtSpeed, speedUnit } from '../ui/format';
import { IconAlert, IconCurveLeft, IconCurveRight } from '../ui/icons';
import { tapFeedback } from '../native';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function RideScreen({ problems }: { problems: number }) {
  const t = useT();
  const phase = useStore((s) => s.phase);
  const ride = useStore((s) => s.rides.find((r) => r.id === s.activeId) ?? null);
  const live = useStore((s) => s.live);
  const { units, lang } = useStore((s) => s.settings);
  const setTab = useStore((s) => s.setTab);
  const now = useNow(phase === 'riding');

  const left = ride?.left ?? 0;
  const right = ride?.right ?? 0;
  const elapsed = ride ? (ride.endedAt ?? now) - ride.startedAt : 0;

  const status =
    phase === 'riding' ? t.statusRiding(fmtDuration(elapsed)) : phase === 'armed' ? t.statusArmed : phase === 'watching' ? t.statusWatching : t.statusOff;

  const onMain = async () => {
    tapFeedback(true);
    if (phase === 'riding') {
      if (await confirm(t.stopConfirm, t.stop, t.cancel, true)) stopRide();
    } else if (phase === 'armed') {
      stopRide();
    } else {
      startRide();
    }
  };

  const onDiscard = async () => {
    if (await confirm(t.discardConfirm, t.discard, t.keep, true)) stopRide(true);
  };

  return (
    <div className="screen ride-screen">
      {problems > 0 && (
        <button className="fix-banner" onClick={() => setTab('help')}>
          <IconAlert />
          <span>{t.fixBanner(problems)}</span>
          <b>{t.fixBannerButton} →</b>
        </button>
      )}

      {live.problem === 'noLocation' && (
        <button className="fix-banner" onClick={() => setTab('help')}>
          <IconAlert />
          <span>{t.noLocation}</span>
          <b>{t.fixBannerButton} →</b>
        </button>
      )}
      {live.gpsWeak && phase !== 'off' && (
        <div className="fix-banner" role="alert">
          <IconAlert />
          <span>{t.gpsWeak}</span>
        </div>
      )}

      <div className={`status status-${phase}`} role="status" aria-live="polite">
        <span className="status-dot" />
        <span>{live.demo ? `${t.statusDemo} · ${status}` : status}</span>
      </div>

      <div className="counters">
        <div className="counter counter-left" aria-label={`${t.left}: ${left}`}>
          <IconCurveLeft className="counter-icon" />
          <div className="counter-num">{left}</div>
          <div className="counter-label">{t.left}</div>
        </div>
        <div className="counter counter-right" aria-label={`${t.right}: ${right}`}>
          <IconCurveRight className="counter-icon" />
          <div className="counter-num">{right}</div>
          <div className="counter-label">{t.right}</div>
        </div>
      </div>

      <div className="total">
        <span>{t.total}</span>
        <b>{left + right}</b>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">{t.rideTime}</div>
          <div className="tile-value">{fmtDuration(elapsed)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">{t.distance}</div>
          <div className="tile-value">{fmtDistance(ride?.distanceM ?? 0, units, lang)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">{t.speed}</div>
          <div className="tile-value">
            {phase === 'off' ? '–' : fmtSpeed(live.speed, units)} <small>{speedUnit(units)}</small>
          </div>
        </div>
      </div>

      <div className="spacer" />

      <button className={`btn btn-huge ${phase === 'riding' ? 'btn-stop' : phase === 'armed' ? 'btn-ready' : 'btn-go'}`} onClick={onMain}>
        {phase === 'riding' ? t.stop : phase === 'armed' ? t.cancelReady : t.start}
      </button>
      {phase === 'riding' && (
        <button className="btn btn-link" onClick={onDiscard}>
          {t.discard}
        </button>
      )}
      {phase !== 'riding' && <p className="hint center">{t.safety}</p>}
    </div>
  );
}
