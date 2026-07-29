import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { sceneFor, sceneForEffects } from "../app/wallpaper.ts";
import { resolveOperationalWeather } from "../app/aviationWeatherPriority.ts";

const phases=["day","night","sunrise","sunset"];
const conditions=["clear","partly-cloudy","overcast","rain","heavy-rain","thunderstorm","snow","fog","neutral"];
const obscurations=["none","mist","fog","freezing-fog","shallow-fog","patchy-fog","partial-fog","haze","smoke","dust","blowing-dust","drifting-dust","sand","blowing-sand","drifting-sand","dust-storm","sandstorm","dust-whirl","volcanic-ash"];
const light=phase=>phase==="night"?"night":"day";
const assetExists=scene=>existsSync(new URL(`../public/assets/backgrounds/${scene}.png`,import.meta.url));

test("all normalized conditions select an existing phase-correct wallpaper",()=>{
  const expected={
    clear:{day:"clear-day",night:"clear-night",sunrise:"sunrise",sunset:"sunset"},
    "partly-cloudy":{day:"partly-cloudy-day",night:"partly-cloudy-night",sunrise:"sunrise",sunset:"sunset"},
    overcast:Object.fromEntries(phases.map(p=>[p,`overcast-${light(p)}`])),
    rain:Object.fromEntries(phases.map(p=>[p,`rain-${light(p)}`])),
    "heavy-rain":Object.fromEntries(phases.map(p=>[p,`rain-${light(p)}`])),
    thunderstorm:Object.fromEntries(phases.map(p=>[p,`thunderstorm-${light(p)}`])),
    snow:Object.fromEntries(phases.map(p=>[p,`snow-${light(p)}`])),
    fog:Object.fromEntries(phases.map(p=>[p,`fog-${light(p)}`])),
    neutral:{day:"clear-day",night:"clear-night",sunrise:"sunrise",sunset:"sunset"},
  };
  for(const [condition,byPhase] of Object.entries(expected)) for(const phase of phases) {
    const scene=sceneFor(condition,phase);
    assert.equal(scene,byPhase[phase],`${condition}/${phase}`);
    assert.equal(assetExists(scene),true,scene);
  }
});

test("every condition, phase, and obscuration combination resolves to an existing wallpaper",()=>{
  for(const condition of conditions) for(const phase of phases) for(const obscuration of obscurations) {
    const scene=sceneForEffects(sceneFor(condition,phase),obscuration,0.75,phase,"BKN");
    assert.equal(assetExists(scene),true,`${condition}/${phase}/${obscuration} -> ${scene}`);
  }
});

test("+TSRA resolves to thunderstorm wallpaper for every solar phase",()=>{
  const weather=resolveOperationalWeather({text:"METAR KMEM 251853Z 22022G38KT 1SM +TSRA BR BKN015CB 30/24 A2988",visibilitySm:1,cloudCoverage:"BKN",cloudBaseFt:1500,cloudSummary:"BKN 1,500 FT",sourceKind:"METAR"});
  assert.equal(weather.condition,"thunderstorm");
  for(const phase of phases) assert.equal(sceneForEffects(sceneFor(weather.condition,phase),"mist",1,phase,"BKN"),`thunderstorm-${light(phase)}`);
});

test("obscuration cannot replace higher-priority precipitation or thunderstorm wallpaper",()=>{
  for(const family of ["thunderstorm","rain","snow"]) for(const phase of phases) for(const obscuration of ["mist","fog","freezing-fog","haze","smoke","blowing-dust"]) {
    const base=sceneFor(family,phase);
    assert.equal(sceneForEffects(base,obscuration,0.5,phase,"BKN"),base,`${family}/${phase}/${obscuration}`);
  }
});

test("cloud and obscuration scenes stay phase-correct",()=>{
  assert.equal(sceneFor("partly-cloudy","sunrise"),"sunrise");
  assert.equal(sceneFor("partly-cloudy","sunset"),"sunset");
  assert.equal(sceneFor("overcast","sunset"),"overcast-day");
  assert.equal(sceneForEffects("fog-day","fog",2,"day","OVC"),"overcast-day");
  assert.equal(sceneForEffects("fog-night","fog",0.5,"night","OVC"),"fog-night");
  assert.equal(sceneForEffects("fog-day","haze",4,"day","SCT"),"partly-cloudy-day");
});

test("partly cloudy golden-hour regression uses sunrise and sunset photography",()=>{
  assert.equal(sceneFor("partly-cloudy","sunrise","SCT"),"sunrise");
  assert.equal(sceneFor("partly-cloudy","sunset","SCT"),"sunset");
  assert.equal(sceneForEffects("sunrise","none",10,"sunrise","SCT"),"sunrise");
  assert.equal(sceneForEffects("sunset","none",10,"sunset","SCT"),"sunset");
});

test("successful wallpaper load still commits when decode rejects",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/img\.decode\(\)\.then\(commit\)\.catch\(commit\)/);
  assert.match(page,/data-wallpaper-scene=\{activeWallpaper\}/);
  assert.match(page,/data-wallpaper-requested=\{scene\}/);
});
