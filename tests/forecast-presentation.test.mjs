import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeForecastSources } from "../app/forecastPresentation.ts";
const taf = { source: "TAF", operationalWeather: { code: "-RA" } };
const hourly = { source: "MODEL", operationalWeather: null };

test("TAF conditions are honestly labeled as combined with hourly products", () => {
  const result = describeForecastSources([taf, taf, taf]);
  assert.equal(result.label, "TAF + HOURLY");
  assert.match(result.detail, /hourly temperature/);
  assert.match(result.detail, /PROB30\/40/);
});
test("TAF-tagged rows without operational weather remain hourly fallback in source label", () => {
  assert.equal(describeForecastSources([{ source: "TAF", operationalWeather: null }]).label, "HOURLY");
  assert.equal(describeForecastSources([{ source: "TAF" }]).label, "HOURLY");
  assert.equal(describeForecastSources([hourly, hourly]).label, "HOURLY");
});
test("mixed visible rows expose both TAF and hourly sources, without mutating input", () => {
  const rows = Object.freeze([Object.freeze(taf), Object.freeze(hourly)]);
  assert.equal(describeForecastSources(rows).label, "TAF + HOURLY");
  assert.equal(rows[0], taf);
  assert.equal(rows[1], hourly);
});
test("empty or missing metadata never claims TAF", () => {
  assert.equal(describeForecastSources([]).label, "NO DATA");
  assert.equal(describeForecastSources([{}]).label, "SOURCE N/A");
});
test("header describes exactly the selected first-three rows, retaining existing future/unique/Zulu logic", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const forecastSource=describeForecastSources\(uniqueList.slice\(0, 3\)\)/);
  assert.match(page, /className="forecast-source-badge" title=\{forecastSource.detail\}>\{forecastSource.label\}/);
  for (const code of ['f.time !== "NOW"', 'Number.isFinite(t)', '(debugFutureWeather||t > now.getTime())', 'seenLabels.has(label)', 'uniqueList.slice(0, 3).map', 'd.getUTCHours()', 'd.getUTCMinutes()']) assert.ok(page.includes(code), code);
  const filter = page.indexOf('const displayList = displayForecast.filter');
  const header = page.indexOf('const forecastSource=describeForecastSources');
  assert.ok(filter > 0 && filter < header);
});
