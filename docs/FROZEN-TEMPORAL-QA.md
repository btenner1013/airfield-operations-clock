# Frozen precipitation temporal verification

Verified 15 October 2026 against the revised source. This follow-up addresses the reported ebb/flow and unattractive hail rebounds; the previous release's comprehensive phenomena/label matrix remains historical supporting evidence.

## Result

The incoming frozen precipitation is continuous. Hail and ice pellets no longer disappear from the falling population while their former particles perform repeated large rebounds at a single horizontal floor. Small, short-lived impacts now have their own bounded pool. Hail is rendered as softer irregular ice pebbles, and pellets as smaller rounded pieces.

Snow starts across its active travel span instead of starting with roughly half the field above the screen. Snow showers no longer hide a synchronized population according to a global intensity cycle. Their remaining opacity variation is gentle, local and phase-offset.

## Temporal measurements

Actual PrecipCanvas source was executed for 120 seconds per scenario at 30 simulated frames/second, 1280×720 CSS pixels, with a repeatable seed and an identical weather-object rerender each clock second. Steady-state figures use 1-second means after the first 20 seconds. Airborne means particles within the top 80% of the scene, excluding rebound particles. Coefficient of variation (CV) measures variation relative to the average. These are population measurements, not hardware FPS or photographic realism scores.

| Fixed condition | Airborne population before → after | Airborne CV before → after |
|---|---:|---:|
| Hail GR | 15.78 → 70.59 | 15.0% → 1.2% |
| Ice pellets PL | 46.55 → 144.44 | 12.6% → 0.9% |
| Small hail GS | 25.14 → 96.50 | 14.5% → 1.1% |
| Freezing rain + pellets FZRAPL | 111.79 → 209.56 | 4.9% → 0.9% |

Configured falling-particle counts were not increased. Restoring particles to the falling stream accounts for the larger airborne population. The former GR implementation kept an average of about 60 particles in rebounds; the falling stream now recycles immediately while the separate tiny impacts decay.

Light snow's first-second airborne population improved from 35.9 to 68.1, near its final steady mean of 62.0. Standard snow improved from 70.7 to 132.4, near a steady mean of 125.1. This removes the long initial refill cohort without claiming that natural random spatial variation is zero.

For SHSN, the displayed-population CV fell from 13.9% to 2.4% after removal of global population gating. The final alpha-weighted displayed population CV was 2.8%. SHPL, SHGR and SHGS were separately checked; their existing classification did not enable the global shower-population envelope, and their display counts remain stable.

## Scenario inventory

The 120-second matrix covers: -SN, SN, +SN, SHSN, SG, IC, BLSN, DRSN, PL, GS, GR, FZRA, FZDZ, RASN, SN BLSN and FZRAPL. Additional 120-second shower checks cover SHPL, SHGR and SHGS and repeat SHSN with threshold-aware metrics. Every frame retains one animation-loop chain and cleanup cancels it.

- Standard/light/heavy snow, snow grains, ice crystals and mixed rain/snow: distributed starts and no artificial replenishment cohort.
- Blowing/drifting snow: original lower/surface behavior preserved; exact before/after population metrics match for BLSN/DRSN.
- Freezing rain/drizzle: continuous falling precipitation and original pane behavior retained; no invented hail bounce.
- Hail/pellets: incoming source independent of impacts, bounded by 64 impact objects; contact heights distributed with depth.
- Largest observed sampled hop: 16.82 CSS pixels for hail, less than 10 pixels for pellets. Impact samples never exceed their lifetime; all expire within the configured 0.24–0.38 seconds.
- Frozen showers: every particle stays eligible for display; local opacity remains between 0.88 and 1. Liquid-shower behavior is unchanged.

## Native visual evidence

Four 20-second side-by-side before/after clips execute the actual renderer for GR, PL, SN and FZRAPL. Full-scene checkpoints and a 12-frame bottom-region sequence around 10 seconds show small moving/fading rebounds without the previous stationary-looking horizontal row. Each clip records source hashes, fixed input, dimensions, frame rate, seed and backdrop identity. A final-source snow-shower comparison and exact-pixel equivalence checks are supplied with the clip provenance.

These are source-executed native Canvas renders over the unchanged original airport image. They are not browser screenshots. They omit the browser's CSS grading/scrim, app DOM, clock, live feed and hardware/browser performance. This review therefore verifies source behavior, temporal continuity and the visible native-rendered improvement, not full-page device fit or iOS/TV FPS.

## Regression checks

Independent full test suite: 266 passed. TypeScript, whitespace/diff checks and static export passed. Additional runtime tests verify one loop; hidden and explicit pause/resume; reduced-motion static output; resize/buffer caps; no automatic quality reduction under simulated slow frames; image-load success/failure/race handling; disposal of listeners, observers and textures. Frozen-specific lifecycle tests verify clearing impacts on resize, reduced motion, transition to clear and unmount, with no update while hidden.

Runtime source hashes:
- PrecipCanvas.tsx: b2d55acbf0650345e126f376060186bbd36297dd42d187a801887e8e0d645a03
- frozenPrecipitation.ts: 7450aa36fe1374db5659a2d033210de4ff0332fe141e8b6815ee25a5394e85e0

Detailed population measurements are in frozen-continuity-summary.csv and continuity-before/after.json. Shower-specific results are in continuity-showers-final.json. Full previous phenomena/label/freshness evidence remains explicitly tied to the preceding release rather than relabeled as a new render.
