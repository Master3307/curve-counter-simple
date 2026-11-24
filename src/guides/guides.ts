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

/** What a step's button does (native: SetupPlugin.open). */
export type Action =
  | 'locationAlways'
  | 'notifications'
  | 'batteryUnrestricted'
  | 'appSettings'
  | 'locationServices'
  | 'powerSave'
  | 'xiaomiAutostart'
  | 'huaweiAppLaunch'
  | 'honorAppLaunch'
  | 'oppoAutostart'
  | 'vivoBackground'
  | 'samsungNeverSleeping';

export interface Step {
  text: Record<Lang, string>;
  action?: Action;
  /** the traffic light this step fixes – the step shows ✓ once it is green */
  check?: 'location' | 'notifications' | 'battery';
}

export interface Guide {
  brand: Brand;
  name: string;
  steps: Step[];
}

/**
 * Writing rules for every step (Rule 2):
 * - one thing per step, short sentences, the words the phone really shows in „quotes“
 * - start with the button: „Tippe auf Öffnen.“ – the button below the text says exactly that
 * - say what to pick on the page that opens, nothing else
 */

/** Steps every Android phone needs. `check` = the matching traffic light (step shows ✓ when green). */
const ANDROID_BASE: Step[] = [
  {
    text: {
      de: 'Standort: Tippe auf „Öffnen“. Wähle „Immer zulassen“.',
      en: 'Location: Tap "Open". Choose "Allow all the time".',
    },
    action: 'locationAlways',
    check: 'location',
  },
  {
    text: {
      de: 'Akku: Tippe auf „Öffnen“. Tippe auf „Zulassen“.',
      en: 'Battery: Tap "Open". Tap "Allow".',
    },
    action: 'batteryUnrestricted',
    check: 'battery',
  },
];

const lockInRecents: Step = {
  text: {
    de: 'Wische vom unteren Rand nach oben und halte kurz. Halte die App gedrückt. Tippe auf das Schloss 🔒.',
    en: 'Swipe up from the bottom and hold. Press and hold the app. Tap the lock 🔒.',
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
          de: 'Samsung: Tippe auf „Öffnen“. Dann „Nie in Standby versetzte Apps“ → „+“ → „Curve Counter Simple“.',
          en: 'Samsung: Tap "Open". Then "Never sleeping apps" → "+" → "Curve Counter Simple".',
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
          de: 'Autostart: Tippe auf „Öffnen“. Schalte „Curve Counter Simple“ EIN.',
          en: 'Autostart: Tap "Open". Switch "Curve Counter Simple" ON.',
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
          de: 'App-Start: Tippe auf „Öffnen“. Schalte „Curve Counter Simple“ AUS. Im Fenster dann alle 3 Schalter EIN.',
          en: 'App launch: Tap "Open". Switch "Curve Counter Simple" OFF. Then switch all 3 options ON in the window.',
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
          de: 'App-Start: Tippe auf „Öffnen“. Schalte „Curve Counter Simple“ AUS. Im Fenster dann alle 3 Schalter EIN.',
          en: 'App launch: Tap "Open". Switch "Curve Counter Simple" OFF. Then switch all 3 options ON in the window.',
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
          de: 'Autostart: Tippe auf „Öffnen“. Schalte „Autostart erlauben“ und „Hintergrundaktivität erlauben“ EIN.',
          en: 'Autostart: Tap "Open". Switch "Allow auto launch" and "Allow background activity" ON.',
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
          de: 'Hintergrund: Tippe auf „Öffnen“. Schalte „Hohen Akkuverbrauch im Hintergrund erlauben“ EIN.',
          en: 'Background: Tap "Open". Switch "Allow high background power consumption" ON.',
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
          de: 'Vor langen Fahrten: „STAMINA-Modus“ ausschalten. Du findest ihn unter Einstellungen → Akku.',
          en: 'Before long rides: switch "STAMINA mode" off. You find it in Settings → Battery.',
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
          de: 'Falls es trotzdem stoppt: Tippe auf „Öffnen“ → „Akku“ → „Nicht eingeschränkt“.',
          en: 'If it still stops: Tap "Open" → "Battery" → "Unrestricted".',
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
          de: 'Standort: Tippe auf „Öffnen“ → „Standort“. Wähle „Immer“. Schalte „Genauer Standort“ EIN.',
          en: 'Location: Tap "Open" → "Location". Choose "Always". Switch "Precise Location" ON.',
        },
        action: 'appSettings',
        check: 'location',
      },
      {
        text: {
          de: 'Hintergrund: Tippe auf „Öffnen“. Schalte „Hintergrundaktualisierung“ EIN.',
          en: 'Background: Tap "Open". Switch "Background App Refresh" ON.',
        },
        action: 'appSettings',
      },
      {
        text: {
          de: 'Während der Fahrt: App NICHT wegwischen. Bei langen Fahrten den Stromsparmodus aus.',
          en: "While riding: DON'T swipe the app away. On long rides, turn Low Power Mode off.",
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
