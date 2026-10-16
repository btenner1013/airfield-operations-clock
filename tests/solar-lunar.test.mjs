import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lunar from "../app/solarLunar.ts";

const source = readFileSync(new URL("../app/SolarLunarInstrument.tsx", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(id => id === "./solarLunar" ? lunar : require(id), mod, mod.exports);
const { default: Instrument, MoonPhaseDisc, SolarLunarDial } = mod.exports;
const windowAt = (daylight, progress, overrides = {}) => {
  const angle = daylight ? Math.PI - progress / 100 * Math.PI : progress / 100 * Math.PI;
  return { daylight, progress, sunrise: "07:06", sunset: "18:24", isTomorrow: false, markerX: 100 + Math.cos(angle) * 88, markerY: 76 + (daylight ? -1 : 1) * Math.sin(angle) * 56, ...overrides };
};
const solar = windowAt(true, 62.2);
const moon = { phase: .12, name: "WAXING CRESCENT" };
const render = (s = solar, m = moon) => renderToStaticMarkup(React.createElement(Instrument, { solar: s, moon: m }));

test("new/full and exact quarters use valid paths without degenerate elliptical radii", () => {
  assert.equal(lunar.moonIlluminatedPath(0), null);
  assert.equal(lunar.moonIlluminatedPath(1), null);
  assert.equal(lunar.moonIlluminatedPath(.25), "M 0 -40 A 40 40 0 0 1 0 40 L 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(.75), "M 0 -40 A 40 40 0 0 0 0 40 L 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(.5), "M 0 -40 A 40 40 0 1 1 0 40 A 40 40 0 1 1 0 -40 Z");
});

test("waxing-right and waning-left paths use mirrored limbs and cosine terminators", () => {
  assert.equal(lunar.moonIlluminatedPath(.125), "M 0 -40 A 40 40 0 0 1 0 40 A 28.2843 40 0 0 0 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(.375), "M 0 -40 A 40 40 0 0 1 0 40 A 28.2843 40 0 0 1 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(.625), "M 0 -40 A 40 40 0 0 0 0 40 A 28.2843 40 0 0 0 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(.875), "M 0 -40 A 40 40 0 0 0 0 40 A 28.2843 40 0 0 1 0 -40 Z");
  assert.equal(lunar.moonIlluminatedPath(-.125), lunar.moonIlluminatedPath(.875));
  assert.equal(lunar.moonIlluminatedPath(1.125), lunar.moonIlluminatedPath(.125));
});

test("invalid moon inputs do not create malformed SVG", () => {
  for (const phase of [NaN, Infinity, -Infinity]) assert.equal(lunar.moonIlluminatedPath(phase), null);
  for (const radius of [0, -1, NaN, Infinity]) assert.equal(lunar.moonIlluminatedPath(.3, radius), null);
  for (let p = 0; p < 1; p += .001) assert.doesNotMatch(lunar.moonIlluminatedPath(p) ?? "", /NaN|Infinity|undefined/);
});

test("every phase preview matches its label and existing aliases retain their values", () => {
  for (const [name, phase, label] of [
    ["new", 0, "NEW MOON"], ["crescent", .12, "WAXING CRESCENT"], ["quarter", .25, "FIRST QUARTER"],
    ["gibbous", .375, "WAXING GIBBOUS"], ["full", .5, "FULL MOON"], ["waning-gibbous", .625, "WANING GIBBOUS"],
    ["last-quarter", .75, "LAST QUARTER"], ["waning-crescent", .88, "WANING CRESCENT"],
  ]) assert.deepEqual(lunar.resolveMoonPreview(moon, name), { phase, name: label });
  assert.deepEqual(lunar.resolveMoonPreview(moon, "waxing-crescent"), lunar.resolveMoonPreview(moon, "crescent"));
  assert.deepEqual(lunar.resolveMoonPreview(moon, "first-quarter"), lunar.resolveMoonPreview(moon, "quarter"));
  assert.deepEqual(lunar.resolveMoonPreview(moon, "waxing-gibbous"), lunar.resolveMoonPreview(moon, "gibbous"));
});

test("preview selection does not mutate live lunar data; unknown values preserve it", () => {
  const live = Object.freeze({ phase: .718, name: "WANING GIBBOUS" });
  for (const preview of [null, "unknown", "__proto__", "constructor"]) assert.equal(lunar.resolveMoonPreview(live, preview), live);
  lunar.resolveMoonPreview(live, "full");
  assert.equal(live.phase, .718);
  const a = lunar.resolveMoonPreview(live, "full"); a.phase = .1;
  assert.equal(lunar.resolveMoonPreview(live, "full").phase, .5);
});

test("local event formatting preserves time and suffix without inventing missing times", () => {
  assert.equal(lunar.solarLocalTime("07:06"), "07:06L");
  assert.equal(lunar.solarLocalTime("18:24L"), "18:24L");
  assert.equal(lunar.solarLocalTime("--:--"), "—");
  assert.equal(lunar.solarLocalTime(""), "—");
  assert.equal(lunar.solarDisplayProgress(-1), 0);
  assert.equal(lunar.solarDisplayProgress(101), 100);
  assert.equal(lunar.solarDisplayProgress(NaN), null);
});

test("actual component exposes phase information only at night and keeps solar readings", () => {
  for (const daylight of [true, false]) {
    const html = render(windowAt(daylight, 62.2));
    assert.equal(html.includes("MOON PHASE"), !daylight);
    assert.equal(html.includes("WAXING CRESCENT"), !daylight);
    assert.equal(html.includes("north-up phase view"), !daylight);
    assert.doesNotMatch(html, />[^<]*NORTH-UP VIEW[^<]*</);
    assert.match(html, /Schematic time progress, not celestial position/);
    assert.match(html, />62%<\/text>/);
    assert.match(html, /CYCLE ELAPSED/);
    assert.match(html, /07:06L/);
    assert.match(html, /18:24L/);
    assert.match(html, /TODAY/);
    assert.doesNotMatch(html, /moonrise|moonset|altitude|azimuth/i);
  }
});

test("tomorrow labels and unavailable solar states are explicit, with no fake marker", () => {
  const tomorrow = render(windowAt(false, 62.2, { isTomorrow: true }));
  assert.equal((tomorrow.match(/TOMORROW/g) ?? []).length, 2);
  const missing = render({ ...solar, sunrise: "--:--", sunset: "--:--" });
  assert.match(missing, /SOLAR TIMES/);
  assert.match(missing, /UNAVAILABLE/);
  assert.match(missing, /data-cycle="unavailable"/);
  assert.doesNotMatch(missing, /CYCLE ELAPSED/);
  assert.doesNotMatch(missing, /translate\(/);
  assert.doesNotMatch(missing, /MOON PHASE|WAXING|north-up|data-moon-phase/);
});

test("multiple actual moon components do not share gradient/clip IDs", () => {
  const html = renderToStaticMarkup(React.createElement("div", null, React.createElement(MoonPhaseDisc, moon), React.createElement(MoonPhaseDisc, { phase: .88, name: "WANING CRESCENT" })));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.length, 10);
});

test("restored dial retains original ellipse arcs, horizon and original sun/moon positions", () => {
  for (const daylight of [true, false]) {
    for (const progress of [0, 5, 25, 50, 75, 95, 100]) {
      const value = windowAt(daylight, progress);
      const html = renderToStaticMarkup(React.createElement(SolarLunarDial, { solar: value, moon }));
      assert.match(html, /d="M12 76 A88 56 0 0 1 188 76"/);
      assert.match(html, /d="M188 76 A88 56 0 0 1 12 76"/);
      assert.match(html, /d="M5 76 H195"/);
      assert.match(html, new RegExp(`data-cycle="${daylight ? "day" : "night"}"`));
      if (daylight) {
        assert.ok(html.includes(`translate(${value.markerX.toFixed(3)} ${value.markerY.toFixed(3)})`));
        assert.match(html, /class="solar-dial-sun"/);
        assert.doesNotMatch(html, /class="solar-dial-moon"/);
      } else {
        assert.ok(html.includes(`data-marker-x="${value.markerX}" data-marker-y="${value.markerY}"`));
        assert.ok(html.includes(`x="${value.markerX - 22.5}" y="${value.markerY - 22.5}" width="45" height="45"`));
        assert.doesNotMatch(html, /class="solar-dial-sun"/);
      }
      assert.equal((html.match(/class="solar-dial-tick/g) ?? []).length, 36);
      assert.doesNotMatch(html, /NaN|Infinity|undefined|solar-cycle-track/);
    }
  }
});

test("elapsed arc starts at original rise/set endpoints and ends at the resolved marker", () => {
  assert.equal(lunar.solarDialProgressPath(windowAt(true, 0)), null);
  assert.equal(lunar.solarDialProgressPath(windowAt(false, 0)), null);
  assert.equal(lunar.solarDialProgressPath(windowAt(true, 50)), "M 12 76 A 88 56 0 0 1 100.000 20.000");
  assert.equal(lunar.solarDialProgressPath(windowAt(false, 50)), "M 188 76 A 88 56 0 0 1 100.000 132.000");
  assert.equal(lunar.solarDialProgressPath(windowAt(true, 100)), "M 12 76 A 88 56 0 0 1 188.000 76.000");
  assert.equal(lunar.solarDialProgressPath(windowAt(false, 100)), "M 188 76 A 88 56 0 0 1 12.000 76.000");
  assert.equal(lunar.solarDialProgressPath({ ...solar, markerX: NaN }), null);
  assert.equal(lunar.solarDialProgressPath({ ...solar, markerY: Infinity }), null);
  assert.equal(lunar.solarDialProgressPath({ ...solar, progress: NaN }), null);
});

test("all phase labels and graphics appear only at night", () => {
  for (const phase of ["new", "crescent", "quarter", "gibbous", "full", "waning-gibbous", "last-quarter", "waning-crescent"]) {
    const preview = lunar.resolveMoonPreview(moon, phase);
    for (const daylight of [true, false]) {
      const html = render(windowAt(daylight, 50), preview);
      assert.equal(html.includes(preview.name), !daylight);
      assert.equal(html.includes("north-up phase view"), !daylight);
      assert.equal(html.includes('class="solar-lunar-caption"'), !daylight);
      assert.equal(html.includes('data-moon-phase='), !daylight);
      assert.equal((html.match(/class="lunar-disc"/g) ?? []).length, daylight ? 0 : 1);
    }
  }
});

test("dial is static SVG with unique references and no new animation or timers", () => {
  const value = windowAt(false, 36);
  const html = renderToStaticMarkup(React.createElement("div", null, React.createElement(SolarLunarDial, { solar, moon }), React.createElement(SolarLunarDial, { solar: value, moon })));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval|setTimeout|<animate|<canvas/);
  const css = readFileSync(new URL("../app/solar-lunar.css", import.meta.url), "utf8");
  assert.match(css, /max-height: 700px/);
  assert.match(css, /min-width: 2560px/);
  assert.doesNotMatch(css, /animation:|transition:|@keyframes/);
});


test("moon visibility follows resolved solar day/night at both boundaries, without clock-hour assumptions", () => {
  for (const daylight of [true, false]) {
    for (const progress of [0, .001, 99.999, 100]) {
      const html = render(windowAt(daylight, progress));
      assert.equal((html.match(/class="lunar-disc"/g) ?? []).length, daylight ? 0 : 1);
      assert.equal(html.includes('class="solar-dial-sun"'), daylight);
      assert.equal(html.includes("WAXING CRESCENT"), !daylight);
    }
  }
  for (const daylight of [true, false]) {
    for (const missing of [{sunrise:"--:--"}, {sunset:"--:--"}, {progress:NaN}]) {
      const html = render(windowAt(daylight, 50, missing));
      assert.doesNotMatch(html, /class="lunar-disc"|class="solar-dial-sun"|class="solar-dial-moon"/);
      assert.doesNotMatch(html, /MOON PHASE|WAXING|north-up|data-moon-phase/);
    }
  }
  assert.doesNotMatch(source, /getHours|getUTCHours|setInterval|setTimeout/);
});

test("readability upgrade enlarges center type without moving the original solar geometry", () => {
  const html = render(windowAt(true, 100));
  assert.match(html, /viewBox="-12 -4 224 164"/);
  assert.match(html, /class="solar-dial-cycle-label"[^>]*font-size="11"[^>]*font-weight="800"/);
  assert.match(html, /class="solar-dial-percentage"[^>]*font-size="29"[^>]*font-weight="900"/);
  assert.match(html, /class="solar-dial-progress-label"[^>]*font-size="8"/);
  assert.match(html, /cx="100" cy="76" rx="106" ry="74"/);
  assert.match(html, /translate\(188\.000 76\.000\)/);
  // The tighter viewport still contains the full sun halo at every endpoint
  // and the original moon/ellipse bounds, so larger markings are not cropped.
  for (const [x, y, r] of [[12, 76, 23], [188, 76, 23], [100, 20, 23], [100, 132, 22.5]]) {
    assert.ok(x - r >= -12 && x + r <= 212);
    assert.ok(y - r >= -4 && y + r <= 160);
  }
});

test("responsive solar readouts remain bounded for narrow, tablet, TV and tall-narrow cards", () => {
  const css = readFileSync(new URL("../app/solar-lunar.css", import.meta.url), "utf8");
  assert.match(css, /\.solar-dial-wrap \{[^}]*position: relative;[^}]*min-height: 122px/);
  assert.match(css, /\.solar-lunar-dial \{[^}]*position: absolute;[^}]*width: 100%; height: 100%; max-height: 190px/);
  assert.match(css, /font-size: clamp\(11px, 11\.5cqw, 34px\)/);
  assert.match(css, /font-size: clamp\(11px, 11\.5cqw, 44px\)/);
  assert.match(css, /font-size: clamp\(11px, 11\.5cqw, 19px\)/);
  assert.match(css, /color: #ffda94/);
  const clamp = (minimum, value, maximum) => Math.max(minimum, Math.min(value, maximum));
  // Both 24-hour readings include their L suffix. Use conservative .62em glyphs,
  // actual negative tracking, and the tighter second-column padding/border.
  for (const width of [100, 110, 130, 150, 180, 200, 250, 300, 360, 440, 550]) {
    for (const cap of [19, 34, 44]) {
      const font = clamp(11, width * .115, cap);
      const textWidth = 6 * .62 * font - 5 * .055 * font;
      const available = (width - 6) / 2 - 7;
      assert.ok(textWidth <= available, `time reading ${font}px fits ${width}px content at cap ${cap}`);
    }
  }
  assert.doesNotMatch(css, /animation:|transition:|@keyframes/);
});
