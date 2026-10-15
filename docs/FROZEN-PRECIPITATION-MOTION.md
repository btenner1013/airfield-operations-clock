# Frozen precipitation motion review

## What changed

The original hail/pellet renderer kept a falling particle occupied through three large rebounds on one fixed line at 87% of the canvas height. That left far fewer particles arriving from above and produced an artificial crowded bounce belt. Its initial full-height field was also seeded from one screen-height above the image through the bottom, unlike its much shorter recycling path. Slow snow therefore started with a noticeable incoming cohort.

The revised actual `PrecipCanvas`:

- Seeds full-height precipitation throughout its active travel span, with independent random cycle positions.
- Recycles an incoming pellet/hail particle at first contact, independent of the brief rebound. Falling-source counts and weather intensity specifications remain unchanged.
- Gives the separate impact fragments depth-distributed contact points, one small rebound with at most one much smaller secondary hop, lateral friction, and continuously fading opacity.
- Caps a hail rebound at 17 CSS pixels and pellet/small-hail rebounds at 10 CSS pixels. Rebound energy is also capped by the actual incoming speed. Impacts expire in 0.24–0.38 seconds, with a hard maximum of 64 impact fragments.
- Uses compact slightly irregular hail pebbles and round ice pellets, with soft shadows instead of the previous black-edged diamond glyphs. Impacts are smaller and less opaque than airborne particles.

Snow, grains, crystals, blowing/drifting snow, freezing-rain/drizzle streaks, mixed-family classification, and pane behavior keep their distinct specifications. Frozen showers now keep every arrival visible, with gentle phase-offset 88–100% opacity variation per particle instead of a common show/hide threshold. Liquid showers retain their existing bounded modulation. Full quality remains the default; there is no automatic hardware/FPS downgrade.

## Verification

The repository suite now contains **266 passing tests**, including deterministic impact-energy, lifespan, fade, resource-bound and pause tests, plus execution of the actual component across 14 frozen/mixed cases. The component test verifies dispersed startup, unchanged source counts, no falling particle waiting through a bounce, the impact cap, and reduced-motion cleanup. TypeScript and static export are checked for the final review package.

Independent before/after fixed-seed frame-series measurements and actual native Canvas videos accompany this review. They inspect temporal continuity, rather than relying on a still image. See `FROZEN-TEMPORAL-QA.md` and the included machine results for exact inputs, sampling windows and final source hashes.

The included all-phenomena matrices and native still sheets from version11 remain historical evidence of the earlier labeling/source audit. Their provenance retains those source hashes. The new temporal clips, impact tests and motion dossier are the evidence for this version12 drawing change.

The falling field is intentionally fuller than the old broken steady state, because particles are no longer held at the bottom during repeated hops. It still uses the same intensity-driven population, with smaller visual pieces. Brief random density variation is natural; there is no intentionally synchronized refill cycle.

## Bounds and limitations

The new impact pool is independently bounded at 64 objects. There are no new canvases, APIs, timers, image dependencies, or animation loops. Existing buffer caps, hidden-tab pause/resume, explicit low mode, reduced motion, and cleanup remain covered. Impacts pause with the renderer and disappear under reduced motion.

The visuals are illustrative, not a physical hail-size, bounce-height or meteorological visibility simulation. Native clips execute the real drawing code with synthetic weather and a fixed seed. They do not verify browser CSS layout, real-device GPU performance, or current live weather. Browser access remains unverified under the existing sign-in boundary. The existing ESLint configuration gap is unchanged.
