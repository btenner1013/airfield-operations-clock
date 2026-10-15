import type { Theme } from "./weatherTypes";

type ModelWeather = { condition: Theme; description: string; phenomena: string[] };
/** WMO interpretation codes documented by the existing model provider:
 * https://open-meteo.com/en/docs#weather-code
 * Tokens here are visual metadata for a model estimate, never a fabricated METAR.
 * Wind speed is independent of precipitation intensity. Unknown codes stay unavailable.
 */
const MODEL_CODES: Record<number, readonly [Theme, string, string]> = {
  0: ["clear", "Clear", ""],
  1: ["partly-cloudy", "Mainly clear", ""],
  2: ["partly-cloudy", "Partly cloudy", ""],
  3: ["overcast", "Overcast", ""],
  45: ["fog", "Fog", "FG"],
  48: ["fog", "Rime fog", "FZFG"],
  51: ["rain", "Light drizzle", "-DZ"],
  53: ["rain", "Moderate drizzle", "DZ"],
  55: ["heavy-rain", "Dense drizzle", "+DZ"],
  56: ["rain", "Light freezing drizzle", "-FZDZ"],
  57: ["heavy-rain", "Dense freezing drizzle", "+FZDZ"],
  61: ["rain", "Light rain", "-RA"],
  63: ["rain", "Moderate rain", "RA"],
  65: ["heavy-rain", "Heavy rain", "+RA"],
  66: ["rain", "Light freezing rain", "-FZRA"],
  67: ["heavy-rain", "Heavy freezing rain", "+FZRA"],
  71: ["snow", "Light snow", "-SN"],
  73: ["snow", "Moderate snow", "SN"],
  75: ["snow", "Heavy snow", "+SN"],
  77: ["snow", "Snow grains", "SG"],
  80: ["rain", "Light rain showers", "-SHRA"],
  81: ["rain", "Moderate rain showers", "SHRA"],
  82: ["heavy-rain", "Violent rain showers", "+SHRA"],
  85: ["snow", "Light snow showers", "-SHSN"],
  86: ["snow", "Heavy snow showers", "+SHSN"],
  95: ["thunderstorm", "Thunderstorm", "TS"],
  96: ["thunderstorm", "Thunderstorm with light hail", "-TSGR"],
  97: ["thunderstorm", "Heavy thunderstorm", "+TS"],
  99: ["thunderstorm", "Thunderstorm with heavy hail", "+TSGR"],
};
export function modelWeatherFromCode(code: unknown): ModelWeather {
  const entry = typeof code === "number" && Number.isInteger(code) ? MODEL_CODES[code] : undefined;
  if (!entry) return { condition: "neutral", description: "Weather unavailable", phenomena: [] };
  return { condition: entry[0], description: entry[1], phenomena: entry[2] ? [entry[2]] : [] };
}
