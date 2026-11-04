import { extractAviationPhenomena, resolveOperationalWeather } from './aviationWeatherPriority.ts';
import { resolveWeatherAlertPlacement } from './weatherAlertPlacement.ts';
import { classifyMetarFreshness } from './weatherRefresh.ts';
import { resolveCurrentWeatherReadings } from './currentWeatherTrends.ts';
import type { Weather } from './weatherTypes';

/** Use the board's selected observed hazard for scenery as well as its alert.
 * Human labels (MIST) never drive effects: the verified aviation code (BR) does.
 * Forecasts, unknown timing and retained/stale reports remain display-only.
 */
export function observedSceneWeather(weather: Weather, nowMs: number): Weather {
  if (weather.feedStatus === 'OFFLINE' || weather.requestStatus === 'ERROR') return weather;
  const selected = [weather.wxPrimaryAlert, weather.wxSecondaryAlert];
  const additions: string[] = [];
  let atis = false;
  for (const value of selected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.trim().toUpperCase() : '';
    if (!code || extractAviationPhenomena(code).join(' ') !== code) continue;
    const placed = resolveWeatherAlertPlacement(value, null, {}, weather.wxAlertSourceContext, nowMs).current[0];
    if (!placed || placed.scope !== 'current' || placed.stale || !placed.sourceTime) continue;
    additions.push(...extractAviationPhenomena(code));
    atis ||= /\bATIS\b/.test(placed.text) || Array.isArray(record.sources) && record.sources.length === 1 && record.sources[0] === 'ATIS';
  }
  if (!additions.length) return weather;
  const metarCurrent = classifyMetarFreshness(weather.metarObsIso, nowMs).state === 'CURRENT';
  const codes = [...new Set([...additions, ...(metarCurrent ? weather.phenomena || [] : [])])];
  const readings = resolveCurrentWeatherReadings(weather, nowMs);
  const visibilitySm = readings.visibility?.value ?? (metarCurrent ? weather.visibilitySm : null);
  const operationalWeather = resolveOperationalWeather({
    ...(metarCurrent ? weather.operationalWeather || {} : {}),
    codes, visibilitySm,
    sourceKind: atis ? 'ATIS' : 'METAR',
  });
  return { ...weather, phenomena: codes, operationalWeather, condition: operationalWeather.condition,
    description: operationalWeather.label, visibilitySm,
    // CLR here disables cloud particles; the reported sky stays unknown in operationalWeather.
    // A current ATIS hazard must not reactivate expired METAR cloud layers.
    cloudCoverage: metarCurrent ? weather.cloudCoverage : "CLR",
    cloudBaseFt: metarCurrent ? weather.cloudBaseFt : null };
}
