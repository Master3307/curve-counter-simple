/**
 * "Keep the app alive" guides per phone brand. Rule: max 3 steps, short sentences,
 * every step that can open the right screen has a button (`action`).
 * Names of settings follow what the phones actually show (de/en); sources: dontkillmyapp.com.
 */
import type { Lang } from '../i18n/strings';

export type Brand =
  | 'samsung'
  | 'xiaomi'
  | 'huawei'
  | 'honor'
  | 'oneplus'
  | 'oppo'
  | 'vivo'
  | 'google'
  | 'motorola'
  | 'sony'
  | 'nokia'
  | 'android'
  | 'iphone';

/** What a step's button does. Vendor keys are opened by the native plugin later. */
export type Action =
  | 'locationAlways'
  | 'notifications'
  | 'batteryUnrestricted'
  | 'appSettings'
  | 'xiaomiAutostart'
  | 'huaweiAppLaunch'
  | 'honorAppLaunch'
  | 'oppoAutostart'
  | 'vivoBackground'
  | 'samsungNeverSleeping';

export interface Step {
  text: Record<Lang, string>;
  action?: Action;
}

export interface Guide {
  brand: Brand;
  name: string;
  steps: Step[];
}

/** First steps every Android phone needs. */
const ANDROID_BASE: Step[] = [
  {
    text: {
      de: 'Tippe auf den Knopf. Wähle „Immer zulassen“.',
      en: 'Tap the button. Choose "Allow all the time".',
    },
    action: 'locationAlways',
  },
  {
    text: {
      de: 'Tippe auf den Knopf. Tippe auf „Zulassen“.',
      en: 'Tap the button. Tap "Allow".',
    },
    action: 'batteryUnrestricted',
  },
];

const lockInRecents: Step = {
  text: {
    de: 'Öffne die zuletzt benutzten Apps. Halte die App „Simple Curve Counter“ gedrückt und tippe auf das Schloss 🔒.',
    en: 'Open your recent apps. Press and hold Simple Curve Counter and tap the lock 🔒.',
  },
};

export const GUIDES: Guide[] = [
  {
    brand: 'samsung',
    name: 'Samsung',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf → „Nie in Standby versetzte Apps“ → „+“ → Simple Curve Counter.',
          en: 'Tap the button → "Never sleeping apps" → "+" → Simple Curve Counter.',
        },
        action: 'samsungNeverSleeping',
      },
    ],
  },
  {
    brand: 'xiaomi',
    name: 'Xiaomi / Redmi / POCO',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf. Schalte „Autostart“ für Simple Curve Counter EIN. Dann: App in den letzten Apps mit dem Schloss 🔒 sichern.',
          en: 'Tap the button. Switch "Autostart" ON for Simple Curve Counter. Then lock the app 🔒 in your recent apps.',
        },
        action: 'xiaomiAutostart',
      },
    ],
  },
  {
    brand: 'huawei',
    name: 'Huawei',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf → „App-Start“. Simple Curve Counter AUS schalten, dann im Fenster alle 3 Schalter EIN.',
          en: 'Tap the button → "App launch". Switch Simple Curve Counter OFF, then switch all 3 options ON in the window.',
        },
        action: 'huaweiAppLaunch',
      },
    ],
  },
  {
    brand: 'honor',
    name: 'Honor',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf → „App-Start“. Simple Curve Counter AUS schalten, dann im Fenster alle 3 Schalter EIN.',
          en: 'Tap the button → "App launch". Switch Simple Curve Counter OFF, then switch all 3 options ON in the window.',
        },
        action: 'honorAppLaunch',
      },
    ],
  },
  { brand: 'oneplus', name: 'OnePlus', steps: [...ANDROID_BASE, lockInRecents] },
  {
    brand: 'oppo',
    name: 'OPPO / realme',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf. Schalte „Autostart erlauben“ und „Hintergrundaktivität erlauben“ EIN.',
          en: 'Tap the button. Switch "Allow auto launch" and "Allow background activity" ON.',
        },
        action: 'oppoAutostart',
      },
    ],
  },
  {
    brand: 'vivo',
    name: 'vivo',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf. Schalte „Hohen Akkuverbrauch im Hintergrund erlauben“ EIN.',
          en: 'Tap the button. Switch "Allow high background power consumption" ON.',
        },
        action: 'vivoBackground',
      },
    ],
  },
  { brand: 'google', name: 'Google Pixel', steps: ANDROID_BASE },
  { brand: 'motorola', name: 'Motorola', steps: ANDROID_BASE },
  {
    brand: 'sony',
    name: 'Sony',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Schalte vor langen Fahrten den „STAMINA-Modus“ aus (Einstellungen → Akku).',
          en: 'Before long rides, switch "STAMINA mode" off (Settings → Battery).',
        },
      },
    ],
  },
  { brand: 'nokia', name: 'Nokia', steps: ANDROID_BASE },
  {
    brand: 'android',
    name: 'Android',
    steps: [
      ...ANDROID_BASE,
      {
        text: {
          de: 'Tippe auf den Knopf → „Akku“ → wähle „Nicht eingeschränkt“.',
          en: 'Tap the button → "Battery" → choose "Unrestricted".',
        },
        action: 'appSettings',
      },
    ],
  },
  {
    brand: 'iphone',
    name: 'iPhone',
    steps: [
      {
        text: {
          de: 'Tippe auf den Knopf → „Standort“ → wähle „Immer“ und schalte „Genauer Standort“ EIN.',
          en: 'Tap the button → "Location" → choose "Always" and switch "Precise Location" ON.',
        },
        action: 'appSettings',
      },
      {
        text: {
          de: 'Auf derselben Seite: „Hintergrundaktualisierung“ EIN.',
          en: 'On the same page: switch "Background App Refresh" ON.',
        },
        action: 'appSettings',
      },
      {
        text: {
          de: 'Wichtig: App während der Fahrt NICHT wegwischen. Stromsparmodus bei langen Fahrten aus.',
          en: "Important: DON'T swipe the app away while riding. Turn Low Power Mode off on long rides.",
        },
      },
    ],
  },
];

/** Picks the guide from the manufacturer string (@capacitor/device). */
export function brandFor(platform: string, manufacturer: string): Brand {
  if (platform === 'ios') return 'iphone';
  const m = manufacturer.toLowerCase();
  if (m.includes('samsung')) return 'samsung';
  if (/xiaomi|redmi|poco/.test(m)) return 'xiaomi';
  if (m.includes('huawei')) return 'huawei';
  if (m.includes('honor')) return 'honor';
  if (m.includes('oneplus')) return 'oneplus';
  if (/oppo|realme/.test(m)) return 'oppo';
  if (/vivo|iqoo/.test(m)) return 'vivo';
  if (m.includes('google')) return 'google';
  if (/motorola|lenovo/.test(m)) return 'motorola';
  if (m.includes('sony')) return 'sony';
  if (/nokia|hmd/.test(m)) return 'nokia';
  return 'android';
}

export const guideFor = (brand: Brand) => GUIDES.find((g) => g.brand === brand) ?? GUIDES.find((g) => g.brand === 'android')!;
