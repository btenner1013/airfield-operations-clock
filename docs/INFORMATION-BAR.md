# Bottom information instruments

The solar/lunar, current weather, bird watch and future-weather cards now share a clearer instrument treatment. The accepted wind geometry and behavior are unchanged; the requested ARROW = FLOW caption is removed, while variable-sector information remains. Its outer card finish/header tracking matches the other instruments. The existing five-card rail, scrolling behavior, clock/header/footer styles, airport scene, weather effects and C-17 behavior are preserved.

## What changed

- **Solar/lunar:** a larger source-drawn moon appears only at night, using the existing resolved solar day/night window. The phase name, phase caption, accessibility description and phase data attribute are also night-only; daytime shows SOLAR with no empty caption placeholder. A continuous projected terminator replaces the old linear shadow approximation. Waxing is illuminated on the right and waning on the left in the retained north-up phase convention for KMEM. Subtle lunar terrain, limb shading and a dark unlit disc keep small crescents and the new moon legible. Sunrise and sunset have separate local-time readouts and TODAY/TOMORROW labels. Following review, the original circular/elliptical solar-lunar dial is restored: a layered instrument rim, 36 fine ticks, warm upper daylight arc, cool lower night arc, and highlighted elapsed path. The sun and night moon use the original resolved marker coordinates. The former daylight moon inset and visible NORTH-UP VIEW caption are removed at the owner’s request; phase orientation/calculation is unchanged. Missing solar times do not invent a nighttime moon marker. The orbit is elapsed daylight/night time, not an astronomical position or altitude diagram.
- **Current weather:** a larger temperature and weather pictogram lead the card. The complete current condition and any secondary modifier can wrap rather than being clipped. Preview conditions now use the shared aviation decoder, so FU says SMOKE rather than the coarse fog scene theme, and live modifiers cannot leak into simulated weather. Code-aware current and forecast icons distinguish smoke/haze/dust/ash, frozen/mixed precipitation and non-thundering hail/squalls/funnels. Preview state is visibly labeled, effective preview ceilings are shown, and missing ceiling data no longer says UNLIMITED. Feels-like temperature, humidity and ceiling are grouped in a labeled row. The existing METAR feed/freshness badge and conditional lightning message remain.
- **Bird watch:** the selected A design adds a stronger, steady blue-backed observation-age band with larger high-contrast text and the existing AHAS calendar timestamp below it. The selected goose-in-flight SVG has a recognizable neck/head, feathered wings and tail. Its color matches the condition: LOW green `#72dbbd`, MODERATE amber `#f3b765`, SEVERE/HIGH red `#ff7676`, and unknown/unavailable neutral `#a6bdca`. Both the goose and severe condition text use the original `bwcPulse` 1.2-second fade. The new SVG is explicitly included in that animation selector, restoring the old symbol’s behavior. The age band never pulses. OS reduced motion and the existing preview reduced-motion state keep both alert elements steady. Missing timestamps now explicitly say AGE UNAVAILABLE; original minute/hour ages and FUTURE OBS diagnostics are preserved, with no invented freshness cutoff.
- **Future weather:** three clean forecast rows separate Zulu times, condition/icon, precipitation probability, sky/ceiling detail and temperature. Forecast temperatures explicitly carry °F. Long conditions, detail and hazard messages can wrap. The header says UPCOMING rather than claiming a nine-hour span that the existing model fallback does not guarantee. A visible-row source badge now says TAF + HOURLY when TAF conditions/sky are present alongside hourly temperature/precipitation, HOURLY when the shown conditions use the model fallback (including TAF-tagged rows without operational weather), and NO DATA/SOURCE N/A when appropriate. Upcoming-only filtering, duplicate-time suppression and the existing hazard palette/animation rules are unchanged.

The instrument CSS is scoped to these four cards. A separate cohesion stylesheet gives all five outer cards a consistent finish/header rhythm, bounds the goose within its grid track on tall tablets, and removes an inherited 150px low-height rail cap that could clip content. Compact rail padding/header spacing helps warnings fit; accepted wind internals and clock/header/footer styles are unchanged. No new animation loop, network source, runtime dependency, paid service or API key was added.

## Warning treatment

See [Operational Warnings](OPERATIONAL-WARNINGS.md) for the dedicated current/general warning treatment, source/status labels and preserved motion rules.

## Data boundaries

`getMoonPhase`, local/Zulu date formatting, `America/Chicago`, KMEM coordinates, refresh cadence and astronomy update cadence remain unchanged. Scenario testing corrected two pre-existing solar-input/boundary bugs: missing Unix solar events no longer coerce to epoch time, and current day/night is classified against today’s sunset rather than tomorrow’s potentially later sunset. Missing or invalid current solar events cannot expose lunar information. Next-day event captions and the next sunrise endpoint remain supported. The moon drawing uses the existing phase value; it is a more legible schematic, not a new ephemeris or a photo of the moon at the user's viewing angle. Moonrise, moonset, sky rotation and lunar altitude are not calculated or claimed.

Day/night progress comes from the solar window with the tested event-boundary fixes noted above. The display does not create a progress marker if either solar time is unavailable. Original numeric/string event values are preserved, while an absent solar event is rendered as a dash.

The original moon-phase preview aliases `crescent`, `quarter` and `full` retain their values. The previously documented `new` and `gibbous` previews now set matching geometry as well as a label; unknown preview values leave live data unchanged. Additional explicit waxing/waning names make all eight phases inspectable. These changes apply only to preview state.

## Preview controls

Use the private review site's base URL with any of these query strings. The normal URL has no preview overrides.

- `?previewWeatherFx=1` opens the existing comparison controls, including all eight moon phases.
- `?debugTime=day&debugMoonPhase=crescent`
- `?debugTime=night&debugMoonPhase=new`
- `?debugTime=night&debugMoonPhase=quarter`
- `?debugTime=night&debugMoonPhase=gibbous`
- `?debugTime=night&debugMoonPhase=full`
- `?debugTime=night&debugMoonPhase=waning-gibbous`
- `?debugTime=night&debugMoonPhase=last-quarter`
- `?debugTime=night&debugMoonPhase=waning-crescent`

`waxing-crescent`, `first-quarter` and `waxing-gibbous` are also accepted. Day, sunrise, sunset and night previews keep their existing behavior.

Bird-condition previews use `?debugBwc=LOW`, `?debugBwc=MODERATE` and `?debugBwc=SEVERE`. Add `&debugReducedMotion=1` for the steady severe state. The normal URL has no overrides. HIGH is a live-feed alias for the severe style, not a new preview value.

The interactive review is available at `?weatherDemo=1` (also `?previewWeatherFx=1`). The existing weather, lunar/day-night, lightning, BWC, flight-category and C-17 controls are joined by wind and weather-alert presets. Diagnostics start collapsed, mobile targets are at least 44px, and the sticky header has a LIVE reset that clears all overrides. Preset links replace query overrides; choose a time preset first, then use the in-place weather buttons to change conditions while retaining that time. Normal URLs show no controls.

## Verification

All **260 tests**, TypeScript and the Next.js static build pass. New tests cover moon geometry and orientation, exact quarters, invalid geometry, eight preview mappings, unknown inputs, no live-data mutation, unique SVG IDs, local event formatting, missing solar data and actual server-rendered component semantics. Restored-dial tests verify the original 88 × 56 ellipse, both event endpoints, sun/moon placement at seven positions per half-cycle, all eight phase states, and no new timers or animation loops. Six added bird-watch tests render the exact production card JSX and verify minute/hour/future/missing ages, calendar stamps, LOW/MODERATE/SEVERE/HIGH/unknown class and color mapping, the original 1.2-second severity fade, a steady age band, and both reduced-motion mechanisms. Twelve warning tests cover source wording/windows, colors, retained stale reports, missing-time/feed/preview state, optional icons, safe text escaping, original motion cadence, reduced motion and scoped fit rules. Five forecast-source tests verify hybrid/hourly/missing badges against exactly the displayed rows. A moon-visibility test covers both solar boundaries and unavailable data. Five preview-control tests exercise real callbacks, query presets, hide/show, diagnostics, live-reset reachability, mobile target rules and the resolved day/night hookup. Existing inventory tests retain weather/forecast/bird fields, alert gates and diagnostics. Independent review checks unchanged phase/clock calculations and corrected missing-event/sunset selection, including midnight, daylight-saving and solar-event outputs, plus the full-page server-rendered fields and unchanged wind/C-17/footer code.

The warning-component review sheet uses the actual stateless React component and its inline base styles through installed Satori and a native SVG rasterizer; it does not verify the responsive CSS cascade or motion. The moon-phase sheet and four-state night-only circular-dial sheet were rendered directly from the actual SVG components using a native rasterizer. The bird color review sheet uses the selected production SVG goose within the reviewed A SVG prototype layout and illustrative observation data; its full HTML/CSS card layout and animation are verified by source/SSR tests, not that static image. They verify isolated graphics, not the complete browser layout. The full private preview still needs visual review on the intended TV/tablet. Browser sign-in was not retried. Device-specific layout, long-running performance and GPU behavior have not been established by source checks or a successful build.

`npm run lint` is blocked by the repository's pre-existing absent ESLint 9 flat configuration. No lint configuration or dependency was added to disguise that limitation. This remains local/private-review work; production GitHub Pages has not been changed.

See [Scenario Verification](SCENARIO-VERIFICATION.md) for the later requested phenomenon-by-phenomenon audit, fixes and evidence limits.
