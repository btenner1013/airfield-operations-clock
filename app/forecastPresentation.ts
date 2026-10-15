import type { Forecast } from "./weatherTypes";

/** Describes the rows actually on screen, without changing their selection or data.
 * TAF-derived rows still inherit hourly temperature and non-PROB precipitation.
 * A TAF-tagged row with no operationalWeather uses its existing hourly fallback.
 */
export function describeForecastSources(rows: readonly Pick<Forecast, "source" | "operationalWeather">[]): { label: string; detail: string } {
  if (!rows.length) return { label: "NO DATA", detail: "No upcoming forecast rows are available." };
  const hasTafCondition = rows.some(row => row.source === "TAF" && row.operationalWeather !== null && row.operationalWeather !== undefined);
  if (hasTafCondition) return { label: "TAF + HOURLY", detail: "TAF conditions and sky where available; hourly temperature. Selected TAF PROB30/40 is retained, otherwise precipitation uses the hourly product." };
  if (rows.some(row => row.source === "MODEL" || row.source === "TAF")) return { label: "HOURLY", detail: "Displayed conditions use the hourly fallback; temperature and precipitation are hourly products. No TAF condition is present in these rows." };
  return { label: "SOURCE N/A", detail: "Forecast source metadata is unavailable." };
}
