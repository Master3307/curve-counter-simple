/**
 * Tuning report: runs the full analysis over every GPX file in test-data/gpx-files and prints
 * the curves it finds. test-data/ is private (gitignored), so this does nothing in CI.
 *   pnpm exec vitest run scripts/gpx-report.test.ts            (SENS=few|normal|many)
 * With REPORT_OUT=<dir> it also writes <file>.json (track + curves) for map rendering.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeTrack } from '../src/logic/analyze';
import { parseGpx, prepareImport } from '../src/logic/gpx';
import type { Sensitivity } from '../src/logic/curves';

const dir = join(__dirname, '..', 'test-data', 'gpx-files');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.gpx')) : [];
const sens = (process.env.SENS as Sensitivity) ?? 'normal';

describe.skipIf(!files.length)('GPX tuning report', () => {
  for (const f of files) {
    it(f, () => {
      const prep = prepareImport(parseGpx(readFileSync(join(dir, f), 'utf8')));
      const a = analyzeTrack(prep.fixes, sens);
      const t0 = prep.fixes[0].t;
      const lines = a.curves.map(
        (c, i) =>
          `${String(i + 1).padStart(3)} ${c.dir} ${String(c.angle).padStart(4)}° ${String(c.lengthM ?? '').padStart(5)}m ` +
          `${((c.t - t0) / 60000).toFixed(1).padStart(6)}min ${(c.minSpeed * 3.6).toFixed(0).padStart(4)}km/h ` +
          `${c.lat.toFixed(5)},${c.lon.toFixed(5)}${c.wide ? ' wide' : ''}${c.confidence != null ? ` conf ${c.confidence.toFixed(2)}` : ''}` +
          `${c.kind ? ` ${c.kind}` : ''}`,
      );
      console.log(
        `\n=== ${f} (${prep.kind}, ${prep.quality}) ${(a.distanceM / 1000).toFixed(1)} km · L ${a.left} R ${a.right} · ${sens}\n` +
          lines.join('\n'),
      );
      if (process.env.REPORT_OUT) {
        const track = prep.fixes.map((x) => [x.lat, x.lon, x.speed]);
        const curves = a.curves.map((c) => ({
          ...c,
          seg: prep.fixes.filter((x) => x.t >= c.t && x.t <= (c.endT ?? c.t)).map((x) => [x.lat, x.lon]),
        }));
        writeFileSync(join(process.env.REPORT_OUT, `${f}.json`), JSON.stringify({ track, curves }));
      }
    });
  }
});
