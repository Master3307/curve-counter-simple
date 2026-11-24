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

  it('counts slow junction turns (bus at a junction, into a driveway)', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 200, speedKmh: 40 },
        { kind: 'arc', radius: 10, angle: 90, speedKmh: 12 },
        { kind: 'straight', length: 200, speedKmh: 40 },
      ]),
    );
    expect(dirs(c)).toBe('R');
  });

  it('counts a turn into a parking lot that ends in a stop', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 40 },
        { kind: 'arc', radius: 12, angle: -90, speedKmh: 10 },
        { kind: 'straight', length: 25, speedKmh: 8 },
        { kind: 'stop', seconds: 60 },
      ]),
    );
    expect(dirs(c)).toBe('L');
  });

  it('a stop at a traffic light inside a ramp loop does not cancel the curve', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 50 },
        { kind: 'arc', radius: 25, angle: -180, speedKmh: 25 },
        { kind: 'stop', seconds: 40 },
        { kind: 'arc', radius: 25, angle: -80, speedKmh: 15 },
        { kind: 'straight', length: 300, speedKmh: 50 },
      ]),
    );
    expect(dirs(c)).toBe('L');
    expect(c[0].angle).toBeGreaterThan(230);
  });

  it('GPS jitter while standing still draws no curves', () => {
    const c = run(simulate([{ kind: 'straight', length: 200, speedKmh: 40 }, { kind: 'stop', seconds: 1800 }], { noise: 6, seed: 9 }));
    expect(c).toHaveLength(0);
  });

  it('walking pace (pushing the bike) does not count', () => {
    const c = run(
      simulate([
        { kind: 'straight', length: 60, speedKmh: 4.5 },
        { kind: 'arc', radius: 8, angle: 90, speedKmh: 4.5 },
        { kind: 'straight', length: 60, speedKmh: 4.5 },
      ]),
    );
    expect(c).toHaveLength(0);
  });

  it('a sharp 90° corner inside one resampling step is not thrown away as a glitch', () => {
    // planned route: corner exactly at a vertex, no smoothing by the road
    const c = run(
      simulate([
        { kind: 'straight', length: 300, speedKmh: 30 },
        { kind: 'arc', radius: 1, angle: 90, speedKmh: 30 },
        { kind: 'straight', length: 300, speedKmh: 30 },
      ]),
    );
    expect(dirs(c)).toBe('R');
    expect(c[0].angle).toBeGreaterThan(80);
  });

  it('a single GPS spike on a straight is ignored', () => {
    const fixes = simulate([{ kind: 'straight', length: 2000, speedKmh: 60 }]);
    const i = 60;
    fixes[i] = { ...fixes[i], lon: fixes[i].lon + 0.0006 }; // ~45 m sideways for one fix
    expect(run(fixes)).toHaveLength(0);
  });

  it('the gyroscope overrules a GPS jump it does not confirm', () => {
    const fixes = simulate([{ kind: 'straight', length: 2000, speedKmh: 50 }]).map((f) => ({ ...f, yaw: 0 }));
    // multipath: the position drifts 25 m sideways for 8 s and comes back
    for (let k = 0; k < 8; k++) fixes[50 + k] = { ...fixes[50 + k], lon: fixes[50 + k].lon + 0.00035 * Math.sin((k / 7) * Math.PI) };
    expect(run(fixes)).toHaveLength(0);
  });

  it('marks curves with a confidence and the sources that saw them', () => {
    const fixes = simulate([
      { kind: 'straight', length: 300, speedKmh: 60 },
      { kind: 'arc', radius: 80, angle: 90, speedKmh: 50 },
      { kind: 'straight', length: 300, speedKmh: 60 },
    ]);
    const c = run(fixes);
    expect(c[0].confidence).toBeGreaterThan(0.5);
    expect(c[0].sources).toBe('p');
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

  describe('definition of "one curve" (plan 1.8)', () => {
    it('counts a wide motorway sweeper (60° at r = 1000 m) once', () => {
      const c = run(
        simulate(
          [
            { kind: 'straight', length: 1000, speedKmh: 120 },
            { kind: 'arc', radius: 1000, angle: 60, speedKmh: 120 },
            { kind: 'straight', length: 1000, speedKmh: 120 },
          ],
          { noise: 2, seed: 11 },
        ),
      );
      expect(dirs(c)).toBe('R');
      expect(c[0].wide).toBe(true);
      expect(c[0].angle).toBeGreaterThan(50);
      expect(c[0].angle).toBeLessThan(70);
    });

    it('counts two opposite sweepers on a motorway', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 800, speedKmh: 120 },
          { kind: 'arc', radius: 900, angle: -50, speedKmh: 120 },
          { kind: 'straight', length: 1200, speedKmh: 120 },
          { kind: 'arc', radius: 1200, angle: 45, speedKmh: 120 },
          { kind: 'straight', length: 800, speedKmh: 120 },
        ]),
      );
      expect(dirs(c)).toBe('LR');
    });

    it('a long straight motorway with GPS noise counts nothing (no fake sweepers)', () => {
      for (const seed of [1, 2, 3]) {
        expect(run(simulate([{ kind: 'straight', length: 8000, speedKmh: 120 }], { noise: 4, seed }))).toHaveLength(0);
      }
    });

    it('a normal curve is counted once, not again by the wide pass', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 600, speedKmh: 90 },
          { kind: 'arc', radius: 250, angle: 70, speedKmh: 90 },
          { kind: 'straight', length: 600, speedKmh: 90 },
        ]),
      );
      expect(dirs(c)).toBe('R');
      expect(c[0].wide).toBeUndefined();
    });

    it('same direction with a 40 m straight inside = one curve', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 300, speedKmh: 60 },
          { kind: 'arc', radius: 60, angle: 50, speedKmh: 55 },
          { kind: 'straight', length: 40, speedKmh: 55 },
          { kind: 'arc', radius: 60, angle: 50, speedKmh: 55 },
          { kind: 'straight', length: 300, speedKmh: 60 },
        ]),
      );
      expect(dirs(c)).toBe('R');
      expect(c[0].angle).toBeGreaterThan(85);
    });

    it('same direction with a 150 m straight between = two curves', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 300, speedKmh: 60 },
          { kind: 'arc', radius: 60, angle: 50, speedKmh: 55 },
          { kind: 'straight', length: 150, speedKmh: 60 },
          { kind: 'arc', radius: 60, angle: 50, speedKmh: 55 },
          { kind: 'straight', length: 300, speedKmh: 60 },
        ]),
      );
      expect(dirs(c)).toBe('RR');
    });

    it('a roundabout (right in, 270° left, right out) is one curve', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 300, speedKmh: 50 },
          { kind: 'arc', radius: 20, angle: 45, speedKmh: 25 },
          { kind: 'arc', radius: 18, angle: -270, speedKmh: 25 },
          { kind: 'arc', radius: 20, angle: 45, speedKmh: 25 },
          { kind: 'straight', length: 300, speedKmh: 50 },
        ]),
      );
      expect(c.filter((x) => x.angle >= 150)).toHaveLength(1);
      expect(c.filter((x) => x.angle >= 150)[0].dir).toBe('L');
    });

    it('an overtake / lane change counts nothing, even at "many"', () => {
      const c = run(
        simulate(
          [
            { kind: 'straight', length: 400, speedKmh: 100 },
            { kind: 'arc', radius: 400, angle: -6, speedKmh: 110 },
            { kind: 'arc', radius: 400, angle: 6, speedKmh: 110 },
            { kind: 'straight', length: 200, speedKmh: 110 },
            { kind: 'arc', radius: 400, angle: 6, speedKmh: 110 },
            { kind: 'arc', radius: 400, angle: -6, speedKmh: 110 },
            { kind: 'straight', length: 400, speedKmh: 100 },
          ],
          { noise: 1.5, seed: 5 },
        ),
        { sensitivity: 'many' },
      );
      expect(c).toHaveLength(0);
    });

    it('stores where a curve ends and how long it is', () => {
      const c = run(
        simulate([
          { kind: 'straight', length: 300, speedKmh: 60 },
          { kind: 'arc', radius: 100, angle: 90, speedKmh: 60 },
          { kind: 'straight', length: 300, speedKmh: 60 },
        ]),
      );
      // arc length = 100 · π/2 ≈ 157 m
      expect(c[0].lengthM).toBeGreaterThan(157 * 0.85);
      expect(c[0].lengthM).toBeLessThan(157 * 1.25);
      expect(c[0].endT).toBeGreaterThan(c[0].t);
    });
  });
});

describe('sensor fusion safety', () => {
  it('a stuck gyroscope (always 0) does not wipe out real curves', () => {
    const fixes = simulate([
      { kind: 'straight', length: 300, speedKmh: 60 },
      { kind: 'arc', radius: 80, angle: 90, speedKmh: 50 },
      { kind: 'straight', length: 300, speedKmh: 60 },
      { kind: 'arc', radius: 80, angle: -90, speedKmh: 50 },
      { kind: 'straight', length: 300, speedKmh: 60 },
    ]).map((f) => ({ ...f, yaw: 0 }));
    expect(dirs(run(fixes))).toBe('RL');
  });
});
