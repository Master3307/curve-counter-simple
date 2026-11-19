/**
 * GPX in and out of the app (plan 1.12 A/B).
 * Export: file in the cache folder → system share sheet (save to Files / Drive, mail, open in
 * another app). Several rides = several files in one share (no ZIP library needed).
 * Import: picked files → same full analysis as a recorded ride, plain-word questions for
 * planned routes and duplicates.
 * "Open with / Share to Simple Curve Counter" from other apps: Inbox plugin (Android).
 * TODO(plan 1.12 B): iOS document type com.topografix.gpx.
 * TODO(plan 1.12 C): Android watched folder, Google Timeline import.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { analyzeTrack } from '../logic/analyze';
import { fileHash, GpxError, overlaps, parseGpx, prepareImport, writeGpx } from '../logic/gpx';
import { STRINGS } from '../i18n/strings';
import { useStore, type Ride } from '../store';
import { confirm } from '../ui/components';
import { fmtDate, fmtTime } from '../ui/format';
import { loadTrack, saveTrack } from './tracks';
import { Inbox } from './plugin';

const st = () => useStore.getState();
const pad = (n: number) => String(n).padStart(2, '0');
function fileName(r: Ride) {
  const d = new Date(r.startedAt);
  return `SimpleCurveCounter-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.gpx`;
}

async function gpxFor(r: Ride): Promise<string | null> {
  const fixes = r.hasTrack ? await loadTrack(r.id) : null;
  if (!fixes?.length) return null;
  const name = r.sourceName ?? fileName(r).replace(/\.gpx$/, '');
  return writeGpx({ name, startedAt: r.startedAt, left: r.left, right: r.right, distanceM: r.distanceM, curves: r.curves }, fixes);
}

/** Returns false when nothing could be exported. */
export async function exportRides(rides: Ride[]): Promise<boolean> {
  const files: { name: string; xml: string }[] = [];
  for (const r of rides) {
    const xml = await gpxFor(r);
    if (xml) files.push({ name: fileName(r), xml });
  }
  if (!files.length) return false;

  if (!Capacitor.isNativePlatform()) {
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([f.xml], { type: 'application/gpx+xml' }));
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    return true;
  }
  const uris: string[] = [];
  for (const f of files) {
    const res = await Filesystem.writeFile({ path: `export/${f.name}`, data: f.xml, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    uris.push(res.uri);
  }
  try {
    await Share.share({ files: uris, title: files.length === 1 ? files[0].name : 'Simple Curve Counter' });
  } catch (e) {
    // closing the share sheet without picking anything is not an error
    if (!/cancel/i.test(String(e))) throw e;
  }
  return true;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Imports GPX files. Returns how many rides were added. Asks in plain words when unsure. */
export async function importFiles(files: File[]): Promise<number> {
  const t = STRINGS[st().settings.lang];
  let added = 0;
  for (const file of files) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      await confirm(t.importBroken(file.name), t.ok, t.cancel);
      continue;
    }
    let prep;
    try {
      prep = prepareImport(parseGpx(text));
    } catch (e) {
      if (!(e instanceof GpxError)) console.error(e);
      await confirm(t.importBroken(file.name), t.ok, t.cancel);
      continue;
    }
    const name = prep.name || file.name.replace(/\.gpx$/i, '');
    if (prep.kind === 'route' && !(await confirm(t.importIsRoute(name), t.countAnyway, t.skip))) continue;

    const hash = fileHash(text);
    const startedAt = prep.fixes[0].t;
    const endedAt = prep.fixes[prep.fixes.length - 1].t;
    const dup = st().rides.find(
      (r) => r.fileHash === hash || (prep.kind === 'ride' && r.source !== 'route' && overlaps(r, { startedAt, endedAt })),
    );
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
      ...(prep.kind === 'route' ? { movingS: 0, avgSpeed: 0, topSpeed: 0 } : {}),
      hasTrack: true,
      source: prep.kind === 'route' ? 'route' : 'gpx',
      sourceName: prep.creator && prep.creator !== 'Simple Curve Counter' ? `${name} · ${prep.creator}` : name,
      fileHash: hash,
      quality: prep.quality,
    };
    try {
      await saveTrack(ride.id, prep.fixes);
    } catch {
      ride.hasTrack = false;
    }
    st().addRide(ride);
    added++;
  }
  return added;
}

/** Imports files that were opened with / shared to the app, now and whenever new ones arrive. */
let watching = false;
export function watchInbox(onImported: (n: number) => void) {
  if (watching || Capacitor.getPlatform() !== 'android') return;
  watching = true;
  const takeAll = async () => {
    const { files } = await Inbox.take().catch(() => ({ files: [] as { name: string; text: string }[] }));
    if (!files.length) return;
    st().setTab('rides');
    const n = await importFiles(files.map((f) => new File([f.text], f.name, { type: 'application/gpx+xml' })));
    onImported(n);
  };
  void takeAll();
  void Inbox.addListener('files', () => void takeAll());
}
