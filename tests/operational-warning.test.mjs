import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as alerts from "../app/alertPresentation.ts";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/OperationalWarning.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/operational-warnings.css", import.meta.url), "utf8");
const cohesion = readFileSync(new URL("../app/board-cohesion.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const mod = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("require", "module", "exports", compiled)(id => id === "./alertPresentation" ? alerts : require(id), mod, mod.exports);
const Warning = mod.exports.default;
const render = (props = {}) => renderToStaticMarkup(React.createElement(Warning, { kind: "weather", text: "-RA PSBL 12-13Z", tone: "blue", pulse: false, flash: false, ...props }));
const visibleText = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("shared warning preserves source message words and Zulu windows without parsing or relabeling as forecast", () => {
  for (const text of ["-RA PSBL 12-13Z", "TSRA WARNING 15 OCT 21–22Z", "VCSH PSBL 29 JUL 05–06Z", "UNCLASSIFIED SOURCE MESSAGE +RAW/123Z", "TS OVER FIELD"]) {
    const html = render({ text });
    assert.ok(visibleText(html).includes(text), text);
    assert.match(html, /WEATHER ALERT/);
    assert.match(html, /OPS BOARD/);
    assert.doesNotMatch(html, /FORECAST|CURRENT WX/);
  }
  assert.doesNotMatch(source, /\.match\(|\.replace\(|\.split\(|Date\.parse|new Date|setInterval|fetch\(/);
});

test("current observed warning exposes its source time without changing the alert content", () => {
  const html = render({ kind: "current", text: "TS OVER FIELD", tone: "red", flash: true, sourceTime: "2026-10-15T17:40:00Z", sourceStamp: "151740Z" });
  assert.match(html, /CURRENT WX/);
  assert.match(html, /OBS 151740Z/);
  assert.match(html, /data-source-time="2026-10-15T17:40:00Z"/);
  assert.match(html, /data-kind="current"/);
  assert.match(html, /ops-warning alert-flash/);
});

test("stale current warnings visibly identify retained reports and retain original animation flags", () => {
  const html = render({ kind: "current", text: "TS OVER FIELD", tone: "red", stale: true, flash: true, sourceStamp: "151500Z" });
  assert.match(html, /REPORTED WX/);
  assert.match(html, /STALE REPORT/);
  assert.match(html, /OBS 151500Z/);
  assert.match(html, /data-stale="true"/);
  assert.match(html, /alert-flash/);
  assert.doesNotMatch(html, /CURRENT WX|FRESH|LIVE/);
});

test("unknown-time current warning never invents a source timestamp or freshness", () => {
  for (const sourceStamp of [undefined, "—"]) {
    const html = render({ kind: "current", text: "VCTS", tone: "yellow", pulse: true, sourceStamp });
    assert.match(html, /TIME UNVERIFIED/);
    assert.doesNotMatch(html, /OBS |FRESH|LIVE|data-source-time/);
  }
});

test("weather warnings expose degraded or offline feed status without inventing a forecast cutoff", () => {
  for (const feedStatus of ["DEGRADED", "OFFLINE"]) {
    const html = render({ feedStatus });
    assert.ok(html.includes(`FEED ${feedStatus}`));
    assert.match(html, /OPS BOARD/);
    assert.match(html, /-RA PSBL 12-13Z/);
    assert.doesNotMatch(html, /CURRENT|FORECAST|STALE/);
  }
  assert.doesNotMatch(render({ feedStatus: "OK" }), /FEED OK|FRESH|LIVE/);
});

test("preview overrides are labeled rather than impersonating a live report", () => {
  for (const kind of ["current", "weather"]) {
    const html = render({ kind, preview: true, sourceStamp: "151740Z", feedStatus: "OFFLINE" });
    assert.match(html, /data-preview="true"/);
    assert.match(html, /PREVIEW/);
    assert.doesNotMatch(html, /OBS 151740Z|OPS BOARD|FEED OFFLINE/);
  }
});

test("source icons remain optional and exact message text is safely escaped", () => {
  assert.match(render({ icon: "⚡" }), /ops-warning-icon/);
  assert.doesNotMatch(render(), /ops-warning-icon/);
  const html = render({ text: "<SOURCE> & TS +RA" });
  assert.match(html, /&lt;SOURCE&gt; &amp; TS \+RA/);
  assert.doesNotMatch(html, /<SOURCE>/);
});

test("blue, yellow and red reuse the Ops Board palette and supplied normalized motion flags", () => {
  for (const [tone, hex] of Object.entries(alerts.OPS_ALERT_COLORS)) assert.ok(render({ tone }).includes(hex));
  for (const tone of ["blue", "yellow", "red"]) {
    const d = alerts.resolveWxAlertDisplay({ text: "-RA PSBL 12-13Z", tone, pulse: tone === "yellow", flash: tone === "red", visible: true });
    const html = render({ text: d.text, tone: d.colorClass.replace("alert-", ""), pulse: d.shouldPulse, flash: d.shouldFlash });
    assert.equal(html.includes("alert-pulse"), d.shouldPulse);
    assert.equal(html.includes("alert-flash"), d.shouldFlash);
  }
});

test("legacy alert cadence is retained only on the message body; source/status stay steady", () => {
  assert.match(css, /data-kind="current"\]\.alert-pulse \.ops-warning-body \{ animation: opsAlertPulse \.95s/);
  assert.match(css, /data-kind="weather"\]\.alert-pulse \.ops-warning-body \{ animation: opsAlertPulse \.82s/);
  assert.match(css, /\.ops-warning\.alert-flash \.ops-warning-body \{ animation: opsAlertFlash 1s step-start/);
  assert.doesNotMatch(css, /[^{}]*(?:ops-warning-heading|ops-warning-status|ops-warning-note)[^{}]*\{[^}]*animation:/);
  assert.doesNotMatch(css, /@keyframes/);
});

test("OS and debug reduced motion disable warning animation; normalized reduced flags also stay off", () => {
  assert.match(css, /\[data-reduced-motion="1"\] \.ops-warning \.ops-warning-body \{ animation: none !important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  const d = alerts.resolveWxAlertDisplay({ text: "TSRA WARNING 21-22Z", tone: "red", flash: true, reducedMotion: true });
  assert.doesNotMatch(render({ pulse: d.shouldPulse, flash: d.shouldFlash }), /alert-pulse|alert-flash/);
});

test("production wiring keeps original no-alert gates and passes normalized text/flags/metadata directly", () => {
  assert.match(page, /lightningDisplay\.severity!=="none"&&\(\s*<OperationalWarning kind="current" text=\{lightningDisplay.text\}/);
  assert.match(page, /pulse=\{lightningDisplay.shouldPulse\} flash=\{lightningDisplay.shouldFlash\} stale=\{lightningDisplay.isStale\}/);
  assert.match(page, /const hasHazard=alertDisplay.severity!=="none"/);
  assert.match(page, /hasHazard && \(\s*<OperationalWarning kind="weather" text=\{alertDisplay.text\} icon=\{alertDisplay.icon\} tone=\{hazardTone\}/);
  assert.match(page, /pulse=\{alertDisplay.shouldPulse\} flash=\{alertDisplay.shouldFlash\}/);
  assert.match(page, /sourceTime=\{lightningDisplay.sourceTime\} sourceStamp=\{aviationStamp\(lightningDisplay.sourceTime\)\}/);
});

test("responsive warning and cohesion styles avoid clipping fields or changing clock/wind internals", () => {
  assert.match(source, /whiteSpace: "normal", overflowWrap: "anywhere"/);
  assert.doesNotMatch(css, /overflow:\s*hidden|white-space:\s*nowrap|text-overflow:\s*ellipsis/);
  assert.match(css, /max-height: 700px/);
  assert.match(css, /min-width: 2560px/);
  assert.match(cohesion, /@media \(max-height: 700px\)[\s\S]*\.info \{ max-height: none; \}/);
  assert.match(cohesion, /\.bird-watch-glyph \{ max-width: 100%; height: auto; \}/);
  assert.doesNotMatch(css + cohesion, /\.(?:clock[\w-]*|clocks|burn-shift|wind-(?:dial|needle|bearing|speed|instrument)[\w-]*)\s*[{,:]/);
});
