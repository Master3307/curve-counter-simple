# Changelog

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
