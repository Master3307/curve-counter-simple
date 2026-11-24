/**
 * Files in and out of the app (plan 1.12 A/B).
 * - Export / share: GPX (recommended), KML, KMZ, CSV, GeoJSON → system share sheet, optionally
 *   with a rendered map picture. Expert options leave out curves, times, sensors or height.
 * - Import: picked files or files opened with / shared to the app, any of those formats →
 *   same full analysis as a recorded ride, plain-word questions for planned routes and
 *   duplicates. The whole import can be undone.
 */
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { analyzeTrack } from '../logic/analyze';
import { MIME, parseAny, writeFormat, type Format } from '../logic/formats';
import { CREATORS, fileHash, GpxError, overlaps, prepareImport, type ExportOptions } from '../logic/gpx';
import { shapeOf } from '../logic/routes';
import { STRINGS } from '../i18n/strings';
import { rideName, useStore, type Ride } from '../store';
import { confirm } from '../ui/components';
import { fmtDate, fmtDistance, fmtTime } from '../ui/format';
import { renderMapImage } from '../ui/mapImage';
import { loadTrack, saveTrack } from './tracks';
import { Inbox } from './plugin';
import { assignRoute } from './engine';

const st = () => useStore.getState();
const pad = (n: number) => String(n).padStart(2, '0');
export function baseName(r: Ride) {
  const d = new Date(r.startedAt);
  return `CurveCounterSimple-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

interface OutFile {
  name: string;
  mime: string;
  /** text or bytes */
  data: string | Uint8Array;
}

async function fileFor(r: Ride, format: Format, opts: ExportOptions): Promise<OutFile | null> {
  const fixes = r.hasTrack ? await loadTrack(r.id) : null;
  if (!fixes?.length) return null;
  const name = rideName(r) ?? baseName(r);
  const data = writeFormat(format, { name, startedAt: r.startedAt, left: r.left, right: r.right, distanceM: r.distanceM, curves: r.curves }, fixes, opts);
  return { name: `${baseName(r)}.${format}`, mime: MIME[format], data };
}

async function mapPicture(r: Ride): Promise<OutFile | null> {
  const t = STRINGS[st().settings.lang];
  const { units, lang } = st().settings;
  const fixes = (r.hasTrack ? await loadTrack(r.id) : null) ?? (r.shape ?? []).map(([lat, lon]) => ({ lat, lon }));
  if (!fixes.length) return null;
  const url = await renderMapImage({
    title: rideName(r) ?? fmtDate(r.startedAt, lang),
    subtitle: `${fmtDate(r.startedAt, lang)} · ${fmtDistance(r.distanceM, units, lang)}`,
    left: r.left,
    right: r.right,
    fixes,
    curves: r.curves,
    labels: { left: t.left, right: t.right, brand: t.appName },
  });
  if (!url) return null;
  return { name: `${baseName(r)}.png`, mime: 'image/png', data: fromBase64(url.split(',')[1]) };
}

/** Hands files to the system: share sheet on phones, downloads in the browser. */
async function handOver(files: OutFile[], title: string, text?: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const blobs = files.map((f) => new File([f.data as BlobPart], f.name, { type: f.mime }));
    if (navigator.canShare?.({ files: blobs })) {
      try {
        await navigator.share({ files: blobs, title, text });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    for (const b of blobs) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = b.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    return;
  }
  const uris: string[] = [];
  for (const f of files) {
    const data = typeof f.data === 'string' ? toBase64(new TextEncoder().encode(f.data)) : toBase64(f.data);
    const res = await Filesystem.writeFile({ path: `export/${f.name}`, data, directory: Directory.Cache, recursive: true });
    uris.push(res.uri);
  }
  try {
    await Share.share({ files: uris, title, text, dialogTitle: title });
  } catch (e) {
    // closing the share sheet without picking anything is not an error
    if (!/cancel/i.test(String(e))) throw e;
  }
}

export interface ShareOptions extends ExportOptions {
  format: Format;
  /** attach a rendered map picture */
  image?: boolean;
  /** a short text with the numbers ("I rode 143 curves …") */
  message?: boolean;
}

/** Returns false when there was nothing to share (no track). */
export async function shareRides(rides: Ride[], o: ShareOptions): Promise<boolean> {
  const t = STRINGS[st().settings.lang];
  const files: OutFile[] = [];
  for (const r of rides) {
    if (o.image && rides.length === 1) {
      const img = await mapPicture(r).catch(() => null);
      if (img) files.push(img);
    }
    const f = await fileFor(r, o.format, o);
    if (f) files.push(f);
  }
  if (!files.length) return false;
  const one = rides.length === 1 ? rides[0] : null;
  const { units, lang } = st().settings;
  const text = o.message && one ? t.shareText(one.left + one.right, one.left, one.right, fmtDistance(one.distanceM, units, lang)) : undefined;
  await handOver(files, one ? (rideName(one) ?? t.appName) : t.appName, text);
  return true;
}

// ---------------------------------------------------------------------------------------------
// import

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export interface InFile {
  name: string;
  bytes: Uint8Array;
}

/** Imports track files. Returns how many rides were added. Asks in plain words when unsure. */
export async function importFiles(files: InFile[]): Promise<number> {
  const t = STRINGS[st().settings.lang];
  const added: string[] = [];
  for (const file of files) {
    let prep;
    try {
      prep = prepareImport(await parseAny(file.name, file.bytes));
    } catch (e) {
      if (!(e instanceof GpxError)) console.error(e);
      await confirm(t.importBroken(file.name), t.ok, t.cancel);
      continue;
    }
    const name = prep.name || file.name.replace(/\.[a-z0-9]+$/i, '');
    if (prep.kind === 'route' && !(await confirm(t.importIsRoute(name), t.countAnyway, t.skip))) continue;

    const hash = fileHash(new TextDecoder().decode(file.bytes.subarray(0, 2_000_000)));
    const startedAt = prep.kind === 'route' ? Date.now() : prep.fixes[0].t;
    const endedAt = prep.kind === 'route' ? startedAt : prep.fixes[prep.fixes.length - 1].t;
    const dup = st().rides.find((r) => r.fileHash === hash || (prep.kind === 'ride' && r.source !== 'route' && overlaps(r, { startedAt, endedAt })));
    const lang = st().settings.lang;
    const when = dup ? `${fmtDate(dup.startedAt, lang)}, ${fmtTime(dup.startedAt, lang)}` : '';
    if (dup && !(await confirm(t.importDuplicate(when), t.keepBoth, t.skip))) continue;

    const a = analyzeTrack(prep.fixes, st().settings.sensitivity);
    const ride: Ride = {
      id: uid(),
      startedAt,
      endedAt,
      mode: 'manual',
      ...a,
      // planned routes: the times are made up, so no time or speed numbers
      ...(prep.kind === 'route' ? { movingS: 0, avgSpeed: 0, topSpeed: 0, motion: null } : {}),
      shape: shapeOf(prep.fixes),
      hasTrack: true,
      source: prep.kind === 'route' ? 'route' : 'gpx',
      sourceName: prep.creator && !CREATORS.includes(prep.creator) ? `${name} · ${prep.creator}` : name,
      fileHash: hash,
      quality: prep.quality,
      extras: prep.extras,
    };
    try {
      await saveTrack(ride.id, prep.fixes);
    } catch {
      ride.hasTrack = false;
    }
    st().addRide(ride);
    assignRoute(ride.id);
    added.push(ride.id);
  }
  if (added.length) {
    const gone = new Set(added);
    st().offerUndo({
      text: t.importDone(added.length),
      rides: [],
      restore: (s) => ({ rides: s.rides.filter((r) => !gone.has(r.id)), routes: s.routes.map((x) => ({ ...x, rideIds: x.rideIds.filter((i) => !gone.has(i)) })).filter((x) => x.rideIds.length) }),
    });
  }
  return added.length;
}

export async function importPicked(list: FileList | File[]): Promise<number> {
  const files: InFile[] = [];
  for (const f of list) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  return importFiles(files);
}

/** Imports files that were opened with / shared to the app, now and whenever new ones arrive. */
let watching = false;
export function watchInbox() {
  if (watching || !Capacitor.isNativePlatform()) return;
  watching = true;
  if (Capacitor.getPlatform() === 'android') {
    const takeAll = async () => {
      const { files } = await Inbox.take().catch(() => ({ files: [] as { name: string; text?: string; data?: string }[] }));
      if (!files.length) return;
      st().setTab('rides');
      await importFiles(files.map((f) => ({ name: f.name, bytes: f.data ? fromBase64(f.data) : new TextEncoder().encode(f.text ?? '') })));
    };
    void takeAll();
    void Inbox.addListener('files', () => void takeAll());
    return;
  }
  // iPhone: "Open in Curve Counter Simple" starts the app with a file:// URL
  const open = async (url: string) => {
    if (!url.startsWith('file:')) return;
    try {
      const r = await Filesystem.readFile({ path: url });
      const data = typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer());
      st().setTab('rides');
      await importFiles([{ name: decodeURIComponent(url.split('/').pop() ?? 'ride'), bytes: data }]);
    } catch (e) {
      console.error(e);
    }
  };
  void CapApp.addListener('appUrlOpen', (e) => void open(e.url));
  void CapApp.getLaunchUrl().then((l) => {
    if (l?.url) void open(l.url);
  });
}
