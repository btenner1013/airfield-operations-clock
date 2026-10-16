/** Reported operations only: wind never selects a runway. */
export type RunwayEnd = "18R" | "36L" | "18C" | "36C" | "18L" | "36R" | "09" | "27";
export const MEM_RUNWAYS = [
  { id: "18R/36L", ends: ["18R", "36L"] },
  { id: "18C/36C", ends: ["18C", "36C"] },
  { id: "18L/36R", ends: ["18L", "36R"] },
  { id: "09/27", ends: ["09", "27"] },
] as const;
export const ATIS_OPERATIONS_CURRENT_MINUTES = 90;
export const NOTAM_OPERATIONS_CURRENT_MINUTES = 90;
export type RunwayClosure = Readonly<{
  ends: readonly RunwayEnd[];
  effectiveStart: string | null;
  effectiveEnd: string | null;
}>;
export type RunwayOperationsSnapshot = Readonly<{
  arrivals: readonly RunwayEnd[];
  departures: readonly RunwayEnd[];
  closed: readonly RunwayEnd[];
  atisObservedAt: string | null;
  atisFetchStatus: string | null;
  atisSource: string | null;
  atisSourceRejected: boolean;
  closures: readonly RunwayClosure[];
  notamAcquiredAt: string | null;
  notamFetchStatus: string | null;
  notamSource: string | null;
}>;
export type ResolvedRunway = Readonly<{
  id: string;
  ends: readonly RunwayEnd[];
  state: "closed" | "active" | "unknown";
  arrivals: readonly RunwayEnd[];
  departures: readonly RunwayEnd[];
  closureSources: readonly ("ATIS" | "NOTAM")[];
  closureUncertain: boolean;
}>;
export type ResolvedRunwayOperations = Readonly<{
  runways: readonly ResolvedRunway[];
  atisCurrent: boolean;
  notamsCurrent: boolean;
}>;

const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const END_SET = new Set<string>(MEM_RUNWAYS.flatMap(runway => [...runway.ends]));

export function normalizeRunwayEnds(value: unknown): RunwayEnd[] {
  const text = Array.isArray(value) ? value.filter(item => typeof item === "string").join(" / ") : string(value) || "";
  const tokens = text.toUpperCase().match(/\b(?:18[CLR]|36[CLR]|0?9|27)\b/g) || [];
  return [...new Set(tokens.map(token => token === "9" ? "09" : token).filter(token => END_SET.has(token)))] as RunwayEnd[];
}

/** Convert feed UTC timestamps without using the browser's local timezone. */
function timestamp(value: unknown): string | null {
  let text = string(value);
  if (!text) return null;
  if (/^\d{12}$/.test(text)) text = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:00Z`;
  else text = text.replace(" ", "T");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeRunwayOperations(payload: unknown): RunwayOperationsSnapshot {
  const data = object(payload);
  const lastGood = object(data.lastKnownGoodUsed);
  return {
    arrivals: normalizeRunwayEnds(data.atisReportedArrRunways),
    departures: normalizeRunwayEnds(data.atisReportedDepRunways),
    closed: normalizeRunwayEnds(data.atisReportedClosedRunways),
    atisObservedAt: timestamp(data.atisObservedZ),
    atisFetchStatus: string(data.atisFetchStatus),
    atisSource: string(data.atisSelectedSource),
    // A current flag can veto a source, but cannot make old timestamps current.
    atisSourceRejected: data.atisSourceIsCurrent === false || lastGood.atis === true,
    closures: (Array.isArray(data.runwayClosureNotams) ? data.runwayClosureNotams : []).flatMap(value => {
      const record = object(value);
      const text = string(record.text) || string(record.rawText) || "";
      // Scope to the runway clause, never taxiway or equipment closure references.
      const clause = text.toUpperCase().match(/\bRWY\s+((?:(?:18[CLR]|36[CLR]|0?9|27)\b[\s/,]*)+)CLSD\b/);
      const ends = clause ? normalizeRunwayEnds(clause[1]) : [];
      return ends.length ? [{ ends, effectiveStart: timestamp(record.effectiveStart), effectiveEnd: timestamp(record.effectiveEnd) }] : [];
    }),
    notamAcquiredAt: timestamp(data.milNotamUpdatedZ),
    notamFetchStatus: string(data.milNotamFetchStatus),
    notamSource: string(data.milNotamSource),
  };
}

function current(time: string | null, status: string | null, source: string | null, now: number, maxMinutes: number): boolean {
  if (status?.toUpperCase() !== "OK" || !source || /CACHE|STALE|LAST.?KNOWN|FALLBACK/i.test(source)) return false;
  const age = time ? (now - Date.parse(time)) / 60000 : NaN;
  return Number.isFinite(age) && age >= -5 && age <= maxMinutes;
}

/** Re-evaluate on each clock tick, including when the last successful payload is cached. */
export function resolveRunwayOperations(snapshot: RunwayOperationsSnapshot | null | undefined, now: number | Date = Date.now()): ResolvedRunwayOperations {
  const data = snapshot || normalizeRunwayOperations(null);
  const nowMs = now instanceof Date ? now.getTime() : now;
  const atisCurrent = !data.atisSourceRejected && current(data.atisObservedAt, data.atisFetchStatus, data.atisSource, nowMs, ATIS_OPERATIONS_CURRENT_MINUTES);
  const notamsCurrent = current(data.notamAcquiredAt, data.notamFetchStatus, data.notamSource, nowMs, NOTAM_OPERATIONS_CURRENT_MINUTES);
  const runways = MEM_RUNWAYS.map(({ id, ends }): ResolvedRunway => {
    const belongs = (end: RunwayEnd) => (ends as readonly RunwayEnd[]).includes(end);
    const atisClosed = atisCurrent && data.closed.some(belongs);
    const relevant = data.closures.filter(closure => closure.ends.some(belongs));
    const effective = relevant.filter(closure => closure.effectiveStart && closure.effectiveEnd && Date.parse(closure.effectiveStart) <= nowMs && nowMs < Date.parse(closure.effectiveEnd));
    const notamClosed = notamsCurrent && effective.length > 0;
    const closed = atisClosed || notamClosed;
    // Stale reports cannot assert closure. A still-effective conflicting closure
    // or an unbounded closure cannot safely assert an active runway either.
    const closureUncertain = !closed && (effective.length > 0 || relevant.some(closure => !closure.effectiveStart || !closure.effectiveEnd));
    const arrivals = atisCurrent && !closed && !closureUncertain ? data.arrivals.filter(belongs) : [];
    const departures = atisCurrent && !closed && !closureUncertain ? data.departures.filter(belongs) : [];
    return {
      id, ends,
      state: closed ? "closed" : arrivals.length || departures.length ? "active" : "unknown",
      arrivals, departures,
      closureSources: [...(atisClosed ? ["ATIS" as const] : []), ...(notamClosed ? ["NOTAM" as const] : [])],
      closureUncertain,
    };
  });
  return { runways, atisCurrent, notamsCurrent };
}
