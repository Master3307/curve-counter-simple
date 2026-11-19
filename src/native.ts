import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { AndroidSettings, IOSSettings, NativeSettings } from 'capacitor-native-settings';
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

export type CheckState = 'ok' | 'bad' | 'unknown';
export interface Checks {
  location: CheckState;
  notifications: CheckState;
  battery: CheckState;
}

/**
 * Placeholder checks. "Allow all the time" (background) can't be read with the stock
 * geolocation plugin – the native SimpleCurveCounter plugin will report it exactly.
 */
export async function runChecks(): Promise<Checks> {
  const res: Checks = { location: 'unknown', notifications: 'unknown', battery: 'unknown' };
  if (!isNative) return res;
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
  if (platform === 'android') {
    try {
      const b = await BatteryOptimization.isBatteryOptimizationEnabled();
      res.battery = b.enabled ? 'bad' : 'ok';
    } catch {
      /* ignore */
    }
  }
  return res;
}

const openApp = () =>
  NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App });

/** Runs a guide/check button. Vendor pages fall back to the app's settings page for now. */
export async function runAction(action: Action): Promise<void> {
  if (!isNative) return;
  try {
    switch (action) {
      case 'locationAlways': {
        const p = await Geolocation.requestPermissions({ permissions: ['location'] });
        // Android 11+: "all the time" can only be chosen on the settings page
        if (p.location === 'granted' && platform === 'android') await openApp();
        return;
      }
      case 'notifications':
        await LocalNotifications.requestPermissions();
        return;
      case 'batteryUnrestricted':
        if (platform === 'android') await BatteryOptimization.requestIgnoreBatteryOptimization();
        return;
      default:
        // TODO(native plugin): SimpleCurveCounter.openVendorSetting({ key: action })
        await openApp();
    }
  } catch {
    await openApp().catch(() => {});
  }
}
