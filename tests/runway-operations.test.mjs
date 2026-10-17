import test from "node:test";
import assert from "node:assert/strict";
import { markRunwayOperationsLastKnown, mergeRunwayOperations, normalizeRunwayEnds, normalizeRunwayOperations, resolveRunwayOperations, restoreRunwayOperations } from "../app/runwayOperations.ts";
const now = Date.parse("2026-10-16T15:00:00Z");
const feed = {
  atisReportedArrRunways: "36R / 27", atisReportedDepRunways: "36C / 36R / 27",
  atisReportedClosedRunways: "18R / 36L", atisObservedZ: "2026-10-16T14:54:00Z",
  atisReportedLetter: "R", atisLetter: "R", atisFetchStatus: "OK", atisSelectedSource: "ATIS_INFO_API+ATIS_RELAY", atisSourceIsCurrent: true,
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
test("stale, warning and upstream-retained ATIS keep reported runways with honest provenance", () => {
  for (const overrides of [
    { atisObservedZ: "2026-10-16T12:00:00Z", atisAgeMinutes: 0 },
    { atisFetchStatus: "WARN_SOURCE", atisSourceIsCurrent: false, atisLetter: "--" },
    { atisFetchStatus: "STALE_SOURCE", atisSourceIsCurrent: false, atisLetter: "--" },
    { atisFetchStatus: "USED_LAST_GOOD", atisSelectedSource: "LAST_KNOWN_GOOD" },
    { atisFetchStatus: "WARN_LAST_GOOD" }, { atisFetchStatus: "STALE_LAST_GOOD" },
    { atisSelectedSource: "CACHE" }, { atisSourceIsCurrent: false }, { lastKnownGoodUsed: { atis: true } },
  ]) {
    const result = resolve(overrides);
    assert.equal(result.atisAvailable, true);
    assert.equal(result.atisCurrent, false);
    assert.equal(result.atisLastKnown, true);
    assert.equal(result.atisLetter, "R");
    assert.deepEqual(strip(result, "18L/36R").arrivals, ["36R"]);
    assert.deepEqual(strip(result, "09/27").departures, ["27"]);
    assert.equal(strip(result, "18R/36L").state, "closed");
  }
  const old = resolve({atisObservedZ:"2026-10-01T12:00:00Z",atisAgeMinutes:0});
  assert.equal(old.atisAgeMinutes, 15 * 24 * 60 + 180);
  assert.equal(old.atisObservedAt, "2026-10-01T12:00:00.000Z");
});
test("missing, malformed, failed and future ATIS cannot establish reported operations", () => {
  for (const overrides of [
    { atisObservedZ: null }, { atisObservedZ: "2026-10-16T16:00:00Z" },
    { atisObservedZ: "2026-10-16T14:54:00" }, { atisObservedZ: "not-a-date" },
    { atisFetchStatus: "ERROR" }, { atisFetchStatus: "FAILED_NO_LAST_GOOD" },
    { atisFetchStatus: "SOURCE_TIME_UNKNOWN" }, { atisFetchStatus: null },
    { atisSelectedSource: null }, { atisSelectedSource: "NONE" },
    { atisReportedArrRunways: undefined }, { atisReportedDepRunways: 36 },
    { atisReportedArrRunways: ["36R", {}] }, { atisReportedArrRunways: "36R / 02" },
    { atisReportedClosedRunways: "unknown" },
  ]) {
    const result = resolve(overrides);
    assert.equal(result.atisAvailable, false);
    assert.equal(result.atisCurrent, false);
    assert.equal(result.atisLastKnown, false);
    assert.equal(result.atisAgeMinutes, null);
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
test("clock advances ATIS age and label without expiring the last report", () => {
  const snapshot = normalizeRunwayOperations({ ...feed, atisAgeMinutes: 0, atisSourceIsCurrent: true });
  assert.equal(resolveRunwayOperations(snapshot, now).atisCurrent, true);
  const later = resolveRunwayOperations(snapshot, now + 2 * 60 * 60000);
  assert.equal(later.atisCurrent, false);
  assert.equal(later.notamsCurrent, false);
  assert.equal(later.atisLastKnown, true);
  assert.equal(later.atisAgeMinutes, 126);
  assert.deepEqual(strip(later, "18L/36R").arrivals, ["36R"]);
  assert.equal(strip(later, "18R/36L").state, "closed");
  assert.deepEqual(strip(later, "18R/36L").closureSources, ["ATIS"]);
  const observed = Date.parse(snapshot.atisObservedAt);
  assert.equal(resolveRunwayOperations(snapshot, observed + 90 * 60000).atisCurrent, true);
  assert.equal(resolveRunwayOperations(snapshot, observed + 90 * 60000 + 1).atisLastKnown, true);
});
test("equipment or taxiway closure text does not close a runway", () => {
  const result = resolve({ atisReportedClosedRunways: null, runwayClosureNotams: [{ text: "ILS RWY 36R OTS. TWY M CLSD", effectiveStart: "202610161300", effectiveEnd: "202610161930" }] });
  assert.equal(strip(result, "18L/36R").state, "active");
});


test("refresh failures keep last valid report atomically and mark even young ATIS last-known", () => {
  const prior = normalizeRunwayOperations(feed);
  for (const [candidate, reached] of [
    [undefined, false], [normalizeRunwayOperations(null), true],
    [normalizeRunwayOperations({...feed,atisFetchStatus:"ERROR"}), true],
    [normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-16T14:40:00Z",atisReportedArrRunways:"18L"}), true],
    [normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-16T16:00:00Z",atisReportedArrRunways:"18L"}), true],
    [normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-16T14:59:00Z",atisReportedArrRunways:undefined}), true],
  ]) {
    const snapshot = mergeRunwayOperations(prior, candidate, now, reached);
    assert.deepEqual(snapshot.arrivals, prior.arrivals);
    assert.deepEqual(snapshot.departures, prior.departures);
    assert.deepEqual(snapshot.closed, prior.closed);
    assert.equal(snapshot.atisObservedAt, prior.atisObservedAt);
    assert.equal(snapshot.atisSource, prior.atisSource);
    const result = resolveRunwayOperations(snapshot, now);
    assert.equal(result.atisAgeMinutes, 6);
    assert.equal(result.atisLastKnown, true);
    assert.equal(result.atisCurrent, false);
  }
  const marked = markRunwayOperationsLastKnown(prior);
  assert.equal(resolveRunwayOperations(marked, now).atisLastKnown, true);
  assert.equal(marked.atisObservedAt, prior.atisObservedAt);
  assert.equal(markRunwayOperationsLastKnown(null), null);
});

test("latest valid ATIS replaces the entire config, including explicit empty reports", () => {
  const prior = normalizeRunwayOperations(feed);
  for (const observed of [feed.atisObservedZ, "2026-10-16T14:59:00Z"]) {
    const next = normalizeRunwayOperations({...feed,atisObservedZ:observed,atisReportedArrRunways:"18L",atisReportedDepRunways:"18C",atisReportedClosedRunways:"NONE",atisReportedLetter:"S"});
    const merged = mergeRunwayOperations(prior,next,now);
    assert.deepEqual(merged.arrivals,["18L"]);
    assert.deepEqual(merged.departures,["18C"]);
    assert.deepEqual(merged.closed,[]);
    assert.equal(resolveRunwayOperations(merged,now).atisLetter,"S");
    assert.equal(resolveRunwayOperations(merged,now).atisCurrent,true);
  }
  for (const empty of [null, "", "--", "NONE", []]) {
    const next = normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-16T14:59:00Z",atisReportedArrRunways:empty,atisReportedDepRunways:empty,atisReportedClosedRunways:empty,runwayClosureNotams:[]});
    const result = resolveRunwayOperations(mergeRunwayOperations(prior,next,now),now);
    assert.equal(result.atisAvailable,true);
    assert.ok(result.runways.every(runway=>runway.state==="unknown"));
  }
});

test("a stale valid startup report is accepted and a future-invalid prior cannot pin it", () => {
  const stale = normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-15T12:00:00Z",atisFetchStatus:"STALE_SOURCE",atisSourceIsCurrent:false});
  assert.equal(resolveRunwayOperations(mergeRunwayOperations(null,stale,now),now).atisAvailable,true);
  const future = normalizeRunwayOperations({...feed,atisObservedZ:"2026-10-17T12:00:00Z"});
  assert.equal(mergeRunwayOperations(future,stale,now).atisObservedAt,stale.atisObservedAt);
});

test("unconfirmed NOTAMs retain conflicting closure vetoes across both failure paths", () => {
  const prior = normalizeRunwayOperations({...feed,atisReportedArrRunways:"36L / 36R",atisReportedDepRunways:"18R",atisReportedClosedRunways:"NONE"});
  assert.equal(strip(resolveRunwayOperations(prior,now),"18R/36L").state,"closed");
  const invalidNotams = normalizeRunwayOperations({...feed,atisReportedArrRunways:"36L / 36R",atisReportedClosedRunways:"NONE",milNotamFetchStatus:"ERROR",runwayClosureNotams:[]});
  for (const snapshot of [markRunwayOperationsLastKnown(prior),mergeRunwayOperations(prior,undefined,now,false),mergeRunwayOperations(prior,normalizeRunwayOperations(null),now),mergeRunwayOperations(prior,invalidNotams,now)]) {
    const result = resolveRunwayOperations(snapshot,now);
    assert.equal(result.notamsCurrent,false);
    assert.equal(strip(result,"18R/36L").state,"unknown");
    assert.equal(strip(result,"18R/36L").closureUncertain,true);
    assert.deepEqual(strip(result,"18R/36L").arrivals,[]);
    assert.equal(strip(result,"18L/36R").state,"active");
  }
  const noClosure = normalizeRunwayOperations({...feed,atisReportedArrRunways:"36L / 36R",atisReportedClosedRunways:"NONE",runwayClosureNotams:[]});
  assert.equal(strip(resolveRunwayOperations(mergeRunwayOperations(prior,noClosure,now),now),"18R/36L").state,"active");
  // A fresh incoming NOTAM still closes a retained stale ATIS runway.
  const nextClosure = normalizeRunwayOperations({...feed,atisFetchStatus:"ERROR",runwayClosureNotams:[{text:"RWY 36R CLSD",effectiveStart:"202610161300",effectiveEnd:"202610161930"}]});
  assert.equal(strip(resolveRunwayOperations(mergeRunwayOperations(prior,nextClosure,now),now),"18L/36R").state,"closed");
});

test("restored runway extensions validate all fields and preserve closure conflict safeguards", () => {
  const valid = normalizeRunwayOperations({...feed,atisReportedClosedRunways:"NONE",atisReportedArrRunways:"36L / 36R"});
  const restored = restoreRunwayOperations(JSON.parse(JSON.stringify(valid)),now);
  assert.equal(resolveRunwayOperations(restored,now).atisLastKnown,true);
  assert.equal(strip(resolveRunwayOperations(restored,now),"18R/36L").closureUncertain,true);
  for (const changes of [
    {atisReportValid:false}, {atisSourceRejected:undefined}, {atisLetter:"ROMEO"},
    {arrivals:["garbage"]}, {departures:null}, {closed:["36R",42]},
    {atisObservedAt:"bad"}, {atisObservedAt:"2026-10-17T14:00:00Z"},
    {atisFetchStatus:"ERROR"}, {atisFetchStatus:{}}, {atisSource:null}, {atisSource:{}},
    {closures:[{ends:["36R"],effectiveStart:"bad",effectiveEnd:null}]},
    {closures:[{ends:["02"],effectiveStart:null,effectiveEnd:null}]}, {closures:"bad"},
  ]) assert.equal(restoreRunwayOperations({...valid,...changes},now),null);
});


test("only an explicit valid NOTAM set can clear retained conflicting closures", () => {
  const prior = normalizeRunwayOperations({...feed,atisReportedArrRunways:"36L / 36R",atisReportedClosedRunways:"NONE"});
  for (const malformed of [undefined,null,{},"unavailable",[null],[{}],[{text:42}]]) {
    const payload = {...feed,atisReportedArrRunways:"36L / 36R",atisReportedClosedRunways:"NONE",runwayClosureNotams:malformed};
    if (malformed === undefined) delete payload.runwayClosureNotams;
    const incoming = normalizeRunwayOperations(payload);
    assert.equal(resolveRunwayOperations(incoming,now).notamsCurrent,false);
    const result = resolveRunwayOperations(mergeRunwayOperations(prior,incoming,now),now);
    assert.equal(result.notamsCurrent,false);
    assert.equal(strip(result,"18R/36L").state,"unknown");
    assert.equal(strip(result,"18R/36L").closureUncertain,true);
    assert.deepEqual(strip(result,"18R/36L").arrivals,[]);
  }
  const empty = normalizeRunwayOperations({...feed,atisReportedArrRunways:"36L / 36R",atisReportedClosedRunways:"NONE",runwayClosureNotams:[]});
  const confirmed = resolveRunwayOperations(mergeRunwayOperations(prior,empty,now),now);
  assert.equal(confirmed.notamsCurrent,true);
  assert.equal(strip(confirmed,"18R/36L").state,"active");
});
