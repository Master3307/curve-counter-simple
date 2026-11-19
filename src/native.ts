import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { AndroidSettings, IOSSettings, NativeSettings } from 'capacitor-native-settings';
import { registerPlugin } from '@capacitor/core';
import { brandFor, type Action, type Brand } from './guides/guides';
import { useStore } from './store';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

export function tapFeedback(strong = false) {
  if (!useStore.getState().settings.haptics) return;
  if (isNative) Haptics.impact({ style: strong ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
  else navigator.vibrate?.(strong ? 30 : 12);
}

export async function detectBrand(): Promise<Brand> {
  try {
    const info = await Device.getInfo();
    return brandFor(info.platform, info.manufacturer);
  } catch {
    return 'android';
  }
}

/** Native "Is everything OK?" check (Android): android/…/tracking/SetupPlugin.java */
interface SetupPlugin {
  check(): Promise<{ location: boolean; precise: boolean; background: boolean; notifications: boolean; battery: boolean; manufacturer: string }>;
  open(options: { key: Action }): Promise<{ opened: boolean }>;
}
const Setup = registerPlugin<SetupPlugin>('Setup');

export type CheckState = 'ok' | 'bad' | 'unknown';
export interface Checks {
  location: CheckState;
  notifications: CheckState;
  battery: CheckState;
}

/**
 * Android: exact states from the Setup plugin. iPhone: "Always" can't be read with the stock
 * plugin yet (TODO(milestone 5): native iOS check), so it shows "please check once".
 */
export async function runChecks(): Promise<Checks> {
  const res: Checks = { location: 'unknown', notifications: 'unknown', battery: 'unknown' };
  if (!isNative) return res;
  if (platform === 'android') {
    try {
      const c = await Setup.check();
      res.location = c.location && c.precise && c.background ? 'ok' : 'bad';
      res.notifications = c.notifications ? 'ok' : 'bad';
      res.battery = c.battery ? 'ok' : 'bad';
    } catch {
      /* stays unknown */
    }
    return res;
  }
  try {
    const p = await Geolocation.checkPermissions();
    res.location = p.location === 'granted' ? 'unknown' : 'bad';
  } catch {
    /* ignore */
  }
  try {
    const n = await LocalNotifications.checkPermissions();
    res.notifications = n.display === 'granted' ? 'ok' : 'bad';
  } catch {
    /* ignore */
  }
  return res;
}

const openApp = () =>
  NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App });

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
      case 'notifications':
        await LocalNotifications.requestPermissions();
        return;
      default:
        await openApp();
    }
  } catch {
    await openApp().catch(() => {});
  }
}
