# Simple Curve Counter

A dead-simple motorcycle app (German / English) that counts your **left curves, right curves
and the total** for every ride, along with ride time, distance and speed.
Made to be understood by anyone: big numbers, big buttons, plain words.

> **Status: early version (v0.1).** The UI, the curve/ride detection logic (with tests) and
> the build pipelines are in place. **Android** records the ride natively in the background
> (screen off, app killed → the ride is rebuilt from the recorded GPS log). **iPhone and the
> browser** still only count while the app is open, until the native iOS recorder exists.

## How it works

1. Press **Start ride**. The app is now *ready*.
2. Ride off. The ride (and its clock) only starts once you're **actually moving**
   (≥ 15 km/h for 5 s), so putting on your helmet doesn't count.
3. The app counts every curve: **↰ left**, **↱ right**, and the **total**.
4. Press **Stop ride**. The ride is saved under **My rides**, where you can delete it again (with undo).

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
- A curve counts if it turns at least **20° / 30° / 45°** (setting: *gentle bends too /
  normal / only real curves*) and its slowest point is ≥ 15 km/h (so junctions don't count).
- Hairpins and roundabouts count as one curve. Every curve stores its angle and its
  entry / apex / average / exit speed.

Planned for "insanely accurate": gyro + GPS sensor fusion, a post-ride re-analysis over the
whole track, and a ground-truth test set of real rides checked in CI.

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
pnpm test         # unit tests (curve + ride detection, guides, formatting)
pnpm apk          # build release APK → dist-apk/SimpleCurveCounter-vX.Y.Z.apk
pnpm apk:install  # install on a connected phone / emulator via adb
pnpm sync:ios && pnpm ios:open   # open the iOS project in Xcode (macOS)
```

### Project layout

```
src/
  logic/        curves.ts (curve detector) · rideDetector.ts · rideStats.ts · geo.ts · simulate.ts
  tracking/     engine.ts (fix log → detectors → store) · source.ts (native / web GPS / demo) · plugin.ts (native API)
android/app/src/main/java/…/tracking/   RecorderService (foreground GPS service) · FixLog · RecorderPlugin
  guides/       per-brand "keep the app alive" guides (de/en)
  screens/      Ride · My rides · Help
  ui/           components, icons, formatting
  i18n/         German + English strings
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
