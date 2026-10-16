import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as birdWatch from "../app/birdWatch.ts";
const require = createRequire(import.meta.url);
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/information-bar.css", import.meta.url), "utf8");
const originalCss = readFileSync(new URL("../app/layout-tuning.css", import.meta.url), "utf8");
function compile(source, imports = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(id => imports[id] || require(id), mod, mod.exports);
  return mod.exports;
}
const glyphSource = readFileSync(new URL("../app/BirdWatchGlyph.tsx", import.meta.url), "utf8");
const Glyph = compile(glyphSource);
// Exercise the exact production card JSX rather than maintaining a separate fixture component.
const card = page.match(/<article className=\{`bird-card panel risk-\$\{birdClass\}`\}>[\s\S]*?<\/article>/)?.[0];
assert.ok(card, "production bird card found");
const riskExpression = page.match(/const birdClass=(.+?), birdStamp=/)?.[1];
assert.ok(riskExpression, "production risk mapping found");
const { default: Card } = compile(`import BirdWatchGlyph from "./BirdWatchGlyph";
import {parseAhasTimestampIso, calculateBirdObservationAge, formatBwcCalendarStamp} from "./birdWatch";
export default function Card({birdRisk, weather, now, birdStamp}) {
  const birdClass = ${riskExpression};
  return (${card});
}`, { "./BirdWatchGlyph": Glyph, "./birdWatch": birdWatch });
const now = new Date("2026-10-15T18:12:00Z");
const render = (risk = "MODERATE", updated = "15/1800Z") => renderToStaticMarkup(React.createElement(Card, { birdRisk: risk, weather: { birdUpdated: updated }, birdStamp: updated || "—", now }));

test("chosen A card gives the original AHAS age a labeled steady high-contrast band", () => {
  const html = render();
  assert.match(html, /bird-observation-age/);
  assert.match(html, /data-age-state="elapsed"/);
  assert.match(html, /OBSERVATION AGE/);
  assert.match(html, /12 MIN AGO/);
  assert.match(html, /15 OCT 1800Z/);
  assert.match(css, /\.bird-observation-age \{[^}]*background: #16303e/);
  assert.match(css, /\.bird-watch-update \.bird-age \{[^}]*#f2f8fb[^}]*9\.5cqw, 30px/);
});

test("actual card retains minute, hour and future ages without manufacturing a freshness cutoff", () => {
  for (const [stamp, expected, state] of [["15/1812Z", "0 MIN AGO", "elapsed"], ["15/1713Z", "59 MIN AGO", "elapsed"], ["15/1712Z", "1H 0M AGO", "elapsed"], ["15/1605Z", "2H 7M AGO", "elapsed"], ["15/1819Z", "FUTURE OBS (+7M)", "future"]]) {
    const html = render("MODERATE", stamp);
    assert.ok(html.includes(expected), expected);
    assert.ok(html.includes(`data-age-state="${state}"`));
    assert.doesNotMatch(html, /STALE|FRESH/);
  }
});

test("missing or invalid observation time is explicit and never appears as a zero-minute update", () => {
  for (const stamp of [null, "", "—", "not a timestamp"]) {
    const html = render("UNAVAILABLE", stamp);
    assert.match(html, /AGE UNAVAILABLE/);
    assert.match(html, /data-age-state="unavailable"/);
    assert.doesNotMatch(html, /0 MIN AGO|NaN|Infinity/);
    if (stamp === "not a timestamp") assert.match(html, /not a timestamp/);
  }
});

test("LOW, MODERATE, SEVERE, HIGH and unknown retain the production risk mapping and shared bird color", () => {
  for (const [risk, expected] of [["LOW", "low"], ["MODERATE", "moderate"], ["SEVERE", "severe"], ["HIGH", "severe"], ["UNAVAILABLE", "unknown"], ["UNKNOWN", "unknown"]]) {
    const html = render(risk);
    assert.ok(html.includes(`bird-card panel risk-${expected}`));
    assert.ok(html.includes(`class="bird-severity">${risk}`));
    assert.match(html, /class="bird-watch-glyph"/);
  }
  for (const [risk, color] of [["low", "#72dbbd"], ["moderate", "#ffd07a"], ["severe", "#ff7676"]]) assert.ok(css.includes(`.bird-card.risk-${risk} { --bird-tone: ${color}; }`));
  assert.match(css, /\.bird-card \{[^}]*--bird-tone: #a6bdca/);
  assert.match(css, /\.bird-watch-glyph \{[^}]*color: var\(--bird-tone\)/);
  assert.match(css, /\.bird-watch-reading \.bird-severity \{[^}]*color: var\(--bird-tone\)/);
  assert.match(glyphSource, /function Goose\(\)/);
  assert.match(glyphSource, /fill="currentColor"/);
  assert.doesNotMatch(glyphSource, /<text|setInterval|requestAnimationFrame/);
});

test("severe bird and text reuse the original 1.2-second fade; age is not animated", () => {
  assert.match(originalCss, /\.risk-severe\s+\.bird-severity,[^{]*\.bird-icon-symbol\s*\{[^}]*animation: bwcPulse 1\.2s infinite ease-in-out/);
  assert.match(originalCss, /@keyframes bwcPulse\s*\{\s*0%, 100%\s*\{\s*opacity: 1;/);
  assert.match(originalCss, /50%\s*\{\s*opacity: 0\.4;/);
  assert.match(css, /\.bird-card\.risk-severe \.bird-watch-glyph \{ animation: bwcPulse 1\.2s infinite ease-in-out; \}/);
  assert.doesNotMatch(css, /[^{}]*(?:bird-age|bird-observation-age|bird-watch-update)[^{}]*\{[^}]*animation:/);
  assert.doesNotMatch(css, /@keyframes/);
});

test("both OS and explicit reduced-motion state disable the severe bird and text pulse", () => {
  assert.match(css, /\[data-reduced-motion="1"\] \.bird-card\.risk-severe \.bird-watch-glyph,\s*\[data-reduced-motion="1"\] \.bird-card\.risk-severe \.bird-severity \{ animation: none !important; opacity: 1; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bird-card\.risk-severe \.bird-watch-glyph, \.bird-card\.risk-severe \.bird-severity \{ animation: none !important; opacity: 1; \}/);
});


test("condition uses a full-width row and substantially larger type without squeezing observation age", () => {
  assert.match(css, /grid-column: 1 \/ -1; font: 900 clamp\(18px, 16cqw, 52px\)/);
  assert.match(css, /font-size: clamp\(18px, 16cqw, 72px\)/);
  assert.match(css, /font-size: clamp\(18px, 16cqw, 30px\)/);
  assert.match(css, /\.bird-watch-reading \.bird-severity \{[^}]*white-space: nowrap/);
  assert.match(css, /\.bird-card\.risk-unknown \.bird-severity \{[^}]*white-space: normal; overflow-wrap: anywhere/);
  const clamp = (lo, value, hi) => Math.max(lo, Math.min(hi, value));
  for (const content of [110,120,130,150,180,230,280,330,440,550]) {
    for (const cap of [30,52,72]) {
      const font = clamp(18, content * .16, cap);
      assert.ok(font * (8 * .62 + 7 * .01) <= content, `MODERATE fits ${content}px full-width row at cap ${cap}`);
    }
    assert.ok(clamp(18, content * .16, 52) >= clamp(14, content * .104, 32) * (content >= 150 ? 1.5 : 1.25));
  }
});
