import test from "node:test";
import assert from "node:assert/strict";
import { parseAhasTimestampIso, calculateBirdObservationAge, formatBwcCalendarStamp } from "../app/birdWatch.ts";

test("AHAS BWC timestamp parser and age calculator - required cases", () => {
  // 0. Live regression test: 23/0142Z at 23/0150Z = 8 MIN AGO
  const now0 = new Date("2026-07-23T01:50:00Z");
  const iso0 = parseAhasTimestampIso("23/0142Z", now0);
  assert.equal(iso0, "2026-07-23T01:42:00.000Z");
  assert.equal(calculateBirdObservationAge(iso0, now0), "8 MIN AGO");
  assert.equal(formatBwcCalendarStamp(iso0, "23/0142Z"), "23 JUL 0142Z");

  // 1. 23/0018Z at 23/0035Z = 17 MIN AGO
  const now1 = new Date("2026-07-23T00:35:00Z");
  const iso1 = parseAhasTimestampIso("23/0018Z", now1);
  assert.equal(iso1, "2026-07-23T00:18:00.000Z");
  assert.equal(calculateBirdObservationAge(iso1, now1), "17 MIN AGO");

  // 2. 23/0018Z at 23/0033Z = 15 MIN AGO
  const now2 = new Date("2026-07-23T00:33:00Z");
  const iso2 = parseAhasTimestampIso("23/0018Z", now2);
  assert.equal(iso2, "2026-07-23T00:18:00.000Z");
  assert.equal(calculateBirdObservationAge(iso2, now2), "15 MIN AGO");

  // 3. 31/2350Z at 01/0005Z = 15 MIN AGO (Month boundary rollover)
  const now3 = new Date("2026-08-01T00:05:00Z");
  const iso3 = parseAhasTimestampIso("31/2350Z", now3);
  assert.equal(iso3, "2026-07-31T23:50:00.000Z");
  assert.equal(calculateBirdObservationAge(iso3, now3), "15 MIN AGO");
  assert.equal(formatBwcCalendarStamp(iso3, "31/2350Z"), "31 JUL 2350Z");

  // 4. Observation under 60 seconds old = 0 MIN AGO
  const now4 = new Date("2026-07-23T00:18:45Z");
  const iso4 = parseAhasTimestampIso("23/0018Z", now4);
  assert.equal(calculateBirdObservationAge(iso4, now4), "0 MIN AGO");

  // 5. Future observation produces diagnostic state instead of silently showing zero
  const now5 = new Date("2026-07-23T00:18:00Z");
  const iso5 = parseAhasTimestampIso("23/0025Z", now5);
  assert.equal(calculateBirdObservationAge(iso5, now5), "FUTURE OBS (+7M)");

  // 7. Live API SQL timestamp string without trailing Z: 2026-07-23 02:00:00.000 at 23/0211Z = 11 MIN AGO
  const now7 = new Date("2026-07-23T02:11:12Z");
  const iso7 = parseAhasTimestampIso("2026-07-23 02:00:00.000", now7);
  assert.equal(iso7, "2026-07-23T02:00:00.000Z");
  assert.equal(calculateBirdObservationAge(iso7, now7), "11 MIN AGO");

  // 8. Calendar format test: 23/0248Z -> "23 JUL 0248Z"
  const now8 = new Date("2026-07-23T02:56:00Z");
  const iso8 = parseAhasTimestampIso("23/0248Z", now8);
  assert.equal(formatBwcCalendarStamp(iso8, "23/0248Z"), "23 JUL 0248Z");
});
