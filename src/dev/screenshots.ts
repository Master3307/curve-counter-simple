/**
 * Screenshot mode for the README (scripts/screenshots.mjs): `?shot=<name>&theme=light|dark`
 * fills the app with sample rides (simulated, no real person's data) and opens one screen.
 * Only active with that URL parameter; a phone never opens the app like that.
 */
import { analyzeTrack } from '../logic/analyze';
import { simulate, type Leg } from '../logic/simulate';
import { shapeOf } from '../logic/routes';
import { useStore, type Ride, type Tab } from '../store';
import { saveTrack } from '../tracking/tracks';

export const shot = new URLSearchParams(location.search).get('shot');

function twisty(seed: number, n: number): Leg[] {
  const legs: Leg[] = [{ kind: 'straight', length: 400, speedKmh: 60 }];
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const a = (25 + rnd() * 120) * (rnd() > 0.5 ? 1 : -1);
    legs.push({ kind: 'arc', radius: 30 + rnd() * 120, angle: a, speedKmh: 35 + rnd() * 35 });
    legs.push({ kind: 'straight', length: 80 + rnd() * 500, speedKmh: 55 + rnd() * 30 });
  }
  return legs;
}

async function ride(id: string, daysAgo: number, legs: Leg[], start: { lat: number; lon: number }, heading: number, name?: string): Promise<Ride> {
  const t0 = Date.now() - daysAgo * 86_400_000 - 3 * 3_600_000;
  const fixes = simulate(legs, { start, heading, noise: 1.5, seed: daysAgo + 3, t0 }).map((f, i) => ({ ...f, alt: 600 + 180 * Math.sin(i / 260) + i * 0.05 }));
  const a = analyzeTrack(fixes, 'normal');
  void saveTrack(id, fixes).catch(() => {});
  return { id, startedAt: fixes[0].t, endedAt: fixes[fixes.length - 1].t, mode: 'manual', ...a, shape: shapeOf(fixes), hasTrack: true, name };
}

export async function setupShot() {
  if (!shot) return;
  const theme = new URLSearchParams(location.search).get('theme');
  const lang = (new URLSearchParams(location.search).get('lang') as 'de' | 'en' | null) ?? 'de';
  const home = { lat: 47.6105, lon: 11.3435 };
  useStore.getState().updateSettings({ onboarded: shot !== 'welcome', lang, theme: (theme as 'light' | 'dark') ?? 'light', confirmed: ['vendor'] });
  const rides = await Promise.all([
    ride('r1', 1, twisty(7, 26), home, 200, 'Kesselberg-Runde'),
    ride('r2', 4, twisty(7, 26), home, 200),
    ride('r3', 9, twisty(21, 18), home, 160),
    ride('r4', 15, twisty(3, 34), { lat: 47.48, lon: 11.1 }, 90, 'Zugspitz-Tour'),
  ]);
  const s = useStore.getState();
  s.updateSettings({ onboarded: shot !== 'welcome', lang, theme: (theme as 'light' | 'dark') ?? 'light', confirmed: ['vendor'] });
  useStore.setState({
    rides,
    routes: [{ id: 'x1', name: lang === 'de' ? 'Hausrunde Kochelsee' : 'Home loop', rideIds: ['r1', 'r2', 'r3'] }],
  });
  const tabs: Record<string, Tab> = { ride: 'ride', riding: 'ride', rides: 'rides', details: 'rides', routes: 'rides', map: 'rides', share: 'rides', settings: 'settings', help: 'help' };
  s.setTab(tabs[shot] ?? 'ride');
  if (shot === 'riding') {
    const r = rides[0];
    const live: Ride = { ...r, id: 'live', endedAt: null, startedAt: Date.now() - 47 * 60_000, left: 23, right: 26, distanceM: 38_400, curves: r.curves.slice(0, 49) };
    useStore.setState({ rides: [live, ...rides], activeId: 'live', phase: 'riding', live: { speed: 64 / 3.6, gpsWeak: false, demo: false, problem: null, noGps: false } });
  }
  // open things by clicking them once the screen is drawn
  const click = (sel: string, nth = 0) => (document.querySelectorAll<HTMLElement>(sel)[nth] ?? null)?.click();
  setTimeout(() => {
    if (shot === 'details' || shot === 'map') click('.panel:nth-child(2) .card-buttons .btn-plain', 0);
    if (shot === 'routes') click('.panel:nth-child(2) .segmented button', 1);
    if (shot === 'share') click('.panel:nth-child(2) .card-buttons .btn-go', 0);
  }, 400);
  setTimeout(() => {
    if (shot === 'map') click('.map-card .btn-plain');
    if (shot === 'details') document.querySelector('.panel:nth-child(2) .details')?.scrollIntoView();
  }, 1200);
}
