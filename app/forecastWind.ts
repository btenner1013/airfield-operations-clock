/** Surface wind from the prevailing TAF group, kept separate from current observations. */
export type ForecastWindRecord = Readonly<{
  directionType: "directional" | "variable" | "calm";
  directionDegrees: number | null;
  speedKt: number;
  gustKt: number | null;
  source: "TAF";
  sourceKind: "TAF_BASE" | "TAF_FM" | "TAF_BECMG";
  issueIso: string;
  validFromIso: string;
  validToIso: string;
  raw: string;
}>;

export type ParsedForecastWind = Pick<ForecastWindRecord, "directionType" | "directionDegrees" | "speedKt" | "gustKt" | "raw">;
export type TafWindTimelinePeriod = Readonly<{ fromIso: string; toIso: string; wind: ForecastWindRecord | null }>;
type TafTiming = Readonly<{ issueIso: string; validStartIso: string; validEndIso: string }>;
type WindChange = { from: number; to: number; wind: ParsedForecastWind | null };

/** Only standalone surface-wind tokens qualify; WS020/18040KT is wind aloft. */
export function parseForecastWindToken(text: string): ParsedForecastWind | null {
  const core = (text || "").toUpperCase().split(/\sRMK\s/)[0];
  const candidates = core.split(/\s+/).map(token => token.replace(/[=.,;]+$/, "")).filter(token => /^(?!WS)\S+(?:KT|MPS|KMH)$/.test(token));
  if (candidates.length !== 1) return null;
  const match = candidates[0].match(/^((\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH))$/);
  if (!match) return null;
  const direction = match[2], speed = Number(match[3]), gust = match[4] ? Number(match[4]) : null;
  const conversion = match[5] === "MPS" ? 3600 / 1852 : match[5] === "KMH" ? 1000 / 1852 : 1;
  const knots = (value: number) => value * conversion;
  if (gust !== null && (gust <= speed || gust === 0)) return null;
  if (direction === "000") {
    if (speed !== 0 || gust !== null) return null;
    return { directionType: "calm", directionDegrees: null, speedKt: 0, gustKt: null, raw: match[1] };
  }
  if (direction !== "VRB" && (Number(direction) < 1 || Number(direction) > 360)) return null;
  return {
    directionType: direction === "VRB" ? "variable" : "directional",
    directionDegrees: direction === "VRB" ? null : Number(direction),
    speedKt: knots(speed),
    gustKt: gust === null ? null : knots(gust),
    raw: match[1],
  };
}

/** Reject malformed cached/foreign objects before the UI reads numeric fields. */
export function isForecastWindRecord(value: unknown): value is ForecastWindRecord {
  if (!value || typeof value !== "object") return false;
  const wind = value as Partial<ForecastWindRecord>;
  if (wind.source !== "TAF" || !["TAF_BASE", "TAF_FM", "TAF_BECMG"].includes(String(wind.sourceKind))) return false;
  if (typeof wind.raw !== "string" || wind.raw.length > 32) return false;
  const parsed = parseForecastWindToken(wind.raw);
  if (!parsed || parsed.raw !== wind.raw || parsed.directionType !== wind.directionType || parsed.directionDegrees !== wind.directionDegrees || parsed.speedKt !== wind.speedKt || parsed.gustKt !== wind.gustKt) return false;
  const dates = [wind.issueIso, wind.validFromIso, wind.validToIso];
  if (!dates.every(date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) && Number.isFinite(Date.parse(date)))) return false;
  const issue = Date.parse(wind.issueIso!), from = Date.parse(wind.validFromIso!), to = Date.parse(wind.validToIso!);
  return from < to && issue < to && to - from <= 72 * 3600000 && Math.abs(issue - from) <= 72 * 3600000;
}

function timeWithin(day: number, hour: number, minute: number, from: number, to: number, includeEnd = false): number | null {
  if (day < 1 || day > 31 || hour < 0 || hour > 24 || minute < 0 || minute > 59 || hour === 24 && minute !== 0) return null;
  const reference = new Date(from);
  for (const offset of [-1, 0, 1]) {
    const month = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, 1));
    const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
    if (date.getUTCMonth() !== month.getUTCMonth()) continue;
    const time = date.getTime() + hour * 3600000 + minute * 60000;
    if (time >= from && (includeEnd ? time <= to : time < to)) return time;
  }
  return null;
}

/**
 * Build a wind-only timeline without changing the weather/sky overlay resolver.
 * FM is a complete replacement (including a missing wind or ceased gusts).
 * TEMPO and PROB winds are conditional and never become prevailing winds.
 * A wind-changing BECMG has no exact onset: report unknown through [start,end),
 * adopt its wind at end, and retain prior wind for BECMG groups omitting wind.
 * An intervening FM supersedes a preceding BECMG, including its pending end.
 */
export function parseTafWindTimeline(raw: string, timing: TafTiming): TafWindTimelinePeriod[] {
  const start = Date.parse(timing.validStartIso), end = Date.parse(timing.validEndIso), issued = Date.parse(timing.issueIso);
  if (![start, end, issued].every(Number.isFinite) || end <= start || end - start > 72 * 3600000) return [];
  const text = (raw || "").toUpperCase().replace(/\s+/g, " ").split(/\sRMK\s/)[0].trim();
  const validity = text.match(/\b\d{4}\/\d{4}\b/);
  if (!validity || /\b(?:NIL|CNL)\b/.test(text)) return [];
  // A concatenated bulletin is ambiguous; never borrow another report's wind.
  if ([...text.matchAll(/\b[A-Z][A-Z0-9]{3}\s+\d{6}Z\b/g)].length !== 1) return [];
  const contentStart = (validity.index || 0) + validity[0].length;
  const markers = [...text.matchAll(/\b(FM\d{6}|BECMG\s+\d{4}\/\d{4}|TEMPO\s+\d{4}\/\d{4}|PROB(?:30|40)(?:\s+TEMPO)?\s+\d{4}\/\d{4})\b/g)]
    .filter(marker => (marker.index ?? 0) >= contentStart);
  const body = (index: number) => text.slice((markers[index].index ?? 0) + markers[index][0].length, markers[index + 1]?.index ?? text.length).trim();
  const base = parseForecastWindToken(text.slice(contentStart, markers[0]?.index ?? text.length));
  const fm: WindChange[] = [], becoming: WindChange[] = [];
  for (const [index, marker] of markers.entries()) {
    if (marker[0].startsWith("FM")) {
      const from = timeWithin(Number(marker[0].slice(2, 4)), Number(marker[0].slice(4, 6)), Number(marker[0].slice(6, 8)), start, end);
      if (from === null) return []; // An unplaceable replacement cannot justify carrying the old wind.
      fm.push({ from, to: end, wind: parseForecastWindToken(body(index)) });
    } else if (marker[0].startsWith("BECMG")) {
      const group = body(index);
      // Omission means unchanged; an explicitly invalid/missing coded wind means unknown.
      if (!/(?:^|\s)(?!WS)\S+(?:KT|MPS|KMH)(?=\s|[=.,;]|$)/.test(group)) continue;
      const range = marker[0].match(/(\d{2})(\d{2})\/(\d{2})(\d{2})/)!;
      const from = timeWithin(Number(range[1]), Number(range[2]), 0, start, end);
      const to = from === null ? null : timeWithin(Number(range[3]), Number(range[4]), 0, from + 1, end, true);
      if (from === null || to === null) return [];
      becoming.push({ from, to, wind: parseForecastWindToken(group) });
    }
  }
  fm.sort((a, b) => a.from - b.from);
  becoming.sort((a, b) => a.to - b.to);
  const boundaries = [...new Set([start, end, ...fm.map(change => change.from), ...becoming.flatMap(change => [change.from, change.to])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1];
    const latestFm = fm.filter(change => change.from <= from).at(-1);
    const activeBecoming = becoming.filter(change => !latestFm || change.from >= latestFm.from);
    const lastBecoming = activeBecoming.filter(change => change.to <= from).at(-1);
    const transitioning = activeBecoming.some(change => change.from <= from && from < change.to);
    const selected = transitioning ? null : lastBecoming ? lastBecoming.wind : latestFm ? latestFm.wind : base;
    const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
    const wind: ForecastWindRecord | null = selected ? {
      ...selected,
      source: "TAF",
      sourceKind: lastBecoming ? "TAF_BECMG" : latestFm ? "TAF_FM" : "TAF_BASE",
      issueIso: new Date(issued).toISOString(),
      validFromIso: fromIso,
      validToIso: toIso,
    } : null;
    return { fromIso, toIso, wind };
  });
}

/** No observed/model fallback: absence and the exclusive TAF end remain unknown. */
export function resolveForecastWind(periods: readonly TafWindTimelinePeriod[] | null | undefined, validTime: string | number | Date): ForecastWindRecord | null {
  const time = typeof validTime === "number" ? validTime : validTime instanceof Date ? validTime.getTime() : Date.parse(validTime);
  if (!Number.isFinite(time)) return null;
  return periods?.find(period => Date.parse(period.fromIso) <= time && time < Date.parse(period.toIso))?.wind ?? null;
}
