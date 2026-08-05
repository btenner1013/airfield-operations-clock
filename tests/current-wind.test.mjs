import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAtisWind,
  parseMetarWind,
  parseSpokenAtisWind,
  parseStandardWind,
  resolveCurrentWind,
  resolveCurrentWindDisplay,
} from "../app/currentWind.ts";

const now = Date.parse("2026-08-05T20:00:00.000Z");
const atisTime = "2026-08-05T19:54:00.000Z";
const metarTime = "2026-08-05T19:50:00.000Z";

const candidate = (text, observedAt, fetchStatus = "OK", ageMinutes = undefined) => ({
  text,
  observedAt,
  fetchStatus,
  ...(ageMinutes === undefined ? {} : { ageMinutes }),
});

test("standard METAR winds normalize VRB, CALM, directional, gust, and variable-sector observations", () => {
  const variable = parseMetarWind("METAR KMEM 051954Z VRB03KT 10SM CLR", metarTime);
  assert.deepEqual(variable, {
    directionType: "variable", directionDegrees: null, speedKt: 3, gustKt: null,
    variableFromDegrees: null, variableToDegrees: null, source: "METAR", observedAt: metarTime, raw: "VRB03KT",
  });

  const calm = parseMetarWind("METAR KMEM 051954Z 00000KT 10SM CLR", metarTime);
  assert.equal(calm?.directionType, "calm");
  assert.equal(calm?.directionDegrees, null);
  assert.equal(calm?.speedKt, 0);
  assert.equal(calm?.raw, "00000KT");

  const directional = parseMetarWind("METAR KMEM 051954Z 21008KT 180V240 10SM CLR", metarTime);
  assert.deepEqual(directional, {
    directionType: "directional", directionDegrees: 210, speedKt: 8, gustKt: null,
    variableFromDegrees: 180, variableToDegrees: 240, source: "METAR", observedAt: metarTime,
    raw: "21008KT 180V240",
  });

  const gust = parseStandardWind("21008G18KT", "MODEL", "2026-08-05T19:55:00Z");
  assert.equal(gust?.directionDegrees, 210);
  assert.equal(gust?.speedKt, 8);
  assert.equal(gust?.gustKt, 18);
  assert.equal(gust?.source, "MODEL");
});

test("spoken and standard ATIS winds parse without borrowing METAR fields", () => {
  const spoken = parseSpokenAtisWind("MEM ATIS INFO S. WIND 210 AT 8 GUSTING TO 18, VARIABLE BETWEEN 180 AND 240.", atisTime);
  assert.deepEqual(spoken, {
    directionType: "directional", directionDegrees: 210, speedKt: 8, gustKt: 18,
    variableFromDegrees: 180, variableToDegrees: 240, source: "ATIS", observedAt: atisTime,
    raw: "21008G18KT 180V240",
  });
  assert.equal(parseAtisWind("MEM ATIS INFO S 1954Z. WIND VRB AT 3.", atisTime)?.raw, "VRB03KT");
  assert.equal(parseAtisWind("MEM ATIS INFO S 1954Z. WIND CALM.", atisTime)?.raw, "00000KT");
  assert.equal(parseAtisWind("MEM ATIS INFO S 1954Z. 31006KT 10SM.", atisTime)?.raw, "31006KT");
});

test("ATIS is preferred as one atomic record and stale or invalid ATIS falls back to one METAR record", () => {
  const atisPreferred = resolveCurrentWind({
    now,
    atis: candidate("MEM ATIS INFO S. WIND VRB AT 3.", atisTime),
    metar: candidate("METAR KMEM 051950Z 30506G12KT 280V330 10SM CLR", metarTime),
  });
  assert.deepEqual(atisPreferred, {
    directionType: "variable", directionDegrees: null, speedKt: 3, gustKt: null,
    variableFromDegrees: null, variableToDegrees: null, source: "ATIS", observedAt: atisTime, raw: "VRB03KT",
  });
  assert.equal(JSON.stringify(atisPreferred).includes("305"), false);
  assert.equal(JSON.stringify(atisPreferred).includes("280"), false);

  const staleAtis = resolveCurrentWind({
    now,
    atis: candidate("MEM ATIS INFO R. WIND 330 AT 20 GUSTING TO 30.", "2026-08-05T18:20:00.000Z", "STALE", 100),
    metar: candidate("METAR KMEM 051950Z 21008G18KT 180V240 10SM CLR", metarTime),
  });
  assert.equal(staleAtis?.source, "METAR");
  assert.equal(staleAtis?.directionDegrees, 210);
  assert.equal(staleAtis?.speedKt, 8);
  assert.equal(staleAtis?.gustKt, 18);
  assert.equal(staleAtis?.observedAt, metarTime);
  assert.equal(staleAtis?.variableFromDegrees, 180);
  assert.equal(staleAtis?.variableToDegrees, 240);

  const malformedAtis = resolveCurrentWind({
    now,
    atis: candidate("MEM ATIS INFO S. WIND UNAVAILABLE.", atisTime, "FAILED_NO_LAST_GOOD"),
    metar: candidate("METAR KMEM 051950Z 21008KT 10SM CLR", metarTime),
  });
  assert.equal(malformedAtis?.source, "METAR");
  assert.equal(resolveCurrentWind({ now, atis: candidate("WIND VRB AT 3", atisTime, "STALE"), metar: null }), null);
});

test("freshness boundaries are inclusive and source ages cannot manufacture mixed observations", () => {
  const atisBoundary = resolveCurrentWind({
    now,
    atis: candidate("WIND 300 AT 5", "2026-08-05T18:30:00.000Z", "OK", 90),
    metar: candidate("METAR KMEM 051950Z 21008KT 10SM CLR", metarTime),
  });
  assert.equal(atisBoundary?.source, "ATIS");
  const metarBoundary = resolveCurrentWind({
    now,
    atis: candidate("WIND 300 AT 5", atisTime, "OK", 91),
    metar: candidate("METAR KMEM 051845Z VRB03KT 10SM CLR", "2026-08-05T18:45:00.000Z", "OK", 75),
  });
  assert.equal(metarBoundary?.source, "METAR");
  assert.equal(metarBoundary?.directionType, "variable");
  assert.equal(metarBoundary?.directionDegrees, null);
});

test("display resolver hides arrows and numeric direction for VRB/CALM and preserves the blowing-toward convention", () => {
  const vrb = resolveCurrentWindDisplay(parseMetarWind("VRB03KT", metarTime));
  assert.deepEqual(vrb, { primary: "VRB @ 03", secondary: "VARIABLE", showArrow: false, arrowRotationDegrees: null, neutral: true });

  const calm = resolveCurrentWindDisplay(parseMetarWind("00000KT", metarTime));
  assert.deepEqual(calm, { primary: "CALM", secondary: null, showArrow: false, arrowRotationDegrees: null, neutral: true });

  const directional = resolveCurrentWindDisplay(parseMetarWind("21008KT", metarTime));
  assert.deepEqual(directional, { primary: "210 @ 08", secondary: null, showArrow: true, arrowRotationDegrees: 30, neutral: false });

  const gustSector = resolveCurrentWindDisplay(parseMetarWind("21008G18KT 180V240", metarTime));
  assert.deepEqual(gustSector, { primary: "210 @ 08 G18", secondary: "180V240", showArrow: true, arrowRotationDegrees: 30, neutral: false });
  assert.deepEqual(resolveCurrentWindDisplay(null), { primary: "—", secondary: null, showArrow: false, arrowRotationDegrees: null, neutral: true });

  const modelOnly = parseStandardWind("30506KT", "MODEL", metarTime);
  assert.deepEqual(resolveCurrentWindDisplay(modelOnly), { primary: "—", secondary: null, showArrow: false, arrowRotationDegrees: null, neutral: true });
});

test("directional-variable-calm transitions replace direction, source, time, speed, and gust together", () => {
  let current = resolveCurrentWind({ now, atis: candidate("WIND 305 AT 6", atisTime), metar: null });
  assert.equal(resolveCurrentWindDisplay(current).showArrow, true);

  current = resolveCurrentWind({ now, atis: candidate("WIND VRB AT 3", "2026-08-05T19:56:00.000Z"), metar: null });
  assert.equal(current?.directionType, "variable");
  assert.equal(current?.directionDegrees, null);
  assert.equal(current?.speedKt, 3);
  assert.equal(current?.gustKt, null);
  assert.equal(current?.observedAt, "2026-08-05T19:56:00.000Z");
  assert.equal(resolveCurrentWindDisplay(current).showArrow, false);

  current = resolveCurrentWind({ now, atis: candidate("WIND 210 AT 8 GUST 18", "2026-08-05T19:57:00.000Z"), metar: null });
  assert.equal(current?.directionType, "directional");
  assert.equal(current?.directionDegrees, 210);
  assert.equal(current?.speedKt, 8);
  assert.equal(current?.gustKt, 18);
  assert.equal(current?.observedAt, "2026-08-05T19:57:00.000Z");
  assert.equal(resolveCurrentWindDisplay(current).showArrow, true);

  current = resolveCurrentWind({ now, atis: candidate("WIND CALM", "2026-08-05T19:58:00.000Z"), metar: null });
  assert.equal(current?.directionType, "calm");
  assert.equal(current?.directionDegrees, null);
  assert.equal(current?.speedKt, 0);
  assert.equal(resolveCurrentWindDisplay(current).showArrow, false);
});
