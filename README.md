# Simple Curve Counter

A dead-simple motorcycle app (German first, English optional) that counts your **left curves, right curves
and the total** for every ride, along with ride time, distance and speed.
Made to be understood by anyone: big numbers, big buttons, plain words.

> **Status: v0.9 beta.** **Android** is complete for everyday use: it records rides natively
> in the background (screen off; app killed → the ride is rebuilt from the GPS log), and has the
> setup check, ride details, height and GPX export/import. **iPhone and the browser** still only
> count while the app is open, until the native iOS recorder exists. Numbers are tuned on
> synthetic tracks; real ground-truth rides come next (see "Accuracy").

## How it works

1. Press **Start ride**. The app is now *ready*.
2. Ride off. The ride (and its clock) only starts once you're **actually moving**
   (≥ 15 km/h for 5 s), so putting on your helmet doesn't count.
3. The app counts every curve: **↰ left**, **↱ right**, and the **total**.
4. Press **Stop ride**. A summary card shows the curves, distance and time. The ride is saved
   under **My rides**, where you can delete it again (with undo).

The first start asks for at most three things, one screen each (location, battery, notifications).

## What you get per ride

- **Left / right / total curves**, ride time, riding time, distance, average and top speed.
- Behind **Details** (hidden by default, so the app stays simple): curves per 100 km, curve
  strength classes (gentle / medium / tight / hairpin), every curve with angle, speed and
  approximate lean angle, the strongest curve, highest point, climb / descent and a height profile.
- **GPX**: save one or all rides as GPX files (share sheet), import GPX files from other apps
  (BMW Motorrad Connected, calimoto, Kurviger, Garmin …) via the button or "Share to / Open with".
  Planned routes without times get their curves counted too.

*Experimental:* in **Help → Settings** the app can detect rides by itself (start and end).
It's off by default because it can't tell a motorcycle from a car or bus yet.

## How curves are counted

GPS based, so it works no matter where the phone is (mount, tank bag, jacket pocket) and
needs no calibration. Reference implementation: [`src/logic/curves.ts`](src/logic/curves.ts).

- Bad fixes are dropped (accuracy > 25 m, impossible jumps); a tunnel gap resets the detector.
- The track is **resampled every 10 m**, so a curve looks the same at 40 and 130 km/h.
- Heading change per step, summed over a sliding 100 m window = "how hard are we turning".
- A small state machine opens a curve when turning starts, splits S-bends into two curves
  and closes the curve when the road is straight again.
- A second pass with a 500 m window finds **wide motorway sweepers**; a curve found by both
  passes counts once. What counts as *one* curve is written down in `curves.ts` and tested.
- A curve counts if it turns at least **20° / 30° / 45°** (setting: *gentle bends too /
  normal / only real curves*) and its slowest point is ≥ 15 km/h (so junctions don't count).
- Hairpins and roundabouts count as one curve. Every curve stores its angle and its
  entry / apex / average / exit speed.

Every ride keeps its track, so saved rides are **recounted automatically** when the detector
improves or the sensitivity setting changes. Radius, cornering g and the approximate lean angle
come from the curve's real turning length and speed (`curveMetrics.ts`).

### Accuracy

Planned for "insanely accurate": gyro + GPS sensor fusion, forward-backward smoothing of the
whole track, map matching, and a ground-truth test set of ≥ 20 real rides checked in CI.

## Keeping it running in the background

Phones love to kill background apps. In the app, **Help** shows a traffic-light check
(location *always*, notifications, battery) with one **Fix** button per item, plus a
step-by-step guide (max. 3 steps) for **your** phone brand: Samsung, Xiaomi/Redmi/POCO, Huawei,
Honor, OnePlus, OPPO/realme, vivo, Google Pixel, Motorola, Sony, Nokia, other Android, iPhone.
Guide texts: [`src/guides/guides.ts`](src/guides/guides.ts).

## Development

Requirements: Node ≥ 22, pnpm, JDK 21 + Android SDK (`ANDROID_HOME` or `android/local.properties`)
for the APK, macOS + Xcode for iOS.

```bash
pnpm install
pnpm dev          # run in the browser (Help → "Simulate a test ride" plays a fake ride)
pnpm test         # unit tests (detector, engine incl. app-kill rebuild, height, GPX, guides …)
pnpm apk          # build release APK → dist-apk/SimpleCurveCounter-vX.Y.Z.apk
pnpm apk:install  # install on a connected phone / emulator via adb
pnpm sync:ios && pnpm ios:open   # open the iOS project in Xcode (macOS)
```

### Project layout

```
src/
  logic/        curves.ts (curve detector) · curveMetrics.ts (radius, g, lean) · analyze.ts (whole-track
                analysis) · height.ts · gpx.ts · rideDetector.ts · rideStats.ts · geo.ts · simulate.ts
  tracking/     engine.ts (fix log → detectors → store) · source.ts (native / web GPS / demo) ·
                tracks.ts (track files) · gpxIo.ts (export / import) · plugin.ts (native API)
  guides/       per-brand "keep the app alive" guides (de/en)
  screens/      Ride · My rides · Help
  ui/           components, ride details, summary, first start, icons, formatting
  i18n/         German + English strings
android/app/src/main/java/…/tracking/   RecorderService (foreground GPS) · FixLog · RecorderPlugin ·
                SetupPlugin (permission check, vendor pages) · InboxPlugin (files shared to the app)
android/ ios/   Capacitor native projects
```

## Versioning & releases

- [SemVer](https://semver.org): the version in `package.json` is the only source of truth.
- Android `versionCode` / iOS build number = `MAJOR*10000 + MINOR*100 + PATCH` (1.2.3 → 10203).
- `pnpm release patch|minor|major` runs the tests, bumps the version, commits, tags `vX.Y.Z` and pushes.
  The tag triggers GitHub Actions:
  - **`release.yml`** builds the signed APK and attaches it to a GitHub Release.
  - **`testflight.yml`** archives the iOS app and uploads it to TestFlight.

### Android signing

Release APKs must always be signed with the **same key**, otherwise Android refuses updates.
Create `android/simplecurvecounter-release.jks` + `android/keystore.properties` (both gitignored, see
`scripts/upload-signing-secrets.sh`), back them up, then run the script to upload the
`SCT_KEYSTORE_BASE64`, `SCT_KEYSTORE_PASSWORD`, `SCT_KEY_ALIAS`, `SCT_KEY_PASSWORD` secrets.
Without a key the APK is debug-signed (installs, but can't update a release build).

### TestFlight

Needs a paid Apple Developer account and the app created in App Store Connect with bundle ID
`com.korbi.simplecurvecounter`. Create an App Store Connect API key (role *App Manager*) and set the
repository secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the `.p8` file, base64) and
`APPLE_TEAM_ID`. Without them the workflow only checks that the iOS app compiles.

## App icon

Placeholder: `assets/src/icon.svg` (yellow curve sign). Export `assets/icon-only.png`,
`icon-foreground.png`, `icon-background.png` (1024×1024) and `splash.png` / `splash-dark.png`
(2732×2732), then run `pnpm icons`.

---

## Kurz auf Deutsch

**Simple Curve Counter** zählt beim Motorradfahren deine **Links-** und **Rechtskurven** und alle
Kurven zusammen, pro Fahrt, dazu Fahrzeit, Strecke und Tempo. *Fahrt starten* drücken,
losfahren, gezählt wird erst, wenn du wirklich rollst. Unter **Hilfe** steht für dein Handy
in höchstens 3 Schritten, wie die App im Hintergrund weiterläuft.

*Ride safely. Keep your eyes on the road, the app counts by itself.*
