/**
 * Renders a ride as a square PNG for sharing: map background (OpenStreetMap tiles when online,
 * a plain styled background when not), the track, the curves and a header with the numbers.
 */
import type { Curve } from '../logic/curves';
import type { Fix } from '../logic/geo';

export interface MapImageInput {
  title: string;
  subtitle: string;
  left: number;
  right: number;
  fixes: { lat: number; lon: number }[];
  curves: Curve[];
  labels: { left: string; right: string; brand: string };
}

const SIZE = 1080;
const HEAD = 190;
const TILE = 256;

const worldXY = (lat: number, lon: number, z: number) => {
  const n = 2 ** z * TILE;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};

function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

/** Returns a PNG data URL. */
export async function renderMapImage(input: MapImageInput, withTiles = true): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const pts = input.fixes.length ? input.fixes : [{ lat: 0, lon: 0 }];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const box = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lons), w: Math.min(...lons) };
  const mapH = SIZE - HEAD;
  const pad = 90;
  let z = 17;
  for (; z > 2; z--) {
    const a = worldXY(box.n, box.w, z);
    const b = worldXY(box.s, box.e, z);
    if (b.x - a.x <= SIZE - 2 * pad && b.y - a.y <= mapH - 2 * pad) break;
  }
  const a = worldXY(box.n, box.w, z);
  const b = worldXY(box.s, box.e, z);
  const ox = (a.x + b.x) / 2 - SIZE / 2;
  const oy = (a.y + b.y) / 2 - mapH / 2 - HEAD;
  const P = (lat: number, lon: number) => {
    const w = worldXY(lat, lon, z);
    return [w.x - ox, w.y - oy] as const;
  };

  // background
  ctx.fillStyle = '#e9e5da';
  ctx.fillRect(0, 0, SIZE, SIZE);
  let tiles = false;
  if (withTiles && navigator.onLine !== false) {
    const jobs: Promise<void>[] = [];
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + SIZE) / TILE); tx++)
      for (let ty = Math.floor((oy + HEAD) / TILE); ty <= Math.floor((oy + SIZE) / TILE); ty++)
        jobs.push(
          loadTile(z, tx, ty).then((img) => {
            if (img) {
              ctx.drawImage(img, tx * TILE - ox, ty * TILE - oy);
              tiles = true;
            }
          }),
        );
    await Promise.all(jobs);
  }
  if (tiles) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, HEAD, SIZE, mapH);
  } else {
    // plain background: soft contour lines
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 20) ctx.lineTo(x, HEAD + 60 + i * 60 + Math.sin(x / 140 + i) * 22);
      ctx.stroke();
    }
  }

  // track: dark outline + bright line
  const path = new Path2D();
  pts.forEach((p, i) => {
    const [x, y] = P(p.lat, p.lon);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b1d22';
  ctx.lineWidth = 15;
  ctx.stroke(path);
  ctx.strokeStyle = '#f2a922';
  ctx.lineWidth = 9;
  ctx.stroke(path);

  // curves
  for (const c of input.curves) {
    const [x, y] = P(c.lat, c.lon);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = c.dir === 'L' ? '#2f6fe0' : '#d6531a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  // start / end
  const dot = (p: { lat: number; lon: number }, color: string) => {
    const [x, y] = P(p.lat, p.lon);
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };
  dot(pts[pts.length - 1], '#c0262d');
  dot(pts[0], '#17803a');

  // header
  const grad = ctx.createLinearGradient(0, 0, 0, HEAD);
  grad.addColorStop(0, '#15171c');
  grad.addColorStop(1, '#22252d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, HEAD);
  ctx.fillStyle = '#f2a922';
  ctx.fillRect(0, HEAD - 6, SIZE, 6);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f4f2ec';
  ctx.font = '800 48px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  ctx.fillText(input.title, 48, 82, 600);
  ctx.fillStyle = '#a6acb6';
  ctx.font = '600 32px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  ctx.fillText(input.subtitle, 48, 136, 620);
  ctx.textAlign = 'right';
  ctx.font = '800 64px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  ctx.fillStyle = '#6aa5ff';
  ctx.fillText(`↰ ${input.left}`, 840, 112);
  ctx.fillStyle = '#ff8f45';
  ctx.fillText(`${input.right} ↱`, 1032, 112);
  ctx.font = '600 26px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  ctx.fillStyle = '#a6acb6';
  ctx.fillText(`${input.labels.left} · ${input.labels.right}`, 1032, 156);
  // footer
  ctx.textAlign = 'left';
  ctx.font = '700 24px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  const brand = input.labels.brand + (tiles ? '  ·  © OpenStreetMap' : '');
  const w = ctx.measureText(brand).width;
  ctx.fillStyle = 'rgba(21,23,28,0.78)';
  ctx.fillRect(SIZE - w - 48, SIZE - 52, w + 32, 40);
  ctx.fillStyle = '#f4f2ec';
  ctx.fillText(brand, SIZE - w - 32, SIZE - 24);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    // tiles without CORS made the canvas unreadable → draw again without them
    return withTiles ? renderMapImage(input, false) : '';
  }
}

export type { Fix };
