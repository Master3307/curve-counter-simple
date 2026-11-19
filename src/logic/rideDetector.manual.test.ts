import { RideDetector, MANUAL_START } from './rideDetector';
import { simulate } from './simulate';

describe('manual start (armed)', () => {
  it('only starts once actually moving, backdated to rolling off', () => {
    const d = new RideDetector(MANUAL_START);
    const fixes = simulate([
      { kind: 'stop', seconds: 300 }, // helmet, gloves …
      { kind: 'straight', length: 1000, speedKmh: 40 },
    ]);
    const ev = fixes.map((f) => d.push(f, f.speed ?? 0)).filter((e) => e != null);
    expect(ev[0]?.type).toBe('start');
    expect(ev[0]!.at).toBeGreaterThanOrEqual(fixes[0].t + 300_000);
    // started within ~10 s of rolling off
    expect(ev[0]!.at).toBeLessThan(fixes[0].t + 310_000);
  });

  it('stays armed while standing', () => {
    const d = new RideDetector(MANUAL_START);
    const ev = simulate([{ kind: 'stop', seconds: 600 }]).map((f) => d.push(f, 0));
    expect(ev.every((e) => e == null)).toBe(true);
  });
});
