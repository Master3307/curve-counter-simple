/**
 * GPX export and import (plan 1.12 A/B). Pure functions, no dependencies, same code in the
 * WebView and in tests.
 *
 * Export: GPX 1.1, track points with time / height / speed, curves as waypoints ("↱ 87°") so
 * other apps show them on the map, plus our own extensions with the curve list and totals.
 * Import: tolerant parser (GPX 1.0 / 1.1, several tracks and segments, routes, missing height
 * or time, namespace prefixes). Broken files → clear error, never a crash.
 *
 * TODO(plan 1.12): validate the export against the GPX 1.1 XSD in CI; FIT and CSV export.
 */
import type { Curve } from './curves';
import { distance, type Fix } from './geo';

export const SCC_NS = 'https://github.com/Master3307/simple-curve-counter/gpx/1';

export interface GpxRide {
  name: string;
  startedAt: number;
  left: number;
  right: number;
  distanceM: number;
  curves: Curve[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (t: number) => new Date(t).toISOString();
const r = (v: number, d: number) => Number(v.toFixed(d));

export function writeGpx(ride: GpxRide, fixes: Fix[]): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<gpx version="1.1" creator="Simple Curve Counter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:scc="${SCC_NS}" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`,
  );
  out.push(`  <metadata><name>${esc(ride.name)}</name><time>${iso(ride.startedAt)}</time></metadata>`);
  for (const c of ride.curves) {
    out.push(
      `  <wpt lat="${r(c.lat, 7)}" lon="${r(c.lon, 7)}"><time>${iso(c.t)}</time><name>${c.dir === 'L' ? '↰' : '↱'} ${c.angle}°</name><type>curve</type></wpt>`,
    );
  }
  out.push(`  <trk><name>${esc(ride.name)}</name>`);
  out.push('    <extensions>');
  out.push(`      <scc:ride left="${ride.left}" right="${ride.right}" distance="${Math.round(ride.distanceM)}">`);
  for (const c of ride.curves) {
    out.push(
      `        <scc:curve t="${iso(c.t)}" dir="${c.dir}" angle="${c.angle}" entry="${r(c.entrySpeed, 2)}" min="${r(c.minSpeed, 2)}" avg="${r(c.avgSpeed, 2)}" exit="${r(c.exitSpeed, 2)}"${c.lengthM ? ` length="${c.lengthM}"` : ''}/>`,
    );
  }
  out.push('      </scc:ride>');
  out.push('    </extensions>');
  out.push('    <trkseg>');
  for (const f of fixes) {
    const ele = f.alt != null && Number.isFinite(f.alt) ? `<ele>${r(f.alt, 1)}</ele>` : '';
    const speed = f.speed != null ? `<extensions><scc:speed>${r(f.speed, 2)}</scc:speed></extensions>` : '';
    out.push(`      <trkpt lat="${r(f.lat, 7)}" lon="${r(f.lon, 7)}">${ele}<time>${iso(f.t)}</time>${speed}</trkpt>`);
  }
  out.push('    </trkseg>');
  out.push('  </trk>');
  out.push('</gpx>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// import

export interface ParsedPoint {
  lat: number;
  lon: number;
  ele: number | null;
  t: number | null;
  speed: number | null;
}

export interface ParsedGpx {
  name: string | null;
  creator: string | null;
  /** track segments (or routes), each a list of points */
  segments: ParsedPoint[][];
}

export class GpxError extends Error {}

const ATTR = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : null;
};
const unesc = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
/** text of the first <name>…</name> child (any namespace prefix) */
const child = (body: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(body);
  return m ? unesc(m[1]) : null;
};

function point(open: string, body: string): ParsedPoint | null {
  const lat = Number(ATTR(open, 'lat'));
  const lon = Number(ATTR(open, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const eleS = child(body, 'ele');
  const timeS = child(body, 'time');
  const speedS = child(body, 'speed');
  const ele = eleS != null && eleS !== '' && Number.isFinite(Number(eleS)) ? Number(eleS) : null;
  const t = timeS ? Date.parse(timeS) : NaN;
  const speed = speedS != null && Number.isFinite(Number(speedS)) ? Number(speedS) : null;
  return { lat, lon, ele, t: Number.isFinite(t) ? t : null, speed };
}

export function parseGpx(xml: string): ParsedGpx {
  if (typeof xml !== 'string' || !/<(?:\w+:)?gpx\b/i.test(xml)) throw new GpxError('not a GPX file');
  const gpxTag = /<(?:\w+:)?gpx\b[^>]*>/i.exec(xml)![0];
  const segments: ParsedPoint[][] = [];
  // track segments first; if there are none, routes (a planned tour)
  for (const kind of [
    { seg: 'trkseg', pt: 'trkpt' },
    { seg: 'rte', pt: 'rtept' },
  ]) {
    const segRe = new RegExp(`<(?:\\w+:)?${kind.seg}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${kind.seg}>`, 'gi');
    let sm: RegExpExecArray | null;
    while ((sm = segRe.exec(xml))) {
      const pts: ParsedPoint[] = [];
      const ptRe = new RegExp(`(<(?:\\w+:)?${kind.pt}\\b[^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${kind.pt}>)`, 'gi');
      let pm: RegExpExecArray | null;
      while ((pm = ptRe.exec(sm[1]))) {
        const p = point(pm[1], pm[2] ?? '');
        if (p) pts.push(p);
      }
      if (pts.length) segments.push(pts);
    }
    if (segments.length) break;
  }
  if (!segments.length) throw new GpxError('no track points');
  const meta = child(xml, 'metadata');
  return {
    name: (meta && child(meta, 'name')) ?? child(xml, 'name'),
    creator: ATTR(gpxTag, 'creator'),
    segments,
  };
}

export type ImportKind = 'ride' | 'route';

export interface PreparedImport {
  kind: ImportKind;
  /** 'approx' = few points, curves are approximate */
  quality: 'good' | 'approx';
  fixes: Fix[];
  name: string | null;
  creator: string | null;
}

/** assumed speed for planned routes (no times), m/s */
const ROUTE_SPEED = 60 / 3.6;

/**
 * Turns a parsed file into fixes the normal analysis can run on.
 * - no timestamps → planned route: times are made up at 60 km/h so the curves can be counted
 * - few points (> 5 s or > 100 m apart) → quality 'approx'; short gaps are filled in a straight
 *   line so the detector doesn't treat every gap as a tunnel
 */
export function prepareImport(p: ParsedGpx): PreparedImport {
  const all = p.segments.flat();
  const timed = all.filter((x) => x.t != null).length;
  const kind: ImportKind = timed < all.length * 0.9 ? 'route' : 'ride';
  const fixes: Fix[] = [];
  let sparse = 0;
  let pairs = 0;

  let tRoute = Date.UTC(2000, 0, 1);
  for (const seg of p.segments) {
    let prev: Fix | null = null;
    for (const pt of seg) {
      let t: number;
      if (kind === 'route') {
        if (prev) tRoute += Math.max(1, (distance(prev, pt) / ROUTE_SPEED) * 1000);
        t = tRoute;
      } else {
        if (pt.t == null) continue;
        t = pt.t;
      }
      const f: Fix = { t, lat: pt.lat, lon: pt.lon, speed: kind === 'route' ? ROUTE_SPEED : pt.speed, accuracy: 5, alt: pt.ele };
      if (prev) {
        if (t <= prev.t) continue; // unsorted / duplicate time
        const d = distance(prev, f);
        const dt = (t - prev.t) / 1000;
        pairs++;
        if (dt > 5 || d > 100) sparse++;
        // fill short gaps (≤ 2 min, ≤ 2 km) with 1 s / ≤ 50 m steps
        if ((dt > 2 || d > 50) && dt <= 120 && d <= 2000) {
          const n = Math.min(240, Math.max(Math.ceil(dt), Math.ceil(d / 50)));
          for (let i = 1; i < n; i++) {
            const k = i / n;
            fixes.push({
              t: prev.t + (t - prev.t) * k,
              lat: prev.lat + (f.lat - prev.lat) * k,
              lon: prev.lon + (f.lon - prev.lon) * k,
              speed: kind === 'route' ? ROUTE_SPEED : null,
              accuracy: 5,
              alt: prev.alt != null && f.alt != null ? prev.alt + (f.alt - prev.alt) * k : null,
            });
          }
        }
      }
      fixes.push(f);
      prev = f;
    }
  }
  if (fixes.length < 2) throw new GpxError('no usable track points');
  return { kind, quality: pairs && sparse / pairs > 0.2 ? 'approx' : 'good', fixes, name: p.name, creator: p.creator };
}

/** Short content hash (FNV-1a 32 bit, hex) to recognise the same file imported twice. */
export function fileHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Two rides overlap in time by more than half of the shorter one. */
export function overlaps(a: { startedAt: number; endedAt: number | null }, b: { startedAt: number; endedAt: number | null }): boolean {
  const ae = a.endedAt ?? a.startedAt;
  const be = b.endedAt ?? b.startedAt;
  const inter = Math.min(ae, be) - Math.max(a.startedAt, b.startedAt);
  const shorter = Math.min(ae - a.startedAt, be - b.startedAt);
  return shorter > 0 && inter > shorter / 2;
}
