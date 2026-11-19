/**
 * Planned native plugin `CurveTracker` (Kotlin foreground service / Swift CLLocationManager).
 * NOT implemented yet – this file is the contract the native side will fulfil.
 * Native code owns GPS, ride detection, curve detection and storage, so counting continues
 * when the WebView is frozen or the app is in the background. The web UI only reads and controls.
 */
import type { Curve, Sensitivity } from '../logic/curves';
import type { Phase, Ride } from '../store';

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

export interface CurveTrackerPlugin {
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
