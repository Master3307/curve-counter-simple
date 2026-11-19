/**
 * Glue: GPS fixes → ride detector → curve detector + ride stats → store.
 * Runs in the WebView for now (foreground only). The native plugin will take this over.
 */
import { CurveDetector } from '../logic/curves';
import type { Fix } from '../logic/geo';
import { MANUAL_START, RideDetector } from '../logic/rideDetector';
import { RideStats } from '../logic/rideStats';
import { useStore } from '../store';
import { playDemo, watchGps, type Stop } from './source';

let stopSource: Stop | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let rideDetector = new RideDetector();
let curves = new CurveDetector();
let stats = new RideStats();
let lastFix: Fix | null = null;

const st = () => useStore.getState();

function feedRide(fix: Fix) {
  const id = st().activeId;
  if (!id) return;
  st().addCurves(id, curves.push(fix));
  stats.push(fix);
  const t = stats.totals();
  st().updateRide(id, { distanceM: t.distanceM, movingS: t.movingS, avgSpeed: t.avgSpeed, topSpeed: t.topSpeed });
}

function onFix(fix: Fix) {
  const speed = fix.speed ?? (lastFix ? derivedSpeed(lastFix, fix) : 0);
  lastFix = fix;
  st().setLive({ speed, gpsWeak: fix.accuracy > 25 });

  const { phase } = st();
  if (phase === 'riding') {
    feedRide(fix);
    // manual rides never end by themselves; automatic (experimental) ones do
    if (st().rides.find((r) => r.id === st().activeId)?.mode === 'auto') {
      const ev = rideDetector.push(fix, speed);
      if (ev?.type === 'end') finishRide(ev.at);
    }
    return;
  }
  if (phase === 'armed' || phase === 'watching') {
    const ev = rideDetector.push(fix, speed);
    if (ev?.type === 'start') {
      resetDetectors();
      st().beginRide(ev.at, phase === 'armed' ? 'manual' : 'auto');
      ev.backlog.forEach(feedRide);
    }
  }
}

function derivedSpeed(a: Fix, b: Fix) {
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return 0;
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) / dt;
}

function resetDetectors() {
  curves = new CurveDetector({ sensitivity: st().settings.sensitivity });
  stats = new RideStats();
}

function finishRide(at: number, discard = false) {
  const id = st().activeId;
  if (!id) return;
  st().addCurves(id, curves.flush());
  const ride = st().rides.find((r) => r.id === id);
  const tooShort = ride && ride.mode === 'auto' && (ride.distanceM < 1000 || at - ride.startedAt < 120_000);
  if (discard || tooShort) st().deleteRide(id);
  else st().endRide(id, at);
  st().clearUndo();
  rideDetector = new RideDetector({ pauseMinutes: st().settings.pauseMinutes });
  syncSource();
}

/** Start or stop GPS depending on the phase (GPS only runs when needed). */
async function syncSource() {
  const needGps = st().phase !== 'off';
  if (needGps && !stopSource && !st().live.demo) {
    try {
      stopSource = await watchGps(onFix);
    } catch {
      stopSource = null;
    }
  } else if (!needGps && stopSource) {
    stopSource();
    stopSource = null;
  }
}

export function initEngine() {
  const s = st();
  // a ride that was running when the app was closed: keep it running
  if (s.phase === 'armed') rideDetector = new RideDetector(MANUAL_START);
  if (s.phase === 'riding') resetDetectors();
  if (s.phase === 'off' && s.settings.auto) s.setPhase('watching');
  syncSource();
  tickTimer ??= setInterval(() => {
    const ev = rideDetector.tick(Date.now());
    if (ev?.type === 'end' && st().phase === 'riding') finishRide(ev.at);
  }, 30_000);
}

/** Big button: "Start ride" → armed (counting begins when actually moving). */
export function startRide() {
  rideDetector = new RideDetector(MANUAL_START);
  st().setPhase('armed');
  syncSource();
}

/** Big button: "Stop ride" (or "Not riding after all" while armed). */
export function stopRide(discard = false) {
  if (st().phase === 'riding') finishRide(Date.now(), discard);
  else {
    st().setPhase(st().settings.auto ? 'watching' : 'off');
    syncSource();
  }
}

export function setAutomatic(on: boolean) {
  st().updateSettings({ auto: on });
  if (st().phase === 'off' && on) st().setPhase('watching');
  if (st().phase === 'watching' && !on) st().setPhase('off');
  rideDetector = new RideDetector({ pauseMinutes: st().settings.pauseMinutes });
  syncSource();
}

/** Demo ride with simulated GPS (for trying the app at home). */
export function startDemo() {
  stopSource?.();
  stopSource = null;
  st().setLive({ demo: true });
  startRide();
  stopSource = playDemo(onFix, () => {
    stopRide();
    st().setLive({ demo: false, speed: 0 });
    stopSource = null;
    syncSource();
  });
}
