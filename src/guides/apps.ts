/**
 * "Send to your apps" and "Bring rides from other apps": one short guide per app, with the file
 * format that app understands best. Rule 2: short steps, the words the app really shows.
 * Apps change their menus – these were written in Nov 2026; links open the official pages.
 */
import type { Format } from '../logic/formats';
import type { Lang } from '../i18n/strings';

export interface AppGuide {
  id: string;
  name: string;
  /** formats the app takes, best first */
  formats: Format[];
  /** steps after tapping "Share file" in our app */
  send?: Record<Lang, string[]>;
  /** steps to get a ride OUT of that app and INTO ours */
  bring?: Record<Lang, string[]>;
  /** official page that the guide mentions */
  url?: string;
}

const SHARE_DE = 'Tippe unten auf „Datei teilen“.';
const SHARE_EN = 'Tap "Share file" below.';

export const APP_GUIDES: AppGuide[] = [
  {
    id: 'bmw',
    name: 'BMW Motorrad Connected',
    formats: ['gpx'],
    send: {
      de: [SHARE_DE, 'Wähle „BMW Motorrad Connected“.', 'Die Strecke erscheint dort als geplante Route.'],
      en: [SHARE_EN, 'Pick "BMW Motorrad Connected".', 'The ride shows up there as a planned route.'],
    },
    bring: {
      de: ['Öffne in der BMW-App deine Fahrt (Meine Fahrten).', 'Tippe auf Teilen / Exportieren → „GPX“.', 'Wähle „Curve Counter Simple“. Fertig.'],
      en: ['In the BMW app, open your ride (My Rides).', 'Tap Share / Export → "GPX".', 'Pick "Curve Counter Simple". Done.'],
    },
  },
  {
    id: 'strava',
    name: 'Strava',
    formats: ['gpx'],
    url: 'https://www.strava.com/upload/select',
    send: {
      de: ['Strava nimmt Dateien nur auf der Webseite an, nicht in der App.', SHARE_DE + ' Speichere die Datei (z. B. „In Dateien sichern“).', 'Öffne strava.com/upload im Browser → „Datei auswählen“ → die Datei.'],
      en: ['Strava only takes files on its website, not in the app.', SHARE_EN + ' Save the file (e.g. "Save to Files").', 'Open strava.com/upload in the browser → "Choose file" → the file.'],
    },
    bring: {
      de: ['Öffne die Aktivität auf strava.com im Browser.', 'Tippe auf „…“ → „GPX exportieren“.', 'Öffne die Datei mit „Curve Counter Simple“.'],
      en: ['Open the activity on strava.com in the browser.', 'Tap "…" → "Export GPX".', 'Open the file with "Curve Counter Simple".'],
    },
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    formats: ['gpx'],
    url: 'https://connect.garmin.com/modern/import-data',
    send: {
      de: [SHARE_DE + ' Speichere die Datei.', 'Öffne connect.garmin.com im Browser.', 'Als Fahrt: „Daten importieren“. Als Strecke zum Nachfahren: „Strecken“ → „Importieren“.'],
      en: [SHARE_EN + ' Save the file.', 'Open connect.garmin.com in the browser.', 'As an activity: "Import Data". As a course to follow: "Courses" → "Import".'],
    },
    bring: {
      de: ['Öffne die Aktivität auf connect.garmin.com.', 'Zahnrad → „Als GPX exportieren“.', 'Öffne die Datei mit „Curve Counter Simple“.'],
      en: ['Open the activity on connect.garmin.com.', 'Gear icon → "Export to GPX".', 'Open the file with "Curve Counter Simple".'],
    },
  },
  {
    id: 'komoot',
    name: 'Komoot',
    formats: ['gpx'],
    url: 'https://www.komoot.com/upload',
    send: {
      de: [SHARE_DE, 'Wähle „Komoot“. Fehlt es in der Liste: Datei speichern und auf komoot.com/upload hochladen.', 'Komoot fragt: geplante oder gemachte Tour.'],
      en: [SHARE_EN, 'Pick "Komoot". Not in the list? Save the file and upload it at komoot.com/upload.', 'Komoot asks: planned or completed tour.'],
    },
    bring: {
      de: ['Öffne die Tour in Komoot.', 'Tippe auf „…“ → „GPX herunterladen“.', 'Öffne die Datei mit „Curve Counter Simple“.'],
      en: ['Open the tour in Komoot.', 'Tap "…" → "Download GPX".', 'Open the file with "Curve Counter Simple".'],
    },
  },
  {
    id: 'alltrails',
    name: 'AllTrails',
    formats: ['gpx', 'kml'],
    url: 'https://www.alltrails.com/my/maps',
    send: {
      de: [SHARE_DE + ' Speichere die Datei.', 'Öffne alltrails.com im Browser → „Meine Karten“ → „Karte erstellen“.', 'Tippe auf „Datei importieren“ und wähle die Datei.'],
      en: [SHARE_EN + ' Save the file.', 'Open alltrails.com in the browser → "My maps" → "Create map".', 'Tap "Import file" and pick the file.'],
    },
  },
  {
    id: 'googlemaps',
    name: 'Google Maps (Google My Maps)',
    formats: ['kml', 'kmz', 'gpx', 'csv'],
    url: 'https://www.google.com/maps/d/',
    send: {
      de: [
        'Google Maps selbst kann keine Dateien öffnen – dafür gibt es „Google My Maps“.',
        SHARE_DE + ' Speichere die Datei.',
        'Öffne google.com/maps/d im Browser → „Neue Karte“ → „Importieren“ → Datei. Danach steht die Karte in Google Maps unter „Gespeichert“ → „Karten“.',
      ],
      en: [
        'Google Maps itself can\'t open files – "Google My Maps" can.',
        SHARE_EN + ' Save the file.',
        'Open google.com/maps/d in the browser → "Create a new map" → "Import" → file. The map then shows in Google Maps under "Saved" → "Maps".',
      ],
    },
    bring: {
      de: ['Öffne deine Karte auf google.com/maps/d im Browser.', 'Menü „⋮“ → „Als KML/KMZ exportieren“.', 'Öffne die Datei mit „Curve Counter Simple“. Linien werden zu Strecken, Punkte zu Wegpunkten.'],
      en: ['Open your map on google.com/maps/d in the browser.', 'Menu "⋮" → "Export to KML/KMZ".', 'Open the file with "Curve Counter Simple". Lines become routes, points become waypoints.'],
    },
  },
  {
    id: 'googleearth',
    name: 'Google Earth',
    formats: ['kmz', 'kml'],
    url: 'https://earth.google.com/web/',
    send: {
      de: [SHARE_DE, 'Wähle „Google Earth“ – oder öffne earth.google.com → „Projekte“ → „Neu“ → „KML-Datei importieren“.', 'Die Strecke wird in 3D angezeigt.'],
      en: [SHARE_EN, 'Pick "Google Earth" – or open earth.google.com → "Projects" → "New" → "Import KML file".', 'The ride is shown in 3D.'],
    },
  },
  {
    id: 'gaia',
    name: 'Gaia GPS',
    formats: ['gpx', 'kml'],
    send: {
      de: [SHARE_DE, 'Wähle „Gaia GPS“.', 'Die Strecke landet in „Gespeichert“.'],
      en: [SHARE_EN, 'Pick "Gaia GPS".', 'The ride ends up in "Saved".'],
    },
  },
  {
    id: 'wahoo',
    name: 'Wahoo (ELEMNT)',
    formats: ['gpx'],
    send: {
      de: [SHARE_DE, 'Wähle „ELEMNT“.', 'Die Strecke steht unter „Routen“; einmal mit dem Gerät synchronisieren.'],
      en: [SHARE_EN, 'Pick "ELEMNT".', 'The ride is under "Routes"; sync your device once.'],
    },
  },
  {
    id: 'suunto',
    name: 'Suunto',
    formats: ['gpx'],
    send: {
      de: [SHARE_DE, 'Wähle „Suunto“. Oder in der Suunto-App: Karte → „Routen“ → „Importieren“.', 'Die Route mit der Uhr synchronisieren.'],
      en: [SHARE_EN, 'Pick "Suunto". Or in the Suunto app: Map → "Routes" → "Import".', 'Sync the route to your watch.'],
    },
  },
  {
    id: 'calimoto',
    name: 'calimoto / Kurviger',
    formats: ['gpx'],
    send: {
      de: [SHARE_DE, 'Wähle „calimoto“ oder „Kurviger“.', 'Die Strecke wird als Route geöffnet.'],
      en: [SHARE_EN, 'Pick "calimoto" or "Kurviger".', 'The ride opens as a route.'],
    },
    bring: {
      de: ['Öffne die Tour in der App.', 'Teilen → „GPX exportieren“.', 'Wähle „Curve Counter Simple“.'],
      en: ['Open the tour in the app.', 'Share → "Export GPX".', 'Pick "Curve Counter Simple".'],
    },
  },
];
