import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/layout-tuning.css",import.meta.url),"utf8");

test("WX alert band uses feed tone and feed motion without a yellow inline override",()=>{
  assert.match(page,/requestedTone=String\(weather\.wxAlertVisible\?weather\.wxAlertTone:lightning\.tone\)\.toLowerCase\(\)/);
  assert.match(page,/hazardFlash=weather\.wxAlertVisible\?weather\.wxAlertFlash:lightning\.flash/);
  assert.match(page,/hazardPulse=weather\.wxAlertVisible\?weather\.wxAlertPulse:lightning\.pulse/);
  assert.match(page,/data-tone=\{hazardTone\}/);
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
});
