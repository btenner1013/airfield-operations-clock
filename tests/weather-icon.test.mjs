import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/WeatherIcon.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/weather-icons.css", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", code)(require, mod, mod.exports);
const { default: WeatherIcon, resolveWeatherIconFamily: family } = mod.exports;
const render = (codes, condition = "fog", night = false) => renderToStaticMarkup(React.createElement(WeatherIcon, { condition, night, codes }));
const expected = {
  FU: "smoke", HZ: "haze", DU: "dust", SA: "sand", DS: "dust-storm", SS: "sandstorm",
  BLDU: "blowing-dust", DRDU: "drifting-dust", BLSA: "blowing-sand", DRSA: "drifting-sand",
  VA: "volcanic-ash", PO: "dust-whirls", PY: "spray", PL: "ice-pellets", GR: "hail", GS: "small-hail",
  FZRA: "freezing-rain", FZDZ: "freezing-drizzle", RASN: "rain-snow", SNRA: "rain-snow",
  FZFG: "freezing-fog", SG: "snow-grains", IC: "ice-crystals", BLSN: "blowing-snow", DRSN: "drifting-snow",
  DZ: "drizzle", SQ: "squall", FC: "funnel-cloud", "+FC": "tornado", UP: "unknown-precipitation", VCSH: "unknown-precipitation",
};

test("actual source SVG covers obscuration, frozen precipitation and non-lightning convection", () => {
  for (const [token, expectedFamily] of Object.entries(expected)) {
    assert.equal(family("thunderstorm", [token]), expectedFamily, token);
    for (const night of [false, true]) {
      const html = render([token], "thunderstorm", night);
      assert.match(html, new RegExp(`data-family="${expectedFamily}"`), `${token}: family`);
      assert.match(html, /<svg[^>]+viewBox="0 0 108 82"/, `${token}: actual source SVG`);
      assert.match(html, /aria-hidden="true"/, `${token}: decorative with neighboring textual label`);
      assert.doesNotMatch(html, /wxp-bolt|wxp-thunderstorm|<text|NaN|undefined/, `${token}: no invented lightning or text glyph`);
    }
  }
});

test("smoke, haze and fog cannot collapse into the same icon", () => {
  assert.match(render(["FU"]), /data-part="smoke-plumes"/);
  assert.doesNotMatch(render(["FU"]), /data-part="cloud"|fog-lines|data-part="haze"/);
  assert.match(render(["HZ"]), /data-part="haze"/);
  assert.doesNotMatch(render(["HZ"]), /data-part="cloud"|fog-lines|smoke-plumes/);
  for (const token of ["FG", "BR", "MIFG", "BCFG", "PRFG", "VCFG"]) {
    assert.equal(family("neutral", [token]), "fog", token);
    assert.match(render([token]), /wxp-fog-lines/);
  }
});

test("suspended, blowing, drifting, and storm dust or sand have truthful separate geometry", () => {
  for (const token of ["DU", "SA"]) {
    assert.match(render([token]), /data-part="suspended-particles"/);
    assert.doesNotMatch(render([token]), /data-part="wind"/);
  }
  for (const token of ["BLDU", "BLSA"]) {
    assert.match(render([token]), /data-part="wind"/);
    assert.doesNotMatch(render([token]), /translate\(0 20\)|suspended-particles/);
  }
  for (const token of ["DRDU", "DRSA"]) assert.match(render([token]), /translate\(0 20\) scale\(1 \.65\)/);
  for (const token of ["DS", "SS"]) assert.match(render([token]), /M11 7C-1 29 6 60 13 79/);
  assert.notEqual(render(["DU"]), render(["SA"]));
});

test("compound frozen precipitation is depicted without a lightning bolt", () => {
  for (const token of ["-PL", "+PL", "SHGR", "SHGS", "VCSHGR", "+FZRA", "-FZDZ", "SHRASN", "-SNRA"]) {
    const html = render([token], "thunderstorm");
    assert.match(html, /wxp-source-svg/);
    assert.doesNotMatch(html, /wxp-bolt|wxp-thunderstorm/);
  }
  assert.match(render(["RASN"]), /data-part="rain"/);
  assert.match(render(["RASN"]), /data-part="ice-crystal"/);
  for (const token of ["FZRA", "FZDZ"]) {
    assert.match(render([token]), /data-part="ice-glaze"/);
    assert.match(render([token]), /data-part="ice-crystal"/);
  }
  assert.equal(family("snow", ["RA", "SN"]), "rain-snow");
  assert.equal(family("snow", ["SN", "RA"]), "rain-snow");
});

test("only a complete actual thunderstorm descriptor produces the lightning theme", () => {
  for (const token of ["TS", "VCTS", "TSRA", "-TSRA", "+TSRAGR", "TSGS", "TSSN", "VCTSRA"]) {
    assert.equal(family("rain", [token]), "thunderstorm", token);
    assert.match(render([token], "rain"), /wxp-thunderstorm /);
  }
  for (const token of ["GR", "GS", "SHGR", "SHGS", "FC", "+FC", "VCFC", "SQ"]) assert.notEqual(family("thunderstorm", [token]), "thunderstorm", token);
  assert.equal(family("fog", ["FU", "VCTS"]), "thunderstorm");
  assert.equal(family("thunderstorm", ["+FC", "TSRA"]), "tornado");
  assert.equal(family("thunderstorm", ["TSRA", "FC"]), "funnel-cloud");
  assert.doesNotMatch(render(["+FC", "TSRA"], "thunderstorm"), /wxp-bolt|wxp-thunderstorm/);
});

test("weather words and malformed fragments never pass for valid aviation codes", () => {
  for (const token of ["", "FUEL", "GRADUAL", "FALSE", "SQUALL", "VOLCANIC ASH", "TS123", "NOTS", "TSRA RMK", "RA BR", "R", "FZ", "VC", "+VCFU", "+++RA", "TSRAGRZZ"]) {
    assert.equal(family("thunderstorm", [token]), "neutral", token);
    assert.match(render([token], "thunderstorm"), /wxp-neutral /);
  }
  assert.equal(family("fog", ["fu"]), "smoke");
  assert.equal(family("fog", ["  -RA  "]), "rain");
  assert.equal(family("fog", ["not-a-code", "FU"]), "smoke");
});

test("generic themes retain their established DOM, classes, and day/night behavior", () => {
  for (const theme of ["clear", "partly-cloudy", "overcast", "rain", "heavy-rain", "thunderstorm", "fog", "snow", "night", "sunrise", "sunset", "neutral"]) {
    for (const codes of [undefined, []]) {
      assert.equal(family(theme, codes), theme);
      const html = render(codes, theme);
      assert.match(html, new RegExp(`wxp-${theme} `));
      assert.match(html, /wxp-sun.*wxp-moon.*wxp-cloud.*wxp-precip.*wxp-flakes.*wxp-bolt.*wxp-fog-lines/);
      assert.doesNotMatch(html, /<svg/);
    }
  }
  assert.match(render(undefined, "clear", true), /wxp-night wxp-nighttime/);
  assert.match(render(undefined, "partly-cloudy", true), /wxp-partly-cloudy wxp-nighttime/);
  assert.equal(family("thunderstorm", ["RA"]), "rain");
  assert.equal(family("rain", ["+RA"]), "heavy-rain");
  assert.equal(family("rain", ["SHSN"]), "snow");
});

test("code-specific styles are static and scoped to the existing pictogram container", () => {
  assert.match(css, /\.wx-pictogram\.wxp-phenomenon \.wxp-source-svg/);
  assert.match(css, /width: 100%;/);
  assert.match(css, /height: 100%;/);
  assert.doesNotMatch(css, /@keyframes|animation:|font:|font-size:|\.clock|\.forecast-card/);
  assert.doesNotMatch(source, /setInterval|requestAnimationFrame|fetch\(|<text|dangerouslySetInnerHTML/);
});

test("night haze uses a subdued moon rather than the daytime sun", () => {
  assert.match(render(["HZ"], "fog", false), /data-part="haze-sun"/);
  assert.doesNotMatch(render(["HZ"], "fog", false), /data-part="haze-moon"/);
  assert.match(render(["HZ"], "fog", true), /data-part="haze-moon"/);
  assert.doesNotMatch(render(["HZ"], "fog", true), /data-part="haze-sun"/);
});


test("missing or malformed cached icon metadata cannot crash presentation", () => {
  for (const codes of [null, undefined, "FU", {}, [null, 4, {}]]) {
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(WeatherIcon, {condition:"neutral", codes})));
  }
});
