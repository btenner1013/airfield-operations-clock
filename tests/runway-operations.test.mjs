import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRunwayEnds, normalizeRunwayOperations, resolveRunwayOperations } from "../app/runwayOperations.ts";
const now = Date.parse("2026-10-16T15:00:00Z");
const feed = {
  atisReportedArrRunways: "36R / 27", atisReportedDepRunways: "36C / 36R / 27",
  atisReportedClosedRunways: "18R / 36L", atisObservedZ: "2026-10-16T14:54:00Z",
  atisFetchStatus: "OK", atisSelectedSource: "ATIS_INFO_API+ATIS_RELAY", atisSourceIsCurrent: true,
  milNotamUpdatedZ: "2026-10-16 14:55:55Z", milNotamFetchStatus: "OK", milNotamSource: "FAA_NMS_STAGING",
  runwayClosureNotams: [{ text: "RWY 18R/36L CLSD", effectiveStart: "202610161300", effectiveEnd: "202610161930", lastUpdated: "2026-01-01T00:00:00Z" }],
};
const resolve = (overrides = {}, time = now) => resolveRunwayOperations(normalizeRunwayOperations({ ...feed, ...overrides }), time);
const strip = (result, id) => result.runways.find(runway => runway.id === id);

test("normalizes canonical 09 and physical pairs without wind inference", () => {
  assert.deepEqual(normalizeRunwayEnds("9 / 09 / 27 / 18R / 02"), ["09", "27", "18R"]);
  const result = resolve();
  assert.equal(result.atisCurrent, true);
  assert.equal(result.notamsCurrent, true);
  assert.equal(strip(result, "18R/36L").state, "closed");
  assert.deepEqual(strip(result, "18L/36R").arrivals, ["36R"]);
  assert.deepEqual(strip(result, "09/27").departures, ["27"]);
  assert.ok(resolveRunwayOperations(null, now).runways.every(runway => runway.state === "unknown"));
  assert.ok(resolve({ atisReportedArrRunways: null, atisReportedDepRunways: null, arrRunways: "36R", depRunways: "36C", windDirDeg: 360 }).runways.every(runway => runway.state !== "active"));
});
test("stale, missing, failed, future or cached ATIS never lights active strips", () => {
  for (const overrides of [
    { atisObservedZ: "2026-10-16T12:00:00Z", atisAgeMinutes: 0 },
    { atisObservedZ: null }, { atisObservedZ: "2026-10-16T16:00:00Z" },
    { atisFetchStatus: "ERROR" }, { atisFetchStatus: null }, { atisSelectedSource: null },
    { atisSelectedSource: "CACHE" }, { atisSourceIsCurrent: false }, { lastKnownGoodUsed: { atis: true } },
  ]) {
    const result = resolve(overrides);
    assert.equal(result.atisCurrent, false);
    assert.ok(result.runways.every(runway => runway.arrivals.length === 0 && runway.departures.length === 0));
  }
});
test("fresh closure on either reciprocal suppresses all conflicting arrows", () => {
  const result = resolve({ atisReportedArrRunways: "36L", atisReportedDepRunways: "18R", atisReportedClosedRunways: "18R", runwayClosureNotams: [] });
  assert.equal(strip(result, "18R/36L").state, "closed");
  assert.deepEqual(strip(result, "18R/36L").arrivals, []);
  assert.deepEqual(strip(result, "18R/36L").departures, []);
});
test("NOTAM uses acquisition freshness and effective window, not publication time", () => {
  const overrides = { atisReportedClosedRunways: null, atisReportedArrRunways: "36L" };
  assert.equal(strip(resolve(overrides), "18R/36L").state, "closed");
  const original = feed.runwayClosureNotams[0];
  for (const dates of [ { effectiveStart: "202610161600" }, { effectiveEnd: "202610161500" } ]) {
    assert.equal(strip(resolve({ ...overrides, runwayClosureNotams: [{ ...original, ...dates }] }), "18R/36L").state, "active");
  }
});
test("stale or failed NOTAM cannot paint red, but conflicting closure prevents green", () => {
  for (const overrides of [ { milNotamUpdatedZ: "2026-10-16T10:00:00Z" }, { milNotamUpdatedZ: null }, { milNotamUpdatedZ: "2026-10-16T16:00:00Z" }, { milNotamFetchStatus: "ERROR" } ]) {
    const result = resolve({ ...overrides, atisReportedClosedRunways: null, atisReportedArrRunways: "36L" });
    const runway = strip(result, "18R/36L");
    assert.equal(result.notamsCurrent, false);
    assert.equal(runway.state, "unknown");
    assert.equal(runway.closureUncertain, true);
    assert.deepEqual(runway.arrivals, []);
    assert.equal(strip(result, "18L/36R").state, "active");
  }
});
test("cached snapshot ages out when clock advances; booleans and age fields cannot refresh it", () => {
  const snapshot = normalizeRunwayOperations({ ...feed, atisAgeMinutes: 0, atisSourceIsCurrent: true });
  assert.equal(resolveRunwayOperations(snapshot, now).atisCurrent, true);
  const later = resolveRunwayOperations(snapshot, now + 2 * 60 * 60000);
  assert.equal(later.atisCurrent, false);
  assert.equal(later.notamsCurrent, false);
  assert.ok(later.runways.every(runway => runway.state === "unknown"));
});
test("equipment or taxiway closure text does not close a runway", () => {
  const result = resolve({ atisReportedClosedRunways: null, runwayClosureNotams: [{ text: "ILS RWY 36R OTS. TWY M CLSD", effectiveStart: "202610161300", effectiveEnd: "202610161930" }] });
  assert.equal(strip(result, "18L/36R").state, "active");
});
