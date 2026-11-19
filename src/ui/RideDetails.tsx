/**
 * The "Details" part of a ride (Rule 2: hidden by default). Curve strength classes,
 * twistiness, strongest curve and the list of all curves.
 */
import type { ReactNode } from 'react';
import { curveMetrics, STRENGTHS, summarizeCurves } from '../logic/curveMetrics';
import { useStore, useT, type Ride } from '../store';
import { localeOf } from '../i18n/strings';
import { fmtHeight, fmtSpeed, fmtTime, speedUnit } from './format';
import type { HeightTotals } from '../logic/height';
import { IconCurveLeft, IconCurveRight } from './icons';

export function RideDetails({ ride, actions }: { ride: Ride; actions?: ReactNode }) {
  const t = useT();
  const { units, lang } = useStore((s) => s.settings);
  const sum = summarizeCurves(ride.curves, ride.distanceM);
  const max = Math.max(1, ...STRENGTHS.map((k) => sum.classes[k]));
  const num = (n: number, digits = 0) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const spd = (v: number | null) => (v == null ? '–' : `${fmtSpeed(v, units)} ${speedUnit(units)}`);

  return (
    <div className="details">
      {sum.per100km != null && <p className="detail-line">{t.per100km(num(sum.per100km))}</p>}
      {sum.maxLeanDeg != null && sum.maxLatG != null && (
        <p className="detail-line">{t.strongestCorner(num(sum.maxLeanDeg), num(sum.maxLatG, 2))}</p>
      )}
      <p className="detail-line">
        {t.curveSpeed}: ↰ {spd(sum.avgCurveSpeed.L)} · {spd(sum.avgCurveSpeed.R)} ↱
      </p>

      {ride.height && (
        <>
          <p className="detail-line">
            {t.highest(fmtHeight(ride.height.maxAltM, units, lang))} · {fmtTime(ride.height.maxAltAt.t, lang)}
          </p>
          <p className="detail-line">{t.climb(fmtHeight(ride.height.climbM, units, lang), fmtHeight(ride.height.descentM, units, lang))}</p>
          <HeightProfile height={ride.height} label={t.heightProfile} />
        </>
      )}

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
      {ride.curves.length === 0 && <p className="hint">{t.noCurves}</p>}
      <ol className="curve-list">
        {[...ride.curves]
          .sort((a, b) => a.t - b.t)
          .map((c, i) => {
            const m = curveMetrics(c);
            return (
              <li key={`${c.t}-${i}`} className={c.dir === 'L' ? 'curve-l' : 'curve-r'}>
                <span className="curve-dir">
                  {c.dir === 'L' ? <IconCurveLeft /> : <IconCurveRight />}
                  {c.dir === 'L' ? t.left : t.right}
                </span>
                <span>
                  {c.angle}° · {t.strength[m.strength]}
                  {c.wide ? ` · ${t.wideCurve}` : ''}
                </span>
                <span className="meta">
                  {fmtTime(c.t, lang)} · {spd(c.avgSpeed)}
                  {m.leanDeg != null ? ` · ${t.approx} ${num(m.leanDeg)}°` : ''}
                </span>
              </li>
            );
          })}
      </ol>
      {actions}
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
