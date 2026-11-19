/** Small geo helpers. Pure functions, no dependencies. */

export interface Fix {
  /** epoch ms */
  t: number;
  lat: number;
  lon: number;
  /** m/s from GPS (Doppler) if available */
  speed: number | null;
  /** horizontal accuracy in metres */
  accuracy: number;
}

const R = 6371008.8; // mean earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Distance in metres (haversine). */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a → b in degrees [0, 360), 0 = north, clockwise. */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest difference b − a in (−180, 180]. Positive = clockwise = right turn. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Point reached from `p` going `dist` metres on `brg` degrees. */
export function destination(p: { lat: number; lon: number }, brg: number, dist: number): { lat: number; lon: number } {
  const d = dist / R;
  const b = rad(brg);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

export const kmh = (ms: number) => ms * 3.6;
export const ms = (kmhValue: number) => kmhValue / 3.6;
