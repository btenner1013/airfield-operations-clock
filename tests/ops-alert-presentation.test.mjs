import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/layout-tuning.css",import.meta.url),"utf8");

test("WX alert band consumes one normalized Ops Board display result",()=>{
  assert.match(page,/const alertDisplay=resolveWxAlertDisplay\(/);
  assert.match(page,/alertDisplay\.shouldPulse/);
  assert.match(page,/alertDisplay\.shouldFlash/);
  assert.match(page,/alertDisplay\.colorClass\.replace\("alert-",""\)/);
  assert.match(page,/data-tone=\{hazardTone\}/);
  assert.doesNotMatch(page,/weather\.wxAlertVisible\?weather\.wxAlertTone:lightning\.tone/);
  assert.doesNotMatch(page,/taf-hazard-band[^\n]+style=\{\{/);
});

test("clock uses the Ops Board alert palette, font, and timing",()=>{
  assert.match(css,/\.taf-hazard-band\[data-tone="blue"\][^{]*\{[^}]*#35b7ff/);
  assert.match(css,/\.taf-hazard-band\[data-tone="yellow"\][^{]*\{[^}]*#ffcc00/);
  assert.match(css,/\.taf-hazard-band\[data-tone="red"\][^{]*\{[^}]*#ff4444/);
  assert.match(css,/\.taf-hazard-band\.alert-pulse em\s*\{[^}]*opsAlertPulse 0\.82s/);
  assert.match(css,/\.taf-hazard-band\.alert-flash em\s*\{[^}]*opsAlertFlash 1s step-start/);
  assert.match(css,/@keyframes opsAlertFlash\s*\{[^}]*0% \{ opacity: 1; \}[^}]*50% \{ opacity: 0\.25; \}/s);
  assert.match(css,/\.taf-hazard-band em\s*\{[^}]*font-family: Arial, sans-serif/s);
  assert.match(css,/\.taf-hazard-band\s*\{[^}]*border: 1\.5px solid #333/s);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.taf-hazard-band\.alert-pulse em[\s\S]*animation: none !important/);
});
