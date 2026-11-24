# Changelog

## 1.0.0 – 2026-11-24

**New name: Curve Counter Simple** – new app ID (`com.korbi.curvecountersimple`) and a new signing
key, so it installs next to the old "Simple Curve Counter". Move your rides over with GPX export → import.

Curve detection (tuned and checked on real rides, see docs/curve-detection.md)
- Sharp 90° junction corners and U-turns are no longer thrown away as "GPS glitches".
- Slow turns count (bus at a junction, into a driveway or parking lot); a stop at a traffic light
  inside a curve no longer cancels it.
- No more curves from GPS jitter while standing; after a long stop, movement must be confirmed.
- Three sources fused with trust levels: GPS position, GPS direction of travel and the gyroscope
  ("invisible compass", works with the phone in a pocket or flat on the dash, calibrates itself).
- S-bends with a big and a small half are split; long even sweepers are not; lane changes,
  overtakes and bus bays are removed after the ride. Every curve gets a confidence.
- Saved rides are recounted automatically.

New
- Map for every ride (preview, full screen, zoom, tap curves or any point of the track).
- Routes: rides with the same start and end, variants for other roads, merging with a distance check.
- Export / import GPX, KML, KMZ, CSV, GeoJSON; share with a rendered map picture; expert options;
  guides for Strava, Garmin, Komoot, AllTrails, Google Maps / My Maps, Google Earth, Gaia GPS, Wahoo,
  Suunto, BMW, calimoto / Kurviger. Extra data from files (heart rate, waypoints …) is shown.
- Ride details: braking / acceleration, stops, phone holder, measured tilt, sensors used.
- Settings and Help are separate tabs; swipe between tabs; About section.
- Setup check with severity, "can I skip this?", more checks (location off, background restricted,
  power saving, phone-maker autostart); warning before a ride when something important is missing.
- New first start (welcome + language, green tick after each step).
- Battery modes (accurate / normal / saver); ride shown on Wear OS watches.
- Undo for every destructive action (delete, delete all, import, routes, sensitivity).
- New icon (always dark, Android 13 themed icon, iOS dark / tinted), calm mountain scenery,
  simpler German and English texts.

## 0.9.0 – 2026-11-19

**German first.** The app starts in German with km/h on every phone; English and miles can be
chosen under Help. Dates and times use European formats in both languages.

New
- First start: at most three screens (location, battery, notifications), one big button each.
- Summary card right after Stop; "Details" per ride: curves per 100 km, strength classes,
  every curve with angle, speed and approx. lean angle, strongest curve.
- Height meter: highest point, climb / descent, height profile (Android 14+: height above sea level).
- GPX: save one or all rides, import GPX files (button or "Share to / Open with" on Android);
  planned routes are counted too, duplicates are recognised.
- Help: the setup check shows the real Android states and every "Fix" opens exactly the right
  page (also Xiaomi, Huawei, Honor, OPPO/realme, vivo, Samsung); simpler step texts, finished
  steps get a ✓.
- Reminders: "Still want to ride?" after 30 min ready, "Forgot to stop?" after 60 min standing
  still (never ends a ride by itself), banner when there is no GPS.
- Calm animations (screens, dialogs, details, counters); off when the phone asks for less motion.

Better counting
- Wide motorway sweepers are counted (second detector pass).
- Curve speeds come from the curve itself (not from the straight after it); S-bends get the
  right size. Saved rides are recounted automatically.

Fixes
- "Delete all rides" during a running ride no longer leaves the recorder running.
- Buttons are at least 64 px high everywhere (gloves).

## 0.2.0 – 2026-11-19

- Android: rides are recorded by a native foreground service (GPS keeps running with the
  screen off, permanent notification with live counts and speed).
- Rides are never lost: every GPS fix is written to a log right away; if the app is killed
  mid-ride, the ride is rebuilt from that log on the next start.
- The ride screen says so in plain words when location isn't allowed or GPS is weak.
- Release APKs are signed with the project key (fix: the keystore path was resolved in the wrong folder).

## 0.1.0 – 2026-11-19

- Project placeholder: Vite + React + Capacitor 8 (Android + iOS), German / English.
- Curve detector (GPS, distance-resampled, S-bend aware, 3 sensitivity levels) with tests.
- Ride detection: manual start waits until you are really moving; experimental automatic mode.
- Ride stats: ride time, moving time, distance, average and top speed, speed per curve.
- Screens: Ride (huge left/right counters), My rides (delete + undo), Help (settings check,
  per-brand battery guides, settings).
- Build pipelines: APK → GitHub Release, iOS → TestFlight.
