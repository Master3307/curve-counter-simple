import { RideDetector } from './rideDetector';
import { RideStats } from './rideStats';
import { simulate } from './simulate';

function events(fixes: ReturnType<typeof simulate>, pauseMinutes = 10) {
  const d = new RideDetector({ pauseMinutes });
  return fixes.map((f) => d.push(f, f.speed ?? 0)).filter((e) => e != null);
}

describe('RideDetector', () => {
  it('starts after riding off and backdates the start', () => {
    const fixes = simulate([
      { kind: 'stop', seconds: 120 },
      { kind: 'straight', length: 2000, speedKmh: 50 },
    ]);
    const ev = events(fixes);
    expect(ev[0]?.type).toBe('start');
    if (ev[0]?.type === 'start') {
      expect(ev[0].at).toBeLessThanOrEqual(fixes[0].t + 121_000);
      expect(ev[0].backlog.length).toBeGreaterThan(25);
    }
  });

  it('does not start while walking', () => {
    expect(events(simulate([{ kind: 'straight', length: 1000, speedKmh: 5 }]))).toHaveLength(0);
  });

  it('keeps a short coffee stop inside the ride', () => {
    const ev = events(
      simulate([
        { kind: 'straight', length: 3000, speedKmh: 60 },
        { kind: 'stop', seconds: 5 * 60 },
        { kind: 'straight', length: 3000, speedKmh: 60 },
      ]),
    );
    expect(ev.map((e) => e.type)).toEqual(['start']);
  });

  it('ends after a long stop, at the moment it stopped', () => {
    const fixes = simulate([
      { kind: 'straight', length: 3000, speedKmh: 60 },
      { kind: 'stop', seconds: 11 * 60 },
    ]);
    const ev = events(fixes);
    expect(ev.map((e) => e.type)).toEqual(['start', 'end']);
    const stopAt = fixes.findIndex((f, i) => i > 10 && f.speed === 0);
    expect(ev[1].at).toBe(fixes[stopAt].t);
  });

  it('ends when GPS goes silent', () => {
    const d = new RideDetector();
    const fixes = simulate([{ kind: 'straight', length: 2000, speedKmh: 60 }]);
    fixes.forEach((f) => d.push(f, f.speed ?? 0));
    const last = fixes[fixes.length - 1].t;
    expect(d.tick(last + 5 * 60_000)).toBeNull();
    expect(d.tick(last + 10 * 60_000)).toEqual({ type: 'end', at: last });
  });
});

describe('RideStats', () => {
  it('measures track length, moving time and speeds', () => {
    const s = new RideStats();
    simulate([
      { kind: 'straight', length: 5000, speedKmh: 72 },
      { kind: 'stop', seconds: 300 },
      { kind: 'arc', radius: 100, angle: 90, speedKmh: 36 },
    ]).forEach((f) => s.push(f));
    const t = s.totals();
    const arc = (Math.PI * 100) / 2;
    expect(t.distanceM).toBeCloseTo(5000 + arc, -1);
    expect(t.movingS).toBeCloseTo(250 + arc / 10, -1); // stop not counted
    expect(t.topSpeed * 3.6).toBeCloseTo(72, 0);
    expect(t.avgSpeed * 3.6).toBeGreaterThan(60);
  });
});
