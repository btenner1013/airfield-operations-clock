export type CurrentWindDirectionType = "directional" | "variable" | "calm";
export type CurrentWindSource = "ATIS" | "METAR" | "MODEL";

export type CurrentWindRecord = Readonly<{
  directionType: CurrentWindDirectionType;
  directionDegrees: number | null;
  speedKt: number;
  gustKt: number | null;
  variableFromDegrees: number | null;
  variableToDegrees: number | null;
  source: CurrentWindSource;
  observedAt: string | null;
  raw: string;
}>;

export type CurrentWindCandidate = Readonly<{
  text?: string | null;
  observedAt?: string | null;
  fetchStatus?: string | null;
  ageMinutes?: number | null;
}>;

export type ResolveCurrentWindInput = Readonly<{
  atis?: CurrentWindCandidate | null;
  metar?: CurrentWindCandidate | null;
  now?: Date | number;
  atisCurrentMinutes?: number;
  metarCurrentMinutes?: number;
}>;

export type CurrentWindDisplay = Readonly<{
  primary: string;
  secondary: string | null;
  showArrow: boolean;
  arrowRotationDegrees: number | null;
  neutral: boolean;
}>;

export const ATIS_WIND_CURRENT_MINUTES = 90;
export const METAR_WIND_CURRENT_MINUTES = 75;

type VariableSector = Readonly<{ from: number; to: number }>;

const INVALID_STATUS_MARKERS = ["FAILED", "ERROR", "UNAVAILABLE", "STALE", "EXPIRED", "OFFLINE", "BAD"];

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : null;
}

function normalizeObservedAt(value: string | null | undefined): string | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validSectorDegree(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 360;
}

function parseVariableSector(text: string): VariableSector | null {
  const upper = (text || "").toUpperCase();
  const compact = upper.match(/\b(\d{3})V(\d{3})\b/);
  const spoken = upper
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .match(/\b(?:VARIABLE|VARYING)(?:\s+BETWEEN)?\s+(\d{3})\s+(?:AND|TO)\s+(\d{3})\b/);
  const match = compact || spoken;
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  return validSectorDegree(from) && validSectorDegree(to) ? { from, to } : null;
}

function normalizedRaw(direction: string, speedKt: number, gustKt: number | null, sector: VariableSector | null): string {
  const speed = String(speedKt).padStart(2, "0");
  const gust = gustKt === null ? "" : `G${String(gustKt).padStart(2, "0")}`;
  const variability = sector ? ` ${String(sector.from).padStart(3, "0")}V${String(sector.to).padStart(3, "0")}` : "";
  return `${direction}${speed}${gust}KT${variability}`;
}

function recordFromParts(
  directionToken: string,
  speedValue: unknown,
  gustValue: unknown,
  sector: VariableSector | null,
  source: CurrentWindSource,
  observedAt: string | null | undefined,
): CurrentWindRecord | null {
  const direction = directionToken.toUpperCase();
  const speedKt = integer(speedValue);
  const gustKt = gustValue === null || gustValue === undefined || gustValue === "" ? null : integer(gustValue);
  if (speedKt === null || (gustValue !== null && gustValue !== undefined && gustValue !== "" && gustKt === null)) return null;

  if (direction === "000" && speedKt === 0) {
    return Object.freeze({
      directionType: "calm",
      directionDegrees: null,
      speedKt: 0,
      gustKt: null,
      variableFromDegrees: null,
      variableToDegrees: null,
      source,
      observedAt: normalizeObservedAt(observedAt),
      raw: "00000KT",
    });
  }

  if (direction === "VRB" || direction === "VARIABLE") {
    return Object.freeze({
      directionType: "variable",
      directionDegrees: null,
      speedKt,
      gustKt,
      variableFromDegrees: null,
      variableToDegrees: null,
      source,
      observedAt: normalizeObservedAt(observedAt),
      raw: normalizedRaw("VRB", speedKt, gustKt, null),
    });
  }

  const directionDegrees = integer(direction);
  if (directionDegrees === null || directionDegrees < 1 || directionDegrees > 360) return null;
  return Object.freeze({
    directionType: "directional",
    directionDegrees,
    speedKt,
    gustKt,
    variableFromDegrees: sector?.from ?? null,
    variableToDegrees: sector?.to ?? null,
    source,
    observedAt: normalizeObservedAt(observedAt),
    raw: normalizedRaw(String(directionDegrees).padStart(3, "0"), speedKt, gustKt, sector),
  });
}

/** Parse a standard aviation wind token embedded in METAR or ATIS text. */
export function parseStandardWind(
  text: string,
  source: CurrentWindSource,
  observedAt: string | null = null,
): CurrentWindRecord | null {
  const upper = (text || "").toUpperCase();
  const match = upper.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (!match) return null;
  return recordFromParts(match[1], match[2], match[3] ?? null, parseVariableSector(upper), source, observedAt);
}

/** Parse D-ATIS wording such as WIND 210 AT 08 GUSTING TO 18 or WIND CALM. */
export function parseSpokenAtisWind(text: string, observedAt: string | null = null): CurrentWindRecord | null {
  const scan = (text || "")
    .toUpperCase()
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bWINDS?\s+(?:ARE\s+)?CALM\b/.test(scan)) {
    return recordFromParts("000", 0, null, null, "ATIS", observedAt);
  }
  const match = scan.match(
    /\bWINDS?\s+(\d{3}|VRB|VARIABLE)\s+(?:AT\s+)?(\d{1,3})(?:\s*(?:KT|KTS|KNOTS?))?(?:\s*(?:G|GUST|GUSTS|GUSTING)(?:\s+TO)?\s*(\d{1,3})(?:\s*(?:KT|KTS|KNOTS?))?)?/,
  );
  if (!match) return null;
  return recordFromParts(match[1], match[2], match[3] ?? null, parseVariableSector(scan), "ATIS", observedAt);
}

export function parseAtisWind(text: string, observedAt: string | null = null): CurrentWindRecord | null {
  return parseStandardWind(text, "ATIS", observedAt) || parseSpokenAtisWind(text, observedAt);
}

export function parseMetarWind(text: string, observedAt: string | null = null): CurrentWindRecord | null {
  return parseStandardWind(text, "METAR", observedAt);
}

function currentCandidate(candidate: CurrentWindCandidate | null | undefined, nowMs: number, maxAgeMinutes: number): boolean {
  if (!candidate?.text || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 0) return false;
  const status = (candidate.fetchStatus || "").trim().toUpperCase();
  if (INVALID_STATUS_MARKERS.some(marker => status.includes(marker))) return false;

  let ageMinutes: number | null = null;
  if (typeof candidate.ageMinutes === "number" && Number.isFinite(candidate.ageMinutes)) {
    ageMinutes = candidate.ageMinutes;
  } else {
    const observed = candidate.observedAt ? Date.parse(candidate.observedAt) : NaN;
    if (Number.isFinite(observed)) ageMinutes = (nowMs - observed) / 60000;
  }
  // A small future tolerance avoids rejecting a current report solely because clocks differ slightly.
  return ageMinutes !== null && ageMinutes >= -5 && ageMinutes <= maxAgeMinutes;
}

/** Resolve one whole current observation. No field is borrowed from the fallback source. */
export function resolveCurrentWind(input: ResolveCurrentWindInput): CurrentWindRecord | null {
  const suppliedNow = input.now instanceof Date ? input.now.getTime() : input.now;
  const nowMs = typeof suppliedNow === "number" && Number.isFinite(suppliedNow) ? suppliedNow : Date.now();
  const atisMax = input.atisCurrentMinutes ?? ATIS_WIND_CURRENT_MINUTES;
  const metarMax = input.metarCurrentMinutes ?? METAR_WIND_CURRENT_MINUTES;

  if (currentCandidate(input.atis, nowMs, atisMax)) {
    const atis = parseAtisWind(input.atis?.text || "", input.atis?.observedAt || null);
    if (atis) return atis;
  }
  if (currentCandidate(input.metar, nowMs, metarMax)) {
    const metar = parseMetarWind(input.metar?.text || "", input.metar?.observedAt || null);
    if (metar) return metar;
  }
  return null;
}

export function resolveCurrentWindDisplay(wind: CurrentWindRecord | null): CurrentWindDisplay {
  // Model wind may still drive non-operational scene motion, but the current-wind
  // card is reserved for a whole ATIS or METAR observation.
  if (!wind || wind.source === "MODEL") return { primary: "—", secondary: null, showArrow: false, arrowRotationDegrees: null, neutral: true };
  if (wind.directionType === "calm") {
    return { primary: "CALM", secondary: null, showArrow: false, arrowRotationDegrees: null, neutral: true };
  }
  const speed = String(wind.speedKt).padStart(2, "0");
  const gust = wind.gustKt === null ? "" : ` G${String(wind.gustKt).padStart(2, "0")}`;
  if (wind.directionType === "variable") {
    return { primary: `VRB @ ${speed}${gust}`, secondary: "VARIABLE", showArrow: false, arrowRotationDegrees: null, neutral: true };
  }
  const direction = String(wind.directionDegrees).padStart(3, "0");
  const sector = wind.variableFromDegrees !== null && wind.variableToDegrees !== null
    ? `${String(wind.variableFromDegrees).padStart(3, "0")}V${String(wind.variableToDegrees).padStart(3, "0")}`
    : null;
  return {
    primary: `${direction} @ ${speed}${gust}`,
    secondary: sector,
    showArrow: true,
    arrowRotationDegrees: ((wind.directionDegrees || 0) + 180) % 360,
    neutral: false,
  };
}
