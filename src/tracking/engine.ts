/**
 * Glue: fix log → ride detector → curve detector + ride stats → store.
 *
 * The engine *pulls* fixes from the source's numbered log (`pump`) instead of reacting to live
 * callbacks only. That makes it robust against the WebView being frozen (screen off) and the app
 * being killed:
 * - frozen: the native recorder keeps logging; on wake-up `pump` processes the backlog in order.
 * - killed: on the next start `initEngine` drops the half-built ride and replays the log from
 *   `session.from`, which rebuilds exactly the same ride (the detectors are deterministic).
 *
 * TODO(plan 1.5): move ride + curve detection into the native plugin so the notification shows
 * live counts while the WebView sleeps. Until then the notification is updated whenever JS runs.
 */
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CurveDetector, type Curve } from '../logic/curves';
import type { Fix } from '../logic/geo';
import { MANUAL_START, RideDetector } from '../logic/rideDetector';
import { RideStats } from '../logic/rideStats';
import { HeightStats } from '../logic/height';
import { ALGO_VERSION, analyzeTrack } from '../logic/analyze';
import { loadTrack, saveTrack, watchTrackDeletes } from './tracks';
import { STRINGS } from '../i18n/strings';
import { fmtDuration, fmtSpeed, speedUnit } from '../ui/format';
import { flushStorage, useStore, type Ride, type Session } from '../store';
import { defaultSource, demoSource, type FixSource, type Stop } from './source';

/** Max fixes per read (keeps a 10-hour replay from blocking the UI in one go). */
const READ_LIMIT = 2000;

let source: FixSource = defaultSource();
let unsubscribe: Stop | null = null;
/** next sequence number to process in the source's log */
let cursor = 0;
let pumping: Promise<void> | null = null;
let pumpAgain = false;
let started = false;

let rideDetector = new RideDetector();
let curves = new CurveDetector();
let stats = new RideStats();
let height = new HeightStats();
/** all fixes of the running ride (saved as its track when it ends) */
let track: Fix[] = [];
let lastFix: Fix | null = null;
/** curves found in the current batch, written to the store once per batch */
let newCurves: Curve[] = [];
/** totals of a ride that continues after its log was lost (web reload); added to the new stats */
let base: Pick<Ride, 'distanceM' | 'movingS' | 'topSpeed'> | null = null;
let lastNotify = { key: '', text: '', at: 0 };
/** last fix at walking speed or faster (for "Forgot to stop?") */
let lastMovingT: number | null = null;
let remindedStop = false;

const st = () => useStore.getState();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------------------------------------------------------------------------------------------
// processing

function activeRide() {
  const s = st();
  return s.activeId ? (s.rides.find((r) => r.id === s.activeId) ?? null) : null;
}

function feedRide(fix: Fix) {
  newCurves.push(...curves.push(fix));
  stats.push(fix);
  height.push(fix);
  track.push(fix);
}

/** Writes the curves and totals collected since the last flush to the store. */
function flushRide() {
  const id = st().activeId;
  if (!id) return;
  st().addCurves(id, newCurves);
  newCurves = [];
  const t = stats.totals();
  const distanceM = (base?.distanceM ?? 0) + t.distanceM;
  const movingS = (base?.movingS ?? 0) + t.movingS;
  st().updateRide(id, {
    distanceM,
    movingS,
    avgSpeed: movingS > 0 ? distanceM / movingS : 0,
    topSpeed: Math.max(base?.topSpeed ?? 0, t.topSpeed),
    // after a lost log (base) the height of the first part is unknown → leave it
    ...(base ? {} : { height: height.totals() }),
  });
}

function derivedSpeed(a: Fix, b: Fix) {
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return 0;
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) / dt;
}

/** One fix. `seq` = its number in the log. */
function onFix(fix: Fix, seq: number) {
  const speed = fix.speed ?? (lastFix ? derivedSpeed(lastFix, fix) : 0);
  lastFix = { ...fix, speed };
  if (speed >= 5 / 3.6) {
    lastMovingT = fix.t;
    remindedStop = false;
  }
  const session = st().session;
  if (!session) return;

  if (st().phase === 'riding') {
    feedRide(fix);
    // manual rides never end by themselves; automatic (experimental) ones do
    // TODO(plan 1.4): manual ride standing still for 60 min → notification "Forgot to stop?"
    if (session.mode === 'auto') {
      const ev = rideDetector.push(fix, speed);
      if (ev?.type === 'end') finishAutoRide(ev.at, seq + 1);
    }
    return;
  }
  const ev = rideDetector.push(fix, speed);
  if (ev?.type === 'start') {
    curves = new CurveDetector({ sensitivity: st().settings.sensitivity });
    stats = new RideStats();
    height = new HeightStats();
    track = [];
    base = null;
    newCurves = [];
    // deterministic id: replaying the same log rebuilds the same ride
    st().beginRide(ev.at, session.mode, `${session.id}-${ev.at}`);
    ev.backlog.forEach(feedRide);
  }
}

/**
 * Closes the active ride: final curve, too-short auto rides are dropped. The saved numbers come
 * from the analysis of the whole track; the track is saved for recounting / export.
 */
async function closeRide(at: number, discard: boolean): Promise<void> {
  const ride = activeRide();
  if (!ride) return;
  newCurves.push(...curves.flush());
  flushRide();
  const r = activeRide()!;
  const tooShort = r.mode === 'auto' && (r.distanceM < 1000 || at - r.startedAt < 120_000);
  st().clearUndo();
  if (discard || tooShort) {
    st().dropRide(r.id);
    return;
  }
  const fixes = track;
  const complete = base == null && fixes.length > 0;
  if (complete) st().updateRide(r.id, { ...analyzeTrack(fixes, st().settings.sensitivity), hasTrack: true });
  st().endRide(r.id, at);
  st().showSummary(r.id);
  if (complete) {
    try {
      await saveTrack(r.id, fixes);
    } catch {
      st().updateRide(r.id, { hasTrack: false });
    }
  }
}

/** Auto mode: ride ended by itself, the session keeps watching from fix `from` on. */
function finishAutoRide(at: number, from: number) {
  void closeRide(at, false);
  const session = st().session;
  if (session) st().setSession({ ...session, from });
  st().setPhase('watching');
  rideDetector = new RideDetector({ pauseMinutes: st().settings.pauseMinutes });
}

/** Processes everything new in the log. Safe to call any time, as often as you like. */
export function pump(): Promise<void> {
  if (pumping) {
    pumpAgain = true;
    return pumping;
  }
  pumping = (async () => {
    do {
      pumpAgain = false;
      for (;;) {
        const sid = st().session?.id;
        if (!sid) break;
        let fixes: Fix[];
        try {
          fixes = (await source.read(cursor, READ_LIMIT)).fixes;
        } catch {
          break;
        }
        if (st().session?.id !== sid || !fixes.length) break; // stopped while reading / nothing new
        const first = cursor;
        fixes.forEach((f, i) => onFix(f, first + i));
        cursor = first + fixes.length;
        flushRide();
        if (lastFix) st().setLive({ speed: lastFix.speed ?? 0, gpsWeak: lastFix.accuracy > 25 });
        updateNotification();
        if (fixes.length < READ_LIMIT) break;
      }
    } while (pumpAgain);
  })().finally(() => {
    pumping = null;
  });
  return pumping;
}

// ---------------------------------------------------------------------------------------------
// sessions

function resetDetectors(mode: Session['mode']) {
  rideDetector = new RideDetector(mode === 'manual' ? MANUAL_START : { pauseMinutes: st().settings.pauseMinutes });
  curves = new CurveDetector({ sensitivity: st().settings.sensitivity });
  stats = new RideStats();
  height = new HeightStats();
  track = [];
  lastFix = null;
  newCurves = [];
  base = null;
  lastNotify = { key: '', text: '', at: 0 };
  lastMovingT = null;
  remindedStop = false;
}

function subscribe() {
  unsubscribe?.();
  unsubscribe = source.onData(() => void pump());
}

/** Asks for what recording needs. Returns false if location was refused. */
async function ensurePermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || source.kind === 'demo') return true;
  try {
    const p = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (p.location !== 'granted') return false;
  } catch {
    return false;
  }
  // the permanent notification needs this on Android 13+ (recording works without it)
  await LocalNotifications.requestPermissions().catch(() => {});
  return true;
}

async function beginSession(mode: Session['mode']): Promise<boolean> {
  await endSession();
  st().setLive({ problem: null });
  if (!(await ensurePermissions())) {
    st().setLive({ problem: 'noLocation' });
    return false;
  }
  const id = uid();
  try {
    await source.start(id);
  } catch {
    st().setLive({ problem: 'noLocation' });
    return false;
  }
  cursor = 0;
  resetDetectors(mode);
  st().setSession({ id, from: 0, mode, startedAt: Date.now() });
  st().setPhase(mode === 'manual' ? 'armed' : 'watching');
  subscribe();
  updateNotification(true);
  void pump();
  return true;
}

async function endSession() {
  unsubscribe?.();
  unsubscribe = null;
  if (st().session) st().setSession(null);
  await source.stop().catch(() => {});
}

/** After a session ended: back to watching (auto on) or off. */
async function idle() {
  if (st().settings.auto && source.kind !== 'demo') {
    if (!(await beginSession('auto'))) st().setPhase('off');
  } else {
    await endSession();
    st().setPhase('off');
  }
  st().setLive({ speed: 0, gpsWeak: false });
}

// ---------------------------------------------------------------------------------------------
// notification

function updateNotification(force = false) {
  if (!source.notify) return;
  const s = st();
  const t = STRINGS[s.settings.lang];
  const ride = activeRide();
  let title: string;
  let text: string;
  if (s.phase === 'riding' && ride) {
    const now = Math.max(Date.now(), lastFix?.t ?? 0);
    title = t.statusRiding(fmtDuration(now - ride.startedAt));
    text = `↰ ${t.left} ${ride.left} · ${t.right} ${ride.right} ↱ · ${fmtSpeed(s.live.speed, s.settings.units)} ${speedUnit(s.settings.units)}`;
  } else {
    title = t.appName;
    text = s.phase === 'armed' ? t.statusArmed : t.statusWatching;
  }
  const full = `${title}\n${text}`;
  const key = `${s.phase}:${ride?.left}:${ride?.right}`;
  const now = Date.now();
  // phase or counts changed → right away; only speed/time changed → at most every 5 s
  if (!force && (full === lastNotify.text || (key === lastNotify.key && now - lastNotify.at < 5000))) return;
  lastNotify = { key, text: full, at: now };
  source.notify(title, text);
}

// ---------------------------------------------------------------------------------------------
// public API

export async function initEngine() {
  if (started) return;
  started = true;
  const s = st();
  if (s.session) {
    const running = await source.active().catch(() => null);
    if (running === s.session.id) {
      // recorder kept going while the app was gone → rebuild the ride from the log
      if (s.activeId) s.dropRide(s.activeId);
      resetDetectors(s.session.mode);
      cursor = s.session.from;
      st().setPhase(s.session.mode === 'manual' ? 'armed' : 'watching');
      subscribe();
      await pump();
    } else {
      // the log is gone (browser reload, recorder was stopped by the system)
      const ride = activeRide();
      const mode = s.session.mode;
      await endSession();
      if (ride) {
        // keep counting into the same ride; its totals so far are kept
        if (await beginSession(mode)) {
          rideDetector.force(true);
          base = { distanceM: ride.distanceM, movingS: ride.movingS, topSpeed: ride.topSpeed };
          st().setPhase('riding');
        }
      } else if (s.phase === 'armed') {
        await beginSession('manual');
      } else {
        await idle();
      }
    }
  } else {
    // e.g. state from an older version
    if (s.activeId) {
      const ride = activeRide();
      if (ride) s.endRide(ride.id, ride.startedAt + ride.movingS * 1000);
    }
    await idle();
  }

  setInterval(() => {
    // safety net in case a data ping got lost
    void pump();
    const ev = rideDetector.tick(Date.now());
    if (ev?.type === 'end' && st().phase === 'riding' && st().session?.mode === 'auto') finishAutoRide(ev.at, cursor);
    void checkReminders(Date.now());
    updateNotification();
  }, 5_000);

  watchTrackDeletes(useStore);
  // recount saved rides after a detector update or when the sensitivity setting changes
  let sens = st().settings.sensitivity;
  useStore.subscribe((s) => {
    if (s.settings.sensitivity !== sens) {
      sens = s.settings.sensitivity;
      void recountRides();
    }
  });
  void recountRides();

  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('resume', () => void pump());
    CapApp.addListener('pause', () => void flushStorage());
  }
}

const ARMED_TIMEOUT = 30 * 60_000;
const FORGOT_STOP = 60 * 60_000;
const NO_GPS = 60_000;

async function remind(title: string, body: string) {
  try {
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 1e6) + 10, title, body }] });
  } catch {
    /* notifications not allowed: the app shows it on screen anyway */
  }
}

/**
 * Plan 1.4 + Rule 1 "never fail silently": armed too long → ask and stop waiting; manual ride
 * standing still for an hour → ask once (never ends it by itself); no GPS → say so.
 * Exported for tests.
 */
export async function checkReminders(now: number) {
  const s = st();
  const session = s.session;
  if (!session || source.kind === 'demo') {
    if (s.live.noGps) s.setLive({ noGps: false });
    return;
  }
  const t = STRINGS[s.settings.lang];
  const lastT = lastFix?.t ?? session.startedAt ?? now;
  const noGps = (s.phase === 'armed' || s.phase === 'riding') && now - lastT > NO_GPS;
  if (noGps !== s.live.noGps) s.setLive({ noGps });

  if (s.phase === 'armed' && session.mode === 'manual' && session.startedAt && now - session.startedAt > ARMED_TIMEOUT) {
    await remind(t.remindArmedTitle, t.remindArmedText);
    await stopRide();
    return;
  }
  const ride = activeRide();
  if (s.phase === 'riding' && session.mode === 'manual' && ride && !remindedStop) {
    const since = lastMovingT ?? ride.startedAt;
    if (now - since > FORGOT_STOP) {
      remindedStop = true;
      await remind(t.remindStopTitle, t.remindStopText);
    }
  }
}

/** Big button: "Start ride" → armed (counting begins when actually moving). */
export async function startRide() {
  await beginSession('manual');
}

/** Big button: "Stop ride" (or "Not riding after all" while armed). */
export async function stopRide(discard = false) {
  await pump(); // take everything recorded up to now
  if (st().phase === 'riding') await closeRide(Math.max(Date.now(), lastFix?.t ?? 0), discard);
  await endSession();
  if (source.kind === 'demo') {
    source = defaultSource();
    st().setLive({ demo: false });
  }
  await idle();
  void flushStorage();
}

export async function setAutomatic(on: boolean) {
  st().updateSettings({ auto: on });
  const phase = st().phase;
  if (phase === 'off' && on) await idle();
  if (phase === 'watching' && !on) await idle();
}

/** Demo ride with simulated GPS (for trying the app at home). */
export async function startDemo() {
  if (st().phase === 'riding') return;
  await endSession();
  source = demoSource(() => void stopRide());
  st().setLive({ demo: true });
  await beginSession('manual');
}

/** Tests / future sources: replace where fixes come from. Call before `initEngine`. */
export function setSource(s: FixSource) {
  source = s;
}

let recounting: Promise<void> | null = null;

/**
 * Re-analyses finished rides whose numbers were made with an older algorithm or another
 * sensitivity (only rides with a saved track; older rides keep their numbers).
 */
export function recountRides(): Promise<void> {
  if (recounting) return recounting.then(() => recountRides());
  recounting = (async () => {
    for (;;) {
      const sens = st().settings.sensitivity;
      const ride = st().rides.find(
        (r) => r.hasTrack && r.endedAt != null && r.id !== st().activeId && (r.algo !== ALGO_VERSION || r.sensitivity !== sens),
      );
      if (!ride) break;
      const fixes = await loadTrack(ride.id);
      if (!st().rides.some((r) => r.id === ride.id)) continue; // deleted meanwhile
      if (!fixes || !fixes.length) {
        st().updateRide(ride.id, { hasTrack: false });
        continue;
      }
      const a = analyzeTrack(fixes, sens);
      // planned routes have made-up times: never show time or speed numbers for them
      st().updateRide(ride.id, ride.source === 'route' ? { ...a, movingS: 0, avgSpeed: 0, topSpeed: 0 } : a);
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
  })().finally(() => {
    recounting = null;
  });
  return recounting;
}
