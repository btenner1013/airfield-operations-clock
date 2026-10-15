# Operational warning instruments

The two alert surfaces now share a deliberate visual treatment: a restrained severity-tinted panel, colored leading edge, small steady source/status header, and a stronger wrapping monospace message with tabular Zulu digits. They use the existing Ops Board palette: blue `#35b7ff`, yellow `#ffcc00`, red `#ff4444`.

## Honest labels and unchanged messages

- Current observation-driven lightning uses **CURRENT WX** with the existing UTC observation stamp when available. Missing observation time is explicitly **TIME UNVERIFIED**, not a fabricated time or freshness claim.
- An upstream-flagged or age-expired report is labeled **REPORTED WX / STALE REPORT**, with its source stamp retained. The existing warning text and alert-animation decision remain unchanged. It uses the existing 75-minute/five-minute-future visual freshness bounds for known observation timestamps. Unknown timestamps remain TIME UNVERIFIED rather than being mislabeled old, and an unidentified Ops source does not borrow another observation’s timestamp.
- The other band is **WEATHER ALERT / OPS BOARD**, not automatically “forecast.” The existing feed contract supplies general alert text, tone, visibility and motion flags; it does not provide a reliable structured current-vs-forecast label or separate Zulu window. The supplied text, including PSBL and its time window, stays intact. A direct read of the public JSON endpoint was unavailable during this pass; no extra feed fields were assumed.
- A degraded/offline feed state appears below a retained general alert. It does not reinterpret or remove the message.
- Debug-generated examples explicitly show **PREVIEW**. They are not presented as live weather.

`OperationalWarning.tsx` has no hazard parser, date parser, fetch, timer or new classification. Existing `resolveLightningDisplay` and `resolveWxAlertDisplay` remain the source of text, severity, visibility and pulse/flash choices. Existing no-report/unavailable gates still hide absent alerts. General warning logic is separate from the cinematic weather scene and does not borrow severity from illustrative effects.

## Motion

Only the message body animates. Status/source labels, observation time and panel border stay steady:

- Current-lightning pulse: original 0.95-second cadence.
- General weather pulse: original 0.82-second cadence.
- Flash: original 1-second cadence.

The original keyframes and blue/yellow/red decisions remain unchanged. OS reduced motion, the explicit reduced-motion state and existing normalized reduced flags suppress motion. A stale alert may retain its original pulse/flash; the **STALE REPORT** label makes its retained status visible. The independent cinematic-scene freshness guard remains separate and suppresses stale scene-lightning effects.

## Forecast source transparency

The right-hand rows retain the same future-only, unique-Zulu-time, first-three selection. Their source badge is derived from those exact displayed rows. **TAF + HOURLY** means TAF condition/sky information is present, while the existing pipeline still supplies hourly temperature and non-TAF precipitation. **HOURLY** covers model fallback and TAF-tagged rows with no operational weather. TAF PROB30/40 behavior, NWS/Open-Meteo probability precedence, TAF source selection and day/night timing remain intact. The later scenario audit adds explicit return-to-prevailing end transitions and corrects demonstrated compound-code label/effect gaps; code-specific icons now preserve phenomenon distinctions.

## Cohesion and fit

All outer instrument cards share subtle rounding, dark surfaces and consistent heading tracking. The wind compass/values and all clock/header/footer styling are untouched. The goose is bounded to its grid track so a tall-tablet large-display breakpoint cannot make it overlap the condition. The inherited short-screen 150px rail cap is removed, with compact outer padding/header spacing, so wrapped warnings can contribute to natural row height rather than being clipped. The five-card order and narrow-screen horizontal scrolling remain unchanged.

Native isolated component renders check actual warning markup and base styling. Source/SSR and cascade tests cover text, provenance, stale/missing/preview states, animation and responsive rules. These checks do not establish full-browser layout or real TV/tablet performance. Browser sign-in was not retried, and production GitHub Pages remains unchanged.
