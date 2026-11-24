/**
 * GPX export and import (plan 1.12 A/B). Pure functions, no dependencies, same code in the
 * WebView and in tests.
 *
 * Export: GPX 1.1, track points with time / height / speed, curves as waypoints ("↱ 87°") so
 * other apps show them on the map, plus our own extensions with the curve list, totals and the
 * extra sensor data (accuracy, Doppler course, gyroscope, phone tilt) so a re-import is lossless.
 * Import: tolerant parser (GPX 1.0 / 1.1, several tracks and segments, routes, missing height
 * or time, namespace prefixes). Broken files → clear error, never a crash. Everything else a file
 * carries (heart rate, cadence, temperature, power, description, author, waypoints) is kept as
 * "extras" and shown in the ride details.
 *
 * `ParsedGpx` is also what the KML / KMZ / CSV / GeoJSON readers (formats.ts) produce, so every
 * format goes through the same `prepareImport`.
 */
import type { Curve } from './curves';
import { distance, type Fix } from './geo';

export const SCC_NS = 'https://github.com/Master3307/curve-counter-simple/gpx/1';
/** older files (v0.x) used this namespace and creator */
export const CREATORS = ['Curve Counter Simple', 'Simple Curve Counter'];
export const APP_CREATOR = CREATORS[0];

export interface GpxRide {
  name: string;
  startedAt: number;
  left: number;
  right: number;
  distanceM: number;
  curves: Curve[];
}

export interface ExportOptions {
  /** curves as waypoints + curve list (default true) */
  curves?: boolean;
  /** accuracy, course, gyroscope, tilt per point (default true) */
  sensors?: boolean;
  /** time stamps (default true; off = only the shape of the route, more private) */
  times?: boolean;
  /** height (default true) */
  height?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (t: number) => new Date(t).toISOString();
const r = (v: number, d: number) => Number(v.toFixed(d));

export function writeGpx(ride: GpxRide, fixes: Fix[], opts: ExportOptions = {}): string {
  const { curves = true, sensors = true, times = true, height = true } = opts;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<gpx version="1.1" creator="${APP_CREATOR}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:scc="${SCC_NS}" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`,
  );
  out.push(`  <metadata><name>${esc(ride.name)}</name>${times ? `<time>${iso(ride.startedAt)}</time>` : ''}</metadata>`);
  if (curves) {
    for (const c of ride.curves) {
      out.push(
        `  <wpt lat="${r(c.lat, 7)}" lon="${r(c.lon, 7)}">${times ? `<time>${iso(c.t)}</time>` : ''}<name>${c.dir === 'L' ? '↰' : '↱'} ${c.angle}°</name><type>curve</type></wpt>`,
      );
    }
  }
  out.push(`  <trk><name>${esc(ride.name)}</name>`);
  if (curves) {
    out.push('    <extensions>');
    out.push(`      <scc:ride left="${ride.left}" right="${ride.right}" distance="${Math.round(ride.distanceM)}">`);
    for (const c of ride.curves) {
      const extra =
        (c.lengthM ? ` length="${c.lengthM}"` : '') +
        (c.confidence != null ? ` confidence="${c.confidence}"` : '') +
        (c.leanDeg != null ? ` lean="${c.leanDeg}"` : '') +
        (c.wide ? ' wide="1"' : '');
      out.push(
        `        <scc:curve ${times ? `t="${iso(c.t)}" ` : ''}dir="${c.dir}" angle="${c.angle}" lat="${r(c.lat, 7)}" lon="${r(c.lon, 7)}" entry="${r(c.entrySpeed, 2)}" min="${r(c.minSpeed, 2)}" avg="${r(c.avgSpeed, 2)}" exit="${r(c.exitSpeed, 2)}"${extra}/>`,
      );
    }
    out.push('      </scc:ride>');
    out.push('    </extensions>');
  }
  out.push('    <trkseg>');
  for (const f of fixes) {
    const ele = height && f.alt != null && Number.isFinite(f.alt) ? `<ele>${r(f.alt, 1)}</ele>` : '';
    const ext: string[] = [];
    if (times && f.speed != null) ext.push(`<scc:speed>${r(f.speed, 2)}</scc:speed>`);
    if (sensors) {
      ext.push(`<scc:acc>${r(f.accuracy, 1)}</scc:acc>`);
      if (f.bearing != null) ext.push(`<scc:course>${r(f.bearing, 1)}</scc:course>`);
      if (f.yaw != null) ext.push(`<scc:yaw>${r(f.yaw, 3)}</scc:yaw>`);
      if (f.g) ext.push(`<scc:g>${f.g.map((v) => r(v, 4)).join(' ')}</scc:g>`);
    }
    const extensions = ext.length ? `<extensions>${ext.join('')}</extensions>` : '';
    out.push(`      <trkpt lat="${r(f.lat, 7)}" lon="${r(f.lon, 7)}">${ele}${times ? `<time>${iso(f.t)}</time>` : ''}${extensions}</trkpt>`);
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
  /** from our own export, or from <hdop> (≈ hdop · 5 m) */
  acc?: number | null;
  course?: number | null;
  yaw?: number | null;
  g?: [number, number, number] | null;
  /** fitness / sensor data other apps write (Garmin TrackPointExtension etc.) */
  hr?: number | null;
  cad?: number | null;
  temp?: number | null;
  power?: number | null;
}

export interface Waypoint {
  lat: number;
  lon: number;
  name: string | null;
  desc: string | null;
  t: number | null;
  type: string | null;
}

export interface ParsedGpx {
  name: string | null;
  creator: string | null;
  /** track segments (or routes), each a list of points */
  segments: ParsedPoint[][];
  desc?: string | null;
  author?: string | null;
  link?: string | null;
  keywords?: string | null;
  /** activity type the file names (e.g. "motorcycling", "driving") */
  type?: string | null;
  /** waypoints that are not our own curve markers */
  waypoints?: Waypoint[];
  /** which file format it came from */
  format?: 'gpx' | 'kml' | 'kmz' | 'csv' | 'geojson';
}

export class GpxError extends Error {}

export const ATTR = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : null;
};
export const unesc = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
/** text of the first <name>…</name> child (any namespace prefix) */
export const child = (body: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(body);
  return m ? unesc(m[1]) : null;
};
const numChild = (body: string, ...names: string[]) => {
  for (const n of names) {
    const v = child(body, n);
    if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
};
/** strips HTML that some apps put into descriptions */
const plain = (s: string | null) => (s == null ? null : s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null);

function point(open: string, body: string): ParsedPoint | null {
  const lat = Number(ATTR(open, 'lat'));
  const lon = Number(ATTR(open, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const timeS = child(body, 'time');
  const t = timeS ? Date.parse(timeS) : NaN;
  const hdop = numChild(body, 'hdop');
  const gS = child(body, 'g');
  const g = gS ? gS.split(/\s+/).map(Number) : null;
  return {
    lat,
    lon,
    ele: numChild(body, 'ele'),
    t: Number.isFinite(t) ? t : null,
    speed: numChild(body, 'speed'),
    acc: numChild(body, 'acc') ?? (hdop != null ? Math.max(3, hdop * 5) : null),
    course: numChild(body, 'course'),
    yaw: numChild(body, 'yaw'),
    g: g && g.length === 3 && g.every(Number.isFinite) ? (g as [number, number, number]) : null,
    hr: numChild(body, 'hr', 'heartrate'),
    cad: numChild(body, 'cad', 'cadence'),
    temp: numChild(body, 'atemp', 'temp', 'wtemp'),
    power: numChild(body, 'power', 'PowerInWatts'),
  };
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

  // waypoints (not our own curve markers)
  const waypoints: Waypoint[] = [];
  const wptRe = /(<(?:\w+:)?wpt\b[^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?wpt>)/gi;
  let wm: RegExpExecArray | null;
  while ((wm = wptRe.exec(xml)) && waypoints.length < 500) {
    const body = wm[2] ?? '';
    const type = child(body, 'type');
    if (type === 'curve') continue;
    const lat = Number(ATTR(wm[1], 'lat'));
    const lon = Number(ATTR(wm[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ts = child(body, 'time');
    const t = ts ? Date.parse(ts) : NaN;
    waypoints.push({ lat, lon, name: plain(child(body, 'name')), desc: plain(child(body, 'desc') ?? child(body, 'cmt')), t: Number.isFinite(t) ? t : null, type });
  }

  const meta = child(xml, 'metadata') ?? '';
  const trk = child(xml, 'trk') ?? child(xml, 'rte') ?? '';
  const authorBlock = child(meta, 'author');
  const linkTag = /<(?:\w+:)?link\b[^>]*>/i.exec(meta);
  return {
    name: (meta && child(meta, 'name')) ?? child(xml, 'name'),
    creator: ATTR(gpxTag, 'creator'),
    segments,
    desc: plain(child(meta, 'desc') ?? child(trk, 'desc')),
    author: plain(authorBlock ? (child(authorBlock, 'name') ?? authorBlock) : null),
    link: linkTag ? ATTR(linkTag[0], 'href') : null,
    keywords: plain(child(meta, 'keywords')),
    type: plain(child(trk, 'type')),
    waypoints,
    format: 'gpx',
  };
}

export type ImportKind = 'ride' | 'route';

/** Everything a file carried beyond the track itself, summarised for the ride details. */
export interface RideExtras {
  format?: string;
  desc?: string;
  author?: string;
  link?: string;
  keywords?: string;
  type?: string;
  waypoints?: Waypoint[];
  hr?: { avg: number; max: number };
  cad?: { avg: number; max: number };
  temp?: { min: number; max: number; avg: number };
  power?: { avg: number; max: number };
}

export interface PreparedImport {
  kind: ImportKind;
  /** 'approx' = few points, curves are approximate */
  quality: 'good' | 'approx';
  fixes: Fix[];
  name: string | null;
  creator: string | null;
  extras: RideExtras;
}

/** assumed speed for planned routes (no times), m/s */
const ROUTE_SPEED = 60 / 3.6;

function range(values: (number | null | undefined)[]) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 3) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return { min: Math.min(...v), max: Math.max(...v), avg: Math.round(avg * 10) / 10 };
}

export function extrasOf(p: ParsedGpx): RideExtras {
  const all = p.segments.flat();
  const e: RideExtras = { format: p.format ?? 'gpx' };
  if (p.desc) e.desc = p.desc;
  if (p.author) e.author = p.author;
  if (p.link) e.link = p.link;
  if (p.keywords) e.keywords = p.keywords;
  if (p.type) e.type = p.type;
  if (p.waypoints?.length) e.waypoints = p.waypoints;
  const hr = range(all.map((x) => x.hr));
  if (hr) e.hr = { avg: Math.round(hr.avg), max: hr.max };
  const cad = range(all.map((x) => x.cad));
  if (cad) e.cad = { avg: Math.round(cad.avg), max: cad.max };
  const temp = range(all.map((x) => x.temp));
  if (temp) e.temp = temp;
  const power = range(all.map((x) => x.power));
  if (power) e.power = { avg: Math.round(power.avg), max: power.max };
  return e;
}

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
      const f: Fix = {
        t,
        lat: pt.lat,
        lon: pt.lon,
        speed: kind === 'route' ? ROUTE_SPEED : pt.speed,
        accuracy: pt.acc ?? 5,
        alt: pt.ele,
      };
      if (kind === 'ride') {
        if (pt.course != null) f.bearing = pt.course;
        if (pt.yaw != null) f.yaw = pt.yaw;
        if (pt.g) f.g = pt.g;
      }
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
              accuracy: f.accuracy,
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
  return { kind, quality: pairs && sparse / pairs > 0.2 ? 'approx' : 'good', fixes, name: p.name, creator: p.creator, extras: extrasOf(p) };
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
