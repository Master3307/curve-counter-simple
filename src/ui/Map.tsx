/**
 * Maps.
 * - MapPreview: tiny SVG outline of a ride (works offline, no tiles, cheap) for lists.
 * - RideMap: interactive OpenStreetMap map (Leaflet): zoom, pan, every curve as a coloured dot
 *   you can tap, tap the track anywhere to see time, speed, height and distance there.
 *   Dark theme darkens the tiles. Without internet the track is drawn on a plain background.
 * - MapSheet: the same map full screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Curve } from '../logic/curves';
import { curveMetrics } from '../logic/curveMetrics';
import { distance, type Fix } from '../logic/geo';
import type { Shape } from '../logic/routes';
import { loadTrack } from '../tracking/tracks';
import { rideName, useStore, useT, type Ride } from '../store';
import { fmtDate, fmtDistance, fmtHeight, fmtSpeed, fmtTime, speedUnit } from './format';
import { Sheet } from './components';
import { tapFeedback } from '../native';

/* ---------- preview ---------- */

export function MapPreview({
  shape,
  curves = [],
  lines,
  className = '',
}: {
  shape?: Shape;
  curves?: Curve[];
  /** several coloured lines on one common scale (route variants) */
  lines?: { shape: Shape; color: string }[];
  className?: string;
}) {
  const W = 320;
  const H = 120;
  const d = useMemo(() => {
    const all = lines?.length ? lines.map((l) => l.shape) : shape ? [shape] : [];
    const pts = all.flat();
    if (pts.length < 2) return null;
    const k = Math.cos((pts[0][0] * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * k);
    const ys = pts.map((p) => -p[0]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((W - 24) / (x1 - x0 || 1e-9), (H - 24) / (y1 - y0 || 1e-9));
    const ox = (W - (x1 - x0) * s) / 2;
    const oy = (H - (y1 - y0) * s) / 2;
    const P = (lat: number, lon: number) => [ox + (lon * k - x0) * s, oy + (-lat - y0) * s];
    const path = (sh: Shape) => sh.map(([la, lo], i) => `${i ? 'L' : 'M'}${P(la, lo).map((v) => v.toFixed(1)).join(' ')}`).join('');
    const first = all[0];
    return {
      paths: all.map((sh, i) => ({ d: path(sh), color: lines?.[i]?.color })),
      start: P(first[0][0], first[0][1]),
      end: P(first[first.length - 1][0], first[first.length - 1][1]),
      dots: curves.slice(0, 200).map((c) => ({ p: P(c.lat, c.lon), dir: c.dir })),
    };
  }, [shape, curves, lines]);
  if (!d) return null;
  return (
    <svg className={`map-preview ${className}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {d.paths.map((p, i) => (
        <path key={`c${i}`} d={p.d} className="mp-casing" />
      ))}
      {d.paths.map((p, i) => (
        <path key={`l${i}`} d={p.d} className="mp-line" style={p.color ? { stroke: p.color } : undefined} />
      ))}
      {d.dots.map((x, i) => (
        <circle key={i} cx={x.p[0]} cy={x.p[1]} r="3.2" className={x.dir === 'L' ? 'mp-l' : 'mp-r'} />
      ))}
      <circle cx={d.end[0]} cy={d.end[1]} r="5" className="mp-end" />
      <circle cx={d.start[0]} cy={d.start[1]} r="5" className="mp-start" />
    </svg>
  );
}

/* ---------- interactive map ---------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface MapLine {
  id: string;
  shape: [number, number][];
  color: string;
  label?: string;
}

function useTrack(ride: Ride | null) {
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  useEffect(() => {
    let alive = true;
    setFixes(null);
    if (ride?.hasTrack) loadTrack(ride.id).then((f) => alive && setFixes(f));
    return () => {
      alive = false;
    };
  }, [ride?.id, ride?.hasTrack]);
  return fixes;
}

export function RideMap({
  ride,
  lines,
  focus,
  interactive = true,
  className = '',
}: {
  ride?: Ride | null;
  /** extra lines (route variants) */
  lines?: MapLine[];
  /** curve to center on */
  focus?: Curve | null;
  interactive?: boolean;
  className?: string;
}) {
  const t = useT();
  const { units, lang } = useStore((s) => s.settings);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const curveLayers = useRef(new Map<number, L.CircleMarker>());
  const fixes = useTrack(ride ?? null);

  // build the map once per ride / line set
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: interactive,
      attributionControl: true,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      boxZoom: false,
      keyboard: interactive,
      tap: interactive,
    } as L.MapOptions);
    map.current = m;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      className: 'map-tiles',
    }).addTo(m);

    const bounds = L.latLngBounds([]);
    for (const l of lines ?? []) {
      if (l.shape.length < 2) continue;
      const pl = L.polyline(l.shape, { color: '#15171c', weight: 9, opacity: 0.55 }).addTo(m);
      L.polyline(l.shape, { color: l.color, weight: 5 }).addTo(m);
      if (l.label) pl.bindTooltip(esc(l.label), { sticky: true });
      bounds.extend(pl.getBounds());
    }

    const pts: [number, number][] = fixes?.length ? fixes.map((f) => [f.lat, f.lon]) : (ride?.shape ?? []);
    if (ride && pts.length > 1) {
      const casing = L.polyline(pts, { color: '#15171c', weight: 10, opacity: 0.6, interactive: false }).addTo(m);
      const line = L.polyline(pts, { color: '#f2a922', weight: 6, className: 'map-track' }).addTo(m);
      bounds.extend(casing.getBounds());
      L.circleMarker(pts[0], { radius: 8, color: '#fff', weight: 3, fillColor: '#17803a', fillOpacity: 1 }).bindTooltip(t.mapStart).addTo(m);
      L.circleMarker(pts[pts.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: '#c0262d', fillOpacity: 1 }).bindTooltip(t.mapEnd).addTo(m);

      // tap anywhere on the track → what happened there
      if (interactive && fixes?.length) {
        const dist: number[] = [0];
        for (let i = 1; i < fixes.length; i++) dist.push(dist[i - 1] + distance(fixes[i - 1], fixes[i]));
        line.on('click', (e: L.LeafletMouseEvent) => {
          tapFeedback();
          let best = 0;
          let bd = Infinity;
          for (let i = 0; i < fixes.length; i++) {
            const d = (fixes[i].lat - e.latlng.lat) ** 2 + (fixes[i].lon - e.latlng.lng) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          const f = fixes[best];
          const inCurve = ride.curves.find((c) => f.t >= c.t && f.t <= (c.endT ?? c.t));
          const rows = [
            ride.source !== 'route' ? `<b>${fmtTime(f.t, lang)}</b>` : '',
            ride.source !== 'route' && f.speed != null ? `${t.speed}: ${fmtSpeed(f.speed, units)} ${speedUnit(units)}` : '',
            f.alt != null ? `${t.height}: ${fmtHeight(f.alt, units, lang)}` : '',
            `${t.fromStart}: ${fmtDistance(dist[best], units, lang)}`,
            inCurve ? `${inCurve.dir === 'L' ? '↰' : '↱'} ${t.inCurve} ${inCurve.angle}°` : '',
            f.accuracy && ride.source !== 'route' && ride.source !== 'gpx' ? `${t.gpsAccuracy}: ±${Math.round(f.accuracy)} m` : '',
          ].filter(Boolean);
          L.popup({ closeButton: true }).setLatLng([f.lat, f.lon]).setContent(rows.join('<br>')).openOn(m);
        });
      }

      // curves: coloured dots, tap for details
      curveLayers.current.clear();
      ride.curves.forEach((c, i) => {
        const mtr = curveMetrics(c);
        const conf = c.confidence == null ? '' : c.confidence >= 0.66 ? t.confSure : c.confidence >= 0.4 ? t.confLikely : t.confUnsure;
        const html = [
          `<b>${i + 1}. ${c.dir === 'L' ? '↰ ' + t.left : t.right + ' ↱'} · ${c.angle}°</b>`,
          `${t.strength[mtr.strength]}${c.wide ? ' · ' + t.wideCurve : ''}`,
          ride.source !== 'route' ? `${fmtTime(c.t, lang)} · ${fmtSpeed(c.avgSpeed, units)} ${speedUnit(units)}` : '',
          mtr.leanDeg != null && ride.source !== 'route' ? `${t.leanApprox} ${Math.round(mtr.leanDeg)}°` : '',
          conf ? `${t.confidence}: ${conf}` : '',
        ]
          .filter(Boolean)
          .join('<br>');
        const cm = L.circleMarker([c.lat, c.lon], {
          radius: 9,
          color: '#fff',
          weight: 3,
          fillColor: c.dir === 'L' ? '#2f6fe0' : '#d6531a',
          fillOpacity: c.confidence != null && c.confidence < 0.4 ? 0.55 : 1,
        })
          .bindPopup(html)
          .addTo(m);
        curveLayers.current.set(c.t, cm);
      });
    }
    if (bounds.isValid()) m.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    else m.setView([48, 11], 5);
    // the container may get its size later (sheet animation)
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [ride, fixes, lines, interactive, t, units, lang]);

  useEffect(() => {
    if (!focus || !map.current) return;
    map.current.setView([focus.lat, focus.lon], Math.max(map.current.getZoom(), 16), { animate: true });
    curveLayers.current.get(focus.t)?.openPopup();
  }, [focus]);

  return <div ref={el} className={`ride-map ${interactive ? '' : 'static'} ${className}`} data-noswipe role="application" aria-label={t.map} />;
}

export function MapSheet({ ride, lines, title, onClose }: { ride?: Ride | null; lines?: MapLine[]; title?: string; onClose: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const [focus, setFocus] = useState<Curve | null>(null);
  const curves = ride?.curves ?? [];
  return (
    <Sheet title={title ?? (ride ? (rideName(ride) ?? fmtDate(ride.startedAt, lang)) : t.map)} onClose={onClose} full>
      <RideMap ride={ride} lines={lines} focus={focus} className="map-full" />
      {curves.length > 0 && (
        <div className="curve-chips" aria-label={t.curveList}>
          {curves.map((c, i) => (
            <button key={c.t} className={`chip ${c.dir === 'L' ? 'chip-l' : 'chip-r'}`} onClick={() => setFocus({ ...c })}>
              {i + 1}. {c.dir === 'L' ? '↰' : '↱'} {c.angle}°
            </button>
          ))}
        </div>
      )}
      <p className="hint">{t.mapHint}</p>
    </Sheet>
  );
}
