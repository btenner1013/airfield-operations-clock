import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as controller from "../app/weatherController.ts";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/PreviewLab.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
function compile(react = React) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(id => id === "react" ? react : id === "./weatherController" ? controller : require(id), mod, mod.exports);
  return mod.exports.default;
}
const Lab = compile();
const noop = () => {};
const props = { active: true, paneDrops: null, onPaneToggle: noop, onWeatherDemo: noop, quality: "full", onQuality: noop };
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(Lab, { ...props, ...overrides }));
const allNodes = node => Array.isArray(node) ? node.flatMap(allNodes) : node && typeof node === "object" ? [node, ...allNodes(node.props?.children)] : [];
const textOf = node => Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? textOf(node.props?.children) : node == null ? "" : String(node);

test("normal clock has no preview controls; active entry exposes requested controls without a diagnostic wall", () => {
  assert.equal(render({ active: false }), "");
  const html = render();
  for (const label of ["WEATHER FX PREVIEW", "SIMULATED WEATHER", "WIND", "GUSTING", "VARIABLE SECTOR", "VRB", "CALM", "NORTH 359°", "WEATHER ALERTS", "WARNING", "C-17 FLYBY SIMULATOR", "SPAWN NOW", "SOLAR / TIME OF DAY", "BIRD WATCH CONDITION", "BWC SEVERE", "CURRENT LIGHTNING", "LIVE", "DIAG+", "HIDE"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /<dt>PARTICLES<\/dt>/);
  assert.match(page, /q.get\("previewWeatherFx"\)==="1"\|\|q.get\("weatherDemo"\)==="1"/);
});

test("preset links use supported query controls, preserve the preview panel and provide a clean live reset", () => {
  const html = render();
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1].replaceAll("&amp;", "&"));
  assert.ok(hrefs.filter(href => href === "?").length >= 1);
  for (const href of hrefs.filter(href => href !== "?")) {
    const q = new URLSearchParams(href.slice(1));
    assert.equal(q.get("previewWeatherFx"), "1");
    if (q.has("debugTime")) assert.ok(["day", "night", "sunrise", "sunset"].includes(q.get("debugTime")));
  }
  for (const value of ["gust", "sector", "variable", "calm"]) assert.ok(hrefs.some(href => new URLSearchParams(href.slice(1)).get("debugWindMode") === value));
  assert.ok(hrefs.some(href => new URLSearchParams(href.slice(1)).get("spawnFlyby") === "1"));
});

test("weather, manual quality and pane controls invoke their real callbacks", () => {
  const callbacks = { demos: [], quality: [], pane: [] };
  const Component = compile({ ...React, useEffect: noop, useState: initial => [initial, noop] });
  const tree = Component({ ...props, onWeatherDemo: value => callbacks.demos.push(value), onQuality: value => callbacks.quality.push(value), onPaneToggle: value => callbacks.pane.push(value) });
  const nodes = allNodes(tree);
  for (const demo of controller.WEATHER_DEMOS) nodes.find(node => node.type === "button" && textOf(node) === demo.label).props.onClick();
  assert.deepEqual(callbacks.demos, controller.WEATHER_DEMOS);
  nodes.find(node => node.type === "button" && textOf(node).startsWith("QUALITY:")).props.onClick();
  nodes.find(node => node.type === "button" && textOf(node).startsWith("WINDOW DROPLETS:")).props.onClick();
  assert.deepEqual(callbacks.quality, ["low"]);
  assert.deepEqual(callbacks.pane, [true]);
});

test("hide/show and diagnostics toggles remain reversible with LIVE reachable while hidden", () => {
  const state = []; let cursor = 0;
  const Component = compile({ ...React, useEffect: noop, useState: initial => {
    const i = cursor++;
    if (!(i in state)) state[i] = initial;
    return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
  } });
  const tree = () => { cursor = 0; return Component(props); };
  const click = label => allNodes(tree()).find(node => node.type === "button" && textOf(node) === label).props.onClick();
  click("HIDE");
  assert.doesNotMatch(textOf(tree()), /C-17 FLYBY SIMULATOR/);
  assert.ok(allNodes(tree()).some(node => node.type === "a" && node.props.href === "?"));
  click("SHOW"); assert.match(textOf(tree()), /C-17 FLYBY SIMULATOR/);
  click("DIAG+"); assert.match(textOf(tree()), /PARTICLES/);
  click("DIAG-"); assert.doesNotMatch(textOf(tree()), /PARTICLES/);
});

test("mobile controls have touch targets and scroll access; explicit day/night presets drive resolved solar visibility", () => {
  const css = readFileSync(new URL("../app/cinematic-weather.css", import.meta.url), "utf8");
  const panelCss = readFileSync(new URL("../app/scene-2c.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*min-height: 44px/);
  assert.match(css, /\.fxlab > header \{ position: sticky; top: 0/);
  assert.match(panelCss, /\.fxlab \{[\s\S]*overflow: auto/);
  assert.match(panelCss, /width: calc\(100vw - 24px\)/);
  assert.match(page, /debugPhase === "day"\) effSolar = \{ \.\.\.solar, daylight: true/);
  assert.match(page, /debugPhase === "night"\) effSolar = \{ \.\.\.solar, daylight: false/);
  assert.match(page, /<SolarLunarInstrument solar=\{effSolar\}/);
});
