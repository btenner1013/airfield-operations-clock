import test from "node:test";
import assert from "node:assert/strict";
import {
  OPS_ALERT_COLORS,
  OPS_ALERT_MOTION_MS,
  resolveLightningDisplay,
  resolveWxAlertDisplay,
} from "../app/alertPresentation.ts";

test("presentation tokens match the read-only Ops Board", () => {
  assert.deepEqual(OPS_ALERT_COLORS, {
    green: "#00ff88",
    blue: "#35b7ff",
    yellow: "#ffcc00",
    red: "#ff4444",
  });
  assert.deepEqual(OPS_ALERT_MOTION_MS, {
    weatherPulse: 820,
    lightningPulse: 950,
    flash: 1000,
  });
});

test("VCSH PSBL resolves to a static blue informational alert", () => {
  assert.deepEqual(resolveWxAlertDisplay({
    text: "🌧️ VCSH PSBL 29 JUL 05-06Z",
    sources: ["TAF"],
  }), {
    text: "VCSH PSBL 29 JUL 05-06Z",
    icon: "🌧️",
    severity: "informational",
    colorClass: "alert-blue",
    shouldPulse: false,
    shouldFlash: false,
  });
});

test("all Ops Board informational categories remain blue and static", () => {
  for (const category of ["rain", "drizzle", "shower", "mist", "haze"]) {
    const display = resolveWxAlertDisplay({ text: `${category} PSBL`, category, sources: "TAF" });
    assert.equal(display.colorClass, "alert-blue", category);
    assert.equal(display.severity, "informational", category);
    assert.equal(display.shouldPulse, false, category);
    assert.equal(display.shouldFlash, false, category);
  }
});

test("forecast high-impact alerts are yellow caution pulses", () => {
  for (const category of ["thunder", "freezing", "ice", "hail", "wind_shear", "tornado", "squall", "ash"]) {
    const display = resolveWxAlertDisplay({ text: `${category} PSBL`, category, sources: "TAF" });
    assert.equal(display.colorClass, "alert-yellow", category);
    assert.equal(display.severity, "caution", category);
    assert.equal(display.shouldPulse, true, category);
    assert.equal(display.shouldFlash, false, category);
  }
});

test("current high-impact alerts and current FZFG are red flashes", () => {
  for (const input of [
    { text: "TSRA OBS", sources: "METAR" },
    { text: "FZFG ATIS", sources: "ATIS" },
  ]) {
    const display = resolveWxAlertDisplay(input);
    assert.equal(display.colorClass, "alert-red");
    assert.equal(display.severity, "warning");
    assert.equal(display.shouldPulse, false);
    assert.equal(display.shouldFlash, true);
  }
});

test("heavy precipitation, snow, and ordinary fog use yellow caution pulses", () => {
  for (const input of [
    { text: "+RA PSBL", code: "+RA", category: "rain", sources: "TAF" },
    { text: "+SHRA OBS", code: "+SHRA", category: "shower", sources: "METAR" },
    { text: "+DZ PSBL", code: "+DZ", category: "drizzle", sources: "TAF" },
    { text: "+SN PSBL", code: "+SN", category: "snow", sources: "TAF" },
    { text: "SN PSBL", code: "SN", category: "snow", sources: "TAF" },
    { text: "FG OBS", code: "FG", category: "fog", sources: "METAR" },
  ]) {
    const display = resolveWxAlertDisplay(input);
    assert.equal(display.colorClass, "alert-yellow", input.text);
    assert.equal(display.severity, "caution", input.text);
    assert.equal(display.shouldPulse, true, input.text);
    assert.equal(display.shouldFlash, false, input.text);
  }
});

test("feed tone and motion are normalized once; reduced motion keeps the color", () => {
  const normal = resolveWxAlertDisplay({
    text: "🌧️ VCSH PSBL 05-06Z",
    tone: "blue",
    pulse: false,
    flash: false,
  });
  assert.equal(normal.colorClass, "alert-blue");
  assert.equal(normal.shouldPulse, false);

  const reduced = resolveWxAlertDisplay({
    text: "⛈️ TSRA OBS",
    tone: "red",
    flash: true,
    reducedMotion: true,
  });
  assert.equal(reduced.colorClass, "alert-red");
  assert.equal(reduced.severity, "warning");
  assert.equal(reduced.shouldPulse, false);
  assert.equal(reduced.shouldFlash, false);
});

test("partial WX feed input cannot create impossible tone/motion combinations", () => {
  const red = resolveWxAlertDisplay({ text: "TSRA OBS", tone: "red" });
  assert.equal(red.colorClass, "alert-red");
  assert.equal(red.shouldFlash, true);
  assert.equal(red.shouldPulse, false);

  const yellow = resolveWxAlertDisplay({ text: "VCTS PSBL", tone: "yellow" });
  assert.equal(yellow.colorClass, "alert-yellow");
  assert.equal(yellow.shouldPulse, true);
  assert.equal(yellow.shouldFlash, false);

  const visibleGreen = resolveWxAlertDisplay({ text: "VCSH PSBL", tone: "green" });
  assert.equal(visibleGreen.colorClass, "alert-blue");
  assert.equal(visibleGreen.severity, "informational");
});

test("no, distant, and vicinity lightning use green/yellow Ops Board states", () => {
  assert.deepEqual(resolveLightningDisplay({ level: "none", text: "NONE" }), {
    text: "NONE",
    severity: "none",
    colorClass: "lightning-green",
    shouldPulse: false,
    shouldFlash: false,
    isStale: false,
    isUnavailable: false,
    sourceTime: null,
  });

  for (const level of ["distant", "vicinity"]) {
    const display = resolveLightningDisplay({ level, text: level === "distant" ? "⚡ DSNT W" : "⚡ VCTS" });
    assert.equal(display.colorClass, "lightning-yellow", level);
    assert.equal(display.severity, "caution", level);
    assert.equal(display.shouldPulse, true, level);
    assert.equal(display.shouldFlash, false, level);
  }
});

test("active-field, station, and severe lightning are red flashes", () => {
  for (const level of ["active_field", "station", "severe"]) {
    const display = resolveLightningDisplay({ level, text: "⛈️ TS OVR FIELD" });
    assert.equal(display.colorClass, "lightning-red", level);
    assert.equal(display.severity, "warning", level);
    assert.equal(display.shouldPulse, false, level);
    assert.equal(display.shouldFlash, true, level);
  }
});

test("legacy lightning watch stays yellow and uses only supplied motion", () => {
  const still = resolveLightningDisplay({ level: "watch", text: "LIGHTNING WATCH" });
  assert.equal(still.colorClass, "lightning-yellow");
  assert.equal(still.shouldPulse, false);
  assert.equal(still.shouldFlash, false);

  const pulsing = resolveLightningDisplay({ level: "watch", text: "LIGHTNING WATCH", pulse: true });
  assert.equal(pulsing.colorClass, "lightning-yellow");
  assert.equal(pulsing.shouldPulse, true);
  assert.equal(pulsing.shouldFlash, false);
});

test("reduced motion disables lightning animation without changing severity color", () => {
  const caution = resolveLightningDisplay({ level: "vicinity", text: "⚡ VCTS", reducedMotion: true });
  assert.equal(caution.colorClass, "lightning-yellow");
  assert.equal(caution.shouldPulse, false);
  assert.equal(caution.shouldFlash, false);

  const warning = resolveLightningDisplay({ level: "active_field", text: "⛈️ TS OVR FIELD", reducedMotion: true });
  assert.equal(warning.colorClass, "lightning-red");
  assert.equal(warning.shouldPulse, false);
  assert.equal(warning.shouldFlash, false);
});

test("stale lightning retains its state while exposing diagnostics", () => {
  const display = resolveLightningDisplay({
    severity: "active_field",
    text: "⛈️ TS OVR FIELD",
    status: "STALE_LAST_GOOD",
    sourceTime: "2026-08-05T19:54:00Z",
  });
  assert.equal(display.colorClass, "lightning-red");
  assert.equal(display.shouldFlash, true);
  assert.equal(display.isStale, true);
  assert.equal(display.isUnavailable, false);
  assert.equal(display.sourceTime, "2026-08-05T19:54:00Z");
});

test("unavailable lightning uses NONE green and reports unavailability separately", () => {
  assert.deepEqual(resolveLightningDisplay({
    status: "FAILED_NO_LAST_GOOD",
    sourceTime: "2026-08-05T19:54:00Z",
  }), {
    text: "NONE",
    severity: "none",
    colorClass: "lightning-green",
    shouldPulse: false,
    shouldFlash: false,
    isStale: false,
    isUnavailable: true,
    sourceTime: "2026-08-05T19:54:00Z",
  });
});
