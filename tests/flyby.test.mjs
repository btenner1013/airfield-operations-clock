import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFlybyWeatherAllowed, FLYBY_MINIMUM_CEILING_FT, FLYBY_MINIMUM_VISIBILITY_SM } from "../app/flyby.ts";

const VFR={cat:"VFR"};
const clear=over=>({visibilitySm:10,cloudCoverage:"CLR",cloudBaseFt:null,phenomena:[],currentLightning:{level:"none"},...over});

test("a clear VFR field launches the flyby",()=>{
  assert.equal(isFlybyWeatherAllowed(clear(),VFR),true);
  assert.equal(isFlybyWeatherAllowed(clear({cloudCoverage:"FEW",cloudBaseFt:4000}),VFR),true);
  // High thin cirrus in VFR still permits it; a low ceiling does not.
  assert.equal(isFlybyWeatherAllowed(clear({cloudCoverage:"BKN",cloudBaseFt:20000}),VFR),true);
  assert.equal(isFlybyWeatherAllowed(clear({cloudCoverage:"BKN",cloudBaseFt:FLYBY_MINIMUM_CEILING_FT}),VFR),true);
  assert.equal(isFlybyWeatherAllowed(clear({cloudCoverage:"BKN",cloudBaseFt:FLYBY_MINIMUM_CEILING_FT-100}),VFR),false);
  assert.equal(isFlybyWeatherAllowed(clear({cloudCoverage:"OVC",cloudBaseFt:3000}),VFR),false);
});

test("category and visibility minimums ground the flyby",()=>{
  for(const cat of ["MVFR","IFR","LIFR"]) assert.equal(isFlybyWeatherAllowed(clear(),{cat}),false);
  assert.equal(isFlybyWeatherAllowed(clear({visibilitySm:FLYBY_MINIMUM_VISIBILITY_SM}),VFR),true);
  assert.equal(isFlybyWeatherAllowed(clear({visibilitySm:FLYBY_MINIMUM_VISIBILITY_SM-1}),VFR),false);
  // An unreported visibility is not treated as a restriction.
  assert.equal(isFlybyWeatherAllowed(clear({visibilitySm:null}),VFR),true);
});

test("only lightning near the field grounds the flyby, not a distant report",()=>{
  // DSNT is 10 NM or more out; it used to suppress every pass.
  assert.equal(isFlybyWeatherAllowed(clear({currentLightning:{level:"distant"}}),VFR),true);
  for(const level of ["vicinity","station","severe"]) {
    assert.equal(isFlybyWeatherAllowed(clear({currentLightning:{level}}),VFR),false);
  }
});

test("suppression reads parsed body tokens, not raw remark text",()=>{
  // Compound tokens matched no word-boundary alternative under the old raw-METAR regex.
  for(const token of ["TSRA","+TSRA","-RA","RA","SN","BR","FG","VCTS","SHRA","GR"]) {
    assert.equal(isFlybyWeatherAllowed(clear({phenomena:[token]}),VFR),false,`${token} should ground it`);
  }
  // Remarks describing an ended or distant storm no longer decide the outcome; with an
  // empty body the field is clear and the pass launches.
  const endedStorm=clear({rawMetar:"SPECI KMEM 172244Z 10005KT 10SM BKN200 BKN250 RMK TSB05E43 OCNL LTGCA DSNT SE",currentLightning:{level:"distant"}});
  assert.equal(isFlybyWeatherAllowed(endedStorm,VFR),true);
});

test("the launch decision is made once at spawn, never re-read mid-transit",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  // Render must not gate on weather, or a refresh mid-pass makes the aircraft vanish.
  assert.match(page,/\{activeFlyby && debugFlybyEnabled !== false && \(/);
  assert.doesNotMatch(page,/isFlybyWeatherAllowed\(weather, flightCat\) \|\| debugFlybyEnabled/);
  assert.match(page,/if \(debugFlybyEnabled === true \|\| flybyAllowedRef\.current\) triggerSpawn\(\);/);
  // A skipped slot must re-arm, otherwise blocked weather ends the schedule permanently.
  assert.match(page,/else setFlybySlot\(slot => slot \+ 1\);/);
  assert.match(page,/\}, \[activeFlyby, debugFlybyEnabled, triggerSpawn, flybySlot\]\);/);
  // Cadence is deliberately unchanged: a 15-30s gap around a 12-18s transit.
  assert.match(page,/const delayMs = 15000 \+ Math\.random\(\) \* 15000;/);
  assert.match(page,/const duration = 12 \+ Math\.random\(\) \* 6;/);
});
