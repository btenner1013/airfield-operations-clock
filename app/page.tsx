"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { useSystemClock, type ClockDebug } from "./useClock";
import { buildFxSpec, buildObscurationSpec, classifyEffect, type Intensity } from "./weatherFx";
import PrecipCanvas from "./PrecipCanvas";
import PreviewLab from "./PreviewLab";
import { NO_LIGHTNING, compactLightningDisplay, debugLightningReport, lightningPlacement, parseCurrentLightning, type LightningLevel, type LightningReport, type LightningTone } from "./lightning";
import { useLightningScheduler } from "./useLightning";
import { applyStructuredTaf, extractAviationPhenomena, parseAviationSky, parseStructuredTaf, resolveOperationalWeather } from "./aviationWeatherPriority";
import { classifyMetarFreshness, classifyTafFreshness, createRefreshCoordinator, installWeatherRefreshLifecycle, mergeWeather, parseMetarObservedAt, parseTafTimes, restoreWeatherCache, serializeWeatherCache } from "./weatherRefresh";
import { calculateBirdObservationAge, formatBwcCalendarStamp, parseAhasTimestampIso } from "./birdWatch";
import type { CloudCoverage, Forecast, SolarDay, Theme, Weather, WeatherFetchResult } from "./weatherTypes";
import { sceneFor, sceneForEffects, type SolarPhase } from "./wallpaper";
import { isFlybyWeatherAllowed } from "./flyby";
import { parseStandardWind, resolveCurrentWind, resolveCurrentWindDisplay, type CurrentWindRecord } from "./currentWind";
import { formatForecastProbability, normalizeFutureSkyDisplay, normalizePrecipitationProbability } from "./futureWeather";
import { resolveLightningDisplay, resolveWxAlertDisplay } from "./alertPresentation";

type Phase = SolarPhase;
type DebugWindMode = "variable"|"calm"|"directional"|"gust"|"sector";
type DebugWxAlert = "none"|"info"|"caution"|"warning";
type OpsBoardWeather = {
  metar?:string;
  taf?:string;
  atisText?:string;
  atisFetchStatus?:string;
  atisObservedZ?:string;
  atisAgeMinutes?:number;
  metarFetchStatus?:string;
  tafFetchStatus?:string;
  metarObservedZ?:string;
  metarAgeMinutes?:number;
  bwc?:string;
  bwcAhasRisk?:string;
  bwcBasedOn?:string;
  bwcUpdatedZ?:string;
  bwcFetchStatus?:string;
  lightning?:string;
  lightningSeverity?:string;
  lightningTone?:string;
  lightningFlash?:boolean;
  lightningPulse?:boolean;
  lightningSource?:string;
  lightningLogText?:string;
  wxAlertText?:string;
  wxAlertTone?:string;
  wxAlertPulse?:boolean;
  wxAlertFlash?:boolean;
  wxAlertVisible?:boolean;
};
// Normalized scene object (Phase 2A): the single source of truth the renderer reads, kept
// deliberately separate from weather parsing so animation layers never re-parse METAR.
type SceneModel = { baseScene:string; cloudCoverage:CloudCoverage; cloudBaseFt:number|null; phenomena:string[]; intensity:"light"|"moderate"|"heavy"; vicinityOnly:boolean; windDirectionDeg:number|null; windSpeedKt:number; gustKt:number|null; visibilitySm:number|null; timePhase:Phase };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:2, opsBoardWeatherUrl:"https://btenner1013.github.io/kmem-ops-board/weather.json" };
const FALLBACK_WIND:CurrentWindRecord={directionType:"calm",directionDegrees:null,speedKt:0,gustKt:null,variableFromDegrees:null,variableToDegrees:null,source:"MODEL",observedAt:null,raw:"00000KT"};
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", currentWind:FALLBACK_WIND, humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", solarDays:[], observationTime:"", forecast:[], operationalWeather:null, currentLightning:{...NO_LIGHTNING}, tafHazards:[], wxAlertText:"", wxAlertTone:"none", wxAlertPulse:false, wxAlertFlash:false, wxAlertVisible:false, birdRisk:"UNAVAILABLE", birdBasis:"—", birdUpdated:"—", source:"MODEL", cloudCoverage:"CLR", cloudBaseFt:null, visibilitySm:null, phenomena:[], metarObsIso:null, tafIssueIso:null, tafValidStartIso:null, tafValidEndIso:null, metarFetchStatus:"UNKNOWN", tafFetchStatus:"UNKNOWN", bwcFetchStatus:"UNKNOWN", feedStatus:"DEGRADED", requestStatus:"IDLE", lastRefreshAttemptIso:null, lastRefreshSuccessIso:null, feedError:"NO DATA" };
const DEBUG_THEMES: Theme[] = ["clear","partly-cloudy","overcast","rain","heavy-rain","thunderstorm","fog","snow","night","sunrise","sunset"];

function parts(date:Date, zone:string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone:zone, hour12:false, weekday:"long", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", timeZoneName:"short" }).formatToParts(date).map(p=>[p.type,p.value]));
}
function dateLine(p:Record<string,string>) { return `${p.weekday.toUpperCase()} • ${p.day} ${p.month.toUpperCase()} ${p.year}`; }
function julian4(date:Date) {
  const p = parts(date, CONFIG.timeZone); const y=Number(p.year), m=Number(new Intl.DateTimeFormat("en-US",{timeZone:CONFIG.timeZone,month:"numeric"}).format(date)), d=Number(p.day);
  const doy=Math.floor((Date.UTC(y,m-1,d)-Date.UTC(y,0,0))/86400000);
  return `${y%10}${String(doy).padStart(3,"0")}`;
}
function getFlightCategory(visSm: number | null, cloudBaseFt: number | null, cloudCoverage: string | null): { cat: "VFR" | "MVFR" | "IFR" | "LIFR"; color: string; label: string } {
  const isCeiling = cloudCoverage && ["BKN", "OVC", "VV"].includes(cloudCoverage);
  const cig = isCeiling ? (cloudBaseFt !== null ? cloudBaseFt : 10000) : 10000;
  const vis = visSm !== null ? visSm : 10;
  if (cig < 500 || vis < 1) return { cat: "LIFR", color: "#c084fc", label: "LOW IFR" };
  if (cig < 1000 || vis < 3) return { cat: "IFR", color: "#f87171", label: "IFR" };
  if (cig <= 3000 || vis <= 5) return { cat: "MVFR", color: "#60a5fa", label: "MARGINAL VFR" };
  return { cat: "VFR", color: "#4ade80", label: "VFR" };
}
function getMoonPhase(date: Date): { phase: number; name: string } {
  // Calibrated to July 14, 2026 05:57 UTC New Moon (timeanddate.com Memphis baseline)
  const knownNewMoon = new Date(Date.UTC(2026, 6, 14, 5, 57));
  const synodicMonth = 29.53058867;
  const diffDays = (date.getTime() - knownNewMoon.getTime()) / 86400000;
  const phase = ((diffDays % synodicMonth) + synodicMonth) % synodicMonth;
  const norm = phase / synodicMonth;
  let name = "NEW MOON";
  if (norm >= 0.015 && norm < 0.235) name = "WAXING CRESCENT";
  else if (norm >= 0.235 && norm <= 0.255) name = "FIRST QUARTER";
  else if (norm > 0.255 && norm < 0.485) name = "WAXING GIBBOUS";
  else if (norm >= 0.485 && norm <= 0.515) name = "FULL MOON";
  else if (norm > 0.515 && norm < 0.735) name = "WANING GIBBOUS";
  else if (norm >= 0.735 && norm <= 0.755) name = "LAST QUARTER";
  else if (norm > 0.755 && norm < 0.985) name = "WANING CRESCENT";
  return { phase: norm, name };
}
function bearingToCardinal(deg:number):string { const pts=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]; return pts[Math.round(deg/22.5)%16]; }
function mapCode(code:number, wind:number): Pick<Weather,"condition"|"description"> {
  if(code===0) return {condition:"clear",description:"Clear"};
  if(code<=2) return {condition:"partly-cloudy",description:"Partly cloudy"};
  if(code===3) return {condition:"overcast",description:"Overcast"};
  if(code===45||code===48) return {condition:"fog",description:code===48?"Freezing fog":"Fog"};
  if(code>=95) return {condition:"thunderstorm",description:code>=96?"Thunderstorm, hail":"Thunderstorm"};
  if((code>=71&&code<=77)||code===85||code===86) return {condition:"snow",description:code===77?"Snow grains":code===75||code===86?"Heavy snow":"Snow"};
  if(code===56||code===57) return {condition: code===57?"heavy-rain":"rain",description:"Freezing drizzle"};
  if(code===66||code===67) return {condition: code===67?"heavy-rain":"rain",description:"Freezing rain"};
  if(code>=51&&code<=55) return {condition:"rain",description:code===51?"Light drizzle":"Drizzle"};
  if(code>=61&&code<=65) return {condition: (code===65||wind>20)?"heavy-rain":"rain",description:(code===65||wind>20)?"Heavy rain":"Rain"};
  if(code>=80&&code<=82) return {condition: (code===82||wind>20)?"heavy-rain":"rain",description:(code===82||wind>20)?"Heavy rain":"Rain showers"};
  return {condition:"overcast",description:"Cloudy"};
}
function coverageFromCondition(c:Theme):CloudCoverage { return c==="overcast"?"OVC":c==="partly-cloudy"?"SCT":c==="clear"?"CLR":c==="fog"?"OVC":"BKN"; }
function phenomenaFromCondition(c:Theme):string[] { return c==="heavy-rain"?["+RA"]:c==="rain"?["RA"]:c==="snow"?["SN"]:c==="thunderstorm"?["TSRA"]:c==="fog"?["FG"]:[]; }
function deriveIntensity(phenomena:string[]):"light"|"moderate"|"heavy" {
  if(phenomena.some(p=>p.startsWith("+"))) return "heavy";
  const precip=phenomena.filter(p=>/(?:DZ|RA|SN|SG|PL|GR|GS|UP)/.test(p));
  if(!precip.length) return "light";
  return precip.every(p=>p.startsWith("-")||p.startsWith("VC"))?"light":"moderate";
}
// Assemble the normalized scene object from the resolved weather, active condition, and solar phase.
// `debug` forces phenomena to match the simulated condition so debug scenes animate correctly.
function buildScene(weather:Weather, condition:Theme, phase:Phase, debug:boolean):SceneModel {
  const live=weather.phenomena||[];
  const phenomena=debug||!live.length?phenomenaFromCondition(condition):live;
  const coverage=debug?coverageFromCondition(condition):(weather.cloudCoverage||"CLR");
  return { baseScene:sceneFor(condition,phase,coverage), cloudCoverage:coverage, cloudBaseFt:debug?null:(weather.cloudBaseFt??null), phenomena, intensity:deriveIntensity(phenomena), vicinityOnly:phenomena.length>0&&phenomena.every(p=>p.startsWith("VC")), windDirectionDeg:weather.currentWind.directionDegrees, windSpeedKt:weather.currentWind.speedKt, gustKt:weather.currentWind.gustKt, visibilitySm:debug?null:(weather.visibilitySm??null), timePhase:phase };
}
// --- Phase 2B cloud-motion helpers -----------------------------------------
// Depth tier from the reported ceiling: low clouds sit lower/darker/faster, high ones finer/slower.
function cloudTier(baseFt:number|null):"low"|"mid"|"high" { return baseFt==null?"mid":baseFt<=3000?"low":baseFt<=10000?"mid":"high"; }
// Turn METAR wind into a slowed drift vector for the cloud layers. Meteorological direction is where
// the wind comes FROM, so clouds travel toward the opposite bearing. nx is a horizontal sign (±1 tile
// per loop) so motion is always mostly lateral; ny (-1..1) adds a subtle vertical bias. Speed maps to
// a capped loop duration (seconds) — larger wind → shorter loop.
function cloudVector(dirDeg:number|null, speedKt:number, gustKt:number|null):{nx:number;ny:number;dur:number} {
  let nx:number, ny:number;
  if(dirDeg==null){ nx=1; ny=0; } // variable / unknown → gentle default drift, never randomized
  else { const to=(dirDeg+180)*Math.PI/180, dx=Math.sin(to), dy=-Math.cos(to);
    nx=dx<-1e-6?-1:1; ny=Math.max(-1,Math.min(1,Math.round(dy))); } // near-zero E/W (due N/S wind) → default east
  const s=Math.max(0,speedKt||0);
  let dur=s<=5?320:s<=15?220:s<=25?150:s<=40?100:78; // higher speed → shorter loop, capped at 40kt+
  if(gustKt&&gustKt>s) dur=Math.round(dur*(1-Math.min(0.12,(gustKt-s)/200))); // gusts nudge slightly faster
  return {nx,ny,dur};
}
function detectPerf():"full"|"low" { if(typeof navigator==="undefined") return "full"; const c=navigator.hardwareConcurrency||8, m=(navigator as {deviceMemory?:number}).deviceMemory||8; return (c<=4||m<=4)?"low":"full"; }
function signedCelsius(token:string) { return token.startsWith("M")?-Number(token.slice(1)):Number(token); }
function cToF(c:number) { return Math.round((c*9/5)+32); }
function parseMetar(raw:string) {
  const sky=parseAviationSky(raw), operationalWeather=resolveOperationalWeather({text:raw,...sky,sourceKind:"METAR"}), currentLightning=parseCurrentLightning(raw), temp=raw.match(/\s(M?\d{2})\/(?:M?\d{2}|XX)\s/);
  return { condition:operationalWeather.condition, description:operationalWeather.label, operationalWeather, currentLightning, temperatureF:temp?cToF(signedCelsius(temp[1])):null };
}
// Open-Meteo unixtime values are absolute UTC seconds, so every timestamp converts on its
// own. A single utc_offset_seconds applied to the whole series silently shifts every hour
// after a DST transition, which the strict PoP period match then drops as unmatched.
function localClock(epochSeconds:number):string {
  const date=new Date(Number(epochSeconds)*1000);
  if(!Number.isFinite(date.getTime())) return "--:--";
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:CONFIG.timeZone,hourCycle:"h23",hour:"2-digit",minute:"2-digit"}).formatToParts(date).map(x=>[x.type,x.value]));
  const hour=parts.hour==="24"?"00":parts.hour;
  return `${hour.padStart(2,"0")}:${parts.minute.padStart(2,"0")}`;
}
async function getModelWeather(signal?:AbortSignal):Promise<Weather> {
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=2&timeformat=unixtime`;
  const r=await fetch(url,{signal}); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  // The timezone parameter still anchors the daily blocks to local midnight; only the
  // timestamps themselves become absolute.
  const tm=(seconds:number)=>localClock(seconds), utcIso=(seconds:number)=>new Date(Number(seconds)*1000).toISOString();
  const start=Math.max(0,j.hourly.time.findIndex((t:number)=>t>=j.current.time));
  const fetchedAt=new Date().toISOString();
  const forecast:Forecast[]=[0,1,2,3,4,5,6,7,8,9].map(offset=>start+offset).filter(i=>i>=0&&i<j.hourly.time.length).map(i=>{const condition=mapCode(j.hourly.weather_code[i],0),validTime=utcIso(j.hourly.time[i]);return {time:tm(j.hourly.time[i]),iso:validTime,temperatureF:Math.round(j.hourly.temperature_2m[i]),...condition,precipitationProbability:normalizePrecipitationProbability(j.hourly.precipitation_probability[i]),precipitationSource:"Open-Meteo",precipitationValidTime:validTime,precipitationFetchedAt:fetchedAt,precipitationAgeMinutes:0,source:"MODEL",operationalWeather:null}});
  const windDegrees=Math.round(j.current.wind_direction_10m);
  const windSpeedKt=Math.round(j.current.wind_speed_10m), currentIso=utcIso(j.current.time), normalizedDirection=windDegrees===0?360:windDegrees;
  const modelWindToken=windSpeedKt===0?"00000KT":`${String(normalizedDirection).padStart(3,"0")}${String(windSpeedKt).padStart(2,"0")}KT`;
  const currentWind=parseStandardWind(modelWindToken,"MODEL",currentIso)??FALLBACK_WIND;
  const solarDays:SolarDay[]=j.daily.time.map((seconds:number,i:number)=>({date:dateKey(new Date(Number(seconds)*1000),CONFIG.timeZone),sunriseLocal:tm(j.daily.sunrise[i]),sunsetLocal:tm(j.daily.sunset[i])}));
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,currentWind,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:solarDays[0]?.sunriseLocal||"--:--",sunsetLocal:solarDays[0]?.sunsetLocal||"--:--",solarDays,observationTime:currentIso,forecast,operationalWeather:null,currentLightning:{...NO_LIGHTNING},tafHazards:[],wxAlertText:"",wxAlertTone:"none",wxAlertPulse:false,wxAlertFlash:false,wxAlertVisible:false,birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",cloudCoverage:coverageFromCondition(mapped.condition),cloudBaseFt:null,visibilitySm:null,phenomena:phenomenaFromCondition(mapped.condition),metarObsIso:null,tafIssueIso:null,tafValidStartIso:null,tafValidEndIso:null,metarFetchStatus:"UNKNOWN",tafFetchStatus:"UNKNOWN",bwcFetchStatus:"UNKNOWN",feedStatus:"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:null};
}
function isOpsBoardWeather(value:unknown):value is OpsBoardWeather { return !!value&&typeof value==="object"&&(typeof (value as OpsBoardWeather).metar==="string"||typeof (value as OpsBoardWeather).taf==="string"); }
function upstreamStatus(value:string|undefined) { return (value||"UNKNOWN").trim().toUpperCase(); }
function resolveCurrentLightning(ops:OpsBoardWeather, metarFallback:LightningReport):LightningReport {
  const sev = ops.lightningSeverity?.toLowerCase();
  const levelMap:Record<string,LightningLevel>={none:"none",distant:"distant",vicinity:"vicinity",station:"station",active_field:"station",active:"station",warning:"station",severe:"severe"};
  if (sev && sev in levelMap) {
    const level=levelMap[sev];
    const opsSource=(ops.lightningSource||"").toUpperCase(), sourceTime=opsSource==="ATIS"?ops.atisObservedZ||null:ops.metarObservedZ||null;
    const lightningFetchStatus=opsSource==="ATIS"?ops.atisFetchStatus:ops.metarFetchStatus, isStale=/STALE|USED_LAST_GOOD/.test(String(lightningFetchStatus||"").toUpperCase());
    if (level === "none") return {...NO_LIGHTNING,source:"ops-feed",sourceTime,isStale};
    const toneRaw=ops.lightningTone?.toLowerCase();
    const tone:LightningTone=toneRaw==="red"||toneRaw==="blue"||toneRaw==="green"||toneRaw==="yellow"?toneRaw:metarFallback.tone;
    const source="ops-feed" as const;
    const awareness = ops.lightning || metarFallback.awareness || ops.lightningLogText || (level === "vicinity" ? "⚡ VCTS 5-10 NM" : "⛈️ TS OVER FIELD");
    return {
      level,
      source,
      code: metarFallback.code || "TS",
      frequency: metarFallback.frequency,
      types: metarFallback.types,
      directions: metarFallback.directions,
      awareness,
      tone,
      flash:typeof ops.lightningFlash==="boolean"?ops.lightningFlash:metarFallback.flash,
      pulse:typeof ops.lightningPulse==="boolean"?ops.lightningPulse:metarFallback.pulse,
      isStale,
      sourceTime
    };
  }
  return {...metarFallback,sourceTime:ops.metarObservedZ||null,isStale:/STALE|USED_LAST_GOOD/.test(String(ops.metarFetchStatus||"").toUpperCase())};
}
async function getWeather(signal?:AbortSignal):Promise<WeatherFetchResult> {
  const feed=fetch(`${CONFIG.opsBoardWeatherUrl}?v=${Date.now()}_${Math.random().toString(36).slice(2)}`,{cache:"no-store",signal}).then(async response=>{if(!response.ok) throw new Error(`FEED HTTP ${response.status}`);const json:unknown=await response.json();if(!isOpsBoardWeather(json)) throw new Error("MALFORMED FEED");return json;});
  const [modelResult,feedResult]=await Promise.allSettled([getModelWeather(signal),feed]);
  if(signal?.aborted) throw new DOMException("Weather refresh aborted","AbortError");
  const modelValid=modelResult.status==="fulfilled", model=modelValid?modelResult.value:{...FALLBACK};
  if(feedResult.status==="rejected") return {weather:{...model,feedStatus:"DEGRADED",feedError:feedResult.reason instanceof Error?feedResult.reason.message:"FEED FETCH FAILED"},metarValid:false,tafValid:false,modelValid,windValid:false,feedReached:false};
  const ops=feedResult.value, rawMetar=ops.metar||"", rawTaf=ops.taf||"", reference=new Date();
  const metarSyntax=/\b(?:(?:METAR|SPECI)\s+)?KMEM\b/.test(rawMetar.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawMetar.toUpperCase());
  const metarObsIso=metarSyntax?parseMetarObservedAt(rawMetar,ops.metarObservedZ,reference):null, metarValid=metarSyntax&&metarObsIso!==null;
  const tafSyntax=/\bTAF(?:\s+(?:AMD|COR))?\s+KMEM\b/.test(rawTaf.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawTaf.toUpperCase());
  const tafTimes=tafSyntax?parseTafTimes(rawTaf,reference):{issueIso:null,validStartIso:null,validEndIso:null}, tafEnvelopeValid=tafSyntax&&tafTimes.issueIso!==null&&tafTimes.validStartIso!==null&&tafTimes.validEndIso!==null;
  const tafTimeline=tafEnvelopeValid?parseStructuredTaf(rawTaf,reference):null, tafValid=tafEnvelopeValid&&tafTimeline!==null;
  const tafProduct=tafTimeline&&model.forecast.length?applyStructuredTaf(model.forecast,tafTimeline,reference):null;
  const metar=metarValid?parseMetar(rawMetar):null, sky=metarValid?parseAviationSky(rawMetar):null, phenomena=metarValid?extractAviationPhenomena(rawMetar):null;
  const metarFetchStatus=upstreamStatus(ops.metarFetchStatus), tafFetchStatus=upstreamStatus(ops.tafFetchStatus), bwcFetchStatus=upstreamStatus(ops.bwcFetchStatus);
  const currentWind=resolveCurrentWind({
    now:reference,
    atis:{text:ops.atisText||null,observedAt:ops.atisObservedZ||null,fetchStatus:ops.atisFetchStatus||null,ageMinutes:ops.atisAgeMinutes??null},
    metar:{text:rawMetar||null,observedAt:metarObsIso,fetchStatus:ops.metarFetchStatus||null,ageMinutes:ops.metarAgeMinutes??null}
  });
  const windValid=currentWind!==null;
  const healthy=metarValid&&tafValid&&metarFetchStatus==="OK"&&tafFetchStatus==="OK";
  const weather:Weather={...model,temperatureF:metar?.temperatureF??model.temperatureF,condition:metar?.condition??model.condition,description:metar?.description??model.description,operationalWeather:metar?.operationalWeather??model.operationalWeather,currentLightning:metar?.currentLightning??model.currentLightning,currentWind:currentWind??model.currentWind,observationTime:currentWind?.observedAt??(metarValid?metarObsIso:model.observationTime),forecast:tafProduct?.forecast??model.forecast,tafHazards:tafProduct?.hazards??[],wxAlertText:ops.wxAlertText||"",wxAlertTone:ops.wxAlertTone||"none",wxAlertPulse:!!ops.wxAlertPulse,wxAlertFlash:!!ops.wxAlertFlash,wxAlertVisible:!!ops.wxAlertVisible,birdRisk:(ops.bwcAhasRisk||ops.bwc||"UNAVAILABLE").toUpperCase(),birdBasis:(ops.bwcBasedOn||"AHAS").toUpperCase(),birdUpdated:ops.bwcUpdatedZ||"—",source:metarValid?"METAR":"MODEL",cloudCoverage:sky?.cloudCoverage??model.cloudCoverage,cloudBaseFt:sky?sky.cloudBaseFt:model.cloudBaseFt,visibilitySm:sky?sky.visibilitySm:model.visibilitySm,phenomena:metarValid?(phenomena??[]):model.phenomena,metarObsIso:metarValid?metarObsIso:null,tafIssueIso:tafTimes.issueIso,tafValidStartIso:tafTimes.validStartIso,tafValidEndIso:tafTimes.validEndIso,metarFetchStatus,tafFetchStatus,bwcFetchStatus,feedStatus:healthy?"OK":"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:healthy?null:"UPSTREAM DEGRADED",rawMetar:metarValid?rawMetar:null};
  weather.currentLightning=resolveCurrentLightning(ops,weather.currentLightning);
  return {weather,metarValid,tafValid,modelValid,windValid,feedReached:true};
}
function WeatherIcon({condition,night=false}:{condition:Theme;night?:boolean}) {
  const theme=condition==="clear"&&night?"night":condition;
  return <i className={`wx-pictogram wxp-${theme} ${night?"wxp-nighttime":""}`} aria-hidden="true"><span className="wxp-sun"/><span className="wxp-moon"/><span className="wxp-cloud"/><span className="wxp-precip"><b/><b/><b/></span><span className="wxp-flakes"><b>✦</b><b>✦</b><b>✦</b></span><span className="wxp-bolt"/><span className="wxp-fog-lines"><b/><b/><b/></span></i>;
}
function isNightAt(time:string,sunrise:string,sunset:string) {
  const parse=(v:string)=>{
    const clean = v.replace(/[^0-9:]/g, "");
    const [h,m]=clean.split(":").map(Number);
    return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:NaN;
  };
  let clock = NaN;
  if (time.includes("T") || time.includes("-")) {
    const d = new Date(time);
    if (Number.isFinite(d.getTime())) {
      const p = parts(d, CONFIG.timeZone);
      clock = Number(p.hour) * 60 + Number(p.minute);
    }
  }
  if (!Number.isFinite(clock)) {
    clock = parse(time);
  }
  const rise=parse(sunrise), set=parse(sunset);
  return Number.isFinite(clock) && Number.isFinite(rise) && Number.isFinite(set) && (clock < rise || clock > set);
}
function parseTimeMinutes(v: string | undefined): number {
  if (!v || v === "--:--") return 1211;
  const pm = /pm/i.test(v);
  const am = /am/i.test(v);
  const clean = v.replace(/(?:AM|PM|\s)/gi, "");
  const [hStr, mStr] = clean.split(":");
  let h = Number(hStr), m = Number(mStr || 0);
  if (!Number.isFinite(h)) return 1211;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h * 60 + m;
}

function dateKey(date:Date,zone:string) { const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).map(x=>[x.type,x.value])); return `${p.year}-${p.month.padStart(2,"0")}-${p.day.padStart(2,"0")}`; }
function solarWindow(now:Date,nowParts:Record<string,string>,days:SolarDay[],fallbackRise:string,fallbackSet:string) {
  const today=dateKey(now,CONFIG.timeZone), current=Number(nowParts.hour)*60+Number(nowParts.minute)+Number(nowParts.second||0)/60;
  const todayIndex=Math.max(0,days.findIndex(d=>d.date===today)), todaySolar=days[todayIndex]||{date:today,sunriseLocal:fallbackRise,sunsetLocal:fallbackSet};
  const todaySet=parseTimeMinutes(todaySolar.sunsetLocal), afterSunset=current>todaySet, selected=afterSunset?(days[todayIndex+1]||todaySolar):todaySolar;
  const rise=parseTimeMinutes(selected.sunriseLocal), set=parseTimeMinutes(selected.sunsetLocal);
  
  const daylight = current >= rise && current <= set;
  const activeObject = daylight ? "sun" : "moon";
  
  let phase: "day" | "night" | "sunrise" | "sunset" = "day";
  if (current >= rise - 30 && current < rise + 60) phase = "sunrise";
  else if (current >= set - 60 && current < set + 30) phase = "sunset";
  else if (current < rise - 30 || current >= set + 30) phase = "night";
  
  const dayProgress=daylight&&set>rise?Math.max(0,Math.min(100,((current-rise)/(set-rise))*100)):0;
  let progress = dayProgress;
  const dayAngle = Math.PI - (dayProgress / 100) * Math.PI;
  let markerX=100+Math.cos(dayAngle)*88, markerY=76-Math.sin(dayAngle)*56;
  if(!daylight) {
    const nightStart = parseTimeMinutes((current < rise ? days[Math.max(0, todayIndex - 1)] : todaySolar)?.sunsetLocal || todaySolar.sunsetLocal);
    const nightEnd = 1440 + parseTimeMinutes(selected.sunriseLocal);
    const nightClock = current < rise ? current + 1440 : current;
    const nightRatio = Math.max(0, Math.min(1, (nightClock - nightStart) / (nightEnd - nightStart)));
    progress = Math.round(nightRatio * 100);
    const nightAngle = nightRatio * Math.PI;
    markerX = 100 + Math.cos(nightAngle) * 88;
    markerY = 76 + Math.sin(nightAngle) * 56;
  }
  const safeX = Number.isFinite(markerX) ? markerX : 100;
  const safeY = Number.isFinite(markerY) ? markerY : 40;
  return {phase, activeObject, sunrise:selected.sunriseLocal, sunset:selected.sunsetLocal, label:daylight?"DAYLIGHT":"MOON", daylight, progress, markerX:safeX, markerY:safeY, isTomorrow:afterSunset};
}
function zStamp(value:string) {
  if (!value || value === "—") return "—";
  const match = value.match(/(?:\d{4}-\d{2}-(\d{2})[ T](\d{2}):(\d{2}))|(?:(\d{2})\/)?(\d{2})(\d{2})Z?/i);
  if (match) {
    if (match[1]) return `${match[1]}/${match[2]}${match[3]}Z`;
    if (match[5] && match[6]) return `${match[4] ? `${match[4]}/` : ""}${match[5]}${match[6]}Z`;
  }
  return value !== "—" ? value : "—";
}
function aviationStamp(value:string|null) { const time=value?Date.parse(value):NaN; if(!Number.isFinite(time)) return "—"; const d=new Date(time); return `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCHours()).padStart(2,"0")}${String(d.getUTCMinutes()).padStart(2,"0")}Z`; }

export default function Home() {
  const [weather,setWeather]=useState<Weather>(FALLBACK); const weatherRef=useRef<Weather>(FALLBACK); const [debug,setDebug]=useState<Theme|null>(null); const [debugPhase,setDebugPhase]=useState<"day"|"night"|"sunrise"|"sunset"|null>(null); const [debugBird,setDebugBird]=useState<"LOW"|"MODERATE"|"SEVERE"|null>(null); const [debugMoon,setDebugMoon]=useState<string|null>(null);
  const [activeFlyby, setActiveFlyby] = useState<{ id: number; top: number; direction: "ltr" | "rtl"; duration: number } | null>(null);
  const [debugFlybyEnabled, setDebugFlybyEnabled] = useState<boolean | null>(null);
  const [debugFlybyDir, setDebugFlybyDir] = useState<"ltr" | "rtl" | null>(null);
  const [debugCloud,setDebugCloud]=useState<CloudCoverage|null>(null); const [debugCloudBase,setDebugCloudBase]=useState<number|null>(null); const [debugWind,setDebugWind]=useState<number|null>(null); const [debugWindSpeed,setDebugWindSpeed]=useState<number|null>(null); const [debugWindMode,setDebugWindMode]=useState<DebugWindMode|null>(null); const [debugWxAlert,setDebugWxAlert]=useState<DebugWxAlert|null>(null); const [debugFutureWeather,setDebugFutureWeather]=useState(false); const [perf,setPerf]=useState<"full"|"low">("full");
  const [debugPhenomena,setDebugPhenomena]=useState<string|null>(null); const [debugIntensity,setDebugIntensity]=useState<Intensity|null>(null); const [debugVisibility,setDebugVisibility]=useState<number|null>(null); const [debugGust,setDebugGust]=useState<number|null>(null); const [reduced,setReduced]=useState(false); const [paneDrops,setPaneDrops]=useState<boolean|null>(null);
  const [showPreview,setShowPreview]=useState(false); const [showSim,setShowSim]=useState(false); const [debugLightning,setDebugLightning]=useState<string|null>(null); const mainRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{ if(typeof matchMedia==="undefined") return; const mq=matchMedia("(prefers-reduced-motion: reduce)"); const on=()=>setReduced(mq.matches); on(); mq.addEventListener?.("change",on); return()=>mq.removeEventListener?.("change",on); },[]);
  const [aScene,setAScene]=useState("clear-night"); const [bScene,setBScene]=useState("clear-night"); const [active,setActive]=useState<"a"|"b">("a");
  const cfRef=useRef<{active:"a"|"b";a:string;b:string}>({active:"a",a:"clear-night",b:"clear-night"}); cfRef.current={active,a:aScene,b:bScene};
  const clockDebug=useMemo<ClockDebug|undefined>(()=>{ if(typeof location==="undefined") return undefined; const q=new URLSearchParams(location.search); const off=q.get("debugClockOffset"), chk=q.get("debugClockCheck"), exact=q.get("debugExactTime"); return { offsetMs: off!=null&&off!==""?Number(off):undefined, exact: exact!=null&&exact!==""?Number(exact):undefined, force:(chk==="offline"||chk==="stale"||chk==="warning")?chk:undefined }; },[]);
  const {now,status:clock}=useSystemClock(clockDebug);
  
  // Spawning controls for single C-17 photo flyby
  const activeFlybyRemovalRef = useRef<number | null>(null);
  // The weather answer is captured when a pass is launched, never re-read mid-transit.
  const flybyAllowedRef = useRef(false);
  const [flybySlot, setFlybySlot] = useState(0);
  
  const triggerSpawn = useCallback((forcedDir?: "ltr" | "rtl") => {
    if (activeFlybyRemovalRef.current) window.clearTimeout(activeFlybyRemovalRef.current);
    const dir = forcedDir || debugFlybyDir || (Math.random() > 0.5 ? "ltr" : "rtl");
    const top = 9 + Math.random() * 7; // constrained to upper sky/header 9%-16%
    const duration = 12 + Math.random() * 6; // fast 12s-18s transit
    const newId = Date.now();
    setActiveFlyby({ id: newId, top, direction: dir, duration });
    activeFlybyRemovalRef.current = window.setTimeout(() => {
      setActiveFlyby(curr => (curr?.id === newId ? null : curr));
    }, duration * 1000);
  }, [debugFlybyDir]);

  useEffect(() => {
    if (debugFlybyEnabled === false) {
      setActiveFlyby(null);
      return;
    }
    // An airborne pass owns the screen until its own removal timer clears it.
    if (activeFlyby) return;

    const scheduleNext = () => {
      const delayMs = 15000 + Math.random() * 15000; // 15s - 30s interval
      return window.setTimeout(() => {
        // Weather is consulted here rather than at render, so a mid-transit change can no
        // longer make an aircraft vanish or pop in halfway across the sky.
        if (debugFlybyEnabled === true || flybyAllowedRef.current) triggerSpawn();
        else setFlybySlot(slot => slot + 1);
      }, delayMs);
    };
    const timerId = scheduleNext();
    return () => clearTimeout(timerId);
  }, [activeFlyby, debugFlybyEnabled, triggerSpawn, flybySlot]);

  useEffect(()=>{
    const q=new URLSearchParams(location.search), sim=q.get("debugWeather") as Theme|null, simPhase=q.get("debugTime"), simBird=q.get("debugBwc")?.toUpperCase(), simMoon=q.get("debugMoonPhase"); if(sim&&DEBUG_THEMES.includes(sim)) setDebug(sim); if(simPhase==="day"||simPhase==="night"||simPhase==="sunrise"||simPhase==="sunset") setDebugPhase(simPhase); if(simBird==="LOW"||simBird==="MODERATE"||simBird==="SEVERE") setDebugBird(simBird); if(simMoon) setDebugMoon(simMoon);
    if(q.has("debugWeather")||q.has("debugTime")||q.has("debugBwc")||q.has("debugMoonPhase")||q.has("sim")||q.has("demo")) setShowSim(true);
    const cc=q.get("debugCloud")?.toUpperCase(); if(cc&&["CLR","FEW","SCT","BKN","OVC","VV"].includes(cc)) setDebugCloud(cc as CloudCoverage);
    const cb=q.get("debugCloudBase"); if(cb!==null&&cb!=="") setDebugCloudBase(Number(cb));
    const wd=q.get("debugWind"); if(wd!==null&&wd!=="") setDebugWind(Number(wd));
    const ws=q.get("debugWindSpeed"); if(ws!==null&&ws!=="") setDebugWindSpeed(Number(ws));
    const windMode=q.get("debugWindMode"); if(windMode==="variable"||windMode==="calm"||windMode==="directional"||windMode==="gust"||windMode==="sector") setDebugWindMode(windMode);
    const wxAlert=q.get("debugWxAlert"); if(wxAlert==="none"||wxAlert==="info"||wxAlert==="caution"||wxAlert==="warning") setDebugWxAlert(wxAlert);
    if(q.get("debugFutureWeather")==="regression") setDebugFutureWeather(true);
    const pf=q.get("debugPerformance"); setPerf(pf==="low"?"low":pf==="full"?"full":detectPerf());
    const ph=q.get("debugPhenomena"); if(ph!==null&&ph!=="") setDebugPhenomena(ph);
    const it=q.get("debugIntensity"); if(it==="light"||it==="moderate"||it==="heavy") setDebugIntensity(it);
    const vv=q.get("debugVisibility"); if(vv!==null&&vv!=="") setDebugVisibility(Number(vv));
    const gu=q.get("debugGust"); if(gu!==null&&gu!=="") setDebugGust(Number(gu));
    const rm=q.get("debugReducedMotion"); setReduced(rm==="1"?true:rm==="0"?false:matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(q.get("previewWeatherFx")==="1") setShowPreview(true);
    const pd=q.get("debugPaneDrops"); if(pd==="on") setPaneDrops(true); else if(pd==="off") setPaneDrops(false);
    const ltg=q.get("debugLightning"); if(ltg) setDebugLightning(ltg);
    const fb=q.get("debugFlyby"); if(fb==="off") setDebugFlybyEnabled(false); else if(fb==="on") setDebugFlybyEnabled(true);
    const fbd=q.get("debugFlybyDir"); if(fbd==="ltr"||fbd==="rtl") setDebugFlybyDir(fbd);
    if(q.get("spawnFlyby")==="1") triggerSpawn((fbd==="ltr"||fbd==="rtl")?fbd:undefined);
    navigator.serviceWorker?.register("./service-worker.js").catch(()=>{});
  },[]);
  // Weather refresh lifecycle — deliberately separate from the clock. One coordinator owns the
  // request, timeout, interval, wake listeners, supersession, cache, and unmount cleanup.
  useEffect(()=>{
    const commit=(next:Weather)=>{weatherRef.current=next;setWeather(next);};
    try{
      const params = new URLSearchParams(window.location.search);
      const exact = params.get("debugExactTime");
      const displayNow = exact ? new Date(Number(exact)) : new Date();
      const cached=restoreWeatherCache(localStorage.getItem("kmem-weather"), displayNow);
      if(cached) commit(cached);
    }catch{}
    const coordinator=createRefreshCoordinator<WeatherFetchResult>({
      fetcher:signal=>getWeather(signal),
      onAttempt:(_reason,atIso)=>commit({...weatherRef.current,requestStatus:"REFRESHING",lastRefreshAttemptIso:atIso,feedError:null}),
      onResult:(result,_reason,atIso)=>{
        const prior=weatherRef.current, feedStatus=result.feedReached?result.weather.feedStatus:(navigator.onLine?"DEGRADED":"OFFLINE");
        const validFeedSnapshot=result.feedReached&&(result.metarValid||result.tafValid||result.windValid);
        const candidate={...result.weather,feedStatus,requestStatus:"IDLE" as const,lastRefreshAttemptIso:prior.lastRefreshAttemptIso,lastRefreshSuccessIso:validFeedSnapshot?atIso:prior.lastRefreshSuccessIso,feedError:result.feedReached?result.weather.feedError:(result.weather.feedError||"FEED UNREACHABLE")};
        const merged=mergeWeather(prior,{...result,weather:candidate}); commit(merged);
        try{const stored=serializeWeatherCache(merged,atIso);if(stored)localStorage.setItem("kmem-weather",stored);}catch{}
      },
      onError:(_error,_reason,_atIso,timedOut)=>commit({...weatherRef.current,requestStatus:"ERROR",feedStatus:navigator.onLine?"DEGRADED":"OFFLINE",feedError:timedOut?"REQUEST TIMEOUT":"REFRESH FAILED"}),
      timeoutMs:12000
    });
    const removeLifecycle=installWeatherRefreshLifecycle(reason=>{void coordinator.refresh(reason);},CONFIG.weatherRefreshMinutes*60000);
    return()=>{removeLifecycle();coordinator.stop();};
  },[]);
  const local=parts(now,CONFIG.timeZone), utc=parts(now,"UTC");
  const localTime=`${local.hour}:${local.minute}:${local.second}`, utcTime=`${utc.hour}:${utc.minute}:${utc.second}`;
  
  // Phase 1 - Unify solar calculations
  const solar=solarWindow(now,local,weather.solarDays||[],weather.sunriseLocal,weather.sunsetLocal);
  const phase=debugPhase||(debug?(debug==="night"||debug==="sunrise"||debug==="sunset"?debug:"day"):solar.phase);
  
  const displayTheme=debug||weather.condition;
  const condition=debug&&!(["night","sunrise","sunset"] as Theme[]).includes(debug)?debug:weather.condition;
  const imageBase=process.env.NEXT_PUBLIC_BASE_PATH||"";
  const sceneModel=buildScene(weather,condition,phase,!!debug);
  // Phase 2B - effective cloud params (debug overrides win) feed the procedural cloud layers via CSS.
  const effCoverage=debugCloud||sceneModel.cloudCoverage;
  const effBase=debugCloudBase!=null?debugCloudBase:sceneModel.cloudBaseFt;
  const debugWindToken=debugWindMode?({variable:"VRB03KT",calm:"00000KT",directional:"21008KT",gust:"21008G18KT",sector:"21008KT 180V240"} as const)[debugWindMode]:null;
  const modeWind=debugWindToken?parseStandardWind(debugWindToken,"METAR",now.toISOString()):null;
  const numericWindOverride=debugWind!=null||debugWindSpeed!=null||debugGust!=null;
  const numericSpeed=debugWindSpeed??weather.currentWind.speedKt, numericDirection=debugWind??weather.currentWind.directionDegrees, numericGust=debugGust??weather.currentWind.gustKt;
  const numericWind:CurrentWindRecord|null=numericWindOverride?{
    directionType:numericSpeed===0?"calm":numericDirection===null?"variable":"directional",
    directionDegrees:numericSpeed===0?null:numericDirection,
    speedKt:numericSpeed,
    gustKt:numericSpeed===0?null:numericGust,
    variableFromDegrees:debugWind===null?weather.currentWind.variableFromDegrees:null,
    variableToDegrees:debugWind===null?weather.currentWind.variableToDegrees:null,
    source:"METAR",
    observedAt:now.toISOString(),
    raw:"DEBUG"
  }:null;
  const effectiveWind=modeWind??numericWind??weather.currentWind;
  const windDisplay=resolveCurrentWindDisplay(effectiveWind);
  const effWindDir=effectiveWind.directionDegrees;
  const effWindSpd=effectiveWind.speedKt;
  const effGust=effectiveWind.gustKt;
  const cloudVec=cloudVector(effWindDir,effWindSpd,effGust);
  const cloudTierV=cloudTier(effBase);
  const cloudStyle={ "--nx":cloudVec.nx, "--ny":cloudVec.ny, "--cloud-dur":cloudVec.dur } as unknown as CSSProperties;
  // Phase 2C — classify precipitation/obscuration from the scene object (or debug tokens) and build
  // the single-canvas particle spec. Reduced motion suppresses animated precipitation particles.
  const effPhenomena=debugPhenomena!=null?debugPhenomena.toUpperCase().split(/\s+/).filter(Boolean):sceneModel.phenomena;
  const effVisibility=debugVisibility!=null?debugVisibility:sceneModel.visibilitySm;
  const fxBase=classifyEffect(effPhenomena);
  const fx={...fxBase,intensity:(debugIntensity||fxBase.intensity)};
  const fxSpec=buildFxSpec(fx,cloudVec.nx,effWindSpd,perf,phase==="night",reduced,paneDrops,effVisibility);
  const obscuration=buildObscurationSpec(fx,effVisibility,cloudVec.nx,effWindSpd,perf,reduced);
  
  // Solar phase (day, sunset, night, sunrise) strictly controls solar lighting.
  // High broken/overcast thin cirrus ceilings (effBase >= 12,000 FT) use the phase-appropriate
  // bright high-cloud / hazy night scene, reserving dark gloomy overcast scenes for genuinely low ceilings (< 5,000 FT).
  let visualBaseScene = sceneModel.baseScene;
  const isHighCeiling = (effCoverage === "BKN" || effCoverage === "OVC") && (effBase === null || effBase >= 12000);
  const isSevereWx = ["rain", "heavy-rain", "thunderstorm", "fog", "snow"].includes(condition);
  if (isHighCeiling && !isSevereWx && visualBaseScene.startsWith("overcast-")) {
    visualBaseScene = sceneFor("partly-cloudy", phase, effCoverage);
  }

  const scene=sceneForEffects(visualBaseScene,obscuration.type,effVisibility,phase,effCoverage);
  const lightning=debugLightningReport(debugLightning)??weather.currentLightning??NO_LIGHTNING, lightningPoint=lightningPlacement(lightning), flashTest=debugLightning==="flash-test";
  const lightningDisplay=resolveLightningDisplay({text:lightning.awareness?compactLightningDisplay(lightning.awareness):"NONE",level:lightning.level,tone:lightning.tone,pulse:lightning.pulse,flash:lightning.flash,isStale:lightning.isStale,isUnavailable:lightning.isUnavailable,sourceTime:lightning.sourceTime,reducedMotion:reduced});
  const debugAlert=debugWxAlert?({
    none:{text:"NONE",tone:"none",pulse:false,flash:false,visible:false},
    info:{text:"🌧️ VCSH PSBL 29 JUL 05–06Z",tone:"blue",pulse:false,flash:false,visible:true},
    caution:{text:"🌫️ FOG PSBL 05 AUG 22–23Z",tone:"yellow",pulse:true,flash:false,visible:true},
    warning:{text:"⛈️ TSRA WARNING 05 AUG 21–22Z",tone:"red",pulse:false,flash:true,visible:true}
  } as const)[debugWxAlert]:null;
  const alertDisplay=resolveWxAlertDisplay({text:debugAlert?.text??weather.wxAlertText,tone:debugAlert?.tone??weather.wxAlertTone,pulse:debugAlert?.pulse??weather.wxAlertPulse,flash:debugAlert?.flash??weather.wxAlertFlash,visible:debugAlert?.visible??weather.wxAlertVisible,reducedMotion:reduced});
  const regressionForecast:Forecast[]=[
    ["2026-08-05T20:00:00.000Z",82,"P6SM FEW060",0],
    ["2026-08-06T00:00:00.000Z",79,"P6SM SKC",0],
    ["2026-08-06T04:00:00.000Z",76,"P6SM SKC",0],
    ["2026-08-06T16:00:00.000Z",86,"P6SM FEW045",35]
  ].map(([iso,temperatureF,raw,precipitationProbability])=>{
    const sky=parseAviationSky(String(raw)), operationalWeather=resolveOperationalWeather({text:String(raw),...sky,sourceKind:"TAF_FM"});
    return {time:String(iso).slice(11,16),iso:String(iso),temperatureF:Number(temperatureF),condition:operationalWeather.condition,description:operationalWeather.label,precipitationProbability:Number(precipitationProbability),precipitationSource:"Open-Meteo",precipitationValidTime:String(iso),precipitationFetchedAt:"2026-08-05T19:00:00.000Z",precipitationAgeMinutes:0,source:"TAF" as const,operationalWeather};
  });
  const displayForecast=debugFutureWeather?regressionForecast:weather.forecast;
  useLightningScheduler(mainRef,lightning,reduced,flashTest);
  const sceneStyle={...cloudStyle,"--obsc-opacity":obscuration.density,"--obsc-horizon":obscuration.horizon,"--obsc-veil":obscuration.veil,"--obsc-duration":`${obscuration.duration}s`,"--obsc-direction":obscuration.direction,"--lightning-x":`${lightningPoint.x}%`,"--lightning-y":`${lightningPoint.y}%`} as unknown as CSSProperties;
  
  // Crossfade the wallpaper between two ping-pong layers using a race-safe state machine.
  // We preload the incoming image and swap only after a successful load. A decode rejection is
  // not a load failure in every browser, so it still commits the loaded image; the cancellation
  // guard prevents stale callbacks from superseding newer scene requests.
  useEffect(() => {
    const { active: ac, a, b } = cfRef.current;
    const currentScene = ac === "a" ? a : b;
    if (currentScene === scene) return;
    
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    
    const commit = () => {
      if (cancelled) return;
      if (cfRef.current.active === "a") {
        setBScene(scene);
        setActive("b");
      } else {
        setAScene(scene);
        setActive("a");
      }
    };
    
    img.onload = () => {
      if (cancelled) return;
      if (img.decode) {
        img.decode().then(commit).catch(commit);
      } else {
        commit();
      }
    };
    img.onerror = () => {
      // Failed to load, keep current scene visible and do nothing
    };
    img.src = `${imageBase}/assets/backgrounds/${scene}.png`;
    
    return () => { cancelled = true; };
  }, [scene, imageBase]);
  
  let effSolar = { ...solar };
  if (effSolar.daylight) {
    const dayAngle = Math.PI - (effSolar.progress / 100) * Math.PI;
    effSolar.markerX = 100 + Math.cos(dayAngle) * 88;
    effSolar.markerY = 76 - Math.sin(dayAngle) * 56;
  } else {
    const nightAngle = (effSolar.progress / 100) * Math.PI;
    effSolar.markerX = 100 + Math.cos(nightAngle) * 88;
    effSolar.markerY = 76 + Math.sin(nightAngle) * 56;
  }

  if (debugPhase) {
    if (debugPhase === "sunrise") effSolar = { ...solar, daylight: true, activeObject: "sun", progress: 5 };
    else if (debugPhase === "sunset") effSolar = { ...solar, daylight: true, activeObject: "sun", progress: 95 };
    else if (debugPhase === "day") effSolar = { ...solar, daylight: true, activeObject: "sun", progress: 50 };
    else if (debugPhase === "night") effSolar = { ...solar, daylight: false, activeObject: "moon", progress: 50 };

    if (effSolar.daylight) {
      const dayAngle = Math.PI - (effSolar.progress / 100) * Math.PI;
      effSolar.markerX = 100 + Math.cos(dayAngle) * 88;
      effSolar.markerY = 76 - Math.sin(dayAngle) * 56;
    } else {
      const nightAngle = (effSolar.progress / 100) * Math.PI;
      effSolar.markerX = 100 + Math.cos(nightAngle) * 88;
      effSolar.markerY = 76 + Math.sin(nightAngle) * 56;
    }
  }
  // Observation freshness (from actual METAR obs time) is tracked separately from feed-fetch health.
  const metarFreshness=classifyMetarFreshness(weather.metarObsIso,now.getTime()), metarState=metarFreshness.state, metarAgeMin=metarFreshness.ageMinutes;
  const tafState=classifyTafFreshness({issueIso:weather.tafIssueIso,validStartIso:weather.tafValidStartIso,validEndIso:weather.tafValidEndIso},now.getTime());
  const ageStr=metarAgeMin!=null?(metarAgeMin<60?`${metarAgeMin}M`:`${Math.floor(metarAgeMin/60)}H${metarAgeMin%60}M`):"—";
  const feed=weather.feedStatus;
  const wxClass=metarState==="STALE"||metarState==="UNAVAILABLE"?"warn":feed==="OK"?"ok":feed==="OFFLINE"?"off":"chk";
  const metarDiagnostic=metarState==="UNAVAILABLE"?"METAR UNAVAILABLE":`METAR ${aviationStamp(weather.metarObsIso)} · AGE ${ageStr} · ${metarState}`;
  const tafDiagnostic=tafState==="UNAVAILABLE"?"TAF UNAVAILABLE":`TAF ${aviationStamp(weather.tafIssueIso)} · ${tafState==="CURRENT"?`VALID TO ${aviationStamp(weather.tafValidEndIso)}`:tafState}`;
  const feedDiagnostic=feed==="OK"?`FEED OK · UPDATED ${aviationStamp(weather.lastRefreshSuccessIso)}`:`FEED ${feed} · LAST OK ${aviationStamp(weather.lastRefreshSuccessIso)}`;
  const birdRisk=debugBird||weather.birdRisk;
  const birdClass=/SEVERE|HIGH/.test(birdRisk)?"severe":/MODERATE/.test(birdRisk)?"moderate":/LOW/.test(birdRisk)?"low":"unknown", birdStamp=zStamp(weather.birdUpdated);
  const clockZ=clock.lastCheckedUtc?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(clock.lastCheckedUtc)).replace(":","")+"Z":"—";
  const clockOffset=clock.estimatedOffsetMs!=null?`${clock.estimatedOffsetMs>=0?"+":"-"}${(Math.abs(clock.estimatedOffsetMs)/1000).toFixed(1)} SEC`:"—";
  const clockText=clock.lastCheckedUtc===null&&clock.state!=="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK…":clock.state==="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: OFFLINE":clock.state==="STALE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: STALE (GITHUB EDGE DATE)":`SRC WINDOWS SYSTEM · CHECK GITHUB EDGE DATE: ${clock.state} · OFFSET ${clockOffset} · ${clockZ}`;
  const clockClass=clock.state==="OK"?"ok":clock.state==="OFFLINE"?"off":clock.state==="CHECK"?"chk":"warn";
  const flightCat = getFlightCategory(effVisibility, effBase, effCoverage);
  const flybyAllowed = isFlybyWeatherAllowed(weather, flightCat);
  useEffect(()=>{ flybyAllowedRef.current = flybyAllowed; },[flybyAllowed]);
  const moonInfo = useMemo(() => {
    const m = getMoonPhase(now);
    if (debugMoon) {
      m.name = `${debugMoon.toUpperCase()} MOON`;
      if (debugMoon === "crescent") m.phase = 0.12;
      else if (debugMoon === "quarter") m.phase = 0.25;
      else if (debugMoon === "full") m.phase = 0.50;
    }
    return m;
  }, [now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), debugMoon]);

  const activeWallpaper=active==="a"?aScene:bScene;
  return <main ref={mainRef} className={`display theme-${condition} phase-${phase}`} style={sceneStyle} data-wallpaper-scene={activeWallpaper} data-wallpaper-requested={scene} data-lightning-level={lightning.level} data-lightning-source={lightning.source} data-lightning-frequency={lightning.frequency||"none"} data-lightning-direction={lightning.directions.join("-")||"none"} data-lightning-types={lightning.types.join(",")||"none"} data-lightning-reduced={reduced?"1":"0"}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${aScene}.png)`,opacity:active==="a"?1:0}}/><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${bScene}.png)`,opacity:active==="b"?1:0}}/><i className="cloud-field"><i className="cloud-layer cl-high"/><i className="cloud-layer cl-mid"/><i className="cloud-layer cl-low"/></i><PrecipCanvas spec={fxSpec} paused={false} night={phase==="night"}/><i className="obscuration-field"><b/><b/><b/></i>{activeFlyby && debugFlybyEnabled !== false && (<i className="air-traffic"><span className={`flyby flyby-${activeFlyby.direction}`} key={activeFlyby.id} style={{top:`${activeFlyby.top}%`,animationDuration:`${activeFlyby.duration}s`}}><span className="c17-photo-container"><img src={`${imageBase}/assets/c17-source-${activeFlyby.direction}.png`} alt="C-17 Globemaster III" className="c17-photo-img" /><span className="c17-photo-lights"><i className="beacon-tail-red"/><i className="beacon-belly-red"/><i className="nav-port-red"/><i className="nav-starboard-green"/><i className="strobe-wing-white port"/><i className="strobe-wing-white starboard"/></span></span></span></i>)}<i className="lightning-layer"><i className="lightning-glow"/><i className="lightning-horizon-glow"/><i className="lightning-bolt-overlay" style={{backgroundImage:`url(${imageBase}/lightning-bolt-isolated.png)`}}/></i><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><img className="brand-logo" src={`${imageBase}/assets/patch-155.png`} alt="155 Patch" /><div><strong>164AW Airfield Management</strong><small>KMEM - FREDERICK W. SMITH INTERNATIONAL - MEMPHIS, TN</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong><strong>JULIAN {julian4(now)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{local.timeZoneName||"LOCAL"}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel">
          <div className="panel-title">
            <span>SOLAR WINDOW</span>
          </div>
          <div className="solar-layout">
            <div className="solar-graphic-wrap">
              <svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMid meet" className="solar-svg">
                <defs>
                  <radialGradient id="sunCoreGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#ffffff" /><stop offset="20%" stopColor="#ffffff" /><stop offset="45%" stopColor="#fffae6" /><stop offset="70%" stopColor="#ffe680" /><stop offset="100%" stopColor="rgba(255, 204, 0, 0)" /></radialGradient>
                  <radialGradient id="sunOuterHalo" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(255, 255, 255, 0.4)" /><stop offset="100%" stopColor="rgba(255, 140, 0, 0)" /></radialGradient>
                  <radialGradient id="moonBody" cx="40%" cy="35%" r="65%"><stop offset="0%" stopColor="#f1f5f9" /><stop offset="45%" stopColor="#cbd5e1" /><stop offset="75%" stopColor="#64748b" /><stop offset="100%" stopColor="#0f172a" /></radialGradient>
                  <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(226, 232, 240, 0.35)" /><stop offset="70%" stopColor="rgba(148, 163, 184, 0.1)" /><stop offset="100%" stopColor="rgba(148, 163, 184, 0)" /></radialGradient>
                </defs>
                <path d="M 12 76 A 88 56 0 0 1 188 76" fill="none" className="solar-arc-bg" strokeWidth="1.5" strokeDasharray="3, 3" />
                <path d="M 188 76 A 88 56 0 0 1 12 76" fill="none" className="lunar-arc-bg" strokeWidth="1.2" strokeDasharray="2, 4" opacity="0.6" />
                <line x1="8" y1="76" x2="192" y2="76" stroke="rgba(180, 211, 221, 0.25)" strokeWidth="1" strokeDasharray="4, 2" />
                {effSolar.daylight ? (() => {
                  const isSunrise = effSolar.progress <= 15;
                  const isSunset = effSolar.progress >= 85;
                  const sunIntensity = Math.max(0, 1 - Math.abs(effSolar.progress - 50) / 50);

                  if (isSunrise) {
                    return (
                      <g className="sun-group-sunrise">
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="18" fill="rgba(255, 140, 0, 0.35)" />
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="12" fill="rgba(255, 165, 0, 0.55)" />
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="8" fill="#ff8c00" stroke="#ffaa00" strokeWidth="1.2" />
                      </g>
                    );
                  }

                  if (isSunset) {
                    return (
                      <g className="sun-group-sunset">
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="18" fill="rgba(255, 51, 51, 0.35)" />
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="12" fill="rgba(239, 68, 68, 0.55)" />
                        <circle cx={effSolar.markerX} cy={effSolar.markerY} r="8" fill="#ff3333" stroke="#ff6666" strokeWidth="1.2" />
                      </g>
                    );
                  }

                  // Midday Sun with radiating solar rays
                  const rayAngles = [0, 45, 90, 135, 180, 225, 270, 315];
                  const sunRadius = 7 + 3 * sunIntensity;

                  return (
                    <g className="sun-group-midday">
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={14 + 10 * sunIntensity} fill="url(#sunOuterHalo)" className="sun-pulse-halo" opacity={sunIntensity} />
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={16 + 8 * sunIntensity} fill="url(#sunGlow)" opacity={0.4 + 0.6 * sunIntensity} />
                      {rayAngles.map((angle) => {
                        const rad = (angle * Math.PI) / 180;
                        const r1 = sunRadius + 4;
                        const r2 = sunRadius + 10;
                        const x1 = effSolar.markerX + Math.cos(rad) * r1;
                        const y1 = effSolar.markerY + Math.sin(rad) * r1;
                        const x2 = effSolar.markerX + Math.cos(rad) * r2;
                        const y2 = effSolar.markerY + Math.sin(rad) * r2;
                        return (
                          <line
                            key={angle}
                            x1={x1.toFixed(1)}
                            y1={y1.toFixed(1)}
                            x2={x2.toFixed(1)}
                            y2={y2.toFixed(1)}
                            stroke="#ffd700"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            opacity="0.85"
                          />
                        );
                      })}
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={sunRadius} fill="#ffffff" stroke="#ffea79" strokeWidth="1.2" opacity="0.95" />
                    </g>
                  );
                })() : (() => {
                  const p = moonInfo.phase; // 0..1 (0=New, 0.25=First Qtr, 0.3=Waxing Gibbous, 0.5=Full)
                  const isWaxing = p <= 0.5;
                  const isWaning = p > 0.5;
                  const isFull = p >= 0.485 && p <= 0.515;
                  const isNew = p < 0.015 || p > 0.985;
                  // Calculate shadow rx sweep for elliptical shadow overlay
                  const shadowRatio = isWaxing ? Math.abs(0.25 - p) / 0.25 : Math.abs(0.75 - p) / 0.25;
                  const shadowRx = Math.round(14 * shadowRatio);
                  const isGibbous = (p > 0.255 && p < 0.485) || (p > 0.515 && p < 0.735);
                  const sweep = (isWaxing && p < 0.25) || (isWaning && p > 0.75) ? 0 : 1;

                  return (
                    <g transform={`translate(${effSolar.markerX.toFixed(1)}, ${effSolar.markerY.toFixed(1)})`}>
                      <circle r="26" fill="url(#moonGlow)" />
                      <circle r="14" fill="url(#moonBody)" stroke="#94a3b8" strokeWidth="0.8" />
                      <circle cx="-3" cy="-3" r="3.5" fill="#475569" opacity="0.3" />
                      <circle cx="4" cy="4" r="2.5" fill="#475569" opacity="0.25" />
                      <circle cx="2" cy="-5" r="2" fill="#475569" opacity="0.2" />
                      {isNew && <circle r="14" fill="#0b131e" opacity="0.94" />}
                      {!isFull && !isNew && (
                        isWaxing ? (
                          p <= 0.25 ? (
                            <path d={`M 0 -14 A 14 14 0 0 0 0 14 A ${shadowRx} 14 0 0 ${sweep} 0 -14 Z`} fill="#0b131e" opacity="0.9" />
                          ) : (
                            <path d={`M 0 -14 A 14 14 0 0 0 0 14 A ${shadowRx} 14 0 0 1 0 -14 Z`} fill="#0b131e" opacity="0.9" />
                          )
                        ) : (
                          p <= 0.75 ? (
                            <path d={`M 0 -14 A 14 14 0 0 1 0 14 A ${shadowRx} 14 0 0 1 0 -14 Z`} fill="#0b131e" opacity="0.9" />
                          ) : (
                            <path d={`M 0 -14 A 14 14 0 0 1 0 14 A ${shadowRx} 14 0 0 0 0 -14 Z`} fill="#0b131e" opacity="0.9" />
                          )
                        )
                      )}
                    </g>
                  );
                })()}
              </svg>
            </div>
            <div className="solar-subtitle">
              <strong>{effSolar.daylight ? `${Math.round(effSolar.progress)}% DAYLIGHT ELAPSED` : `MOON - ${moonInfo.name}`}</strong>
            </div>
            <div className="solar-times-row">
              <div className="solar-time solar-rise"><span>SUNRISE</span><strong>{solar.sunrise.endsWith("L") ? solar.sunrise : `${solar.sunrise}L`}</strong><small>{effSolar.isTomorrow ? "TOMORROW" : "TODAY"}</small></div>
              <div className="solar-time solar-set"><span>SUNSET</span><strong>{solar.sunset.endsWith("L") ? solar.sunset : `${solar.sunset}L`}</strong><small>{effSolar.isTomorrow ? "TOMORROW" : "TODAY"}</small></div>
            </div>
          </div>
        </article>
        <article className="weather-card panel">
          <div className="panel-title">
            <span>CURRENT WEATHER</span>
            <b className={`metar-title-badge health-${feed !== "OK" ? (feed === "OFFLINE" ? "unavailable" : "stale") : metarState.toLowerCase()}`}>
              {feed !== "OK" ? `METAR FEED ${feed}` : `METAR ${metarState}`}
            </b>
          </div>
          <div className="weather-user-spec-layout">
            <div className="weather-table-left">
              <div className="weather-table-row weather-row-temp">
                <strong className="weather-spec-temp-centered">{weather.temperatureF ?? "--"}°<small className="temp-unit-f">F</small></strong>
              </div>
              <div className="weather-table-row weather-row-feels">
                <span className="weather-spec-feels">FEELS LIKE <strong>{weather.feelsLikeF??weather.temperatureF}°F</strong></span>
              </div>
              <div className="weather-table-row weather-row-cond">
                <b className="weather-spec-cond">{debug?displayTheme.replace("-"," "):weather.description}{weather.operationalWeather?.secondaryLabel && <span className="weather-modifier"> · {weather.operationalWeather.secondaryLabel}</span>}</b>
              </div>
              <div className="weather-table-row weather-row-humidity">
                <div className="weather-spec-humidity">
                  HUMIDITY <strong>{weather.humidity}%</strong>
                </div>
              </div>
              <div className="weather-table-row weather-row-ceiling">
                <div className="weather-ceiling-badge">
                  <span className="ceiling-label">CEILING</span>
                  <strong className="ceiling-value">{weather.cloudCoverage && ["BKN","OVC","VV"].includes(weather.cloudCoverage) && weather.cloudBaseFt !== null ? `${weather.cloudCoverage} ${weather.cloudBaseFt.toLocaleString()} FT` : "UNLIMITED (UNL)"}</strong>
                </div>
              </div>
              {/* Lightning awareness is an exception line: no lightning reported means no row at all. */}
              {lightningDisplay.severity!=="none"&&(
                <small className={`lightning-awareness${lightningDisplay.shouldPulse?" alert-pulse":""}${lightningDisplay.shouldFlash?" alert-flash":""}`} data-tone={lightningDisplay.colorClass.replace("lightning-","")} data-stale={lightningDisplay.isStale||undefined} data-source-time={lightningDisplay.sourceTime||undefined}>
                  <span>{lightningDisplay.text}</span>
                </small>
              )}
            </div>
            <div className="weather-table-right">
              <span className="weather-glyph-right"><WeatherIcon condition={condition} night={!effSolar.daylight || phase === "night"} /></span>
            </div>
          </div>
        </article>
        <article className="wind-card panel">
          <div className="panel-title"><span>WIND & FLIGHT CAT</span></div>
          <div className="wind-main-stacked">
            <div className="wind-speed-row">
              <strong data-wind-type={effectiveWind.directionType} data-wind-source={effectiveWind.source} data-wind-time={effectiveWind.observedAt||undefined}>{windDisplay.primary}</strong>
              {windDisplay.secondary&&<small className="wind-variability">{windDisplay.secondary}</small>}
            </div>
            <div className="compass-wrap-centered">
              <div className={`compass-dial${windDisplay.neutral?" compass-neutral":""}`}>
                <svg className="compass-ticks" viewBox="0 0 100 100" fill="none" stroke="currentColor">
                  <circle cx="50" cy="50" r="48" stroke="var(--cyan)" strokeWidth="1.2" opacity="0.4" />
                  <circle cx="50" cy="50" r="42" stroke="var(--line)" strokeWidth="0.5" strokeDasharray="1.5, 3" />
                  <line x1="50" y1="2" x2="50" y2="8" stroke="var(--cyan)" strokeWidth="2" />
                  <line x1="50" y1="92" x2="50" y2="98" stroke="var(--muted)" strokeWidth="1.2" />
                  <line x1="2" y1="50" x2="8" y2="50" stroke="var(--muted)" strokeWidth="1.2" />
                  <line x1="92" y1="50" x2="98" y2="50" stroke="var(--muted)" strokeWidth="1.2" />
                  <circle cx="50" cy="50" r="4" fill="var(--cyan)" box-shadow="0 0 6px var(--cyan)" />
                </svg>
                <span className="compass-label compass-n">N</span>
                <span className="compass-label compass-e">E</span>
                <span className="compass-label compass-s">S</span>
                <span className="compass-label compass-w">W</span>
                {windDisplay.showArrow&&windDisplay.arrowRotationDegrees!==null&&(
                  <div className="compass-arrow" style={{transform:`rotate(${windDisplay.arrowRotationDegrees}deg)`}}>
                    <svg viewBox="0 0 100 100" className="compass-arrow-svg" fill="none" stroke="currentColor">
                      <path d="M50 10 L60 38 L50 32 L40 38 Z" fill="var(--cyan)" stroke="var(--cyan)" strokeWidth="1.5" strokeLinejoin="round" />
                      <line x1="50" y1="32" x2="50" y2="78" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" />
                      <circle cx="50" cy="78" r="2.5" fill="var(--cyan)" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
            <div className="wind-flight-meta-centered">
              <span className="flight-cat-pill" style={{ borderColor: flightCat.color, color: flightCat.color, background: `${flightCat.color}22` }}>{flightCat.cat}</span>
              <span className="wind-vis-tag">VIS <strong>{effVisibility ?? 10} SM</strong></span>
            </div>
          </div>
        </article>
        <article className={`bird-card panel risk-${birdClass}`}>
          <div className="panel-title"><span>BIRD WATCH CONDITION</span><b>AHAS</b></div>
          <div className="bird-main-stacked">
            <div className="bird-glyph-row">
              <span className="bird-icon-symbol" aria-label="Bird hazard icon">𓅪</span>
            </div>
            <div className="bird-severity-row">
              <strong className="bird-severity">{birdRisk}</strong>
            </div>
            {(() => {
              const bwcIso = parseAhasTimestampIso(weather.birdUpdated, now);
              const calendarStampStr = formatBwcCalendarStamp(bwcIso, birdStamp);
              const ageStr = bwcIso ? calculateBirdObservationAge(bwcIso, now) : "";
              return (
                <>
                  {bwcIso && ageStr && <div className="bird-age">{ageStr}</div>}
                  <div className="bird-timestamp">{calendarStampStr}</div>
                </>
              );
            })()}
          </div>
        </article>
        {(() => {
          const hasHazard=alertDisplay.severity!=="none";
          const hazardTone=alertDisplay.colorClass.replace("alert-","");
          return (
            <article className={`forecast-card panel ${hasHazard ? "has-taf-hazard" : ""}`}>
              <div className="panel-title">
                <span>FUTURE WEATHER · NEXT 9 HOURS</span>
                <b>TAF</b>
              </div>
              {hasHazard && (
                <div className={`taf-hazard-band ${alertDisplay.shouldPulse ? "alert-pulse" : ""} ${alertDisplay.shouldFlash ? "alert-flash" : ""}`} data-tone={hazardTone}>
                  <em>
                    {alertDisplay.icon&&<span className="taf-alert-icon" aria-hidden="true">{alertDisplay.icon}</span>}
                    <span>{alertDisplay.text}</span>
                  </em>
                </div>
              )}
          <div className="forecast-list">
            {(() => {
              if (!displayForecast.length) return <div className="forecast-empty">FORECAST UNAVAILABLE</div>;
              
              // Strictly filter Future Weather to upcoming future hours (iso > now). Only display pure future blocks (1, 2, or 3).
              const displayList = displayForecast.filter(f => {
                const t = new Date(f.iso).getTime();
                return f.time !== "NOW" && Number.isFinite(t) && (debugFutureWeather||t > now.getTime());
              });

              const seenLabels = new Set<string>();
              const uniqueList = displayList.filter(f => {
                const d = new Date(f.iso);
                const label = Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2,"0")}Z` : f.time;
                if (seenLabels.has(label)) return false;
                seenLabels.add(label);
                return true;
              });

              if (!uniqueList.length) return <div className="forecast-empty">NO UPCOMING FORECAST SLOTS</div>;

              return uniqueList.slice(0, 3).map((f, i) => {
                const d = new Date(f.iso);
                const timeLabel = Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2,"0")}Z` : f.time;
                const skyDisplay=normalizeFutureSkyDisplay(f.operationalWeather?{
                  skyCondition:f.operationalWeather.skyCondition,
                  skyCoverage:f.operationalWeather.skyCoverage,
                  cloudCoverage:f.operationalWeather.cloudCoverage,
                  cloudBaseFt:f.operationalWeather.cloudBaseFt,
                  cloudLayers:f.operationalWeather.cloudLayers
                }:{skyCoverage:coverageFromCondition(f.condition),cloudBaseFt:null});
                // The row is a narrow three-up tile, so a phenomenon uses its aviation short form
                // ("LT TSTMS WITH RAIN"); the long label belongs to the wider Current Weather card.
                const conditionLabel=f.operationalWeather?(f.operationalWeather.code?f.operationalWeather.shortLabel:skyDisplay.headline):f.description;
                const precipText=formatForecastProbability(f.operationalWeather?.probability,f.precipitationProbability);
                const cigText=skyDisplay.detail;

                return (
                  <div key={`${f.time}-${i}`} className="forecast-item-tile" data-category={f.operationalWeather?.category || "unknown"}>
                    <time className="forecast-time">{timeLabel}</time>
                    <span className="forecast-icon"><WeatherIcon condition={f.condition} night={isNightAt(f.iso || f.time, solar.sunrise, solar.sunset)} /></span>
                    <div className="forecast-content-col">
                      <b className="forecast-condition">{conditionLabel}</b>
                      <span className="forecast-meta-detail">{precipText}{cigText ? ` · ${cigText}` : ""}</span>
                    </div>
                    <strong className="forecast-temp">{f.temperatureF}°</strong>
                  </div>
                );
              });
            })()}
          </div>
        </article>
      );
    })()}
      </section>
      <footer>
        <span className={`clock-status clock-${clockClass}`}><i/> {clockText}</span>
        <span className={`wx-diagnostics clock-status clock-${wxClass}`}><i/><span>{metarDiagnostic}</span><span>{tafDiagnostic}</span><span>{feedDiagnostic}</span></span>
        <span>PRESS F11 FOR FULL SCREEN</span>
      </footer>
    </div>
    <PreviewLab active={showPreview} paneDrops={paneDrops} onPaneToggle={setPaneDrops}/>
  </main>;
}
