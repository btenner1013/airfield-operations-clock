import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lunar from "../app/solarLunar.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["parts", "dateKey", "parseTimeMinutes", "localClock", "solarWindow"];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)).map(n => n.getText(ast));
assert.equal(functions.length, names.length, "test executes every required production function");
function compile(source, imports = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(id => imports[id] || require(id), mod, mod.exports);
  return mod.exports;
}
const solar = compile(`const CONFIG={timeZone:"America/Chicago"};\n${functions.join("\n")}\nmodule.exports={${names.join(",")}};`);
const Instrument = compile(readFileSync(new URL("../app/SolarLunarInstrument.tsx", import.meta.url), "utf8"), { "./solarLunar": lunar }).default;
const phases = ["new", "crescent", "quarter", "gibbous", "full", "waning-gibbous", "last-quarter", "waning-crescent"];
const render = (window, phase = "full") => renderToStaticMarkup(React.createElement(Instrument, { solar: window, moon: lunar.resolveMoonPreview({ phase: .5, name: "FULL MOON" }, phase) }));
const resolve = (iso, days, rise = "--:--", set = "--:--") => {
  const now = new Date(iso);
  return solar.solarWindow(now, solar.parts(now, "America/Chicago"), days, rise, set);
};

// Tomorrow's later sunset used to extend today's daylight by a minute.
const summerDays = [
  { date: "2026-06-13", sunriseLocal: "05:45", sunsetLocal: "20:15" },
  { date: "2026-06-14", sunriseLocal: "05:45", sunsetLocal: "20:16" },
  { date: "2026-06-15", sunriseLocal: "05:45", sunsetLocal: "20:17" },
];

test("today's sunset controls daylight even when tomorrow's sunset is later", () => {
  for (const [iso, daylight] of [
    ["2026-06-15T01:15:59Z", true], ["2026-06-15T01:16:00Z", true],
    ["2026-06-15T01:16:01Z", false], ["2026-06-15T01:17:00Z", false], ["2026-06-15T01:17:01Z", false],
  ]) {
    const window = resolve(iso, summerDays);
    assert.equal(window.daylight, daylight, iso);
    assert.equal(window.activeObject, daylight ? "sun" : "moon", iso);
    for (const phase of phases) {
      const html = render(window, phase);
      assert.equal(html.includes('class="lunar-disc"'), !daylight, `${iso} ${phase}`);
      assert.equal(html.includes('class="solar-lunar-caption"'), !daylight, `${iso} ${phase}`);
      assert.equal(html.includes('class="solar-dial-sun"'), daylight, `${iso} ${phase}`);
    }
  }
});

test("after sunset, tomorrow captions and next sunrise remain intact", () => {
  const window = resolve("2026-06-15T01:16:01Z", summerDays);
  assert.equal(window.isTomorrow, true);
  assert.equal(window.sunrise, "05:45");
  assert.equal(window.sunset, "20:17");
  assert.equal(window.phase, "sunset", "twilight scene and actual sun/moon selection are distinct");
  assert.ok(window.markerY >= 76, "moon remains on the night arc");
  assert.equal((render(window).match(/TOMORROW/g) || []).length, 2);
  assert.equal(resolve("2026-06-15T01:46:00Z", summerDays).phase, "night", "30-minute scene transition uses today's sunset");
});

test("sunrise and decreasing-sunset boundaries retain their exact inclusivity", () => {
  const days = [
    { date: "2026-10-14", sunriseLocal: "07:05", sunsetLocal: "18:25" },
    { date: "2026-10-15", sunriseLocal: "07:06", sunsetLocal: "18:24" },
    { date: "2026-10-16", sunriseLocal: "07:07", sunsetLocal: "18:23" },
  ];
  for (const [iso, daylight] of [
    ["2026-10-15T12:05:59Z", false], ["2026-10-15T12:06:00Z", true], ["2026-10-15T12:06:01Z", true],
    ["2026-10-15T23:23:59Z", true], ["2026-10-15T23:24:00Z", true], ["2026-10-15T23:24:01Z", false],
    ["2026-10-16T05:00:00Z", false],
  ]) assert.equal(resolve(iso, days).daylight, daylight, iso);
});

test("no-event/null and nonfinite upstream values cannot fabricate Unix-epoch solar times", () => {
  for (const raw of [null, undefined, NaN, Infinity, -Infinity, "", "not a time"]) {
    const time = solar.localClock(raw);
    assert.equal(time, "--:--", String(raw));
    const window = resolve("2026-10-15T17:00:00Z", [{ date: "2026-10-15", sunriseLocal: time, sunsetLocal: time }]);
    for (const phase of phases) {
      const html = render(window, phase);
      assert.match(html, /data-cycle="unavailable"/);
      assert.match(html, /UNAVAILABLE/);
      assert.doesNotMatch(html, /class="lunar-disc"|class="solar-dial-sun"|solar-lunar-caption|data-moon-phase|north-up phase view/);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
  }
});

test("valid epoch times retain local-time/DST conversion and valid zero epoch semantics", () => {
  for (const [iso, expected] of [["2026-10-15T12:06:00Z", "07:06"], ["2026-03-08T07:59:00Z", "01:59"], ["2026-03-08T08:00:00Z", "03:00"], ["2026-11-01T06:59:00Z", "01:59"], ["2026-11-01T07:00:00Z", "01:00"]]) {
    assert.equal(solar.localClock(Date.parse(iso) / 1000), expected, iso);
  }
  assert.equal(solar.localClock(0), "18:00", "Unix epoch zero is not an undocumented polar sentinel");
});

test("missing or invalid today events cannot become an apparently valid night via tomorrow captions", () => {
  for (const [rise, set] of [["--:--", "--:--"], ["--:--", "18:24"], ["07:06", "--:--"], ["bad", "18:24"], ["07:06", "25:00"], ["07:99", "18:24"], ["00:00", "00:00"], ["18:24", "07:06"]]) {
    const days = [{ date: "2026-10-15", sunriseLocal: rise, sunsetLocal: set }, { date: "2026-10-16", sunriseLocal: "07:07", sunsetLocal: "18:23" }];
    for (const iso of ["2026-10-15T17:00:00Z", "2026-10-16T02:00:00Z"]) {
      const window = resolve(iso, days);
      assert.equal(Number.isFinite(window.progress), false, `${iso} ${rise}/${set}`);
      const html = render(window);
      assert.match(html, /data-cycle="unavailable"/);
      assert.doesNotMatch(html, /class="lunar-disc"|class="solar-dial-sun"|solar-lunar-caption|data-moon-phase|north-up phase view/);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
  }
  const next = resolve("2026-10-16T02:00:00Z", [{ date: "2026-10-15", sunriseLocal: "--:--", sunsetLocal: "--:--" }, { date: "2026-10-16", sunriseLocal: "07:07", sunsetLocal: "18:23" }]);
  assert.equal(next.sunrise, "07:07");
  assert.equal(next.sunset, "18:23");
  assert.match(render(next), /07:07L/);
  assert.match(render(next), /18:23L/);
});

test("invalid next-day events also keep the night marker unavailable", () => {
  for (const event of ["--:--", "bad", "25:00"]) {
    const next = resolve("2026-10-16T02:00:00Z", [{ date: "2026-10-15", sunriseLocal: "07:06", sunsetLocal: "18:24" }, { date: "2026-10-16", sunriseLocal: event, sunsetLocal: "18:23" }]);
    assert.equal(Number.isFinite(next.progress), false);
    assert.match(render(next), /data-cycle="unavailable"/);
  }
  const valid = resolve("2026-10-15T17:00:00Z", [{ date: "2026-10-15", sunriseLocal: "07:06 AM", sunsetLocal: "06:24 PM" }]);
  assert.equal(valid.daylight, true, "existing AM/PM forms remain supported");
  assert.equal(Number.isFinite(valid.progress), true);
});
