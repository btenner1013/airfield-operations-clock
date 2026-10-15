# Weather and solar scenario verification

## Scope

This pass exercises supported preview controls and weather phenomena through the current and forecast presentation, shared aviation parser, effect classification/controller, warning state, lunar visibility and isolated renderers. It is a bounded regression audit, not a certification that a browser/device or every possible weather report is correct. No new data source, service, API key or runtime dependency was added.

## Corrections

- Preview text uses the selected aviation tokens and shared decoder. FU is SMOKE, BR is MIST, HZ is HAZE, and all supported modifiers/intensity labels come from the same source as live reports. Live secondary text cannot leak into a different simulated condition.
- Current/forecast pictograms now accept actual phenomenon codes. Smoke, haze, dust/sand, ash, freezing precipitation, pellets/hail, mixed precipitation, squalls and funnels have dedicated static SVGs. A hail-only code cannot manufacture a lightning icon; actual TS/VCTS keeps its existing thunder symbol. Tornado/funnel priority precedes thunder in compound icons.
- Smoke retains the existing FU classification but uses elevated warm-charcoal billows and gentle rise instead of sharing the low fog bank’s mask. Fog/mist/haze/dust rendering remains unchanged. Full-quality defaults, bounded buffers, reduced motion, one animation loop and hidden-tab pause are preserved.
- The existing model fallback retains its documented numeric weather code in presentation metadata rather than flattening freezing drizzle/rain, snow grains and showers into broad scene themes. Wind speed no longer changes the meaning of the model precipitation code. Unknown model codes are unavailable. Model thunder can tint the illustrative scene but cannot fabricate a current-lightning observation or animated bolt.
- Current preview lightning follows the actual selected tokens, including vicinity and intensity, rather than converting every thunder code to TSRA. Explicit lightning presets still take priority.
- Known old/future observation timestamps now mark retained current warnings stale using the existing freshness bounds. Unknown timestamps remain TIME UNVERIFIED. An Ops feed with unknown observation provenance cannot borrow an unrelated METAR time. Raw source warning text, tone and existing alert pulse/flash policy stay intact.
- METAR observations more than five minutes in the future now show UNAVAILABLE rather than CURRENT, matching the existing observation-instrument tolerance.
- Unknown current ceiling data and missing model sky metadata say UNAVAILABLE, not UNLIMITED. Preview ceilings use the selected simulated cloud inputs.
- All moon phase information is night-only: disc, name, caption, accessibility wording and phase data attribute. Daytime has a SOLAR heading and no blank caption. Missing/invalid solar windows do not claim verified night. Lunar phase math and waxing/waning orientation are unchanged.
- Solar event handling rejects missing/nonfinite Unix events instead of converting null to epoch time. Current day/night uses today’s sunset even when tomorrow’s sunset is later; next-day event captions still work. Invalid current or selected event pairs leave progress unavailable.

Compound-token, highest-priority label, valid vicinity, indefinite-ceiling and TAF return-transition regressions are tested alongside these presentation changes. Higher-priority thunder/tornado headlines retain combined lower-priority precipitation and obscuration detail, including in the forecast rows. Their detailed cases live in the source test suite; the existing source hierarchy and exclusive forecast-period ends remain authoritative.

## Verification result

All **260 automated tests**, TypeScript, the Next.js static export and `git diff --check` pass. The independent QA dossier adds actual page execution and large input matrices beyond these named tests.

## Evidence

- Automated tests cover all provider WMO-code mappings, actual component markup, phase geometry, real day/night event boundaries, warning timing/source states, icon families, effect types/intensities, model/TAF separation, refresh behavior, wind/BWC/C-17 behavior and renderer lifecycle.
- Independent actual Home execution checks query presets and live fixtures, rather than relying only on string searches.
- Actual production SVG icon and solar-dial sheets are included as isolated renders. The solar sheet extracts caption text from the production component.
- The smoke comparison uses actual source controller/renderer and existing airport wallpaper with synthetic same-visibility inputs. It does not claim that a synthetic 1 SM value visually reproduces real 1 SM visibility. Non-smoke native samples were compared byte-for-byte.

Full-browser CSS/layout, device GPU behavior, real-time external-feed availability and long-running TV/tablet stability were not verified in this environment. Browser sign-in was not retried. The pre-existing missing ESLint flat config still blocks lint; tests, type checking and export are recorded separately. Review publishing is private; production GitHub Pages has not changed.

## Reference for the existing model source

The model mapping uses the provider’s documented [WMO weather codes](https://open-meteo.com/en/docs#weather-code), checked during this pass. These tokens are visual metadata for model estimates, not generated METAR observations. Actual current METAR/ATIS and general Ops Board source boundaries remain separate.
