import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { AndroidSettings, IOSSettings, NativeSettings } from 'capacitor-native-settings';
import { registerPlugin } from '@capacitor/core';
import { brandFor, guideFor, type Action, type Brand } from './guides/guides';
import { useStore } from './store';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

export function tapFeedback(strong = false) {
  if (!useStore.getState().settings.haptics) return;
  if (isNative) Haptics.impact({ style: strong ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
  else navigator.vibrate?.(strong ? 30 : 12);
}

let brandCache: Brand | null = null;
export async function detectBrand(): Promise<Brand> {
  if (brandCache) return brandCache;
  try {
    const info = await Device.getInfo();
    brandCache = brandFor(info.platform, info.manufacturer);
  } catch {
    brandCache = 'android';
  }
  return brandCache;
}

/** Native "Is everything OK?" check (Android): android/…/tracking/SetupPlugin.java */
interface SetupPlugin {
  check(): Promise<{
    location: boolean;
    precise: boolean;
    background: boolean;
    notifications: boolean;
    battery: boolean;
    manufacturer: string;
    locationOn?: boolean;
    powerSave?: boolean;
    backgroundRestricted?: boolean;
    gyro?: boolean;
  }>;
  open(options: { key: Action }): Promise<{ opened: boolean }>;
}
const Setup = registerPlugin<SetupPlugin>('Setup');

export type CheckState = 'ok' | 'bad' | 'unknown';
export type CheckKey = 'locationOn' | 'location' | 'precise' | 'background' | 'notifications' | 'battery' | 'restricted' | 'powerSave' | 'vendor';
export type Checks = Record<CheckKey, CheckState>;
/**
 * How bad a missing setting really is (shown with every item, plain words):
 * must        – without it nothing is counted at all
 * important   – counting will stop or have gaps on many phones
 * recommended – better with it, works without
 * optional    – can stay off
 */
export type Severity = 'must' | 'important' | 'recommended' | 'optional';

export interface CheckItem {
  key: CheckKey;
  severity: Severity;
  action: Action;
  /** the app can't read it – the user taps "I did it" */
  manual?: boolean;
}

export const EMPTY_CHECKS: Checks = {
  locationOn: 'unknown',
  location: 'unknown',
  precise: 'unknown',
  background: 'unknown',
  notifications: 'unknown',
  battery: 'unknown',
  restricted: 'unknown',
  powerSave: 'unknown',
  vendor: 'unknown',
};

/** The items that matter on this phone, most important first. */
export function checkItems(brand: Brand | null): CheckItem[] {
  if (!isNative) return [];
  if (platform === 'ios') {
    return [
      { key: 'location', severity: 'must', action: 'locationAlways' },
      { key: 'background', severity: 'recommended', action: 'appSettings', manual: true },
      { key: 'notifications', severity: 'optional', action: 'notifications' },
    ];
  }
  const vendorStep = guideFor(brand ?? 'android').steps.find((s) => s.action && !['locationAlways', 'batteryUnrestricted', 'appSettings', 'notifications'].includes(s.action));
  const items: CheckItem[] = [
    { key: 'locationOn', severity: 'must', action: 'locationServices' },
    { key: 'location', severity: 'must', action: 'locationAlways' },
    { key: 'precise', severity: 'must', action: 'appSettings' },
    { key: 'restricted', severity: 'important', action: 'appSettings' },
    { key: 'battery', severity: 'important', action: 'batteryUnrestricted' },
  ];
  if (vendorStep?.action) items.push({ key: 'vendor', severity: 'important', action: vendorStep.action, manual: true });
  items.push(
    { key: 'background', severity: 'recommended', action: 'locationAlways' },
    { key: 'powerSave', severity: 'recommended', action: 'powerSave' },
    { key: 'notifications', severity: 'optional', action: 'notifications' },
  );
  return items;
}

const SEVERITY_RANK: Record<Severity, number> = { must: 0, important: 1, recommended: 2, optional: 3 };
export const bySeverity = (a: CheckItem, b: CheckItem) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

/** Items that are not OK (unknown manual items count as not OK until confirmed). */
export function problems(items: CheckItem[], checks: Checks, upTo: Severity = 'optional'): CheckItem[] {
  return items.filter((i) => SEVERITY_RANK[i.severity] <= SEVERITY_RANK[upTo] && checks[i.key] === 'bad').sort(bySeverity);
}

/**
 * Android: exact states from the Setup plugin. iPhone: "Always" can't be read with the stock
 * plugin, so the user confirms it once.
 */
export async function runChecks(): Promise<Checks> {
  const res: Checks = { ...EMPTY_CHECKS };
  const confirmed = new Set(useStore.getState().settings.confirmed);
  res.vendor = confirmed.has('vendor') ? 'ok' : 'bad';
  if (!isNative) return { ...EMPTY_CHECKS };
  if (platform === 'android') {
    try {
      const c = await Setup.check();
      const yes = (v: boolean | undefined, okIf = true): CheckState => (v == null ? 'unknown' : v === okIf ? 'ok' : 'bad');
      res.locationOn = yes(c.locationOn);
      res.location = yes(c.location);
      res.precise = c.location ? yes(c.precise) : 'bad';
      res.background = yes(c.background);
      res.notifications = yes(c.notifications);
      res.battery = yes(c.battery);
      res.restricted = yes(c.backgroundRestricted, false);
      res.powerSave = yes(c.powerSave, false);
    } catch {
      /* stays unknown */
    }
    return res;
  }
  try {
    const p = await Geolocation.checkPermissions();
    res.location = p.location === 'granted' ? 'ok' : 'bad';
  } catch {
    /* ignore */
  }
  res.background = confirmed.has('background') ? 'ok' : 'bad';
  try {
    const n = await LocalNotifications.checkPermissions();
    res.notifications = n.display === 'granted' ? 'ok' : 'bad';
  } catch {
    /* ignore */
  }
  return res;
}

const openApp = () => NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App });

/** Runs a guide/check button: asks for the permission or opens exactly the right page. */
export async function runAction(action: Action): Promise<void> {
  if (!isNative) return;
  try {
    if (platform === 'android') {
      if (action === 'locationAlways') {
        // first the normal question (precise location), then "Allow all the time"
        const p = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (p.location !== 'granted') {
          await Setup.open({ key: 'appSettings' });
          return;
        }
      }
      if (action === 'notifications') {
        const n = await LocalNotifications.requestPermissions();
        if (n.display === 'granted') return;
      }
      await Setup.open({ key: action });
      return;
    }
    // iPhone
    switch (action) {
      case 'locationAlways':
        await Geolocation.requestPermissions({ permissions: ['location'] });
        return;
      case 'notifications': {
        const n = await LocalNotifications.requestPermissions();
        if (n.display !== 'granted') await openApp();
        return;
      }
      default:
        await openApp();
    }
  } catch {
    await openApp().catch(() => {});
  }
}
