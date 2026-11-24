import { analyzeTrack } from './analyze';
import { detectFormat, parseAny, parseCsv, parseGeoJson, parseKml, unzip, writeFormat, zip, FORMATS } from './formats';
import { prepareImport } from './gpx';
import { simulate } from './simulate';

const FIXES = simulate(
  [
    { kind: 'straight', length: 400, speedKmh: 60 },
    { kind: 'arc', radius: 80, angle: 70, speedKmh: 55 },
    { kind: 'straight', length: 250, speedKmh: 60 },
    { kind: 'arc', radius: 60, angle: -90, speedKmh: 50 },
    { kind: 'straight', length: 300, speedKmh: 60 },
  ],
  { noise: 1, seed: 4, t0: Date.UTC(2026, 5, 1, 9) },
).map((f, i) => ({ ...f, alt: 400 + i * 0.1 }));
const A = analyzeTrack(FIXES, 'normal');
const RIDE = { name: 'Test', startedAt: FIXES[0].t, left: A.left, right: A.right, distanceM: A.distanceM, curves: A.curves };
const bytes = (x: string | Uint8Array) => (typeof x === 'string' ? new TextEncoder().encode(x) : x);

describe('file formats', () => {
  it.each(FORMATS)('%s: export → import keeps the track and its curves', async (fmt) => {
    const out = writeFormat(fmt, RIDE, FIXES);
    const parsed = await parseAny(`ride.${fmt}`, bytes(out));
    const prep = prepareImport(parsed);
    const b = analyzeTrack(prep.fixes, 'normal');
    expect([b.left, b.right]).toEqual([A.left, A.right]);
    expect(Math.abs(b.distanceM - A.distanceM) / A.distanceM).toBeLessThan(0.03);
    // KML LineStrings have no times → read back as a planned route
    expect(prep.kind).toBe(fmt === 'kml' || fmt === 'kmz' ? 'route' : 'ride');
  });

  it('detects formats by content, not only by name', () => {
    expect(detectFormat('x.txt', bytes('<?xml version="1.0"?><gpx>'))).toBe('gpx');
    expect(detectFormat('x', bytes('<kml xmlns="http://www.opengis.net/kml/2.2">'))).toBe('kml');
    expect(detectFormat('x', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('kmz');
    expect(detectFormat('x.json', bytes('{"type":"FeatureCollection"}'))).toBe('geojson');
    expect(detectFormat('points.txt', bytes('latitude,longitude\n1,2'))).toBe('csv');
  });

  it('zip round trip', async () => {
    const files = await unzip(zip([{ name: 'a.txt', data: bytes('hello') }, { name: 'ü.kml', data: bytes('<kml/>') }]));
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'ü.kml']);
    expect(new TextDecoder().decode(files[0].data)).toBe('hello');
  });

  it('reads a Google My Maps style KML (LineString + points in folders)', () => {
    const p = parseKml(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Alpen 2026</name>
      <Folder><name>Ebene 1</name>
      <Placemark><name>Strecke</name><LineString><tessellate>1</tessellate><coordinates>
        11.0,47.0,0 11.001,47.0,0 11.002,47.001,0
      </coordinates></LineString></Placemark>
      <Placemark><name>Kaffee</name><description><![CDATA[Gute <b>Kuchen</b>]]></description><Point><coordinates>11.002,47.001,0</coordinates></Point></Placemark>
      </Folder></Document></kml>`);
    expect(p.name).toBe('Alpen 2026');
    expect(p.segments[0]).toHaveLength(3);
    expect(p.waypoints).toEqual([expect.objectContaining({ name: 'Kaffee', desc: 'Gute Kuchen' })]);
  });

  it('reads a gx:Track with times (Google Earth)', () => {
    const p = parseKml(`<kml><Document><Placemark><gx:Track>
      <when>2026-06-01T09:00:00Z</when><when>2026-06-01T09:00:01Z</when>
      <gx:coord>11 47 500</gx:coord><gx:coord>11.0001 47 501</gx:coord></gx:Track></Placemark></Document></kml>`);
    expect(p.segments[0][1].t).toBe(Date.UTC(2026, 5, 1, 9, 0, 1));
    expect(p.segments[0][1].ele).toBe(501);
  });

  it('reads CSV with German separators and column names', () => {
    const p = parseCsv('Zeit;Breite;Länge;Höhe;Tempo km/h\n2026-06-01T09:00:00Z;47,5;11,25;600;36\n2026-06-01T09:00:01Z;47,5001;11,25;601;36\n2026-06-01T09:00:02Z;47,5002;11,25;602;36');
    expect(p.segments[0][0]).toMatchObject({ lat: 47.5, lon: 11.25, ele: 600 });
    expect(p.segments[0][0].speed).toBeCloseTo(10);
  });

  it('reads GeoJSON MultiLineString and ignores our own curve points', () => {
    const p = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { name: 'Tour' }, geometry: { type: 'MultiLineString', coordinates: [[[11, 47], [11.001, 47]], [[11.002, 47], [11.003, 47]]] } },
          { type: 'Feature', properties: { kind: 'curve' }, geometry: { type: 'Point', coordinates: [11, 47] } },
          { type: 'Feature', properties: { name: 'Pass' }, geometry: { type: 'Point', coordinates: [11.003, 47] } },
        ],
      }),
    );
    expect(p.segments).toHaveLength(2);
    expect(p.waypoints?.map((w) => w.name)).toEqual(['Pass']);
  });

  it('broken files give a clear error, never a crash', async () => {
    await expect(parseAny('x.kml', bytes('<kml><Document/></kml>'))).rejects.toThrow();
    await expect(parseAny('x.geojson', bytes('{oops'))).rejects.toThrow();
    await expect(parseAny('x.bin', new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
