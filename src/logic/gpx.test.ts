import { analyzeTrack } from './analyze';
import { fileHash, GpxError, overlaps, parseGpx, prepareImport, writeGpx } from './gpx';
import { simulate, type Leg } from './simulate';

const LEGS: Leg[] = [
  { kind: 'straight', length: 400, speedKmh: 60 },
  { kind: 'arc', radius: 80, angle: 70, speedKmh: 55 },
  { kind: 'straight', length: 250, speedKmh: 60 },
  { kind: 'arc', radius: 60, angle: -90, speedKmh: 50 },
  { kind: 'straight', length: 300, speedKmh: 60 },
  { kind: 'arc', radius: 25, angle: -150, speedKmh: 25 },
  { kind: 'straight', length: 300, speedKmh: 60 },
];
const FIXES = simulate(LEGS, { noise: 1, seed: 4, t0: Date.UTC(2026, 5, 1, 9) }).map((f, i) => ({ ...f, alt: 500 + i * 0.2 }));

describe('GPX', () => {
  it('export → import gives the same ride', () => {
    const a = analyzeTrack(FIXES, 'normal');
    const xml = writeGpx({ name: 'Test & <ride>', startedAt: FIXES[0].t, left: a.left, right: a.right, distanceM: a.distanceM, curves: a.curves }, FIXES);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('Test &amp; &lt;ride&gt;');
    expect(xml).toContain('<type>curve</type>');
    const parsed = parseGpx(xml);
    expect(parsed.name).toBe('Test & <ride>');
    expect(parsed.creator).toBe('Simple Curve Counter');
    const prep = prepareImport(parsed);
    expect(prep.kind).toBe('ride');
    expect(prep.quality).toBe('good');
    expect(prep.fixes).toHaveLength(FIXES.length);
    expect(prep.fixes[10].alt).toBeCloseTo(FIXES[10].alt!, 1);
    const b = analyzeTrack(prep.fixes, 'normal');
    expect([b.left, b.right]).toEqual([a.left, a.right]);
    expect(Math.abs(b.distanceM - a.distanceM)).toBeLessThan(5);
  });

  it('a planned route (no times) still gets its curves counted', () => {
    const pts = FIXES.filter((_, i) => i % 3 === 0)
      .map((f) => `<rtept lat="${f.lat}" lon="${f.lon}"/>`)
      .join('');
    const prep = prepareImport(parseGpx(`<gpx version="1.1"><rte><name>Tour</name>${pts}</rte></gpx>`));
    expect(prep.kind).toBe('route');
    const a = analyzeTrack(prep.fixes, 'normal');
    expect(a.left).toBe(2);
    expect(a.right).toBe(1);
  });

  it('few track points: marked approximate, curves still found', () => {
    const sparse = FIXES.filter((_, i) => i % 8 === 0);
    const pts = sparse.map((f) => `<trkpt lat="${f.lat}" lon="${f.lon}"><time>${new Date(f.t).toISOString()}</time></trkpt>`).join('\n');
    const prep = prepareImport(parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`));
    expect(prep.quality).toBe('approx');
    const a = analyzeTrack(prep.fixes, 'normal');
    expect(a.left + a.right).toBeGreaterThanOrEqual(2);
  });

  it('reads GPX 1.0 with namespace prefixes, several segments, missing height', () => {
    const seg = (fs: typeof FIXES) =>
      `<gpx:trkseg>${fs.map((f) => `<gpx:trkpt lon='${f.lon}' lat='${f.lat}'><gpx:time>${new Date(f.t).toISOString()}</gpx:time></gpx:trkpt>`).join('')}</gpx:trkseg>`;
    const xml = `<?xml version="1.0"?><gpx:gpx version="1.0" creator="BMW Motorrad Connected" xmlns:gpx="http://www.topografix.com/GPX/1/0"><gpx:trk>${seg(FIXES.slice(0, 50))}${seg(FIXES.slice(50))}</gpx:trk></gpx:gpx>`;
    const p = parseGpx(xml);
    expect(p.segments).toHaveLength(2);
    expect(p.creator).toBe('BMW Motorrad Connected');
    expect(p.segments[0][0].ele).toBeNull();
    expect(prepareImport(p).fixes.length).toBeGreaterThanOrEqual(FIXES.length);
  });

  it('broken files give a clear error, not a crash', () => {
    expect(() => parseGpx('hello')).toThrow(GpxError);
    expect(() => parseGpx('<gpx><trk></trk></gpx>')).toThrow(GpxError);
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="999" lon="x"/></trkseg></trk></gpx>')).toThrow(GpxError);
    // random garbage never throws anything but GpxError
    for (let i = 0; i < 200; i++) {
      const junk = '<gpx><trkseg>' + Array.from({ length: 50 }, () => String.fromCharCode(32 + ((i * 7919 + Math.random() * 90) | 0) % 90)).join('') + '<trkpt lat="1" lon="2">';
      try {
        prepareImport(parseGpx(junk));
      } catch (e) {
        expect(e).toBeInstanceOf(GpxError);
      }
    }
  });

  it('recognises the same file and overlapping rides', () => {
    expect(fileHash('abc')).toBe(fileHash('abc'));
    expect(fileHash('abc')).not.toBe(fileHash('abd'));
    expect(overlaps({ startedAt: 0, endedAt: 100 }, { startedAt: 20, endedAt: 110 })).toBe(true);
    expect(overlaps({ startedAt: 0, endedAt: 100 }, { startedAt: 90, endedAt: 300 })).toBe(false);
  });
});
