# Cinematic Weather

The weather upgrade adds moving, textured cloud layers, depth-scaled precipitation, visibility-driven fog, and localized thunderstorm illumination behind the existing operations display. It uses Canvas 2D and adds no dependencies or external services.

These are photographic/procedural visual approximations inspired by cinematic weather references, not a reproduction of a reference video or a physical weather simulation. After review, the owner authorized reworking the sky while retaining the airport scenery. Original PNG assets and weather-based selection remain unchanged. A masked, moving photographic sky now supplies visible cloud detail; the old whole-wallpaper breathing transform is disabled so the airport stays still. Existing clocks, branding, original aircraft artwork, flight path, and weather-eligibility rules remain intact. The later requested bottom-information overhaul improves solar/lunar, current weather, bird watch and forecast presentation while preserving their fields and lunar phase calculation; the later scenario audit narrowly fixes demonstrated source-input and event-boundary defects. The later owner-requested wind-instrument improvement is confined to the existing wind card, and C-17 transit is now 9–13 seconds instead of 12–18 seconds; the 15–30 second launch gap is unchanged.

## Architecture and data boundaries

- `app/page.tsx` keeps the existing Ops Board, Open-Meteo, and NWS integration. It passes normalized current weather into the controller and binds preview controls and diagnostics.
- `app/weatherController.ts` is the pure observation-to-effects boundary. It combines precipitation, cloud amount, ceiling, visibility, wind, and current lightning into rendering specifications. It has no timers, network requests, browser storage, or clock state.
- `app/weatherFx.ts` retains the established precipitation/obscuration classification and family-specific specifications.
- `app/PrecipCanvas.tsx` owns two visible compositing layers driven by **one animation loop**: a bounded photographic-sky canvas below the original scene shading, and the existing atmosphere/precipitation canvas above it. It smooths weather changes, handles image load failures/resize, and cleans up on unmount. The active, decoded wallpaper determines the photo source.
- `app/photographicSky.ts` animates detail from the existing photographic sky with a gentle zoom/pan. Cover-aware masks protect the stationary tower, antennas, buildings, poles, runway, and horizon; a soft oval protects the complete tower envelope. Image changes crossfade using the same bounded buffer. Missing images leave the original static background available.
- `app/atmosphereRenderer.ts` generates two small reusable noise textures and a reusable offscreen composite. Layered cloud motion, fog depth, and procedural lightning share the precipitation canvas rather than adding another animation loop.
- `app/useLightning.ts` retains the existing cancellable lightning scheduler. Report code and availability changes now restart it correctly; stale/unavailable reports cannot trigger scene flashes.
- `app/cinematic-weather.css` retires overlapping legacy cloud/fog/lightning layers without changing the clock layout. `app/PreviewLab.tsx` adds comparison buttons and rendering diagnostics.
- `app/WindInstrument.tsx`, `app/windCompass.ts`, and `app/wind-compass.css` provide the separately requested wind-card upgrade. Display state, freshness, FROM bearings, cardinal labels, and sector geometry are isolated from weather fetching and animation. The existing card rail is retained, and the later bottom-information overhaul explicitly leaves this accepted wind card unchanged; browser-level layout verification remains outstanding.

The two-minute refresh, wake/reconnection recovery, weather cache, source precedence, TAF source selection, NWS/Open-Meteo precipitation probabilities, and independent system-clock lifecycle are unchanged. Forecast thunderstorms cannot produce current rain or lightning. Current METAR/ATIS lightning authority is retained, with reduced-motion and stale/unavailable animation suppression.

Storms have an illustrative upper-cloud drift floor and internal evolution, so calm surface wind does not freeze convective clouds. The procedural layers use 22–38 CSS pixels/second before parallax; photographic sky movement uses 13–25 CSS pixels/second before its bounded easing, with stronger surface winds able to increase that speed. Surface wind still controls precipitation. This is an artistic approximation because aloft winds are not supplied.

Wind is projected from the meteorological **FROM** direction to a screen-space travel vector. North/south winds no longer become full sideways rain. The photograph's camera bearing is unknown, so the result is an illustrative screen-space projection, not a geographically calibrated view.

## Wind compass and C-17 refinements

The wind card now has a larger ticked dial with a white marker at the reported **FROM** bearing and a cyan arrow showing airflow toward the opposite bearing. The readout separates the degree/cardinal bearing, sustained speed in knots, gusts, and source/observation time. An amber arc represents an observed variable FROM-direction sector, including ranges crossing north. The display identifies ATIS or METAR without claiming a true/magnetic conversion.

Calm wind shows zero knots and a neutral ring; variable wind shows VRB and its observed speed without an invented direction. Missing, model-only, or unverified-time wind does not appear as a current observation. After the existing inclusive 90-minute ATIS or 75-minute METAR freshness cutoff, the card labels the observation stale and hides its old arrow and speed. Direction changes use the shortest rotation across north. Reduced-motion preferences and the existing debug override disable needle transitions.

The C-17 uses the same assets, sky path, direction logic, and weather gate. Its requested brisker transit takes 9–13 seconds, followed by the existing 15–30 second gap. Eligibility is consulted before launch, not mid-pass. In ordinary operation the gate considers reported weather and the displayed flight category; a clear visual preset does not guarantee that the reported weather is eligible.

- Wind previews: `?debugWindMode=gust`, `?debugWindMode=sector`, `?debugWindMode=variable`, or `?debugWindMode=calm`.
- North-bearing preview: `?debugWind=359&debugWindSpeed=8`.
- Combined forced demonstration: `?debugWeather=partly-cloudy&debugTime=day&debugWindMode=gust&debugFlyby=on&debugFlybyDir=ltr&spawnFlyby=1`.
- `debugFlyby=on` explicitly bypasses weather eligibility for demonstrations; `spawnFlyby=1` forces one immediate pass. Remove both to return to normal weather-gated launches. `debugFlyby=off` suppresses passes.

The actual instrument SVG was separately rendered and inspected in directional, north-crossing-sector, variable, and calm states. These isolated dial images are not browser screenshots and do not validate the complete card layout.

## Bottom information refinements

The later owner-requested overhaul refreshes every bottom information card except the accepted wind instrument. Larger, grouped current-weather readings, a native bird icon with clear AHAS timestamps, readable three-row forecast details and a restored circular solar-lunar dial with a night-only north-up moon phase and phase caption now share the same instrument language. The dial retains the original upper/lower orbit geometry and resolved marker coordinates, with a layered rim, fine ticks and brighter elapsed arcs. The lunar phase calculation, clock/date formatting, forecast source authority and display filtering remain intact. Scenario verification separately fixes demonstrated missing-solar-event and sunset-boundary handling, compound phenomenon routing and TAF end transitions; see SCENARIO-VERIFICATION.md. See [Information Bar](INFORMATION-BAR.md) for details, eight lunar previews, verification and limits.

## Interactive comparison

Open the running site's URL with `?weatherDemo=1` or `?previewWeatherFx=1`. The panel opens without changing live observations. Its weather buttons change only preview state; live observations continue refreshing independently.

Buttons cover Clear, Partly cloudy, Overcast, Light rain, Heavy rain, Thunderstorm, Severe thunderstorm, Fog, Snow, Blowing snow, and High winds. They switch in place so transitions can be inspected. The quality button compares full/low rendering; window droplets can be AUTO, ON, or OFF. The existing detailed presets remain available below.

Use LIVE or remove the query string to reset all preview overrides. The demo panel is hidden on the ordinary live URL.

### Condition URLs

Append these query strings to the running site's base URL. Add `&previewWeatherFx=1` for diagnostics. For a night comparison, replace `debugTime=day` with `debugTime=night`.

| Condition | Query string |
| --- | --- |
| Drizzle | `?debugWeather=rain&debugPhenomena=DZ&debugTime=day` |
| Light rain | `?debugWeather=rain&debugPhenomena=-RA&debugTime=day` |
| Moderate rain | `?debugWeather=rain&debugPhenomena=RA&debugTime=day` |
| Heavy rain | `?debugWeather=heavy-rain&debugPhenomena=%2BRA&debugVisibility=1.5&debugTime=day` |
| Rain showers | `?debugWeather=rain&debugPhenomena=SHRA&debugTime=day` |
| Thunderstorm with rain | `?debugWeather=thunderstorm&debugPhenomena=TSRA&debugLightning=tsra&debugTime=day` |
| Severe thunderstorm | `?debugWeather=thunderstorm&debugPhenomena=%2BTSRA&debugLightning=severe&debugVisibility=1&debugTime=day` |
| Clear sky, SKC | `?debugWeather=clear&debugCloud=SKC&debugTime=day` |
| Clear sky, CLR | `?debugWeather=clear&debugCloud=CLR&debugTime=day` |
| Few clouds | `?debugWeather=partly-cloudy&debugCloud=FEW&debugCloudBase=6000&debugTime=day` |
| Scattered clouds | `?debugWeather=partly-cloudy&debugCloud=SCT&debugCloudBase=6000&debugTime=day` |
| Broken ceiling | `?debugWeather=overcast&debugCloud=BKN&debugCloudBase=1800&debugTime=day` |
| Overcast | `?debugWeather=overcast&debugCloud=OVC&debugCloudBase=1800&debugTime=day` |
| Fog | `?debugWeather=fog&debugPhenomena=FG&debugVisibility=.5&debugTime=day` |
| Mist | `?debugWeather=fog&debugPhenomena=BR&debugVisibility=5&debugTime=day` |
| Haze | `?debugWeather=fog&debugPhenomena=HZ&debugVisibility=4&debugTime=day` |
| Smoke | `?debugWeather=fog&debugPhenomena=FU&debugVisibility=3&debugTime=day` |
| Snow | `?debugWeather=snow&debugPhenomena=SN&debugVisibility=2&debugTime=day` |
| Blowing snow | `?debugWeather=snow&debugPhenomena=BLSN&debugWind=270&debugWindSpeed=30&debugVisibility=1&debugTime=day` |
| Snow and blowing snow | `?debugWeather=snow&debugPhenomena=SN%20BLSN&debugWind=270&debugWindSpeed=30&debugVisibility=.75&debugTime=day` |
| Freezing rain | `?debugWeather=rain&debugPhenomena=FZRA&debugTime=day` |
| Freezing drizzle | `?debugWeather=rain&debugPhenomena=FZDZ&debugTime=day` |

Encode a heavy-weather plus sign as `%2B`. For direct performance comparisons, append `&debugPerformance=full` or `&debugPerformance=low`. Append `&debugReducedMotion=1` to inspect the static weather rendering.

## Performance and accessibility

- Normal presentation now always starts at full quality, at the owner’s request. It targets 30 weather frames per second; explicit developer/preview low mode targets 20. The clocks keep their separate absolute-system-time ticks.
- The main canvas backing buffer is capped at approximately 3.2 million pixels in full quality and 1.5 million in low quality, including on 4K/high-DPI displays. CSS sizing remains full-screen.
- The photographic sky uses one visible backing store and one offscreen buffer, each capped at 960 × 540 pixels. Procedural clouds reuse two 384 × 224 textures and one 576 × 324 composite; there is no per-frame image decoding or pixel readback.
- Hardware-concurrency/device-memory detection and sustained-cost automatic quality reductions are disabled. Full quality remains selected even when rendering is expensive. The panel still reports actual FPS, render time, buffer dimensions and requested quality. Target rates are limits, not guaranteed device performance. Explicit low mode remains available for comparison/debugging, but normal presentation never selects it automatically.
- Hidden tabs stop the weather loop and lightning timers. Visibility recovery resumes without accumulating missed frames. Clear scenes stop drawing once transitions settle.
- Reduced motion draws a static weather snapshot and disables lightning. A weather or viewport change can redraw that snapshot without running a continuous animation.
- Both layers stay behind the UI. Photographic sky sits under the original scene scrim and matches the active wallpaper through CSS filtering, avoiding the less widely supported Canvas filter API. The existing clock-band CSS mask remains on the atmosphere/precipitation layer, preserving the accepted rain/fog presentation. Lightning width/glow is modestly stronger without increasing flash frequency.

## Verification and limits

At implementation review, all **266 tests**, TypeScript (`npx tsc --noEmit`), and the GitHub Pages static production build (`npx next build`) passed. Tests include condition families, current/forecast separation, wind projection, low/reduced specifications, invalid-number guards, no input mutation, and existing weather/cache/clock boundaries. The new wind tests cover FROM versus flow, all cardinal conventions, gusts, north wraparound, variable-sector geometry, source-specific stale cutoffs, missing/model/future-time inputs, reduced motion, and accessible markup from the actual TSX component. Existing flyby tests verify the new transit range with unchanged gap and gating. Eight quality regressions execute the real canvas component under sustained slow rendering and verify that full remains full, explicit low/full mode switches remain reversible, buffers stay bounded, and hidden/reduced/paused/unavailable lifecycle behavior remains intact. A Linux-only test path was corrected with `fileURLToPath`.

`npm run lint` remains blocked by the repository's pre-existing missing ESLint 9 flat configuration. No dependency was added to work around it. No production deployment or pull request was created for this local upgrade.

Actual TV/tablet GPU performance, long-running memory behavior, and device-specific visual quality still require testing on the intended display hardware. Automated tests and a successful static build do not establish those results.

### Independent lifecycle checks

A mocked React/Canvas harness also checked one outstanding animation frame across updates and sustained slow rendering without automatic downgrade, hidden-tab cancellation/resume, reduced-motion static redraws, listener removal, and bounded 4K backing-buffer sizes. Renderer tests verify that repeated frames allocate no additional texture canvases or ImageData and that disposal releases their references. Independent image-loader checks cover successful, failed, obsolete, and post-unmount callbacks, and the two-canvas lifecycle keeps one outstanding animation frame. These are programmatic checks, not a long-running browser heap/GPU benchmark. One-time procedural texture generation measured roughly 85–90 ms on the cloud CPU in a mocked-canvas harness; slower devices may take longer.

The live browser screenshot/layout comparison and real-device TV/tablet performance review have not been completed. The separate private preview lets the owner review the rendered site; an isolated renderer-only recording, if supplied, is labeled accordingly and does not verify the complete browser UI. A native Canvas renderer-only comparison demonstrated photographic sky movement roughly eight times more visible than the earlier procedural-only overlay over a three-second interval, while protected tower/horizon/ground pixels stayed unchanged in the isolated photo pass. Full-effect rain, fog, and lightning naturally alter those pixels visually. This is renderer evidence, not a complete browser screenshot or a target-device performance benchmark. The photographic sky uses bounded pan/zoom with soft architectural masks, so motion can slow and reverse and masked sky can remain less mobile near the tower. It is not photorealistic volumetric cloud simulation; true fluid advection, calibrated upper-air wind, and a fully segmented photographic foreground would require additional artwork/rendering work.

## Review and rollback

The local work is on `feat/cinematic-weather`, based on `f623a68bf4c4126e1378ee9499772fc1f2929851`. The production GitHub Pages site and its `main` branch have not been updated. Review the private preview before publishing a branch or draft pull request; deployment remains a separate decision.

For a supplied patch, start from that base on a separate branch and preserve any existing uncommitted work. Run `git apply --check cinematic-weather.patch` before `git apply cinematic-weather.patch`. To undo an uncommitted isolated application, run `git apply -R --check cinematic-weather.patch` and then `git apply -R cinematic-weather.patch`. If it has been committed or later edits exist, use a reviewed revert commit rather than discarding unrelated work. The original background/aircraft assets and weather data modules require no rollback because they were not changed.

Changed files include the original weather/compass work and the later information-bar request: `README.md`; `app/PrecipCanvas.tsx`, `PreviewLab.tsx`, `WindInstrument.tsx`, `SolarLunarInstrument.tsx`, `BirdWatchGlyph.tsx`, `solarLunar.ts`, `solar-lunar.css`, `information-bar.css`, `atmosphereRenderer.ts`, `photographicSky.ts`, `cinematic-weather.css`, `layout.tsx`, `lightning.css`, `lightning.ts`, `page.tsx`, `useLightning.ts`, `weatherController.ts`, `windCompass.ts`, `wind-compass.css`; `package.json` (test script only); `docs/CINEMATIC-WEATHER.md`, `PREVIEW-LAB.md`, `INFORMATION-BAR.md`; `tests/information-bar.test.mjs`, `solar-lunar.test.mjs`, `weather-refresh.test.mjs`, `lightning.test.mjs`, `weather-fx.test.mjs`, `weather-controller.test.mjs`, `atmosphere-renderer.test.mjs`, `photographic-sky.test.mjs`, `wind-compass.test.mjs`, `flyby.test.mjs`. No new runtime dependencies, API keys, paid services, or video assets are introduced.

## Phenomenon consistency audit

Preview labels now decode the actual selected tokens instead of printing a coarse scene name. Smoke FU is no longer called fog, and live secondary modifiers cannot leak into previews. Code-specific current/forecast icons distinguish obscuration and frozen precipitation; standalone hail, squalls and funnel clouds do not get a thunderstorm bolt. Full-quality smoke now has warmer charcoal, elevated billowing texture and gentle upward drift, distinct from the low white fog bank, cool mist and tan haze. These are illustrative atmospheric effects, not calibrated visibility simulations.

The existing Open-Meteo fallback retains each documented WMO code’s phenomenon and intensity instead of collapsing drizzle/freezing rain/snow grains into generic rain/snow. Model thunder does not create current-lightning reports or animated bolts. Mapping is based on the provider’s [weather-code documentation](https://open-meteo.com/en/docs#weather-code). No model feeds, fetch precedence, keys or services were added. See [Scenario Verification](SCENARIO-VERIFICATION.md) for tested matrices and limitations.

## Frozen precipitation continuity refinement

The frozen-particle stream now stays independent of short, bounded bounce fragments. Hail has a compact irregular ice shape, contact positions vary by depth, and rebounds lose energy and fade quickly. Full-height particles begin distributed across their active paths rather than arriving as a startup cohort. See [the frozen-motion review](FROZEN-PRECIPITATION-MOTION.md) for the specific bounds and temporal validation.
