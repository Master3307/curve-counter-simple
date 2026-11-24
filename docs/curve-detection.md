# How curves are counted – and how it was tuned

Reference implementation: [`src/logic/curves.ts`](../src/logic/curves.ts) (live, per GPS fix) and
[`src/logic/analyze.ts`](../src/logic/analyze.ts) (after the ride, over the whole track – these are the
saved numbers). Unit tests: `src/logic/curves.test.ts`.

## The pipeline

1. **Clean the fixes** – drop bad accuracy (> 30 m), impossible jumps (> 70 m/s), and position jumps the
   GPS's own Doppler speed doesn't allow (multipath). Stand-still is frozen (see below).
2. **Resample every 10 m**, so 40 km/h and 130 km/h look the same.
3. **Turn per 10 m step** from three sources, each with its own trust level, fused:

   | Source | Trust | Good at | Weak at |
   | --- | --- | --- | --- |
   | Position course (bearing between smoothed positions) | base | always there | jitter at low speed, multipath |
   | Doppler course (`Location.getBearing`) | 50 % weight | calm while moving | useless below ~3 m/s |
   | Gyroscope around the gravity axis ("invisible compass") | 65 % weight | sharp, fast, phone position doesn't matter | slow drift (bias learned while standing) |

   A position jump that course/gyro don't confirm is ignored. A source that keeps disagreeing on clear
   turns (stuck sensor, phone turning inside a pocket) loses trust and is switched off.
4. **Sliding windows**: 100 m (normal curves) and 500 m (wide motorway sweepers) → small state machines
   open a curve when turning starts and close it when the road is straight again.
5. **Rules on the closed candidate**: minimum angle, turning done while moving, straight-splitting.
6. **After the ride**: jog filter (lane change / overtake / bus bay), confidence per curve.

### What counts as ONE curve

- a continuous change of direction ≥ 20° / 30° / 45° (setting) in one direction, driven while moving;
- a straight of ≥ 50 m (clearly flatter than the curve) between two same-direction bends makes two curves;
- an opposite turn always separates (S-bend = two curves);
- roundabout / hairpin / ramp loop = one curve; standing still inside a curve doesn't break it;
- lane change, overtake, pulling into a bus bay = no curve;
- wide motorway sweepers (radius ≳ 500 m) count from 30° / 45° / 60° and are marked "wide" –
  a rider hardly leans there (at 120 km/h and r = 1000 m it's about 6°), but it is a real change of
  direction you see on the map, so the big ones count.

## Tuning on real GPX files (v1.0)

Test set: two rides recorded with v0.9 (bus + e-scooter, Neutraubling → Demling), two planned routes
from motarva.com (Helvetia ride, Frankfurt → Dole, 480 km). Every result was checked against
OpenStreetMap by rendering the track and the detected curves on the map.

| Ride | v0.9 | v1.0 | Checked on the map |
| --- | --- | --- | --- |
| 23 Nov (bus, 13 km) | 15 curves; 4 of the 6 corners of the start loop missing, big left at Moosgraben missing | 30 curves; every junction corner of the loop, all Donaustauf turns | ✅ all corners on real junctions |
| 20 Nov (bus, 11 km + 90 min at home) | 6 curves; the 274° ramp loop at the bridge missing; jitter curves at home | 14 curves; ramp loop found; nothing while at home | ✅ (1 low-confidence curve on the last 2 fixes) |
| Helvetia route | R65 · L76 · R70 (U-turn and two corners clipped) | R182 (U-turn) · L76 · R116 · L47 | ✅ matches the written description |
| Frankfurt → Dole | 489 | 522 (normal) | ✅ spot checks in Darmstadt: all on junctions/bends |

### The changes – symptom, change, why, trade-off

**1. Apex cutting & wide lines / sharp corners at 1 Hz** (missed 90° junction corners, U-turn = 65°)
- Was: a single 10 m step turning > 75° was set to 0 as a "glitch". A crisp junction corner is exactly that.
- Now: no clipping. A step is only a glitch if it turns > 100° **and straight back** on the next step
  (spike: both cancel). Plus a fix whose jump is bigger than `2 × Doppler speed + 8 m/s` is dropped
  before smoothing (max 3 in a row, so a real move can't be stuck).
- Trade-off: a two-step zig-zag of < 100° per step isn't caught by the spike rule – the Doppler jump
  rule and the gyro cover most of those.

**2. GPS jitter, multipath & stationary points** (curves while waiting at a stop or sitting at home)
- Was: every fix was resampled, so 5 m of jitter per second drew random "curves" over hours.
- Now: below **3.5 km/h** positions are frozen. After **≥ 30 s** standing, movement only counts once
  confirmed: ≥ 4 fixes, ≥ 15 m, and going somewhere (net distance ≥ half the path). The held fixes
  are then used, so nothing is lost.
- Trade-off: the first ~15 m after a long stop are delayed (not lost). Walking pace doesn't count.

**3. Straightaway wiggles & lane changes** (the "lane change" at the end of the 23 Nov ride)
- After the ride, an opposite pair of curves that is close (≤ 80 m apart), similar (angles within
  45 %, both ≤ 75°), continues in the same direction (≤ 20°) and only moved sideways ≤ 12 m is
  removed (lane change, overtake, bus bay).
- The flagged spot on 23 Nov turned out to be a real manoeuvre in the data: the speed drops to
  4 km/h, then a 70° right and a 50° left with consistent Doppler speed. v0.9 only showed the left
  half (the right half was below its 15 km/h rule), which looked like a lone false curve.
- Trade-off: a genuine left-right "chicane" of two small curves with ≤ 12 m offset is dropped too.

**4. S-bends & rapid reversals** (Helvetia R117 → 69 m → L47 counted as one R70)
- Was: only the 100 m window could flip direction, and it still held the big first turn.
- Now: also a **50 m reversal check**: ≥ 20° opposite turning in the last 50 m after a curve of ≥ 30°,
  only at ≥ 25 km/h. The window restarts from the new curve so the old turning can't flip it back.
- Trade-off: below 25 km/h quick reversals stay merged (in town those were mostly bus bays and jogs).

**5. Double-counting long / sweeping curves** (one 75° sweeper split into 34° + 35°)
- A straight only splits a curve when its heading stays within 4° for 50 m **and** it turns less
  than 30 % of the curve's average. An even sweeper (≈ 1° per 10 m) never splits; a real straight
  between two bends does. Quiet distance before closing a curve: 30 → 40 m.
- Trade-off: two bends with a 40 m straight between them are one curve (by definition).

**6. Slow turns, driveways, parking, stops inside curves** (bus corners, the bridge ramp loop)
- Was: a curve was dropped if its slowest point was < 15 km/h – every curve with a traffic light or
  bus stop inside, and every junction turn of a bus.
- Now: the **median speed of the turning part** must be ≥ 6 km/h. Stops inside don't matter.
- Trade-off: manoeuvring in a parking lot can count; such slow, very tight turns (≥ 3°/m below
  10 km/h) get lower confidence and are marked "unsure".

### Confidence

`0.35 × clear angle margin + 0.35 × source agreement + 0.3 × GPS accuracy` (− 0.25 for slow, very
tight turning). Shown as *sure* (≥ 0.66), *likely*, *unsure* (< 0.4) in the curve list and as lighter
dots on the map. It is a hint for the rider, not used for counting.

### Not done (yet)

- Map matching with OpenStreetMap roads (would tell real road curves from GPS shape exactly).
- An on-device model: needs hand-labelled rides first. The "unsure" marks are a first step towards
  collecting that ground truth.
- A native (Kotlin/Swift) port, so the phone notification shows live counts while the app sleeps.
