/**
 * Native plugins.
 *
 * 1. `Recorder` (IMPLEMENTED, Android): a foreground service that records GPS fixes into a
 *    file, with a permanent notification, so a ride keeps recording with the screen off and
 *    survives the app being killed. The counting itself still runs in TS (engine.ts), which
 *    replays the fix log whenever the WebView is awake.
 *    Android code: android/app/src/main/java/com/korbi/simplecurvecounter/tracking/
 *
 * 2. `SimpleCurveCounterPlugin` (PLANNED, see plan 1.5): native code owns ride detection,
 *    curve detection and storage (Room / SQLite), so the notification shows live counts even
 *    while the WebView sleeps. Contract only – not implemented yet.
 */
import { registerPlugin } from '@capacitor/core';
import type { Curve, Sensitivity } from '../logic/curves';
import type { Fix } from '../logic/geo';
import type { Phase, Ride } from '../store';

// ---------------------------------------------------------------------------------------------
// 1. Recorder (implemented)

export interface RecorderPlugin {
  /** Starts the foreground service and a fresh fix log for `sessionId`. */
  start(options: { sessionId: string }): Promise<void>;
  /** Stops the service and deletes the log. */
  stop(): Promise<void>;
  /** Up to `limit` fixes with sequence number ≥ from (numbers start at 0). */
  read(options: { from: number; limit: number }): Promise<{ fixes: Fix[] }>;
  /** sessionId is set while the service is recording (also after the app was killed). */
  status(): Promise<{ sessionId: string | null; count: number }>;
  updateNotification(options: { title: string; text: string }): Promise<void>;
  addListener(event: 'fix', cb: () => void): Promise<{ remove(): Promise<void> }>;
}

export const Recorder = registerPlugin<RecorderPlugin>('Recorder');

/** Files opened with / shared to the app (Android). */
export interface InboxPlugin {
  take(): Promise<{ files: { name: string; text: string }[] }>;
  addListener(event: 'files', cb: () => void): Promise<{ remove(): Promise<void> }>;
}

export const Inbox = registerPlugin<InboxPlugin>('Inbox');

// ---------------------------------------------------------------------------------------------
// 2. SimpleCurveCounter (planned)

export interface TrackerConfig {
  auto: boolean;
  sensitivity: Sensitivity;
  pauseMinutes: number;
  /** notification texts in the current app language */
  notification: { title: string; riding: string; watching: string };
}

export interface TrackerStatus {
  phase: Phase;
  activeRide: Ride | null;
  /** m/s */
  speed: number;
  gpsWeak: boolean;
}

export type Permission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface PermissionReport {
  locationAlways: Permission;
  preciseLocation: Permission;
  notifications: Permission;
  /** Android: app is exempt from battery optimisation */
  batteryUnrestricted: Permission;
  /** iOS: Background App Refresh on */
  backgroundRefresh: Permission;
  /** Android: vendor extra (Xiaomi autostart, Huawei app launch …) – can't be read, user confirms */
  vendorExtra: Permission;
}

export interface SimpleCurveCounterPlugin {
  configure(config: TrackerConfig): Promise<void>;
  /** Manual start: arms the ride – it begins when the bike is actually moving. */
  arm(): Promise<void>;
  stop(options: { discard?: boolean }): Promise<void>;
  status(): Promise<TrackerStatus>;
  listRides(options: { offset: number; limit: number }): Promise<{ rides: Ride[] }>;
  deleteRide(options: { id: string }): Promise<void>;
  deleteAll(): Promise<void>;
  /** Re-run the post-ride analysis (e.g. after changing sensitivity). */
  recalculate(options: { id?: string; sensitivity: Sensitivity }): Promise<void>;

  checkPermissions(): Promise<PermissionReport>;
  requestLocationAlways(): Promise<PermissionReport>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  /** Opens the vendor-specific page (xiaomiAutostart, huaweiAppLaunch, samsungNeverSleeping …). */
  openVendorSetting(options: { key: string }): Promise<{ opened: boolean }>;

  addListener(event: 'curve', cb: (c: Curve & { rideId: string }) => void): Promise<{ remove(): void }>;
  addListener(event: 'status', cb: (s: TrackerStatus) => void): Promise<{ remove(): void }>;
}
