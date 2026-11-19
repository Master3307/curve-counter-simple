import { CurveDetector, type Curve } from './curves';
import { simulate, type Leg } from './simulate';
import type { Fix } from './geo';

function run(fixes: Fix[], opts = {}): Curve[] {
  const d = new CurveDetector(opts);
  const out = fixes.flatMap((f) => d.push(f));
  return [...out, ...d.flush()];
}
const dirs = (c: Curve[]) => c.map((x) => x.dir).join('');

describe('CurveDetector', () => {
  it('counts nothing on a straight road', () => {
    expect(run(simulate([{ kind: 'straight', length: 3000, speedKmh: 90 }]))).toHaveLength(0);
  });

  it('counts nothing on a straight road with GPS noise', () => {
    expect(run(simulate([{ kind: 'straight', length: 3000, speedKmh: 70 }], { noise: 1.5, seed: 7 }))).toHaveLength(0);
  });

  it('counts one right curve', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 70 },
        { kind: 'arc', radius: 80, angle: 90, speedKmh: 60 },
        { kind: 'straight', length: 300, speedKmh: 70 },
      ]),
    );
    expect(dirs(c)).toBe('R');
    expect(c[0].angle).toBeGreaterThan(75);
    expect(c[0].angle).toBeLessThan(105);
    expect(c[0].avgSpeed * 3.6).toBeGreaterThan(50);
  });

  it('counts one left curve', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 70 },
        { kind: 'arc', radius: 120, angle: -70, speedKmh: 80 },
        { kind: 'straight', length: 300, speedKmh: 70 },
      ]),
    );
    expect(dirs(c)).toBe('L');
  });

  it('splits an S-bend into left then right', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 60 },
        { kind: 'arc', radius: 60, angle: -80, speedKmh: 55 },
        { kind: 'arc', radius: 60, angle: 80, speedKmh: 55 },
        { kind: 'straight', length: 300, speedKmh: 60 },
      ]),
    );
    expect(dirs(c)).toBe('LR');
  });

  it('works the same at high speed (fewer fixes per curve)', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 500, speedKmh: 130 },
        { kind: 'arc', radius: 400, angle: 45, speedKmh: 130 },
        { kind: 'straight', length: 500, speedKmh: 130 },
      ]),
    );
    expect(dirs(c)).toBe('R');
  });

  it('counts a hairpin as one curve', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 200, speedKmh: 50 },
        { kind: 'arc', radius: 15, angle: -170, speedKmh: 25 },
        { kind: 'straight', length: 200, speedKmh: 50 },
      ]),
    );
    expect(dirs(c)).toBe('L');
    expect(c[0].angle).toBeGreaterThan(140);
  });

  it('ignores slow junction turns', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 200, speedKmh: 40 },
        { kind: 'arc', radius: 10, angle: 90, speedKmh: 12 },
        { kind: 'straight', length: 200, speedKmh: 40 },
      ]),
    );
    expect(c).toHaveLength(0);
  });

  it('ignores slight bends', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 90 },
        { kind: 'arc', radius: 500, angle: 12, speedKmh: 90 },
        { kind: 'straight', length: 300, speedKmh: 90 },
      ]),
    );
    expect(c).toHaveLength(0);
  });

  it('sensitivity "many" counts smaller bends than "few"', () => {
    const track = simulate([
      { kind: 'straight', length: 300, speedKmh: 80 },
      { kind: 'arc', radius: 200, angle: 35, speedKmh: 80 },
      { kind: 'straight', length: 300, speedKmh: 80 },
    ]);
    expect(run(track, { sensitivity: 'many' })).toHaveLength(1);
    expect(run(track, { sensitivity: 'few' })).toHaveLength(0);
  });

  it('counts a twisty road correctly', () => {
    const legs: Leg[] = [{ kind: 'straight', length: 300, speedKmh: 70 }];
    const pattern = [60, -45, 90, -120, 50, -60, 75];
    for (const a of pattern) {
      legs.push({ kind: 'arc', radius: 70, angle: a, speedKmh: 55 });
      legs.push({ kind: 'straight', length: 150, speedKmh: 70 });
    }
    const c = run(simulate(legs, { noise: 1, seed: 3 }));
    expect(dirs(c)).toBe('RLRLRLR');
  });
});
