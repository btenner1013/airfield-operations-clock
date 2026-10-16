import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWeatherEffects, CLOUD_AMOUNTS, projectWind, WEATHER_DEMOS } from "../app/weatherController.ts";
import { debugLightningReport, NO_LIGHTNING, parseCurrentLightning } from "../app/lightning.ts";

const input = (overrides = {}) => ({
  phenomena: [], coverage: "CLR", ceiling: null, visibility: 10,
  windDirection: 270, windSpeed: 12, gust: null,
  lightning: { ...NO_LIGHTNING, types: [], directions: [] },
  night: false, quality: "full", reduced: false,
  ...overrides,
});
const effects = (phenomena, overrides = {}) => buildWeatherEffects(input({ phenomena, ...overrides }));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} ≈ ${expected}`);
const deepFreeze = value => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
const assertFiniteNumbers = value => {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `non-finite controller value: ${value}`);
  else if (value && typeof value === "object") for (const child of Object.values(value)) assertFiniteNumbers(child);
};

test("sky coverage has ordered visual density and explicit CLR/SKC zero-cloud states", () => {
  assert.equal(CLOUD_AMOUNTS.CLR, 0);
  assert.equal(CLOUD_AMOUNTS.SKC, 0);
  assert.ok(CLOUD_AMOUNTS.FEW > 0);
  assert.ok(CLOUD_AMOUNTS.FEW < CLOUD_AMOUNTS.SCT);
  assert.ok(CLOUD_AMOUNTS.SCT < CLOUD_AMOUNTS.BKN);
  assert.ok(CLOUD_AMOUNTS.BKN < CLOUD_AMOUNTS.OVC);
  assert.equal(CLOUD_AMOUNTS.OVC, 1);
  assert.equal(CLOUD_AMOUNTS.VV, 1);
  for (const coverage of Object.keys(CLOUD_AMOUNTS)) {
    const result = effects([], { coverage, ceiling: 25000 });
    assert.equal(result.atmosphere.coverage, CLOUD_AMOUNTS[coverage], coverage);
    assert.equal(result.atmosphere.ceiling, 25000);
    assert.equal(result.spec, null, `${coverage} must not manufacture precipitation`);
    assert.equal(result.atmosphere.lightningLevel, "none");
  }
});

test("rain intensity scales population, storm shading and visibility veil without becoming lightning", () => {
  const light = effects(["-RA"]), moderate = effects(["RA"]), heavy = effects(["+RA"]);
  assert.ok(light.spec.count < moderate.spec.count && moderate.spec.count < heavy.spec.count);
  assert.ok(light.atmosphere.storm < moderate.atmosphere.storm && moderate.atmosphere.storm < heavy.atmosphere.storm);
  assert.ok(light.spec.veil < moderate.spec.veil && moderate.spec.veil < heavy.spec.veil);
  for (const result of [light, moderate, heavy]) {
    assert.equal(result.fx.precip, "rain");
    assert.equal(result.spec.shape, "streak");
    assert.equal(result.spec.burst, false);
    assert.equal(result.atmosphere.lightningLevel, "none");
    assert.ok(result.spec.pane);
  }
  const restricted = effects(["+RA"], { visibility: .5 });
  assert.ok(restricted.atmosphere.veil > heavy.atmosphere.veil);
});

test("drizzle stays finer and slower while showers retain their separate modulation", () => {
  const drizzle = effects(["DZ"]), rain = effects(["RA"]), shower = effects(["SHRA"]);
  assert.equal(drizzle.spec.type, "drizzle");
  assert.ok(drizzle.spec.len < rain.spec.len);
  assert.ok(drizzle.spec.thick < rain.spec.thick);
  assert.ok(drizzle.spec.alpha < rain.spec.alpha);
  assert.ok(drizzle.spec.speed < rain.spec.speed);
  assert.equal(drizzle.spec.pane.profile, "drizzle");
  assert.equal(shower.fx.shower, true);
  assert.equal(shower.spec.burst, true);
  const nearby = effects(["VCSH"]);
  assert.equal(nearby.fx.vicinity, true);
  assert.ok(nearby.spec.count < shower.spec.count);
  assert.equal(nearby.spec.pane.profile, "vicinity");
  assert.equal(nearby.atmosphere.lightningLevel, "none");
});

test("liquid styling preserves night and per-class vicinity opacity reductions", () => {
  for (const token of ["RA", "DZ", "FZRA", "FZDZ", "SHRA"]) {
    const day = effects([token]);
    const night = effects([token], { night: true });
    close(night.spec.alpha, day.spec.alpha * .88, token);
  }
  const local = effects(["SHRA"]);
  const nearby = effects(["VCSH"]);
  const nearbyNight = effects(["VCSH"], { night: true });
  close(nearby.spec.alpha, local.spec.alpha * .58);
  close(nearbyNight.spec.alpha, local.spec.alpha * .58 * .88);
  // A local primary must not erase the vicinity status of its secondary rain.
  const mixed = effects(["SN", "VCSHRA"]);
  assert.equal(mixed.fx.vicinity, false);
  assert.equal(mixed.spec.secondary.type, "rain");
  close(mixed.spec.secondary.alpha, local.spec.alpha * .58);
  const localRain = effects(["VCSN", "RA"]);
  assert.equal(localRain.spec.secondary.type, "rain");
  close(localRain.spec.secondary.alpha, local.spec.alpha);
});

test("explicit visual overrides do not change normalized observation input", () => {
  const observation = deepFreeze(input({ phenomena: ["-RA"], intensity: "heavy", paneDrops: false }));
  const before = JSON.stringify(observation);
  const result = buildWeatherEffects(observation);
  assert.equal(JSON.stringify(observation), before);
  assert.equal(result.fx.intensity, "heavy");
  assert.equal(result.spec.pane, null);
  assert.equal(result.spec.count, effects(["+RA"]).spec.count);
  const paneOnly = effects([], { paneDrops: true });
  assert.equal(paneOnly.fx.precip, "none");
  assert.equal(paneOnly.spec.count, 0);
  assert.ok(paneOnly.spec.pane);
});

test("winter and mixed families preserve their distinct shapes, bands and secondary particles", () => {
  const cases = [
    ["SN", "snow", "flake", "full"],
    ["SHSN", "snow-shower", "flake", "full"],
    ["BLSN", "blowing-snow", "grain", "lower"],
    ["DRSN", "drifting-snow", "grain", "surface"],
    ["SG", "snow-grains", "grain", "full"],
    ["IC", "ice-crystals", "crystal", "full"],
    ["PL", "ice-pellets", "pellet", "full"],
    ["GR", "hail", "hail", "full"],
    ["GS", "small-hail", "pellet", "full"],
  ];
  for (const [token, type, shape, band] of cases) {
    const result = effects([token]);
    assert.equal(result.spec.type, type, token);
    assert.equal(result.spec.shape, shape, token);
    assert.equal(result.spec.band, band, token);
    assert.equal(result.spec.pane, null, token);
    assert.equal(result.atmosphere.lightningLevel, "none", token);
    assert.ok(result.spec.count > 0, token);
  }
  const mixed = effects(["RASN"]);
  assert.equal(mixed.spec.type, "snow");
  assert.equal(mixed.spec.secondary.type, "rain");
  assert.ok(mixed.spec.secondary.count > 0);
  assert.ok(mixed.spec.pane);
  const blowing = effects(["SN", "BLSN"]);
  assert.equal(blowing.spec.type, "snow");
  assert.equal(blowing.spec.secondary.type, "blowing-snow");
  assert.equal(blowing.spec.secondary.band, "lower");
  for (const token of ["FZRA", "FZDZ"]) {
    const frozen = effects([token]);
    assert.equal(frozen.spec.pane.freezing, true);
    assert.equal(frozen.spec.pane.profile, "freezing");
    assert.equal(frozen.atmosphere.lightningLevel, "none");
  }
});

test("fog, mist, haze, smoke and ground fog retain different atmospheric identities", () => {
  const cases = [["FG", "fog"], ["BR", "mist"], ["HZ", "haze"], ["FU", "smoke"], ["FZFG", "freezing-fog"], ["MIFG", "shallow-fog"], ["BCFG", "patchy-fog"], ["PRFG", "partial-fog"]];
  for (const [token, type] of cases) {
    const result = effects([token], { visibility: 1 });
    assert.equal(result.obscuration.type, type, token);
    assert.equal(result.atmosphere.obscuration, type, token);
    assert.equal(result.atmosphere.density, result.obscuration.density);
    assert.equal(result.atmosphere.horizon, result.obscuration.horizon);
    assert.equal(result.spec, null, `${token} is atmospheric, not falling precipitation`);
    assert.ok(result.atmosphere.density > 0);
  }
  const highVisibility = effects(["FG"], { visibility: 5 });
  const lowVisibility = effects(["FG"], { visibility: .5 });
  assert.ok(lowVisibility.atmosphere.density > highVisibility.atmosphere.density);
  assert.ok(lowVisibility.atmosphere.veil > highVisibility.atmosphere.veil);
  assert.ok(lowVisibility.atmosphere.horizon > highVisibility.atmosphere.horizon);
  assert.ok(effects(["MIFG"], { visibility: .5 }).atmosphere.veil < lowVisibility.atmosphere.veil);
});

test("dust, sand and ash pass through as atmosphere rather than invented rain", () => {
  for (const [token, type] of [["DU", "dust"], ["BLDU", "blowing-dust"], ["DRDU", "drifting-dust"], ["SA", "sand"], ["BLSA", "blowing-sand"], ["DRSA", "drifting-sand"], ["DS", "dust-storm"], ["SS", "sandstorm"], ["PO", "dust-whirl"], ["VA", "volcanic-ash"]]) {
    const result = effects([token], { visibility: 1, windSpeed: 30 });
    assert.equal(result.atmosphere.obscuration, type, token);
    assert.equal(result.spec, null, token);
    assert.equal(result.atmosphere.lightningLevel, "none", token);
  }
});

test("wind projection uses meteorological FROM-to-TO direction and calm is stationary", () => {
  for (const [direction, x, y] of [[0, 0, 1], [360, 0, 1], [90, -1, 0], [180, 0, -1], [270, 1, 0]]) {
    const wind = projectWind(direction, 20, 30);
    close(wind.x, x, `${direction}° horizontal component`);
    close(wind.y, y, `${direction}° vertical component`);
    assert.equal(wind.speed, 20);
    close(wind.gust, 10 / 35);
  }
  assert.deepEqual(projectWind(270, 0, null), { x: 0, y: 0, speed: 0, gust: 0 });
  assert.deepEqual(projectWind(null, 12, null), { x: .22, y: 0, speed: 12, gust: 0 });
  const north = effects(["RA"], { windDirection: 0 });
  const west = effects(["RA"], { windDirection: 270 });
  const east = effects(["RA"], { windDirection: 90 });
  close(north.spec.vx, 0);
  assert.ok(west.spec.vx > 0);
  assert.ok(east.spec.vx < 0);
  close(west.spec.vx, -east.spec.vx);
  assert.equal(effects(["RA"], { windSpeed: 0 }).spec.vx, 0);
});

test("invalid numerical input stays finite and bounded", () => {
  for (const direction of [null, NaN, Infinity, -Infinity, -720, 720]) {
    for (const speed of [NaN, Infinity, -20, 0, 300]) {
      for (const gust of [null, NaN, Infinity, -10, 500]) {
        const wind = projectWind(direction, speed, gust);
        assertFiniteNumbers(wind);
        assert.ok(wind.speed >= 0 && wind.speed <= 80);
        assert.ok(wind.gust >= 0 && wind.gust <= 1);
        assert.ok(Math.abs(wind.x) <= 1 && Math.abs(wind.y) <= 1);
      }
    }
  }
  for (const visibility of [NaN, Infinity, -10, 200]) {
    const result = effects(["+RA", "FG"], { visibility, ceiling: NaN, windDirection: NaN, windSpeed: NaN, gust: NaN });
    assertFiniteNumbers(result);
    assert.ok(result.atmosphere.ceiling >= 0);
  }
});

test("only fresh, available observed thunderstorms activate atmospheric lightning", () => {
  const station = parseCurrentLightning("METAR KMEM 151653Z 27012KT 3SM TSRA BKN020CB 20/19 A2992");
  const severe = parseCurrentLightning("METAR KMEM 151653Z 27020KT 1SM +TSRA BKN010CB 20/19 A2992");
  assert.equal(effects(["TSRA"], { lightning: station }).atmosphere.lightningLevel, "station");
  assert.equal(effects(["+TSRA"], { lightning: severe }).atmosphere.lightningLevel, "severe");
  assert.ok(effects(["+TSRA"], { lightning: severe }).atmosphere.storm > effects(["TSRA"], { lightning: station }).atmosphere.storm);
  for (const lightning of [
    { ...station, isStale: true },
    { ...station, isUnavailable: true },
    { ...station, source: "none" },
    parseCurrentLightning("METAR KMEM 151653Z 27012KT 10SM SCT050 RMK FRQ LTGCG DSNT W"),
    parseCurrentLightning("TAF KMEM 151600Z 1518/1624 27012KT 3SM TSRA BKN020CB"),
  ]) assert.equal(effects([], { lightning }).atmosphere.lightningLevel, "none");
  const staleWithThunder = effects(["TSRA"], { lightning: { ...station, isStale: true } });
  assert.equal(staleWithThunder.atmosphere.lightningLevel, "none");
  assert.ok(staleWithThunder.atmosphere.storm > 0, "reported storm character may remain while flashes are suppressed");
});

test("unavailable observations clear all weather effects even with forced pane and lightning data", () => {
  const result = effects(["+TSRA", "FG"], {
    available: false, coverage: "OVC", paneDrops: true,
    lightning: debugLightningReport("severe"),
  });
  assert.equal(result.fx.precip, "none");
  assert.equal(result.spec, null);
  assert.equal(result.obscuration.type, "none");
  assert.equal(result.atmosphere.coverage, 0);
  assert.equal(result.atmosphere.storm, 0);
  assert.equal(result.atmosphere.density, 0);
  assert.equal(result.atmosphere.veil, 0);
  assert.equal(result.atmosphere.lightningLevel, "none");
});

test("forecast-only properties cannot activate present weather effects", () => {
  const result = effects([], { forecast: [{ phenomena: ["+TSRA"], condition: "thunderstorm" }], tafHazards: [{ weather: { code: "+TSRA" } }] });
  assert.equal(result.spec, null);
  assert.equal(result.atmosphere.storm, 0);
  assert.equal(result.atmosphere.lightningLevel, "none");
});

test("low quality and reduced-motion specs retain identity with bounded work", () => {
  for (const token of ["+RA", "SHRA", "+SN", "SHSN", "RASN", "PL", "FZRA"]) {
    const full = effects([token]);
    const low = effects([token], { quality: "low" });
    const reduced = effects([token], { reduced: true });
    assert.equal(low.spec.type, full.spec.type, token);
    assert.ok(low.spec.totalCount <= 240, token);
    assert.ok(low.spec.totalCount < full.spec.totalCount, token);
    assert.equal(low.atmosphere.quality, "low");
    assert.equal(reduced.spec.reduced, true);
    assert.equal(reduced.atmosphere.reduced, true);
    assert.equal(reduced.spec.near, false);
    assert.equal(reduced.spec.burst, false, `${token} must not modulate in reduced motion`);
    assert.ok(reduced.spec.totalCount < full.spec.totalCount, token);
  }
  const reducedFog = effects(["FG"], { reduced: true });
  assert.equal(reducedFog.obscuration.duration, 0);
  assert.ok(reducedFog.atmosphere.density > 0);
});

test("all named weather demos produce valid explicit effect states", () => {
  const labels = WEATHER_DEMOS.map(demo => demo.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const label of ["Clear", "Partly cloudy", "Overcast", "Light rain", "Heavy rain", "Thunderstorm", "Severe thunderstorm", "Fog", "Snow", "Blowing snow", "High winds"]) assert.ok(labels.includes(label), label);
  for (const demo of WEATHER_DEMOS) {
    const lightning = debugLightningReport(demo.lightning);
    assert.ok(lightning, demo.label);
    const result = effects(demo.phenomena.split(/\s+/).filter(Boolean), {
      coverage: demo.coverage, visibility: demo.visibility,
      windSpeed: demo.speed, gust: demo.gust, lightning,
    });
    assertFiniteNumbers(result);
    if (demo.lightning === "none") assert.equal(result.atmosphere.lightningLevel, "none", demo.label);
    if (!demo.phenomena) assert.equal(result.spec, null, demo.label);
  }
});

test("controller remains pure, deterministic and independent of clock, network and browser state", () => {
  const observation = deepFreeze(input({ phenomena: ["RASN", "BR"], coverage: "BKN", visibility: 2, lightning: { ...NO_LIGHTNING } }));
  const before = JSON.stringify(observation);
  const first = buildWeatherEffects(observation);
  assert.deepEqual(first, buildWeatherEffects(observation));
  assert.equal(JSON.stringify(observation), before);
  const source = readFileSync(new URL("../app/weatherController.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:document|window|localStorage|navigator)\./);
  assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval|requestAnimationFrame|useState|useEffect)\s*\(/);
  assert.doesNotMatch(source, /from\s+["'][^"']*useClock/);
});
