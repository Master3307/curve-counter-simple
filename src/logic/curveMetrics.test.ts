import { CurveDetector, type Curve } from './curves';
import { curveMetrics, strengthOf, summarizeCurves } from './curveMetrics';
import { simulate } from './simulate';

function one(radius: number, angle: number, speedKmh: number): Curve {
  const d = new CurveDetector({ sensitivity: 'many' });
  const fixes = simulate(
    [
      { kind: 'straight', length: 400, speedKmh },
      { kind: 'arc', radius, angle, speedKmh },
      { kind: 'straight', length: 400, speedKmh },
    ],
    { noise: 1, seed: 9 },
  );
  const c = [...fixes.flatMap((f) => d.push(f)), ...d.flush()];
  expect(c).toHaveLength(1);
  return c[0];
}

describe('curve metrics', () => {
  it.each([
    [40, 90, 40],
    [80, 70, 60],
    [150, 60, 80],
    [300, 45, 100],
  ])('radius %i m, %i°, %i km/h: radius and lean angle within 25 %', (r, a, v) => {
    const m = curveMetrics(one(r, a, v));
    expect(Math.abs(m.radiusM! - r) / r).toBeLessThan(0.25);
    const ms = v / 3.6;
    const trueLean = (Math.atan((ms * ms) / (r * 9.81)) * 180) / Math.PI;
    expect(Math.abs(m.leanDeg! - trueLean) / trueLean).toBeLessThan(0.25);
    expect(m.latG).toBeCloseTo(Math.tan((m.leanDeg! * Math.PI) / 180), 6);
  });

  it('classes by angle', () => {
    expect(strengthOf(30)).toBe('gentle');
    expect(strengthOf(45)).toBe('gentle');
    expect(strengthOf(60)).toBe('medium');
    expect(strengthOf(120)).toBe('tight');
    expect(strengthOf(170)).toBe('hairpin');
  });

  it('old curves without a length still get a class, no fake physics', () => {
    const c: Curve = { t: 0, dir: 'L', angle: 100, entrySpeed: 10, minSpeed: 9, avgSpeed: 10, exitSpeed: 10, lat: 0, lon: 0 };
    expect(curveMetrics(c)).toEqual({ radiusM: null, latG: null, leanDeg: null, strength: 'tight' });
  });

  it('implausible cornering (> 1.3 g) is not shown', () => {
    const c: Curve = { t: 0, dir: 'R', angle: 90, entrySpeed: 40, minSpeed: 40, avgSpeed: 40, exitSpeed: 40, lat: 0, lon: 0, lengthM: 50 };
    expect(curveMetrics(c).latG).toBeNull();
  });

  it('summarizes a ride', () => {
    const curves = [one(80, 70, 60), one(40, 160, 30), one(150, -40, 70)];
    const s = summarizeCurves(curves, 20_000);
    expect(s.classes).toEqual({ gentle: 1, medium: 1, tight: 0, hairpin: 1 });
    expect(s.per100km).toBeCloseTo(15);
    expect(s.maxLeanDeg).toBeGreaterThan(10);
    expect(s.avgCurveSpeed.L).not.toBeNull();
    expect(summarizeCurves(curves, 500).per100km).toBeNull();
  });
});
