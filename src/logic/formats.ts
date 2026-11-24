/**
 * All file formats the app reads and writes, besides GPX (gpx.ts):
 *
 * | Format  | Good for                                              | Write | Read |
 * | ------- | ----------------------------------------------------- | ----- | ---- |
 * | GPX     | almost every sport / navigation app (recommended)     |  ✓    |  ✓   |
 * | KML     | Google Earth, Google My Maps                          |  ✓    |  ✓   |
 * | KMZ     | the same, zipped (smaller; what My Maps exports)      |  ✓    |  ✓   |
 * | CSV     | Excel / Numbers / Google Sheets                        |  ✓    |  ✓   |
 * | GeoJSON | web maps, developers, geojson.io                      |  ✓    |  ✓   |
 *
 * Every reader returns the same `ParsedGpx` structure, so imports always go through the same
 * `prepareImport` and analysis. Pure functions, no dependencies (zip = own tiny writer/reader;
 * compressed zips are inflated with the platform's DecompressionStream).
 */
import type { Fix } from './geo';
import { ATTR, child, GpxError, parseGpx, writeGpx, type ExportOptions, type GpxRide, type ParsedGpx, type ParsedPoint, type Waypoint } from './gpx';

export type Format = 'gpx' | 'kml' | 'kmz' | 'csv' | 'geojson';
export const FORMATS: Format[] = ['gpx', 'kml', 'kmz', 'csv', 'geojson'];

export const MIME: Record<Format, string> = {
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  kmz: 'application/vnd.google-earth.kmz',
  csv: 'text/csv',
  geojson: 'application/geo+json',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (t: number) => new Date(t).toISOString();
const r = (v: number, d: number) => Number(v.toFixed(d));

// ---------------------------------------------------------------------------------------------
// writers

export function writeKml(ride: GpxRide, fixes: Fix[], opts: ExportOptions = {}): string {
  const { curves = true, times = true, height = true } = opts;
  const coord = (f: Fix) => `${r(f.lon, 7)},${r(f.lat, 7)}${height && f.alt != null ? `,${r(f.alt, 1)}` : ''}`;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  out.push(`<Document><name>${esc(ride.name)}</name>`);
  out.push('<Style id="track"><LineStyle><color>ff2a8cf2</color><width>5</width></LineStyle></Style>');
  out.push('<Style id="left"><IconStyle><color>ffd05b1c</color></IconStyle></Style>');
  out.push('<Style id="right"><IconStyle><color>ff0c48c8</color></IconStyle></Style>');
  out.push(`<Placemark><name>${esc(ride.name)}</name>`);
  out.push(`<description>↰ ${ride.left} · ${ride.right} ↱ · ${r(ride.distanceM / 1000, 1)} km</description>`);
  if (times && fixes.length) out.push(`<TimeSpan><begin>${iso(fixes[0].t)}</begin><end>${iso(fixes[fixes.length - 1].t)}</end></TimeSpan>`);
  out.push(`<styleUrl>#track</styleUrl><LineString><tessellate>1</tessellate>${height ? '<altitudeMode>clampToGround</altitudeMode>' : ''}<coordinates>`);
  out.push(fixes.map(coord).join(' '));
  out.push('</coordinates></LineString></Placemark>');
  if (curves) {
    out.push('<Folder><name>Curves</name>');
    for (const c of ride.curves) {
      out.push(
        `<Placemark><name>${c.dir === 'L' ? '↰' : '↱'} ${c.angle}°</name>${times ? `<TimeStamp><when>${iso(c.t)}</when></TimeStamp>` : ''}<styleUrl>#${c.dir === 'L' ? 'left' : 'right'}</styleUrl><Point><coordinates>${r(c.lon, 7)},${r(c.lat, 7)}</coordinates></Point></Placemark>`,
      );
    }
    out.push('</Folder>');
  }
  out.push('</Document></kml>');
  return out.join('\n') + '\n';
}

export function writeCsv(ride: GpxRide, fixes: Fix[], opts: ExportOptions = {}): string {
  const { times = true, height = true, sensors = true } = opts;
  const head = ['lat', 'lon'];
  if (times) head.unshift('time');
  if (height) head.push('ele_m');
  if (times) head.push('speed_kmh');
  if (sensors) head.push('accuracy_m', 'course_deg', 'gyro_turn_deg');
  const lines = [head.join(',')];
  for (const f of fixes) {
    const row: (string | number)[] = [r(f.lat, 7), r(f.lon, 7)];
    if (times) row.unshift(iso(f.t));
    if (height) row.push(f.alt != null ? r(f.alt, 1) : '');
    if (times) row.push(f.speed != null ? r(f.speed * 3.6, 1) : '');
    if (sensors) row.push(r(f.accuracy, 1), f.bearing != null ? r(f.bearing, 1) : '', f.yaw != null ? r(f.yaw, 2) : '');
    lines.push(row.join(','));
  }
  void ride;
  return lines.join('\n') + '\n';
}

export function writeGeoJson(ride: GpxRide, fixes: Fix[], opts: ExportOptions = {}): string {
  const { curves = true, times = true, height = true } = opts;
  const features: unknown[] = [
    {
      type: 'Feature',
      properties: {
        name: ride.name,
        left: ride.left,
        right: ride.right,
        distance_m: Math.round(ride.distanceM),
        ...(times ? { start: iso(ride.startedAt), coordTimes: fixes.map((f) => iso(f.t)) } : {}),
        ...(times ? { speeds_kmh: fixes.map((f) => (f.speed != null ? r(f.speed * 3.6, 1) : null)) } : {}),
      },
      geometry: {
        type: 'LineString',
        coordinates: fixes.map((f) => (height && f.alt != null ? [r(f.lon, 7), r(f.lat, 7), r(f.alt, 1)] : [r(f.lon, 7), r(f.lat, 7)])),
      },
    },
  ];
  if (curves) {
    for (const c of ride.curves) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'curve',
          name: `${c.dir === 'L' ? '↰' : '↱'} ${c.angle}°`,
          dir: c.dir,
          angle: c.angle,
          avg_speed_kmh: r(c.avgSpeed * 3.6, 1),
          ...(times ? { time: iso(c.t) } : {}),
        },
        geometry: { type: 'Point', coordinates: [r(c.lon, 7), r(c.lat, 7)] },
      });
    }
  }
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 1) + '\n';
}

/** Writes a ride in the given format: text for everything but KMZ (bytes). */
export function writeFormat(format: Format, ride: GpxRide, fixes: Fix[], opts: ExportOptions = {}): string | Uint8Array {
  switch (format) {
    case 'gpx':
      return writeGpx(ride, fixes, opts);
    case 'kml':
      return writeKml(ride, fixes, opts);
    case 'kmz':
      return zip([{ name: 'doc.kml', data: new TextEncoder().encode(writeKml(ride, fixes, opts)) }]);
    case 'csv':
      return writeCsv(ride, fixes, opts);
    case 'geojson':
      return writeGeoJson(ride, fixes, opts);
  }
}

// ---------------------------------------------------------------------------------------------
// zip (store only for writing; reading also inflates)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // stored
    v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new GpxError('cannot unzip on this device');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads all files of a zip (via the central directory). */
export async function unzip(buf: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new GpxError('not a zip file');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out: { name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// readers

/** "lon,lat[,alt] lon,lat[,alt] …" (KML) */
function kmlCoords(s: string): ParsedPoint[] {
  return s
    .trim()
    .split(/\s+/)
    .map((c) => c.split(',').map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90)
    .map((c) => ({ lat: c[1], lon: c[0], ele: c.length > 2 && Number.isFinite(c[2]) && c[2] !== 0 ? c[2] : null, t: null, speed: null }));
}

export function parseKml(xml: string): ParsedGpx {
  if (!/<(?:\w+:)?kml\b/i.test(xml)) throw new GpxError('not a KML file');
  const segments: ParsedPoint[][] = [];
  const waypoints: Waypoint[] = [];
  // gx:Track: <when> + <gx:coord> pairs (Google Earth, Google Timeline exports) → real times
  const trackRe = /<(?:\w+:)?Track\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Track>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = trackRe.exec(xml))) {
    const whens = [...tm[1].matchAll(/<when>([^<]+)<\/when>/gi)].map((m) => Date.parse(m[1]));
    const coords = [...tm[1].matchAll(/<(?:\w+:)?coord>([^<]+)<\/(?:\w+:)?coord>/gi)].map((m) => m[1].trim().split(/\s+/).map(Number));
    const pts: ParsedPoint[] = [];
    coords.forEach((c, i) => {
      if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        pts.push({ lat: c[1], lon: c[0], ele: c[2] != null && Number.isFinite(c[2]) ? c[2] : null, t: Number.isFinite(whens[i]) ? whens[i] : null, speed: null });
    });
    if (pts.length > 1) segments.push(pts);
  }
  // Placemarks: LineString → track, Point → waypoint
  const pmRe = /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pmRe.exec(xml))) {
    const body = pm[1];
    if (/<(?:\w+:)?Track\b/i.test(body)) continue;
    const lines = [...body.matchAll(/<(?:\w+:)?LineString\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    for (const l of lines) {
      const pts = kmlCoords(l[1]);
      if (pts.length > 1) segments.push(pts);
    }
    if (!lines.length) {
      const pt = /<(?:\w+:)?Point\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(body);
      if (pt) {
        const [p] = kmlCoords(pt[1]);
        const name = child(body, 'name');
        // our own curve markers are not waypoints
        if (p && !/^[↰↱] \d+°$/.test(name ?? '')) {
          const when = child(body, 'when');
          waypoints.push({ lat: p.lat, lon: p.lon, name, desc: child(body, 'description')?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null, t: when ? Date.parse(when) || null : null, type: null });
        }
      }
    }
  }
  if (!segments.length) throw new GpxError('no lines in KML');
  const doc = child(xml, 'Document') ?? xml;
  return { name: child(doc, 'name'), creator: null, segments, desc: child(doc, 'description'), waypoints, format: 'kml' };
}

/** Splits one CSV line (quotes allowed). */
function csvSplit(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): ParsedGpx {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new GpxError('CSV too short');
  const sep = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = csvSplit(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  const iLat = col(/^lat/, /breite/);
  const iLon = col(/^(lon|lng|long)/, /länge|laenge/);
  if (iLat < 0 || iLon < 0) throw new GpxError('CSV has no lat/lon columns');
  const iTime = col(/time|zeit|date|datum|timestamp/);
  const iEle = col(/^(ele|alt|höhe|hoehe|height)/);
  const iSpeed = col(/speed|tempo|geschw/);
  const kmh = iSpeed >= 0 && /km/.test(head[iSpeed]);
  const iAcc = col(/accuracy|genauigkeit/);
  const iCourse = col(/course|bearing|heading|kurs/);
  const num = (s: string | undefined) => {
    if (s == null || s === '') return null;
    const n = Number(s.replace(sep === ';' ? ',' : '\u0000', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const pts: ParsedPoint[] = [];
  for (const line of lines.slice(1)) {
    const c = csvSplit(line, sep);
    const lat = num(c[iLat]);
    const lon = num(c[iLon]);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    let t: number | null = null;
    if (iTime >= 0 && c[iTime]) {
      const raw = c[iTime];
      const n = Number(raw);
      t = Number.isFinite(n) ? (n > 1e11 ? n : n * 1000) : Date.parse(raw);
      if (!Number.isFinite(t)) t = null;
    }
    const sp = iSpeed >= 0 ? num(c[iSpeed]) : null;
    pts.push({
      lat,
      lon,
      ele: iEle >= 0 ? num(c[iEle]) : null,
      t,
      speed: sp == null ? null : kmh ? sp / 3.6 : sp,
      acc: iAcc >= 0 ? num(c[iAcc]) : null,
      course: iCourse >= 0 ? num(c[iCourse]) : null,
    });
  }
  if (pts.length < 2) throw new GpxError('no usable rows');
  return { name: null, creator: null, segments: [pts], format: 'csv' };
}

interface GeoFeature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

export function parseGeoJson(text: string): ParsedGpx {
  let json: { type?: string; features?: GeoFeature[]; geometry?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new GpxError('not JSON');
  }
  const features: GeoFeature[] =
    json.type === 'FeatureCollection' ? (json.features ?? []) : json.type === 'Feature' ? [json as GeoFeature] : [{ geometry: json as GeoFeature['geometry'] }];
  const segments: ParsedPoint[][] = [];
  const waypoints: Waypoint[] = [];
  let name: string | null = null;
  for (const f of features) {
    const g = f.geometry;
    const props = f.properties ?? {};
    if (!g) continue;
    const toPts = (coords: unknown, times?: unknown): ParsedPoint[] =>
      (Array.isArray(coords) ? coords : [])
        .filter((c): c is number[] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c, i) => {
          const tv = Array.isArray(times) ? times[i] : null;
          const t = typeof tv === 'string' ? Date.parse(tv) : typeof tv === 'number' ? (tv > 1e11 ? tv : tv * 1000) : NaN;
          return { lat: c[1], lon: c[0], ele: c.length > 2 && Number.isFinite(c[2]) ? c[2] : null, t: Number.isFinite(t) ? t : null, speed: null };
        });
    const cp = props.coordinateProperties as Record<string, unknown> | undefined;
    const times = props.coordTimes ?? props.times ?? cp?.times ?? cp?.coordTimes;
    if (g.type === 'LineString') {
      const pts = toPts(g.coordinates, times);
      if (pts.length > 1) segments.push(pts);
      if (!name && typeof props.name === 'string') name = props.name;
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      g.coordinates.forEach((line, i) => {
        const pts = toPts(line, Array.isArray(times) ? times[i] : undefined);
        if (pts.length > 1) segments.push(pts);
      });
      if (!name && typeof props.name === 'string') name = props.name;
    } else if (g.type === 'Point' && Array.isArray(g.coordinates) && props.kind !== 'curve') {
      const [p] = toPts([g.coordinates]);
      if (p) waypoints.push({ lat: p.lat, lon: p.lon, name: typeof props.name === 'string' ? props.name : null, desc: typeof props.description === 'string' ? props.description : null, t: null, type: null });
    }
  }
  if (!segments.length) throw new GpxError('no lines in GeoJSON');
  return { name, creator: null, segments, waypoints, format: 'geojson' };
}

/** Guesses the format from the file name and the first bytes. */
export function detectFormat(name: string, head: Uint8Array): Format | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b) return 'kmz';
  const text = new TextDecoder().decode(head.subarray(0, 2000)).replace(/^﻿/, '').trimStart();
  if (/<(?:\w+:)?gpx\b/i.test(text)) return 'gpx';
  if (/<(?:\w+:)?kml\b/i.test(text)) return 'kml';
  if (text.startsWith('{')) return 'geojson';
  if (ext === 'gpx' || ext === 'kml' || ext === 'kmz' || ext === 'csv' || ext === 'geojson') return ext;
  if (ext === 'json') return 'geojson';
  if (/^[^\n]*\b(lat|latitude)\b/i.test(text)) return 'csv';
  return null;
}

/** Reads any supported file. */
export async function parseAny(name: string, bytes: Uint8Array): Promise<ParsedGpx> {
  const format = detectFormat(name, bytes);
  const text = () => new TextDecoder().decode(bytes);
  switch (format) {
    case 'gpx':
      return parseGpx(text());
    case 'kml':
      return parseKml(text());
    case 'kmz': {
      const files = await unzip(bytes);
      const kml = files.find((f) => /\.kml$/i.test(f.name));
      if (!kml) throw new GpxError('no KML inside the KMZ');
      return { ...parseKml(new TextDecoder().decode(kml.data)), format: 'kmz' };
    }
    case 'csv':
      return parseCsv(text());
    case 'geojson':
      return parseGeoJson(text());
    default:
      throw new GpxError('unknown format');
  }
}

/** For the "Open with" filters and file pickers. */
export const IMPORT_ACCEPT = '.gpx,.kml,.kmz,.csv,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,text/csv,application/geo+json,application/json,application/octet-stream,text/xml,application/xml';

export { ATTR };
