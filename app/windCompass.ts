import { ATIS_WIND_CURRENT_MINUTES, METAR_WIND_CURRENT_MINUTES, type CurrentWindRecord } from "./currentWind.ts";

export type WindCompassState = "directional" | "variable" | "calm" | "stale" | "unavailable";
export type WindColorCue = "neutral" | "green" | "yellow" | "red";
export type WindCompassModel = Readonly<{
  state: WindCompassState;
  bearing: number | null;
  degrees: string;
  cardinal: string;
  speed: string;
  gust: string | null;
  arrowColor: Exclude<WindColorCue, "red">;
  gustColor: WindColorCue;
  sector: string | null;
  sectorPath: string | null;
  observation: string;
  description: string;
}>;

export function normalizeWindBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function windCardinal(degrees: number): string {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(normalizeWindBearing(degrees) / 22.5) % 16];
}

/** Preserve the short turn across north (359 → 1 is +2°, never −358°). */
export function closestWindRotation(previous: number, bearing: number): number {
  const delta = normalizeWindBearing(bearing - previous + 180) - 180;
  return previous + delta;
}

const degreesLabel = (value: number) => `${String(Math.round(normalizeWindBearing(value)) || 360).padStart(3, "0")}°`;
const validDegrees = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;
const validSpeed = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 999;

/** A clockwise arc of reported FROM bearings, including sectors crossing north. */
export function windSectorPath(from: number, to: number): string | null {
  if (!validDegrees(from) || !validDegrees(to)) return null;
  const sweep = normalizeWindBearing(to - from);
  if (sweep === 0) return null;
  const point = (bearing: number) => {
    const radians = bearing * Math.PI / 180;
    return `${(60 + 36 * Math.sin(radians)).toFixed(3)} ${(60 - 36 * Math.cos(radians)).toFixed(3)}`;
  };
  return `M ${point(from)} A 36 36 0 ${sweep > 180 ? 1 : 0} 1 ${point(to)}`;
}

/** Display only one complete, fresh observed wind; model motion is never an observation. */
export function buildWindCompassModel(wind: CurrentWindRecord | null, nowMs: number): WindCompassModel {
  const empty: WindCompassModel = {
    state: "unavailable", bearing: null, degrees: "—", cardinal: "", speed: "—", gust: null,
    arrowColor: "neutral", gustColor: "neutral",
    sector: null, sectorPath: null, observation: "OBS UNAVAILABLE", description: "Current observed wind unavailable.",
  };
  if (!wind || !["ATIS", "METAR"].includes(wind.source)) return empty;
  const observed = wind.observedAt ? Date.parse(wind.observedAt) : NaN;
  const age = (nowMs - observed) / 60000;
  if (!Number.isFinite(age) || age < -5) return { ...empty, observation: `${wind.source} · TIME UNVERIFIED` };
  const time = new Date(observed).toISOString().slice(11, 16).replace(":", "") + "Z";
  const observation = `${wind.source} · ${time}`;
  const maxAge = wind.source === "ATIS" ? ATIS_WIND_CURRENT_MINUTES : METAR_WIND_CURRENT_MINUTES;
  if (age > maxAge) return {
    ...empty, state: "stale", observation: `${observation} · STALE`,
    description: `Current wind unavailable. Last ${wind.source} observation at ${time} is stale, ${Math.floor(age)} minutes old.`,
  };
  if (!validSpeed(wind.speedKt) || (wind.gustKt !== null && !validSpeed(wind.gustKt))) return empty;
  const speed = String(Math.round(wind.speedKt)).padStart(2, "0");
  const gust = wind.gustKt === null ? null : String(Math.round(wind.gustKt)).padStart(2, "0");
  // Display cues only, not operational limits. Classify fresh observations independently.
  const gustColor: WindColorCue = wind.gustKt === null ? "neutral" : wind.gustKt >= 30 ? "red" : wind.gustKt >= 20 ? "yellow" : "green";
  const gustDescription = gust === null ? "" : `, gusting ${gust} knots`;
  if (wind.directionType === "calm" && wind.speedKt === 0) return {
    ...empty, state: "calm", degrees: "CALM", speed: "00", observation,
    description: `Calm wind, 0 knots. ${observation}.`,
  };
  if (wind.directionType === "variable") return {
    ...empty, state: "variable", degrees: "VRB", speed, gust, gustColor, observation,
    description: `Variable wind direction, ${speed} knots${gustDescription}. ${observation}.`,
  };
  if (wind.directionType !== "directional" || !validDegrees(wind.directionDegrees)) return empty;
  const bearing = normalizeWindBearing(wind.directionDegrees);
  const degrees = degreesLabel(bearing), cardinal = windCardinal(bearing);
  const sector = validDegrees(wind.variableFromDegrees) && validDegrees(wind.variableToDegrees)
    ? `${degreesLabel(wind.variableFromDegrees)}–${degreesLabel(wind.variableToDegrees)}` : null;
  const sectorPath = sector ? windSectorPath(wind.variableFromDegrees!, wind.variableToDegrees!) : null;
  return {
    arrowColor: wind.speedKt >= 20 ? "yellow" : "green", gustColor,
    state: "directional", bearing, degrees, cardinal, speed, gust, sector, sectorPath, observation,
    description: `Wind from ${degrees} ${cardinal}, ${speed} knots${gustDescription}.${sector ? ` Direction varies from ${sector}.` : ""} The arrow shows airflow toward ${degreesLabel(bearing + 180)} ${windCardinal(bearing + 180)}. ${observation}.`,
  };
}
