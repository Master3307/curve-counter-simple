import { canMerge, findRoute, sameRoads, shapeOf, variants } from './routes';
import { simulate, type Leg } from './simulate';

const start = { lat: 48.99, lon: 12.2 };
const ride = (legs: Leg[], noise = 2, seed = 1) => shapeOf(simulate(legs, { start, heading: 90, noise, seed }));

const MAIN: Leg[] = [
  { kind: 'straight', length: 2000, speedKmh: 60 },
  { kind: 'arc', radius: 100, angle: -90, speedKmh: 50 },
  { kind: 'straight', length: 2000, speedKmh: 60 },
];
// same start and end, other road: first north, then east
const OTHER: Leg[] = [
  { kind: 'arc', radius: 100, angle: -90, speedKmh: 50 },
  { kind: 'straight', length: 1900, speedKmh: 60 },
  { kind: 'arc', radius: 100, angle: 90, speedKmh: 50 },
  { kind: 'straight', length: 1900, speedKmh: 60 },
];

describe('routes', () => {
  it('the same ride twice runs on the same roads', () => {
    expect(sameRoads(ride(MAIN, 3, 1), ride(MAIN, 3, 2))).toBe(true);
  });

  it('another road between the same places is a different variant of the same route', () => {
    const a = ride(MAIN);
    const b = ride(OTHER);
    expect(sameRoads(a, b)).toBe(false);
    expect(canMerge(a, b).check).toBe('ok');
    const v = variants([
      { id: '1', shape: a },
      { id: '2', shape: b },
      { id: '3', shape: ride(MAIN, 3, 5) },
    ]);
    expect(v).toEqual([['1', '3'], ['2']]);
  });

  it('merging asks when the ends are a bit apart and refuses when far apart', () => {
    const a = ride(MAIN);
    const near = shapeOf(simulate(MAIN, { start: { lat: start.lat + 0.006, lon: start.lon }, heading: 90 }));
    const far = shapeOf(simulate(MAIN, { start: { lat: start.lat + 0.05, lon: start.lon }, heading: 90 }));
    expect(canMerge(a, near).check).toBe('ask');
    expect(canMerge(a, far).check).toBe('tooFar');
  });

  it('suggests the route a new ride belongs to', () => {
    const rides = [{ id: 'a', shape: ride(MAIN) }];
    const routes = [{ id: 'r', rideIds: ['a'] }];
    expect(findRoute(ride(OTHER), routes, rides)?.id).toBe('r');
    expect(findRoute(shapeOf(simulate(MAIN, { start: { lat: 49.2, lon: 12.2 } })), routes, rides)).toBeNull();
  });
});
