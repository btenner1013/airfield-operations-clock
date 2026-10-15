/** Preview text uses the same aviation decoder as live observations, never a scene-theme name. */
import { resolveOperationalWeather, type OperationalWeather } from "./aviationWeatherPriority.ts";
import { debugLightningReport, parseCurrentLightning, NO_LIGHTNING, type LightningReport } from "./lightning.ts";
import type { CloudCoverage, Theme } from "./weatherTypes";

export type CurrentWeatherPresentation = {
  condition: Theme;
  label: string;
  secondaryLabel: string | null;
  codes: string[];
  simulated: boolean;
};

export function currentWeatherPresentation(input: {
  condition: Theme;
  description: string;
  operationalWeather: OperationalWeather | null;
  simulated: boolean;
  phenomena: string[];
  coverage: CloudCoverage;
  ceiling: number | null;
  visibility: number | null;
}): CurrentWeatherPresentation {
  if (!input.simulated) return {
    condition: input.condition,
    label: input.description,
    secondaryLabel: input.operationalWeather?.secondaryLabel ?? null,
    codes: input.operationalWeather?.codes ?? input.phenomena,
    simulated: false,
  };
  const resolved = resolveOperationalWeather({
    codes: input.phenomena,
    cloudCoverage: input.coverage,
    cloudBaseFt: input.ceiling,
    visibilitySm: input.visibility,
    sourceKind: "MODEL", // Presentation-only synthetic input, never an observation or feed mutation.
  });
  return { condition: resolved.condition, label: resolved.label, secondaryLabel: resolved.secondaryLabel ?? null, codes: resolved.codes, simulated: true };
}

/** Explicit lightning demos win; otherwise derive the preview from its actual tokens.
 * Never borrow live lightning for a different simulated phenomenon, or turn VCTS into TSRA.
 */
export function currentLightningPresentation(input: { preview: string | null; simulated: boolean; phenomena: string[]; live: LightningReport | null }): LightningReport {
  const explicit = debugLightningReport(input.preview);
  if (explicit) return explicit;
  if (input.simulated) return { ...parseCurrentLightning(input.phenomena.join(" ")), source: "debug" };
  return input.live ?? NO_LIGHTNING;
}

/** Unknown timing and an old observation are distinct display states. Visual freshness
 * may suppress both, but an unverified timestamp must not be described as a known old report.
 */
export function lightningReportForDisplay(report: LightningReport, metarObservation: string | null, nowMs: number): LightningReport {
  const direct = report.sourceTime ? Date.parse(report.sourceTime) : NaN;
  const metarSource = report.source === "metar-body" || report.source === "metar-remarks";
  const fallback = metarSource && metarObservation ? Date.parse(metarObservation) : NaN;
  const observed = Number.isFinite(direct) ? direct : fallback;
  const sourceTime = Number.isFinite(direct) ? report.sourceTime : Number.isFinite(fallback) ? metarObservation : null;
  const expired = report.source !== "debug" && Number.isFinite(observed) && Number.isFinite(nowMs) && (nowMs - observed > 75 * 60000 || observed - nowMs > 5 * 60000);
  return { ...report, sourceTime, isStale: Boolean(report.isStale || expired) };
}
