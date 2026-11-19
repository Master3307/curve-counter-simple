# Changelog

## Unreleased

- German first: the app starts in German with km/h and km on every phone (English and miles
  can be chosen under Help). Dates and times use European formats in both languages.

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
