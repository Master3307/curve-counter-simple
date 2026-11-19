/**
 * The track (all GPS fixes) of every finished ride, one small file per ride in the app's
 * private storage. Needed for recounting (better algorithm / other sensitivity), the height
 * profile and GPX export.
 *
 * Format: CSV, one fix per line: t,lat,lon,speed,accuracy,alt (empty = unknown).
 * TODO(milestone 2b): move into SQLite together with the rides; delete raw fixes after 30 days
 * (optional setting, counts stay).
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Fix } from '../logic/geo';
import type { useStore as Store } from '../store';

const path = (id: string) => `tracks/${id}.csv`;
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(v));

export function encodeTrack(fixes: Fix[]): string {
  return fixes.map((f) => `${f.t},${f.lat},${f.lon},${num(f.speed)},${f.accuracy},${num(f.alt)}`).join('\n');
}

export function decodeTrack(csv: string): Fix[] {
  const out: Fix[] = [];
  for (const line of csv.split('\n')) {
    const p = line.split(',');
    if (p.length < 5) continue;
    const [t, lat, lon, accuracy] = [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[4])];
    if (![t, lat, lon, accuracy].every(Number.isFinite)) continue;
    out.push({
      t,
      lat,
      lon,
      speed: p[3] === '' ? null : Number(p[3]),
      accuracy,
      alt: p[5] == null || p[5] === '' ? null : Number(p[5]),
    });
  }
  return out;
}

export async function saveTrack(id: string, fixes: Fix[]): Promise<void> {
  await Filesystem.writeFile({ path: path(id), data: encodeTrack(fixes), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
}

export async function loadTrack(id: string): Promise<Fix[] | null> {
  try {
    const r = await Filesystem.readFile({ path: path(id), directory: Directory.Data, encoding: Encoding.UTF8 });
    return decodeTrack(typeof r.data === 'string' ? r.data : await r.data.text());
  } catch {
    return null;
  }
}

export async function deleteTrack(id: string): Promise<void> {
  await Filesystem.deleteFile({ path: path(id), directory: Directory.Data }).catch(() => {});
}

/**
 * Deletes a ride's track once the ride is really gone: deleted AND the undo bar is over.
 * Works for every way a ride disappears (delete, delete all, discarded, too short).
 */
export function watchTrackDeletes(store: typeof Store) {
  const known = (s: ReturnType<typeof store.getState>) => {
    const ids = new Set(s.rides.filter((r) => r.hasTrack).map((r) => r.id));
    if (s.lastDeleted?.ride.hasTrack) ids.add(s.lastDeleted.ride.id);
    return ids;
  };
  let prev = known(store.getState());
  return store.subscribe((s) => {
    const now = known(s);
    for (const id of prev) if (!now.has(id)) void deleteTrack(id);
    prev = now;
  });
}
