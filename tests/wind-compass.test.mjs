import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseStandardWind } from "../app/currentWind.ts";
import * as compass from "../app/windCompass.ts";

const now = Date.parse("2026-10-15T17:00:00Z");
const observedAt = "2026-10-15T16:54:00.000Z";
const wind = (token, source = "METAR", time = observedAt) => parseStandardWind(token, source, time);
const display = token => compass.buildWindCompassModel(wind(token), now);

test("FROM labels preserve the observation while the arrow description reports opposite flow", () => {
  for (const [token, degrees, cardinal, flow] of [
    ["36008KT", "360°", "N", "180° S"], ["09008KT", "090°", "E", "270° W"],
    ["18008KT", "180°", "S", "360° N"], ["27008KT", "270°", "W", "090° E"],
    ["21008G18KT", "210°", "SSW", "030° NNE"],
  ]) {
    const result = display(token);
    assert.equal(result.state, "directional");
    assert.equal(result.degrees, degrees);
    assert.equal(result.cardinal, cardinal);
    assert.ok(result.description.includes(`Wind from ${degrees} ${cardinal}`));
    assert.ok(result.description.includes(`airflow toward ${flow}`));
    assert.equal(result.speed, "08");
  }
  assert.equal(display("21008G18KT").gust, "18");
  assert.equal(display("21008KT").gust, null);
  const northZero = compass.buildWindCompassModel({ ...wind("36008KT"), directionDegrees: 0 }, now);
  assert.equal(northZero.degrees, "360°");
  assert.equal(northZero.bearing, 0);
});

test("north wraparound uses the short transition in both directions and after repeated turns", () => {
  assert.equal(compass.closestWindRotation(359, 1), 361);
  assert.equal(compass.closestWindRotation(1, 359), -1);
  assert.equal(compass.closestWindRotation(719, 1), 721);
  assert.equal(compass.closestWindRotation(-359, 359), -361);
  assert.equal(compass.closestWindRotation(360, 0), 360);
  assert.equal(compass.normalizeWindBearing(-1), 359);
  assert.equal(compass.windCardinal(359), "N");
  assert.equal(compass.windCardinal(11), "N");
  assert.equal(compass.windCardinal(12), "NNE");
});

test("variable sectors draw reported FROM bearings across north without flipping to flow", () => {
  const result = display("36008KT 330V030");
  assert.equal(result.sector, "330°–030°");
  assert.equal(result.sectorPath, "M 42.000 28.823 A 36 36 0 0 1 78.000 28.823");
  assert.match(display("21008KT 180V240").sectorPath, /^M 60\.000 96\.000/);
  assert.equal(compass.windSectorPath(0, 360), null);
  assert.equal(compass.windSectorPath(-10, 20), null);
  assert.equal(compass.windSectorPath(NaN, 20), null);
});

test("calm, variable, and missing observations never invent a directional arrow", () => {
  const calm = display("00000KT");
  assert.equal(calm.state, "calm");
  assert.equal(calm.speed, "00");
  assert.equal(calm.bearing, null);
  assert.equal(calm.gust, null);
  const variable = display("VRB03G12KT");
  assert.equal(variable.state, "variable");
  assert.equal(variable.bearing, null);
  assert.equal(variable.speed, "03");
  assert.equal(variable.gust, "12");
  for (const missing of [null, wind("21008KT", "MODEL"), wind("21008KT", "METAR", null)]) {
    const result = compass.buildWindCompassModel(missing, now);
    assert.equal(result.state, "unavailable");
    assert.equal(result.bearing, null);
    assert.equal(result.speed, "—");
    assert.equal(result.gust, null);
  }
});

test("observations expire at each source's existing cutoff, without exposing old values as current", () => {
  for (const [source, limit] of [["ATIS", 90], ["METAR", 75]]) {
    const report = wind("21008G18KT", source, new Date(now - limit * 60000).toISOString());
    assert.equal(compass.buildWindCompassModel(report, now).state, "directional");
    const stale = compass.buildWindCompassModel(report, now + 1);
    assert.equal(stale.state, "stale");
    assert.equal(stale.bearing, null);
    assert.equal(stale.speed, "—");
    assert.equal(stale.gust, null);
    assert.ok(stale.observation.startsWith(source));
    assert.match(stale.observation, /STALE$/);
    assert.match(stale.description, /Last .* observation/);
  }
  const future = wind("21008KT", "METAR", new Date(now + 6 * 60000).toISOString());
  assert.equal(compass.buildWindCompassModel(future, now).state, "unavailable");
  assert.equal(compass.buildWindCompassModel(wind("21008KT"), NaN).state, "unavailable");
});

test("invalid numeric input cannot produce a fictitious heading, speed, or NaN markup", () => {
  for (const change of [{ directionDegrees: NaN }, { directionDegrees: 361 }, { speedKt: -1 }, { gustKt: Infinity }]) {
    const result = compass.buildWindCompassModel({ ...wind("21008KT"), ...change }, now);
    assert.equal(result.state, "unavailable");
    assert.equal(result.bearing, null);
  }
});

// Compile the actual TSX in memory, then render its real React DOM output. No browser
// or screenshot substitute is involved in these accessibility/markup regressions.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/WindInstrument.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(id => id === "./windCompass" ? compass : require(id), mod, mod.exports);
const Instrument = mod.exports.default;
const render = (report, reduced = false) => renderToStaticMarkup(React.createElement(Instrument, { wind: report, nowMs: now, reduced }));

test("actual instrument markup exposes useful accessible text, degrees, knots, source, and variable sector", () => {
  const markup = render(wind("21008G18KT 180V240", "ATIS"));
  assert.match(markup, /role="img" aria-label="Wind from 210° SSW, 08 knots, gusting 18 knots/);
  assert.match(markup, /FROM SSW/);
  assert.match(markup, /VAR 180°–240°/);
  assert.doesNotMatch(markup, /ARROW = FLOW/);
  const fixed = render(wind("21008KT"));
  assert.doesNotMatch(fixed, /ARROW = FLOW|wind-direction-key/);
  assert.match(fixed, /wind-flow-head/);
  assert.match(markup, /ATIS · 1654Z/);
  assert.match(markup, /transform:rotate\(210deg\)/);
  assert.match(markup, /class="wind-from-marker"/);
  assert.match(markup, /class="wind-flow-head"/);
  assert.equal((markup.match(/class="wind-dial-tick/g) ?? []).length, 36);
  assert.match(render(wind("21008KT"), true), /wind-needle is-reduced/);
  const css = readFileSync(new URL("../app/wind-compass.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("actual neutral-state markup has no directional marker or arrow and shows its status", () => {
  for (const [report, state, label] of [
    [wind("00000KT"), "calm", "CALM"], [wind("VRB03KT"), "variable", "VRB"],
    [null, "unavailable", "OBS UNAVAILABLE"],
    [wind("21008G18KT", "METAR", "2026-10-15T14:00:00Z"), "stale", "STALE"],
  ]) {
    const markup = render(report);
    assert.match(markup, new RegExp(`data-wind-state="${state}"`));
    assert.ok(markup.includes(label));
    assert.doesNotMatch(markup, /wind-flow-head|wind-from-marker|wind-sector-arc/);
    assert.doesNotMatch(markup, /NaN|undefined/);
  }
});

test("observed gusts get a separate bold G reading with knots and preserved accessible description", () => {
  for (const [token, expected] of [["21008G18KT", "18"], ["VRB03G12KT", "12"], ["27075G105KT", "105"]]) {
    const markup = render(wind(token));
    assert.match(markup, new RegExp(`<span class="wind-gust"><strong>G ${expected}</strong><span>KT</span></span>`));
    assert.ok(markup.includes(`gusting ${expected} knots`));
  }
  const css = readFileSync(new URL("../app/wind-compass.css", import.meta.url), "utf8");
  assert.match(css, /\.wind-gust \{[^}]*background: #080e14;[^}]*color: #fff6df;[^}]*font-weight: 900;/);
  assert.match(css, /\.wind-gust strong \{ font-size: clamp\(17px, 10cqw, 30px\); font-weight: 900;/);
  assert.match(css, /\.wind-gust strong \{ font-size: 16px; \}/);
  assert.doesNotMatch(css, /\.wind-gust \{ font-size: 8px;/);
});

test("the gust badge is absent for no-gust, calm, stale, model-only and missing observations", () => {
  for (const report of [
    wind("21008KT"), wind("VRB03KT"), wind("00000KT"),
    wind("21008G18KT", "METAR", "2026-10-15T14:00:00Z"),
    wind("21008G18KT", "MODEL"), null,
  ]) assert.doesNotMatch(render(report), /class="wind-gust"/);
});
