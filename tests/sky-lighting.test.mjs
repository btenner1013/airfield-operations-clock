import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudSunsetStrength } from "../app/skyLighting.ts";

test("sunset grading changes only low/mid broken and closed cloud decks", () => {
  for (const phase of ["day", "sunrise", "sunset", "night"]) {
    for (const [coverage, amount] of Object.entries({ CLR: 0, FEW: .2, SCT: .44, BKN: .76, OVC: 1, VV: 1 })) {
      const strength = cloudSunsetStrength(phase, amount, 6500, 0);
      assert.equal(strength, phase === "sunset" && ["BKN", "OVC", "VV"].includes(coverage) ? 1 : 0, `${phase}/${coverage}`);
    }
  }
  for (const ceiling of [null, NaN, 12000, 25000]) assert.equal(cloudSunsetStrength("sunset", .76, ceiling, 0), 0);
  assert.equal(cloudSunsetStrength("sunset", .76, 11000, 0), .5, "High-cloud boundary fades smoothly");
  for (const storm of [.08, .22, .46, .68, 1]) assert.equal(cloudSunsetStrength("sunset", .76, 6500, storm), 0, "Rain/storm lighting stays unchanged");
  assert.equal(cloudSunsetStrength(undefined, .76, 6500, 0), 0);
});

test("phase reaches the atmosphere renderer and only cloudy sunset loses the legacy runway glow", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const canvas = readFileSync(new URL("../app/PrecipCanvas.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/cinematic-weather.css", import.meta.url), "utf8");
  assert.match(page, /<PrecipCanvas[^>]*phase=\{phase\}/);
  assert.match(canvas, /atmosphereRef\.current=\{\.\.\.atmosphere,phase\}/);
  assert.match(canvas, /JSON\.stringify\(\{\.\.\.atmosphere,phase\}\)/, "Static/reduced frames redraw when phase changes");
  for (const coverage of ["BKN", "OVC", "VV"]) assert.ok(css.includes(`.phase-sunset[data-wallpaper-scene="overcast-day"][data-coverage="${coverage}"][data-obscuration="none"] .sky::after`));
  assert.match(css, /\.theme-overcast\.phase-sunset/);
  assert.doesNotMatch(css, /data-coverage="(?:CLR|FEW|SCT)"/);
});
