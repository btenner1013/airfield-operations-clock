import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/information-bar.css", import.meta.url), "utf8");
const solarCss = readFileSync(new URL("../app/solar-lunar.css", import.meta.url), "utf8");

test("current-weather overhaul retains source values, modifier, feed status and conditional lightning", () => {
  for (const text of ["weather.temperatureF", "weather.feelsLikeF??weather.temperatureF", "weather.humidity", "weather.description", "currentPresentation.secondaryLabel", "effBase.toLocaleString()", "UNLIMITED (UNL)", "METAR FEED", "METAR ${metarState}", 'lightningDisplay.severity!=="none"', "lightningDisplay.text", "lightningDisplay.isStale", "lightningDisplay.sourceTime"]) assert.ok(page.includes(text), text);
  assert.match(page, /current-weather-stats/);
  assert.match(page, /FEELS LIKE/);
  assert.match(page, /HUMIDITY/);
  assert.match(page, /CEILING/);
});

test("bird-watch overhaul keeps risk, source, age and original timestamp parsing", () => {
  for (const text of ["{birdRisk}", "AHAS", "parseAhasTimestampIso(weather.birdUpdated, now)", "formatBwcCalendarStamp(bwcIso, birdStamp)", "calculateBirdObservationAge(bwcIso, now)", 'ageStr || "AGE UNAVAILABLE"', "{calendarStampStr}"]) assert.ok(page.includes(text), text);
  assert.match(page, /<BirdWatchGlyph \/>/);
  const glyph = readFileSync(new URL("../app/BirdWatchGlyph.tsx", import.meta.url), "utf8");
  assert.match(glyph, /viewBox="0 0 88 88"/);
  assert.doesNotMatch(glyph, /<text/);
});

test("future rows retain future-only unique Zulu time slots, probability, ceiling, temperature and hazards", () => {
  for (const text of ['f.time !== "NOW"', "t > now.getTime()", "seenLabels.has(label)", "uniqueList.slice(0, 3)", "d.getUTCHours()", "d.getUTCMinutes()", "normalizeFutureSkyDisplay", "formatForecastProbability(f.operationalWeather?.probability,f.precipitationProbability)", "{conditionLabel}", "{precipText}", "{cigText}", "{f.temperatureF}", "alertDisplay.shouldPulse", "alertDisplay.shouldFlash", "alertDisplay.text", "FORECAST UNAVAILABLE", "NO UPCOMING FORECAST SLOTS"]) assert.ok(page.includes(text), text);
  assert.match(page, /UPCOMING · ZULU/);
  assert.match(page, /forecast-probability/);
});

test("instrument CSS is scoped away from wind, rail, clocks, scene and footer", () => {
  for (const content of [css, solarCss]) assert.doesNotMatch(content, /\.(?:wind[\w-]*|info|clock[\w-]*|clocks|burn-shift|display|sky[\w-]*)\s*[{,:]|\bfooter\s*\{/);
  assert.match(css, /max-height: 700px/);
  assert.match(css, /min-width: 2560px/);
  assert.match(solarCss, /max-height: 700px/);
  assert.match(css, /white-space: normal; overflow: visible/);
  assert.doesNotMatch(css + solarCss, /@keyframes/);
  assert.deepEqual([...css.matchAll(/animation:\s*([^;]+);/g)].map(m => m[1]), ["bwcPulse 1.2s infinite ease-in-out", "none !important", "none !important"]);
  for (const text of ["clockText", "metarDiagnostic", "tafDiagnostic", "feedDiagnostic", "popDiagnostic", "PRESS F11 FOR FULL SCREEN"]) assert.ok(page.includes(text));
});
