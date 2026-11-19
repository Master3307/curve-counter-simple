import { HeightStats } from './height';
import { simulate } from './simulate';

function withHeight(fn: (distM: number) => number, noise = 0, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const fixes = simulate([{ kind: 'straight', length: 10_000, speedKmh: 60 }]);
  return fixes.map((f, i) => ({ ...f, alt: fn((i / (fixes.length - 1)) * 10_000) + rnd() * noise }));
}

describe('height', () => {
  it('pass road: up 600 m, down 400 m', () => {
    const h = new HeightStats();
    withHeight((d) => (d < 6000 ? 500 + d / 10 : 1100 - (d - 6000) / 10)).forEach((f) => h.push(f));
    const t = h.totals()!;
    expect(t.maxAltM).toBeGreaterThan(1090);
    expect(t.minAltM).toBeLessThan(510);
    expect(Math.abs(t.climbM - 600)).toBeLessThan(20);
    expect(Math.abs(t.descentM - 400)).toBeLessThan(20);
    expect(t.profile.length).toBeGreaterThan(80);
  });

  it('flat road with ±5 m GPS noise does not add up fake climbing', () => {
    const h = new HeightStats();
    withHeight(() => 300, 5, 7).forEach((f) => h.push(f));
    const t = h.totals()!;
    expect(t.climbM).toBeLessThan(25);
    expect(t.descentM).toBeLessThan(25);
  });

  it('single spikes are ignored', () => {
    const h = new HeightStats();
    withHeight(() => 300).map((f, i) => (i === 100 ? { ...f, alt: 900 } : f)).forEach((f) => h.push(f));
    expect(h.totals()!.maxAltM).toBeLessThan(305);
  });

  it('no height information → null', () => {
    const h = new HeightStats();
    simulate([{ kind: 'straight', length: 1000, speedKmh: 60 }]).forEach((f) => h.push(f));
    expect(h.totals()).toBeNull();
  });
});
