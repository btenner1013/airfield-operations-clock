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
  atisLetter: string | null;
  atisReportValid: boolean;
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
  atisAvailable: boolean;
  atisLastKnown: boolean;
  atisAgeMinutes: number | null;
  atisObservedAt: string | null;
  atisLetter: string | null;
  atisSource: string | null;
  notamsCurrent: boolean;
}>;

const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const END_SET = new Set<string>(MEM_RUNWAYS.flatMap(runway => [...runway.ends]));
// These statuses describe a real report, including upstream retained reports.
// Failed/no-data/unknown-time responses must never replace a validated report.
const ATIS_REPORT_STATUSES = new Set(["OK", "WARN_SOURCE", "STALE_SOURCE", "USED_LAST_GOOD", "WARN_LAST_GOOD", "STALE_LAST_GOOD"]);
const ATIS_FIELDS = ["atisReportedArrRunways", "atisReportedDepRunways", "atisReportedClosedRunways"] as const;
const atisSourceValid = (value: string | null): boolean => !!value && !/^(?:NONE|UNKNOWN|UNAVAILABLE|--|N\/A)$/i.test(value);
const atisLetter = (value: unknown): string | null => typeof value === "string" && /^[A-Z]$/i.test(value.trim()) ? value.trim().toUpperCase() : null;

/** Explicit empty fields are meaningful; missing or malformed fields are not. */
function reportedRunwayEnds(value: unknown): RunwayEnd[] | null {
  if (value === null) return [];
  if (Array.isArray(value)) {
    if (!value.every(item => typeof item === "string")) return null;
    const groups = value.map(item => reportedRunwayEnds(item));
    return groups.every(group => group !== null) ? [...new Set(groups.flat())] as RunwayEnd[] : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  // The publisher emits -- for an unreported ARR/DEP and NONE for no closure.
  if (!text || text === "--" || text === "NONE") return [];
  if (!/^(?:18[CLR]|36[CLR]|0?9|27)(?:[\s/,]+(?:18[CLR]|36[CLR]|0?9|27))*$/.test(text)) return null;
  return normalizeRunwayEnds(text);
}

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
  const fields = ATIS_FIELDS.map(key => Object.hasOwn(data, key) ? reportedRunwayEnds(data[key]) : null);
  const observedAt = timestamp(data.atisObservedZ), status = string(data.atisFetchStatus), source = string(data.atisSelectedSource);
  // Only a structurally reported set can confirm that no NOTAM closures remain.
  const notamPayloadValid = Array.isArray(data.runwayClosureNotams) && data.runwayClosureNotams.every(value => {
    const record = object(value);
    return !!(string(record.text) || string(record.rawText));
  });
  return {
    arrivals: fields[0] || [],
    departures: fields[1] || [],
    closed: fields[2] || [],
    atisObservedAt: observedAt,
    atisLetter: atisLetter(data.atisReportedLetter) || atisLetter(data.atisLetter),
    atisReportValid: fields.every(field => field !== null) && !!observedAt && ATIS_REPORT_STATUSES.has(status?.toUpperCase() || "") && atisSourceValid(source),
    atisFetchStatus: status,
    atisSource: source,
    // Freshness flags affect the label, not whether reported operations survive.
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
    notamFetchStatus: notamPayloadValid ? string(data.milNotamFetchStatus) : null,
    notamSource: string(data.milNotamSource),
  };
}

function current(time: string | null, status: string | null, source: string | null, now: number, maxMinutes: number): boolean {
  if (status?.toUpperCase() !== "OK" || !source || /CACHE|STALE|LAST.?KNOWN|FALLBACK/i.test(source)) return false;
  const age = time ? (now - Date.parse(time)) / 60000 : NaN;
  return Number.isFinite(age) && age >= -5 && age <= maxMinutes;
}

function validEndArray(value: unknown): value is RunwayEnd[] {
  return Array.isArray(value) && value.every(end => typeof end === "string" && END_SET.has(end));
}

function usableAtis(snapshot: RunwayOperationsSnapshot | null | undefined, now: number): snapshot is RunwayOperationsSnapshot {
  if (!snapshot || snapshot.atisReportValid !== true || !validEndArray(snapshot.arrivals) || !validEndArray(snapshot.departures) || !validEndArray(snapshot.closed)) return false;
  const observed = timestamp(snapshot.atisObservedAt);
  return !!observed && Number.isFinite(now) && Date.parse(observed) <= now + 5 * 60000 &&
    ATIS_REPORT_STATUSES.has(snapshot.atisFetchStatus?.toUpperCase() || "") && atisSourceValid(snapshot.atisSource);
}

/** Keep the report identity and timestamp unchanged when a refresh cannot confirm it. */
export function markRunwayOperationsLastKnown(snapshot: RunwayOperationsSnapshot | null | undefined): RunwayOperationsSnapshot | null {
  return snapshot ? { ...snapshot, atisSourceRejected: true, notamFetchStatus: "UNCONFIRMED" } : null;
}

/** Replace ATIS atomically and monotonically, independently of incoming NOTAMs. */
export function mergeRunwayOperations(previous: RunwayOperationsSnapshot | null | undefined, incoming: RunwayOperationsSnapshot | null | undefined, now: number, feedReached = true): RunwayOperationsSnapshot | null {
  if (!previous && !incoming) return null;
  const priorValid = usableAtis(previous, now), nextValid = feedReached && usableAtis(incoming, now);
  let base = incoming || normalizeRunwayOperations(null);
  if (!feedReached || !current(base.notamAcquiredAt, base.notamFetchStatus, base.notamSource, now, NOTAM_OPERATIONS_CURRENT_MINUTES)) {
    // A failed/unconfirmed NOTAM response cannot silently reopen a conflicting
    // runway. Keep possible closures until a current source replaces the set.
    const closures = [...new Map([...(previous?.closures || []), ...base.closures].map(closure => [JSON.stringify(closure), closure])).values()];
    base = { ...base, closures, notamAcquiredAt: base.notamAcquiredAt || previous?.notamAcquiredAt || null,
      notamSource: base.notamSource || previous?.notamSource || null, notamFetchStatus: "UNCONFIRMED" };
  }
  if (nextValid && (!priorValid || Date.parse(incoming.atisObservedAt!) >= Date.parse(previous.atisObservedAt!))) return base;
  if (!priorValid) return feedReached ? base : { ...base, atisReportValid: false };
  // Never reuse the previous ATIS's NOTAM acquisition time for a new response.
  return {
    ...base,
    arrivals: previous.arrivals, departures: previous.departures, closed: previous.closed,
    atisObservedAt: previous.atisObservedAt, atisLetter: previous.atisLetter,
    atisReportValid: true, atisFetchStatus: previous.atisFetchStatus,
    atisSource: previous.atisSource, atisSourceRejected: true,
  };
}

/** Local storage is untrusted: validate this extension independently of weather. */
export function restoreRunwayOperations(value: unknown, now: number): RunwayOperationsSnapshot | null {
  const data = object(value);
  if (data.atisReportValid !== true || typeof data.atisSourceRejected !== "boolean" ||
      !(data.atisLetter === null || atisLetter(data.atisLetter) === data.atisLetter) ||
      !Array.isArray(data.closures) || !data.closures.every(value => {
        const closure = object(value);
        return validEndArray(closure.ends) && closure.ends.length > 0 &&
          (closure.effectiveStart === null || !!timestamp(closure.effectiveStart)) &&
          (closure.effectiveEnd === null || !!timestamp(closure.effectiveEnd));
      }) || !(data.notamAcquiredAt === null || !!timestamp(data.notamAcquiredAt)) ||
      !(data.notamFetchStatus === null || typeof data.notamFetchStatus === "string") ||
      !(data.notamSource === null || typeof data.notamSource === "string") ||
      !(data.atisFetchStatus === null || typeof data.atisFetchStatus === "string") ||
      !(data.atisSource === null || typeof data.atisSource === "string")) return null;
  const candidate = data as RunwayOperationsSnapshot;
  if (!usableAtis(candidate, now)) return null;
  // Cached NOTAMs can still veto conflicting arrows, but cannot assert a fresh closure.
  return { ...candidate, atisSourceRejected: true, notamFetchStatus: "RESTORED_CACHE" };
}

/** Re-evaluate age on each clock tick without expiring the last valid ATIS report. */
export function resolveRunwayOperations(snapshot: RunwayOperationsSnapshot | null | undefined, now: number | Date = Date.now()): ResolvedRunwayOperations {
  const data = snapshot || normalizeRunwayOperations(null);
  const nowMs = now instanceof Date ? now.getTime() : now;
  const atisAvailable = usableAtis(data, nowMs);
  const atisCurrent = atisAvailable && !data.atisSourceRejected && current(data.atisObservedAt, data.atisFetchStatus, data.atisSource, nowMs, ATIS_OPERATIONS_CURRENT_MINUTES);
  const notamsCurrent = current(data.notamAcquiredAt, data.notamFetchStatus, data.notamSource, nowMs, NOTAM_OPERATIONS_CURRENT_MINUTES);
  const runways = MEM_RUNWAYS.map(({ id, ends }): ResolvedRunway => {
    const belongs = (end: RunwayEnd) => (ends as readonly RunwayEnd[]).includes(end);
    const atisClosed = atisAvailable && data.closed.some(belongs);
    const relevant = data.closures.filter(closure => closure.ends.some(belongs));
    const effective = relevant.filter(closure => closure.effectiveStart && closure.effectiveEnd && Date.parse(closure.effectiveStart) <= nowMs && nowMs < Date.parse(closure.effectiveEnd));
    const notamClosed = notamsCurrent && effective.length > 0;
    const closed = atisClosed || notamClosed;
    // NOTAM freshness is unchanged. A stale effective or unbounded NOTAM
    // cannot assert closure, but still suppresses conflicting runway use.
    const closureUncertain = !closed && (effective.length > 0 || relevant.some(closure => !closure.effectiveStart || !closure.effectiveEnd));
    const arrivals = atisAvailable && !closed && !closureUncertain ? data.arrivals.filter(belongs) : [];
    const departures = atisAvailable && !closed && !closureUncertain ? data.departures.filter(belongs) : [];
    return {
      id, ends,
      state: closed ? "closed" : arrivals.length || departures.length ? "active" : "unknown",
      arrivals, departures,
      closureSources: [...(atisClosed ? ["ATIS" as const] : []), ...(notamClosed ? ["NOTAM" as const] : [])],
      closureUncertain,
    };
  });
  return {
    runways, atisCurrent, atisAvailable, atisLastKnown: atisAvailable && !atisCurrent,
    atisAgeMinutes: atisAvailable ? Math.max(0, Math.floor((nowMs - Date.parse(data.atisObservedAt!)) / 60000)) : null,
    atisObservedAt: atisAvailable ? data.atisObservedAt : null,
    atisLetter: atisAvailable ? data.atisLetter : null,
    atisSource: atisAvailable ? data.atisSource : null,
    notamsCurrent,
  };
}
