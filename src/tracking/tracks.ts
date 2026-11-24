/**
 * The track (all GPS fixes) of every finished ride, one small file per ride in the app's
 * private storage. Needed for recounting (better algorithm / other sensitivity), the height
 * profile and GPX export.
 *
 * Format: CSV, one fix per line: t,lat,lon,speed,accuracy,alt,bearing,yaw,gx,gy,gz
 * (empty = unknown; files from older versions simply have fewer columns).
 * TODO(milestone 2b): move into SQLite together with the rides; delete raw fixes after 30 days
 * (optional setting, counts stay).
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Fix } from '../logic/geo';
import type { useStore as Store } from '../store';

const path = (id: string) => `tracks/${id}.csv`;
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(v));

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function encodeTrack(fixes: Fix[]): string {
  return fixes
    .map((f) => {
      const base = `${f.t},${f.lat},${f.lon},${num(f.speed)},${f.accuracy},${num(f.alt)}`;
      if (f.bearing == null && f.yaw == null && !f.g) return base;
      const g = f.g ? f.g.map(r4).join(',') : ',,';
      return `${base},${num(f.bearing)},${num(f.yaw == null ? null : r4(f.yaw))},${g}`;
    })
    .join('\n');
}

const opt = (v: string | undefined) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function decodeTrack(csv: string): Fix[] {
  const out: Fix[] = [];
  for (const line of csv.split('\n')) {
    const p = line.split(',');
    if (p.length < 5) continue;
    const [t, lat, lon, accuracy] = [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[4])];
    if (![t, lat, lon, accuracy].every(Number.isFinite)) continue;
    const f: Fix = { t, lat, lon, speed: opt(p[3]), accuracy, alt: opt(p[5]) };
    const bearing = opt(p[6]);
    const yaw = opt(p[7]);
    const g = [opt(p[8]), opt(p[9]), opt(p[10])];
    if (bearing != null) f.bearing = bearing;
    if (yaw != null) f.yaw = yaw;
    if (g.every((x) => x != null)) f.g = g as [number, number, number];
    out.push(f);
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
    for (const r of s.undo?.rides ?? []) if (r.hasTrack) ids.add(r.id);
    return ids;
  };
  let prev = known(store.getState());
  return store.subscribe((s) => {
    const now = known(s);
    for (const id of prev) if (!now.has(id)) void deleteTrack(id);
    prev = now;
  });
}
