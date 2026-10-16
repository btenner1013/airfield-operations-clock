import type { Forecast, Weather } from "./weatherTypes";
import { isForecastWindRecord } from "./forecastWind.ts";

const ISSUE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export type ForecastWindPresentation = {
  text: string;
  state: "available" | "stale" | "unavailable";
  detail: string;
};

type ForecastWindContext = Pick<Weather, "tafIssueIso" | "tafValidStartIso" | "tafValidEndIso" | "tafFetchStatus" | "requestStatus">;

/** Wind is a prevailing TAF forecast for this exact row, never a current METAR
 * or model reading. Evaluate freshness at real time, not at the future row or
 * the preview clock. Validate again here because older cache records are untyped.
 */
export function formatForecastWind(
  row: Pick<Forecast, "source" | "iso" | "forecastWind">,
  context: ForecastWindContext,
  nowMs: number = Date.now(),
): ForecastWindPresentation {
  const unavailable = (detail: string): ForecastWindPresentation => ({ text: "N/A", state: "unavailable", detail });
  const stale = (detail: string): ForecastWindPresentation => ({ text: "N/A · STALE", state: "stale", detail });
  const wind = row.forecastWind;
  if (row.source !== "TAF" || !isForecastWindRecord(wind)) return unavailable("No verified prevailing TAF wind is available for this forecast time.");

  const issue = Date.parse(context.tafIssueIso || "");
  const validStart = Date.parse(context.tafValidStartIso || "");
  const validEnd = Date.parse(context.tafValidEndIso || "");
  const rowTime = Date.parse(row.iso);
  if (![nowMs, issue, validStart, validEnd, rowTime].every(Number.isFinite) || validEnd <= validStart || issue >= validEnd) {
    return unavailable("TAF wind timing could not be verified.");
  }
  if (issue !== Date.parse(wind.issueIso) || issue > nowMs + ISSUE_CLOCK_TOLERANCE_MS) {
    return unavailable("The wind does not match a verified, already-issued TAF.");
  }
  if (nowMs >= validEnd) {
    return stale("TAF wind is withheld because the TAF has expired.");
  }
  const status = (context.tafFetchStatus || "").trim().toUpperCase();
  if (status !== "OK" || context.requestStatus === "ERROR") {
    return /STALE|EXPIRED/.test(status) ? stale("The TAF source reports stale or expired data.") : unavailable("The TAF source is unavailable or has not been reverified.");
  }
  if (rowTime < validStart || rowTime >= validEnd || rowTime < Date.parse(wind.validFromIso) || rowTime >= Date.parse(wind.validToIso)) {
    return unavailable("No prevailing TAF wind covers this exact forecast time.");
  }

  const speed = String(Math.round(wind.speedKt)).padStart(2, "0");
  const gust = wind.gustKt === null ? "" : ` G${String(Math.round(wind.gustKt)).padStart(2, "0")}`;
  const direction = wind.directionType === "variable" ? "VRB" : `${String(wind.directionDegrees).padStart(3, "0")}`;
  const text = wind.directionType === "calm" ? "CALM" : `${direction} @ ${speed}${gust} KT`;
  return {
    text,
    state: "available",
    detail: `Prevailing TAF wind at ${new Date(rowTime).toISOString()}. Issued ${new Date(issue).toISOString()}. TEMPO/PROB wind changes are not included.`,
  };
}

/** Describes the rows actually on screen, without changing their selection or data.
 * TAF-derived rows still inherit hourly temperature and non-PROB precipitation.
 * A TAF-tagged row with no operationalWeather uses its existing hourly fallback.
 */
export function describeForecastSources(rows: readonly Pick<Forecast, "source" | "operationalWeather">[]): { label: string; detail: string } {
  if (!rows.length) return { label: "NO DATA", detail: "No upcoming forecast rows are available." };
  const hasTafCondition = rows.some(row => row.source === "TAF" && row.operationalWeather !== null && row.operationalWeather !== undefined);
  if (hasTafCondition) return { label: "TAF + HOURLY", detail: "TAF conditions and sky where available; prevailing TAF wind when current; hourly temperature. Selected TAF PROB30/40 is retained, otherwise precipitation uses the hourly product." };
  if (rows.some(row => row.source === "MODEL" || row.source === "TAF")) return { label: "HOURLY", detail: "Displayed conditions use the hourly fallback; temperature and precipitation are hourly products. No TAF condition is present in these rows." };
  return { label: "SOURCE N/A", detail: "Forecast source metadata is unavailable." };
}
