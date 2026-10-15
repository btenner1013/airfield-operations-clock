# Weather and information-board scenario verification

Reviewed 15 October 2026. This report documents an enumerated source/runtime check, not a claim that every possible real-world weather report or device has been tested.

## Scope and outcomes

| Layer | Scenarios/checks | Outcome |
|---|---:|---|
| Actual page preview wiring | 85 preset links + 11 weather buttons | All execute their real query or callback path; expected labels/effects/provenance pass |
| Page assertions | 362 assertions | Pass: decoded labels, icons, full-quality default, chosen night retained by weather buttons, hidden normal controls, no live modifier/lightning leakage |
| Weather-token matrix | 2,096 enumerated inputs; 84 explicit semantic checks | Pass; includes supported families, intensity, pairwise mixtures, remarks/recent/unknown boundaries, punctuation, and grammar probes |
| Model fallback and model forecast | 29 mapped weather codes + 5 invalid/unknown inputs | Pass: exact drizzle/freezing/snow-grain/shower metadata and icons, no fabricated current lightning warning |
| Native renderer | 43 effect-family scenarios × day/night = 86 | Pass: actual canvas code runs, bounded single animation loop, visible effect output where applicable, cleanup removes the loop |
| Lunar and bird-watch states | 662 assertions across the enumerated matrices | Pass: all eight lunar phases night-only, boundary/unavailable inputs, risk/age combinations, steady age and reduced-motion behavior |
| Warning component | 144 source/component combinations | Pass: supplied text/time windows/colors, stale/unverified/preview/feed provenance, HTML escaping |
| Renderer lifecycle | Hidden/resume, pause, reduced/static update, resize, image races/failure, disposal, sustained slow-frame simulation | Pass; normal full quality is retained; buffers stay bounded |
| Airport mask | 1280×720, 1024×768, 768×1024, 390×844, 2560×1080 | Tower, poles and ground receive zero moving-sky mask alpha |

The scenario files enumerate actual inputs and outputs; scenario counts above overlap and should not be summed into a single test total. The final release passes all 260 repository tests, TypeScript checking and the static production build.

## Verified corrections

- Smoke now has its own decoded label, smoke icon and darker drifting plume treatment. Fog, mist, haze, dust and smoke are not presented as the same phenomenon.
- Preview labels use effective simulated weather, rather than the broad wallpaper theme, and no longer append an unrelated live secondary condition. Simulated current weather is explicitly labeled.
- Hail and small hail no longer imply a thunderstorm bolt without a TS descriptor. Freezing precipitation, mixed rain/snow, dust/sand, ash, squall/funnel and unknown precipitation have appropriate code-driven symbols.
- Higher-priority thunderstorm/tornado headlines are retained when mixed winter precipitation is also present. Secondary decoded details remain visible, including forecast rows.
- Combined freezing rain/ice pellets and other supported compound precipitation retain their constituent effects. Nearby showers do not dilute on-field rain or turn local steady rain into showers.
- Supported vicinity and automated groups, indefinite vertical visibility and report terminators are handled consistently. TAF overlay end transitions restore prevailing conditions at the exclusive end of the temporary period.
- Model fallback keeps the provider's exact phenomenon/intensity rather than collapsing freezing drizzle, freezing rain and snow grains into generic rain/snow. Model estimates cannot create an observation-driven current warning or sky lightning.
- Old/future current-lightning timestamps suppress sky flashes; stale and unverified report labels distinguish retained data from verified current observations. General Ops Board alerts preserve their supplied text and source.
- Both moon artwork and phase name/accessibility text are absent during day or unavailable solar state. Today's sunset controls current day/night even when tomorrow's sunset is later. Missing upstream solar events no longer become an epoch-derived time.

## Representative phenomena covered

Precipitation: drizzle, rain, light/heavy intensity, showers, freezing drizzle/rain, snow, snow showers, snow grains, ice crystals, ice pellets, hail, small hail, blowing/drifting snow, rain/snow, snow plus blowing snow and freezing rain plus pellets.

Obscuration: mist, fog, shallow/patchy/partial/freezing fog, haze, smoke, suspended/blowing/drifting dust and sand, dust/sand storms, dust whirls and volcanic ash.

Other states: thunderstorm/vicinity/distant lightning, clear/partly cloudy/overcast, calm/directional/gusting/variable wind, all lunar phases, missing/stale/future observations, BWC severity/age/reduced motion, normal live view and explicit demos.

## Preservation checks

The clock/date/local and Zulu formatting, moon-phase ephemeris, C-17 scheduler and accepted flight path/gates remain unchanged from the prior preview. Wind instrument internals, bird-watch parser/palette, wallpaper assets, airport mask and the single-loop canvas lifecycle remain unchanged. The authorized faster 9–13 second C-17 transit remains in place.

## Important limits

- No authenticated full-app browser, mobile Safari, physical TV/tablet, browser layout measurement, live-feed uptime or hardware FPS certification was performed. Source-level mobile sizing and lifecycle checks are not a substitute for device testing.
- Native contact sheets execute the actual renderer against synthetic conditions and a common original airport backdrop. They omit browser CSS grading/masks, the complete page, photographic-sky image loading and live observations. Their labels identify them as native renderer tests. Lightning in those static panels is a diagnostic pulse, not a timing-frequency measurement.
- Grammar probes are robustness inputs, not assertions that every accepted combination is meteorologically valid. Supported unusual examples were checked against primary meteorological references.
- UP/SHUP/VCSH use the existing generic rain-style particle approximation while their labels/icons retain unknown/vicinity meaning. SQ, FC and PY have labels/icons but no newly invented dedicated funnel/spray animation. Mixed rendering is bounded to two precipitation families. These are deliberate rendering limits, not claims of a physical simulation.
- The fixed KMEM solar model safely handles unavailable/no-event inputs; it is not a polar ephemeris. BWC age has no invented stale cutoff: old ages remain explicit.
- International METAR TREND/BECMG and unknown BKN/// or SCT/// layer heights remain pre-existing parser limits. This fixed KMEM app is scoped to its US station/SM/FM products; it is not validated as a general international aviation decoder.
- ESLint could not run because the existing repository lacks the ESLint 9 flat configuration. Type checking, executable tests and the static build provide the recorded validation.

## Primary code-reference validation

- Federal Meteorological Handbook No. 1: https://www.icams-portal.gov/resources/ofcm/fmh/FMH1/fmh1_2019.pdf
- WMO present-weather code registry: https://codes.wmo.int/306/_4678
- ICAO meteorological working-group appendix: https://www.icao.int/safety/meteorology/amofsg/AMOFSG%20Meeting%20Material/Microsoft%20Word%20-AMOFSG.10.SoD.en.pdf
- NWS mixed-precipitation observations: https://www.weather.gov/gsp/KCLT_obs_30Jan
- UCAR weather-symbol reference: https://weather.rap.ucar.edu/info/wxSymbols_anno2.pdf
- Open-Meteo provider weather-code documentation: https://open-meteo.com/en/docs
