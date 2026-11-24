/**
 * The "Details" part of a ride (Rule 2: hidden by default): map, curve strength classes,
 * twistiness, strongest curve, braking, stops, tilt, extra data from imported files and the
 * list of all curves (tap one → shown on the map).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Curve } from '../logic/curves';
import { curveMetrics, STRENGTHS, summarizeCurves } from '../logic/curveMetrics';
import { useStore, useT, type Ride } from '../store';
import { localeOf } from '../i18n/strings';
import { fmtDuration, fmtHeight, fmtSpeed, fmtTime, speedUnit } from './format';
import type { HeightTotals } from '../logic/height';
import { IconCurveLeft, IconCurveRight } from './icons';
import { MapSheet, RideMap } from './Map';
import { ExtLink } from './components';
import { tapFeedback } from '../native';

export function RideDetails({ ride, actions }: { ride: Ride; actions?: ReactNode }) {
  const t = useT();
  const { units, lang } = useStore((s) => s.settings);
  const [full, setFull] = useState(false);
  const [focus, setFocus] = useState<Curve | null>(null);
  const sum = useMemo(() => summarizeCurves(ride.curves, ride.distanceM), [ride.curves, ride.distanceM]);
  const max = Math.max(1, ...STRENGTHS.map((k) => sum.classes[k]));
  const num = (n: number, digits = 0) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const spd = (v: number | null) => (v == null ? '–' : `${fmtSpeed(v, units)} ${speedUnit(units)}`);
  const route = ride.source === 'route';
  const m = ride.motion;
  const x = ride.extras;
  const sorted = useMemo(() => [...ride.curves].sort((a, b) => a.t - b.t), [ride.curves]);
  const unsure = sorted.filter((c) => c.confidence != null && c.confidence < 0.4).length;

  return (
    <div className="details">
      {(ride.hasTrack || ride.shape) && (
        <div className="map-card">
          <RideMap ride={ride} focus={focus} />
          <button className="btn btn-plain wide" onClick={() => setFull(true)}>
            ⤢ {t.mapBig}
          </button>
        </div>
      )}
      {full && <MapSheet ride={ride} onClose={() => setFull(false)} />}

      {sum.per100km != null && <p className="detail-line">{t.per100km(num(sum.per100km))}</p>}
      {!route && sum.maxLeanDeg != null && sum.maxLatG != null && <p className="detail-line">{t.strongestCorner(num(sum.maxLeanDeg), num(sum.maxLatG, 2))}</p>}
      {!route && (
        <p className="detail-line">
          {t.curveSpeed}: ↰ {spd(sum.avgCurveSpeed.L)} · {spd(sum.avgCurveSpeed.R)} ↱
        </p>
      )}
      {!route && m && (
        <>
          {m.maxBrakeG != null && <p className="detail-line">{t.strongestBrake(num(m.maxBrakeG, 2), t.brakeWords(m.maxBrakeG))}</p>}
          {m.maxAccelG != null && <p className="detail-line">{t.strongestAccel(num(m.maxAccelG, 2))}</p>}
          {m.stops > 0 && <p className="detail-line">{t.stops(m.stops, fmtDuration(m.stoppedS * 1000))}</p>}
          {m.holder && <p className="detail-line">{m.holder === 'fixed' ? t.holderFixed : t.holderLoose}</p>}
          {m.holder === 'fixed' && (m.maxTiltL != null || m.maxTiltR != null) && (
            <p className="detail-line">{t.measuredTilt(m.maxTiltL != null ? `${m.maxTiltL}°` : '–', m.maxTiltR != null ? `${m.maxTiltR}°` : '–')}</p>
          )}
          <p className="hint">{t.sensorsUsed(t.sensorNames(m.sensors))}</p>
        </>
      )}

      {ride.height && (
        <>
          <p className="detail-line">
            {t.highest(fmtHeight(ride.height.maxAltM, units, lang))}
            {!route && ` · ${fmtTime(ride.height.maxAltAt.t, lang)}`}
          </p>
          <p className="detail-line">{t.climb(fmtHeight(ride.height.climbM, units, lang), fmtHeight(ride.height.descentM, units, lang))}</p>
          <HeightProfile height={ride.height} label={t.heightProfile} />
        </>
      )}

      {x && <Extras ride={ride} />}

      <div className="classes" role="list">
        {STRENGTHS.map((k) => (
          <div key={k} className={`class-row class-${k}`} role="listitem">
            <span className="class-label">{t.strength[k]}</span>
            <span className="class-bar">
              <span style={{ width: `${(sum.classes[k] / max) * 100}%` }} />
            </span>
            <b className="class-num">{sum.classes[k]}</b>
          </div>
        ))}
        <p className="hint">{t.strengthHint}</p>
      </div>

      <h3>{t.curveList}</h3>
      {sorted.length === 0 && <p className="hint">{t.noCurves}</p>}
      {unsure > 0 && <p className="hint">{t.unsureNote(unsure)}</p>}
      <ol className="curve-list">
        {sorted.map((c, i) => {
          const mt = curveMetrics(c);
          const conf = c.confidence == null ? null : c.confidence >= 0.66 ? 'sure' : c.confidence >= 0.4 ? 'likely' : 'unsure';
          return (
            <li key={`${c.t}-${i}`}>
              <button
                className={`curve-item ${c.dir === 'L' ? 'curve-l' : 'curve-r'}`}
                onClick={() => {
                  tapFeedback();
                  setFocus({ ...c });
                }}
              >
                <span className="curve-dir">
                  {c.dir === 'L' ? <IconCurveLeft /> : <IconCurveRight />}
                  {i + 1}. {c.dir === 'L' ? t.left : t.right}
                </span>
                <span>
                  {c.angle}° · {t.strength[mt.strength]}
                  {c.wide ? ` · ${t.wideCurve}` : ''}
                  {conf && conf !== 'sure' && <span className={`pill pill-${conf}`}>{conf === 'likely' ? t.confLikely : t.confUnsure}</span>}
                </span>
                {!route && (
                  <span className="meta">
                    {fmtTime(c.t, lang)} · {spd(c.avgSpeed)}
                    {mt.leanDeg != null ? ` · ${t.approx} ${num(mt.leanDeg)}°` : ''}
                    {c.leanDeg != null ? ` · ${t.measured} ${Math.abs(c.leanDeg)}°` : ''}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {actions}
    </div>
  );
}

function Extras({ ride }: { ride: Ride }) {
  const t = useT();
  const x = ride.extras!;
  const lines: ReactNode[] = [];
  if (x.desc) lines.push(<p key="d" className="detail-line quote">{x.desc}</p>);
  if (x.author) lines.push(<p key="a" className="detail-line">{t.author}: {x.author}</p>);
  if (x.type) lines.push(<p key="ty" className="detail-line">{t.activity}: {x.type}</p>);
  if (x.hr) lines.push(<p key="hr" className="detail-line">❤ {t.heartRate}: Ø {x.hr.avg} · max {x.hr.max} bpm</p>);
  if (x.cad) lines.push(<p key="cad" className="detail-line">{t.cadence}: Ø {x.cad.avg} · max {x.cad.max} rpm</p>);
  if (x.power) lines.push(<p key="pw" className="detail-line">{t.powerWatts}: Ø {x.power.avg} · max {x.power.max} W</p>);
  if (x.temp) lines.push(<p key="tp" className="detail-line">🌡 {t.temperature}: {x.temp.min}–{x.temp.max} °C</p>);
  if (x.keywords) lines.push(<p key="k" className="hint">{x.keywords}</p>);
  if (x.link) lines.push(<p key="l"><ExtLink href={x.link}>{x.link.replace(/^https?:\/\//, '')} ↗</ExtLink></p>);
  if (x.waypoints?.length)
    lines.push(
      <details key="w" className="waypoints">
        <summary>{t.waypoints(x.waypoints.length)}</summary>
        <ul>
          {x.waypoints.slice(0, 100).map((w, i) => (
            <li key={i}>
              <b>{w.name ?? `#${i + 1}`}</b>
              {w.desc ? ` – ${w.desc}` : ''}
            </li>
          ))}
        </ul>
      </details>,
    );
  if (!lines.length) return null;
  return (
    <div className="extras">
      <h3>{t.fromFile(x.format?.toUpperCase() ?? 'GPX')}</h3>
      {lines}
    </div>
  );
}

/** Small height-over-distance chart (inline SVG, follows the theme colours). */
function HeightProfile({ height, label }: { height: HeightTotals; label: string }) {
  const p = height.profile;
  if (p.length < 2) return null;
  const W = 300;
  const H = 80;
  const maxD = p[p.length - 1][0] || 1;
  const lo = height.minAltM;
  const span = Math.max(20, height.maxAltM - lo);
  const x = (d: number) => (d / maxD) * W;
  const y = (h: number) => H - 4 - ((h - lo) / span) * (H - 8);
  const line = p.map(([d, h]) => `${x(d).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <polygon points={`0,${H} ${line} ${W},${H}`} className="profile-fill" />
      <polyline points={line} className="profile-line" />
    </svg>
  );
}
