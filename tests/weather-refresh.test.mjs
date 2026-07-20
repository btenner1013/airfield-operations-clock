import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyMetarFreshness,
  classifyTafFreshness,
  createRefreshCoordinator,
  installWeatherRefreshLifecycle,
  mergeWeather,
  parseMetarObservedAt,
  parseTafTimes,
  restoreWeatherCache,
  serializeWeatherCache,
} from "../app/weatherRefresh.ts";

const iso="2026-07-20T06:00:00.000Z";
function weather(overrides={}) {
  return {
    temperatureF:80,feelsLikeF:84,condition:"clear",description:"Clear",windSpeedKt:6,windDirection:"S",windDegrees:180,windGustKt:null,humidity:55,
    sunriseLocal:"06:00",sunsetLocal:"20:10",solarDays:[{date:"2026-07-20",sunriseLocal:"06:00",sunsetLocal:"20:10"}],observationTime:iso,
    forecast:[{time:"09:00",iso:"2026-07-20T14:00:00.000Z",temperatureF:82,condition:"clear",description:"Clear",precipitation:0,source:"TAF",operationalWeather:null}],operationalWeather:null,currentLightning:{level:"none",source:"none",code:null,frequency:null,types:[],directions:[],awareness:null},tafHazards:[],
    birdRisk:"LOW",birdBasis:"AHAS",birdUpdated:iso,source:"METAR",cloudCoverage:"CLR",cloudBaseFt:null,visibilitySm:10,phenomena:[],
    metarObsIso:iso,tafIssueIso:"2026-07-20T05:00:00.000Z",tafValidStartIso:"2026-07-20T06:00:00.000Z",tafValidEndIso:"2026-07-21T12:00:00.000Z",
    metarFetchStatus:"OK",tafFetchStatus:"OK",bwcFetchStatus:"OK",feedStatus:"OK",requestStatus:"IDLE",lastRefreshAttemptIso:iso,lastRefreshSuccessIso:iso,feedError:null,
    ...overrides,
  };
}

test("METAR freshness uses observation age with an inclusive 75-minute boundary",()=>{
  const now=Date.parse("2026-07-20T08:00:00.000Z");
  for(const minutes of [5,60,75]) assert.equal(classifyMetarFreshness(new Date(now-minutes*60000).toISOString(),now).state,"CURRENT");
  assert.equal(classifyMetarFreshness(new Date(now-76*60000).toISOString(),now).state,"STALE");
  assert.deepEqual(classifyMetarFreshness(null,now),{state:"UNAVAILABLE",ageMinutes:null});
  assert.deepEqual(classifyMetarFreshness("invalid",now),{state:"UNAVAILABLE",ageMinutes:null});
});

test("METAR DDHHMMZ resolves the previous UTC day and previous month",()=>{
  assert.equal(parseMetarObservedAt("KMEM 192355Z 00000KT 10SM CLR",undefined,new Date("2026-07-20T00:05:00Z")),"2026-07-19T23:55:00.000Z");
  assert.equal(parseMetarObservedAt("KMEM 302355Z 00000KT 10SM CLR",undefined,new Date("2026-07-01T00:05:00Z")),"2026-06-30T23:55:00.000Z");
  assert.equal(parseMetarObservedAt("KMEM BAD",undefined,new Date("2026-07-20T00:05:00Z")),null);
});

test("TAF issue and validity states cover current, pending, expired, midnight, and month end",()=>{
  const current=parseTafTimes("TAF KMEM 200500Z 2006/2112 18006KT P6SM SKC",new Date("2026-07-20T07:00:00Z"));
  assert.deepEqual(current,{issueIso:"2026-07-20T05:00:00.000Z",validStartIso:"2026-07-20T06:00:00.000Z",validEndIso:"2026-07-21T12:00:00.000Z"});
  assert.equal(classifyTafFreshness(current,Date.parse("2026-07-20T07:00:00Z")),"CURRENT");
  assert.equal(classifyTafFreshness(current,Date.parse("2026-07-20T05:30:00Z")),"PENDING");
  assert.equal(classifyTafFreshness(current,Date.parse("2026-07-21T12:00:00Z")),"EXPIRED");
  const midnight=parseTafTimes("TAF KMEM 202200Z 2023/2106 18006KT P6SM SKC",new Date("2026-07-20T22:30:00Z"));
  assert.equal(midnight.validEndIso,"2026-07-21T06:00:00.000Z");
  const monthEnd=parseTafTimes("TAF KMEM 312300Z 0100/0206 18006KT P6SM SKC",new Date("2026-07-31T23:20:00Z"));
  assert.deepEqual(monthEnd,{issueIso:"2026-07-31T23:00:00.000Z",validStartIso:"2026-08-01T00:00:00.000Z",validEndIso:"2026-08-02T06:00:00.000Z"});
  assert.equal(classifyTafFreshness(parseTafTimes("TAF KMEM BAD",new Date()),Date.now()),"UNAVAILABLE");
});

test("failed or partial refresh preserves independent last-valid METAR and TAF data",()=>{
  const previous=weather({operationalWeather:{category:"clear",condition:"clear"},currentLightning:{level:"station",source:"metar-body",code:"TS",frequency:null,types:[],directions:[],awareness:"TS OVR FIELD"},tafHazards:[{id:"tempo",fromIso:"2026-07-20T07:00:00.000Z",toIso:"2026-07-20T09:00:00.000Z",weather:{category:"thunderstorm",condition:"thunderstorm"}}]});
  const modelOnly=weather({temperatureF:65,feelsLikeF:68,humidity:88,condition:"rain",description:"Model rain",source:"MODEL",metarObsIso:null,tafIssueIso:null,tafValidStartIso:null,tafValidEndIso:null,forecast:[],feedStatus:"DEGRADED"});
  const merged=mergeWeather(previous,{weather:modelOnly,metarValid:false,tafValid:false,modelValid:true,feedReached:false});
  assert.equal(merged.temperatureF,80);
  assert.equal(merged.condition,"clear");
  assert.equal(merged.operationalWeather,previous.operationalWeather);
  assert.equal(merged.currentLightning,previous.currentLightning);
  assert.equal(merged.metarObsIso,previous.metarObsIso);
  assert.deepEqual(merged.forecast,previous.forecast);
  assert.deepEqual(merged.tafHazards,previous.tafHazards);
  assert.equal(merged.tafValidEndIso,previous.tafValidEndIso);
  assert.equal(merged.feelsLikeF,68);
  assert.equal(merged.humidity,88);
  assert.equal(merged.feedStatus,"DEGRADED");
});

test("validated cache restores; malformed or partial cache cannot replace it",()=>{
  const snapshot=weather(), raw=serializeWeatherCache(snapshot,"2026-07-20T06:02:00.000Z");
  assert.ok(raw);
  const restored=restoreWeatherCache(raw);
  assert.equal(restored?.metarObsIso,snapshot.metarObsIso);
  assert.equal(restored?.feedStatus,"DEGRADED");
  assert.equal(restoreWeatherCache("{bad"),null);
  assert.equal(restoreWeatherCache(JSON.stringify({version:1,savedAtIso:iso,weather:{condition:"clear"}})),null);
  const legacy=JSON.parse(JSON.stringify(snapshot));delete legacy.operationalWeather;delete legacy.currentLightning;delete legacy.tafHazards;for(const f of legacy.forecast) delete f.operationalWeather;
  const migrated=restoreWeatherCache(JSON.stringify({version:1,savedAtIso:iso,weather:legacy}));
  assert.equal(migrated?.operationalWeather,null);assert.equal(migrated?.currentLightning.level,"none");assert.deepEqual(migrated?.tafHazards,[]);assert.equal(migrated?.forecast[0].operationalWeather,null);
});

class FakeTarget {
  constructor(){this.listeners=new Map();}
  addEventListener(name,fn){const set=this.listeners.get(name)||new Set();set.add(fn);this.listeners.set(name,set);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name){for(const fn of this.listeners.get(name)||[]) fn();}
  count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}

test("one lifecycle owns initial, interval, focus, visibility, pageshow, online, and cleanup",()=>{
  const win=new FakeTarget(), doc=new FakeTarget();doc.visibilityState="visible";let intervalFn=null,cleared=false;win.setInterval=fn=>{intervalFn=fn;return 7;};win.clearInterval=id=>{assert.equal(id,7);cleared=true;};
  const reasons=[];const cleanup=installWeatherRefreshLifecycle(reason=>reasons.push(reason),120000,win,doc);
  assert.deepEqual(reasons,["initial"]);intervalFn();win.fire("focus");doc.fire("visibilitychange");win.fire("pageshow");win.fire("online");
  assert.deepEqual(reasons,["initial","interval","focus","visible","pageshow","online"]);
  cleanup();assert.equal(cleared,true);assert.equal(win.count()+doc.count(),0);
  win.fire("focus");assert.equal(reasons.length,6);
});

test("rapid wake events cancel and coalesce without overlapping requests",async()=>{
  let calls=0,active=0,maxActive=0;const resolvers=[];
  const coordinator=createRefreshCoordinator({
    fetcher:signal=>new Promise((resolve,reject)=>{calls++;active++;maxActive=Math.max(maxActive,active);const done=value=>{active--;resolve(value);};resolvers.push(done);signal.addEventListener("abort",()=>{active--;reject(new DOMException("aborted","AbortError"));},{once:true});}),
    onResult:()=>{},onError:()=>assert.fail("supersession is not a feed error"),timeoutMs:1000,
  });
  const first=coordinator.refresh("focus");void coordinator.refresh("visible");void coordinator.refresh("pageshow");
  await first;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);assert.equal(maxActive,1);resolvers.at(-1)("ok");await new Promise(resolve=>setImmediate(resolve));coordinator.stop();
});

test("timeout aborts, reports once, and stop prevents updates after unmount",async()=>{
  let errors=0,results=0,timedOut=false;
  const coordinator=createRefreshCoordinator({
    fetcher:signal=>new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true})),
    onResult:()=>results++,onError:(_error,_reason,_at,timeout)=>{errors++;timedOut=timeout;},timeoutMs:5,
  });
  await coordinator.refresh("initial");assert.equal(errors,1);assert.equal(timedOut,true);assert.equal(results,0);
  void coordinator.refresh("focus");coordinator.stop();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(errors,1);assert.equal(results,0);assert.equal(coordinator.isActive(),false);
});

test("protected clock, scene, precipitation, and service-worker invariants remain intact",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"), clock=readFileSync(new URL("../app/useClock.ts",import.meta.url),"utf8"), sw=readFileSync(new URL("../public/service-worker.js",import.meta.url),"utf8");
  assert.equal((page.match(/className="sky-base"/g)||[]).length,2);
  assert.equal((page.match(/<PrecipCanvas\b/g)||[]).length,1);
  assert.equal((page.match(/className="cloud-field"/g)||[]).length,1);
  assert.match(page,/const forecast:Forecast\[\]=\[2,5,8\]/);
  assert.match(page,/condition:metar\?\.condition\?\?model\.condition/);
  assert.doesNotMatch(clock,/from\s+["'][^"']*weather/i);
  const weatherBranch=sw.slice(sw.indexOf("if(url.hostname"),sw.indexOf("e.respondWith(fetch(e.request)"));
  assert.match(weatherBranch,/weather\.json/);assert.match(weatherBranch,/cache:\s*"no-store"/);assert.doesNotMatch(weatherBranch,/caches\.match|caches\.open/);
});
