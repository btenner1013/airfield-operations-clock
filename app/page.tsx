"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { useSystemClock, type ClockDebug } from "./useClock";
import type { Intensity } from "./weatherFx";
import { buildWeatherEffects, type WeatherDemo } from "./weatherController";
import PrecipCanvas from "./PrecipCanvas";
import PreviewLab from "./PreviewLab";
import { NO_LIGHTNING, compactLightningDisplay, lightningForAnimation, lightningPlacement, parseCurrentLightning, type LightningLevel, type LightningReport, type LightningTone } from "./lightning";
import { useLightningScheduler } from "./useLightning";
import { applyStructuredTaf, extractAviationPhenomena, parseAviationSky, parseStructuredTaf, resolveOperationalWeather } from "./aviationWeatherPriority";
import { classifyMetarFreshness, classifyTafFreshness, createRefreshCoordinator, installWeatherRefreshLifecycle, mergeWeather, parseMetarObservedAt, parseTafTimes, restoreWeatherCache, serializeWeatherCache } from "./weatherRefresh";
import { calculateBirdObservationAge, formatBwcCalendarStamp, parseAhasTimestampIso } from "./birdWatch";
import type { CloudCoverage, Forecast, SolarDay, Theme, Weather, WeatherFetchResult } from "./weatherTypes";
import { sceneFor, sceneForEffects, type SolarPhase } from "./wallpaper";
import { isFlybyWeatherAllowed } from "./flyby";
import { applyNwsPrecipitation, describePrecipitationSource, parseNwsHourlyPrecipitation } from "./nwsPrecipitation";
import { parseStandardWind, resolveCurrentWind, type CurrentWindRecord } from "./currentWind";
import WindInstrument from "./WindInstrument";
import WeatherIcon from "./WeatherIcon";
import SolarLunarInstrument from "./SolarLunarInstrument";
import BirdWatchGlyph from "./BirdWatchGlyph";
import OperationalWarning from "./OperationalWarning";
import { describeForecastSources } from "./forecastPresentation";
import { currentWeatherPresentation, currentLightningPresentation, lightningReportForDisplay } from "./currentWeatherPresentation";
import { modelWeatherFromCode } from "./modelWeather";
import { resolveMoonPreview, showLunarInformation } from "./solarLunar";
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

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:2, opsBoardWeatherUrl:"https://btenner1013.github.io/kmem-ops-board/weather.json",
  // Gridpoint for the KMEM coordinates, resolved once because the field does not move.
  // Re-derive with: https://api.weather.gov/points/35.0424,-89.9767 -> properties.forecastHourly
  nwsHourlyUrl:"https://api.weather.gov/gridpoints/MEG/45,62/forecast/hourly" };
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
function mapCode(code:number, _wind:number) {
  return modelWeatherFromCode(code);
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
  if(!Number.isFinite(epochSeconds)) return "--:--";
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
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,currentWind,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:solarDays[0]?.sunriseLocal||"--:--",sunsetLocal:solarDays[0]?.sunsetLocal||"--:--",solarDays,observationTime:currentIso,forecast,operationalWeather:null,currentLightning:{...NO_LIGHTNING},tafHazards:[],wxAlertText:"",wxAlertTone:"none",wxAlertPulse:false,wxAlertFlash:false,wxAlertVisible:false,birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",cloudCoverage:coverageFromCondition(mapped.condition),cloudBaseFt:null,visibilitySm:null,phenomena:mapped.phenomena,metarObsIso:null,tafIssueIso:null,tafValidStartIso:null,tafValidEndIso:null,metarFetchStatus:"UNKNOWN",tafFetchStatus:"UNKNOWN",bwcFetchStatus:"UNKNOWN",feedStatus:"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:null};
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
  // NWS gridpoint PoP is preferred over the model's own: it is the product line the KMEM TAF
  // is written against. A failure here is not a weather failure, so it degrades to the
  // Open-Meteo PoP already on the rows rather than blanking the forecast card.
  const nws=fetch(CONFIG.nwsHourlyUrl,{signal,headers:{Accept:"application/geo+json"}}).then(async response=>{
    if(!response.ok) throw new Error(`NWS HTTP ${response.status}`);
    return parseNwsHourlyPrecipitation(await response.json(),new Date().toISOString());
  });
  const [modelResult,feedResult,nwsResult]=await Promise.allSettled([getModelWeather(signal),feed,nws]);
  if(signal?.aborted) throw new DOMException("Weather refresh aborted","AbortError");
  const modelValid=modelResult.status==="fulfilled", modelWeather=modelValid?modelResult.value:{...FALLBACK};
  const nwsSamples=nwsResult.status==="fulfilled"?nwsResult.value:[];
  const model=nwsSamples.length?{...modelWeather,forecast:applyNwsPrecipitation(modelWeather.forecast,nwsSamples)}:modelWeather;
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
  // Tomorrow supplies the next event captions and night endpoint, not today's day/night boundary.
  const rise=parseTimeMinutes(todaySolar.sunriseLocal), set=todaySet;
  const validSolarWindow=[todaySolar,selected].every(day=>
    [day.sunriseLocal,day.sunsetLocal].every(value=>typeof value==="string"&&/^(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM))$/i.test(value.trim()))&&
    parseTimeMinutes(day.sunsetLocal)>parseTimeMinutes(day.sunriseLocal));
  
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
  return {phase, activeObject, sunrise:selected.sunriseLocal, sunset:selected.sunsetLocal, label:daylight?"DAYLIGHT":"MOON", daylight, progress:validSolarWindow?progress:NaN, markerX:safeX, markerY:safeY, isTomorrow:afterSunset};
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
    const duration = 9 + Math.random() * 4; // brisk 9s-13s transit
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
    const cc=q.get("debugCloud")?.toUpperCase().replace(/^SKC$/,"CLR"); if(cc&&["CLR","FEW","SCT","BKN","OVC","VV"].includes(cc)) setDebugCloud(cc as CloudCoverage);
    const cb=q.get("debugCloudBase"); if(cb!==null&&cb!=="") setDebugCloudBase(Number(cb));
    const wd=q.get("debugWind"); if(wd!==null&&wd!=="") setDebugWind(Number(wd));
    const ws=q.get("debugWindSpeed"); if(ws!==null&&ws!=="") setDebugWindSpeed(Number(ws));
    const windMode=q.get("debugWindMode"); if(windMode==="variable"||windMode==="calm"||windMode==="directional"||windMode==="gust"||windMode==="sector") setDebugWindMode(windMode);
    const wxAlert=q.get("debugWxAlert"); if(wxAlert==="none"||wxAlert==="info"||wxAlert==="caution"||wxAlert==="warning") setDebugWxAlert(wxAlert);
    if(q.get("debugFutureWeather")==="regression") setDebugFutureWeather(true);
    const pf=q.get("debugPerformance"); setPerf(pf==="low"?"low":"full");
    const ph=q.get("debugPhenomena"); if(ph!==null&&ph!=="") setDebugPhenomena(ph);
    const it=q.get("debugIntensity"); if(it==="light"||it==="moderate"||it==="heavy") setDebugIntensity(it);
    const vv=q.get("debugVisibility"); if(vv!==null&&vv!=="") setDebugVisibility(Number(vv));
    const gu=q.get("debugGust"); if(gu!==null&&gu!=="") setDebugGust(Number(gu));
    const rm=q.get("debugReducedMotion"); setReduced(rm==="1"?true:rm==="0"?false:matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(q.get("previewWeatherFx")==="1"||q.get("weatherDemo")==="1") setShowPreview(true);
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
  const currentPresentation=currentWeatherPresentation({
    condition:weather.condition,description:weather.description,operationalWeather:weather.operationalWeather,
    simulated:Boolean((debug && !(["night","sunrise","sunset"] as Theme[]).includes(debug)) || debugPhenomena !== null || debugCloud !== null || debugCloudBase !== null),
    phenomena:effPhenomena,coverage:effCoverage,ceiling:effBase,visibility:effVisibility,
  });
  const lightning=currentLightningPresentation({preview:debugLightning,simulated:currentPresentation.simulated,phenomena:effPhenomena,live:weather.currentLightning});
  const visualLightning=lightningForAnimation(lightning,weather.metarObsIso,now.getTime());
  const lightningPoint=lightningPlacement(lightning),flashTest=debugLightning==="flash-test";
  const {fx,spec:fxSpec,obscuration,atmosphere}=buildWeatherEffects({
    phenomena:effPhenomena,coverage:effCoverage,ceiling:effBase,visibility:effVisibility,
    windDirection:effWindDir,windSpeed:effWindSpd,gust:effGust,lightning:visualLightning,night:phase==="night",
    quality:perf,reduced,intensity:debugIntensity,paneDrops,available:condition!=="neutral"||!!debugPhenomena,
  });

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
  const displayLightning=lightningReportForDisplay(lightning,weather.metarObsIso,now.getTime());
  const lightningDisplay=resolveLightningDisplay({text:lightning.awareness?compactLightningDisplay(lightning.awareness):"NONE",level:lightning.level,tone:lightning.tone,pulse:lightning.pulse,flash:lightning.flash,isStale:displayLightning.isStale,isUnavailable:lightning.isUnavailable,sourceTime:displayLightning.sourceTime,reducedMotion:reduced});
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
  useLightningScheduler(mainRef,visualLightning,reduced,flashTest);
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
  // PoP silently falls back to the model when the pinned gridpoint stops answering, so the
  // source is stated here rather than leaving a quiet downgrade invisible on the board.
  const popDiagnostic=describePrecipitationSource(weather.forecast);
  const birdRisk=debugBird||weather.birdRisk;
  const birdClass=/SEVERE|HIGH/.test(birdRisk)?"severe":/MODERATE/.test(birdRisk)?"moderate":/LOW/.test(birdRisk)?"low":"unknown", birdStamp=zStamp(weather.birdUpdated);
  const clockZ=clock.lastCheckedUtc?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(clock.lastCheckedUtc)).replace(":","")+"Z":"—";
  const clockOffset=clock.estimatedOffsetMs!=null?`${clock.estimatedOffsetMs>=0?"+":"-"}${(Math.abs(clock.estimatedOffsetMs)/1000).toFixed(1)} SEC`:"—";
  const clockText=clock.lastCheckedUtc===null&&clock.state!=="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK…":clock.state==="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: OFFLINE":clock.state==="STALE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: STALE (GITHUB EDGE DATE)":`SRC WINDOWS SYSTEM · CHECK GITHUB EDGE DATE: ${clock.state} · OFFSET ${clockOffset} · ${clockZ}`;
  const clockClass=clock.state==="OK"?"ok":clock.state==="OFFLINE"?"off":clock.state==="CHECK"?"chk":"warn";
  const flightCat = getFlightCategory(effVisibility, effBase, effCoverage);
  const flybyAllowed = isFlybyWeatherAllowed(weather, flightCat);
  useEffect(()=>{ flybyAllowedRef.current = flybyAllowed; },[flybyAllowed]);
  const moonInfo = useMemo(() => resolveMoonPreview(getMoonPhase(now), debugMoon), [now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), debugMoon]);

  const applyWeatherDemo=(demo:WeatherDemo)=>{
    setDebug(demo.condition);setDebugCloud(demo.coverage);setDebugCloudBase(demo.coverage==="CLR"?null:demo.coverage==="SCT"?6000:1800);
    setDebugPhenomena(demo.phenomena);setDebugIntensity(null);setDebugVisibility(demo.visibility);
    setDebugWind(250);setDebugWindSpeed(demo.speed);setDebugGust(demo.gust??demo.speed);setDebugWindMode(null);setDebugLightning(demo.lightning);
    setShowSim(true);
  };
  const activeWallpaper=active==="a"?aScene:bScene;
  return <main ref={mainRef} className={`display theme-${condition} phase-${phase}`} style={sceneStyle} data-wallpaper-scene={activeWallpaper} data-wallpaper-requested={scene} data-lightning-level={lightning.level} data-lightning-source={lightning.source} data-lightning-frequency={lightning.frequency||"none"} data-lightning-direction={lightning.directions.join("-")||"none"} data-lightning-types={lightning.types.join(",")||"none"} data-lightning-reduced={reduced?"1":"0"}
    data-weather-renderer="cinematic" data-coverage={effCoverage} data-tier={cloudTierV}
    data-perf={perf} data-performance={perf} data-reduced-motion={reduced?"1":"0"}
    data-precip-type={fx.precip} data-secondary-precip-type={fx.secondaryPrecip} data-precip-intensity={fx.intensity}
    data-vicinity={fx.vicinity?"1":"0"} data-visibility={effVisibility??"unknown"}
    data-obscuration={obscuration.type} data-obscuration-density={obscuration.density.toFixed(2)}
    data-obscuration-horizon={obscuration.horizon.toFixed(2)} data-obscuration-veil={obscuration.veil.toFixed(2)}
    data-active-obscuration-layers={obscuration.layers} data-obscuration-direction={obscuration.direction}
    data-winddir={effWindDir??"VRB"} data-wind={effWindSpd} data-nx={atmosphere.windX.toFixed(2)} data-ny={atmosphere.windY.toFixed(2)}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${aScene}.png)`,opacity:active==="a"?1:0}}/><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${bScene}.png)`,opacity:active==="b"?1:0}}/><i className="cloud-field"><i className="cloud-layer cl-high"/><i className="cloud-layer cl-mid"/><i className="cloud-layer cl-low"/></i><PrecipCanvas spec={fxSpec} atmosphere={atmosphere} backgroundSrc={`${imageBase}/assets/backgrounds/${activeWallpaper}.png`} paused={false} night={phase==="night"}/><i className="obscuration-field"><b/><b/><b/></i>{activeFlyby && debugFlybyEnabled !== false && (<i className="air-traffic"><span className={`flyby flyby-${activeFlyby.direction}`} key={activeFlyby.id} style={{top:`${activeFlyby.top}%`,animationDuration:`${activeFlyby.duration}s`}}><span className="c17-photo-container"><img src={`${imageBase}/assets/c17-source-${activeFlyby.direction}.png`} alt="C-17 Globemaster III" className="c17-photo-img" /><span className="c17-photo-lights"><i className="beacon-tail-red"/><i className="beacon-belly-red"/><i className="nav-port-red"/><i className="nav-starboard-green"/><i className="strobe-wing-white port"/><i className="strobe-wing-white starboard"/></span></span></span></i>)}<i className="lightning-layer"><i className="lightning-glow"/><i className="lightning-horizon-glow"/><i className="lightning-bolt-overlay" style={{backgroundImage:`url(${imageBase}/lightning-bolt-isolated.png)`}}/></i><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><img className="brand-logo" src={`${imageBase}/assets/patch-155.png`} alt="155 Patch" /><div><strong>164AW Airfield Management</strong><small>KMEM - FREDERICK W. SMITH INTERNATIONAL - MEMPHIS, TN</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong><strong>JULIAN {julian4(now)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{local.timeZoneName||"LOCAL"}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel">
          <div className="panel-title"><span>{showLunarInformation(effSolar) ? "SOLAR / LUNAR" : "SOLAR"}</span><b>LOCAL</b></div>
          <SolarLunarInstrument solar={effSolar} moon={moonInfo} />
        </article>
        <article className="weather-card panel">
          <div className="panel-title">
            <span>{currentPresentation.simulated ? "PREVIEW WEATHER" : "CURRENT WEATHER"}</span>
            <b className={`metar-title-badge health-${feed !== "OK" ? (feed === "OFFLINE" ? "unavailable" : "stale") : metarState.toLowerCase()}`}>
              {currentPresentation.simulated ? "SIMULATED" : feed !== "OK" ? `METAR FEED ${feed}` : `METAR ${metarState}`}
            </b>
          </div>
          <div className="current-weather-instrument">
            <div className="current-weather-hero">
              <strong className="current-temperature">{weather.temperatureF ?? "--"}°<small>F</small></strong>
              <span className="current-weather-glyph"><WeatherIcon condition={currentPresentation.condition} codes={currentPresentation.codes} night={!effSolar.daylight || phase === "night"} /></span>
            </div>
            <b className="current-condition">{currentPresentation.label}{currentPresentation.secondaryLabel && <span className="weather-modifier"> · {currentPresentation.secondaryLabel}</span>}</b>
            <div className="current-weather-stats">
              <div><span>FEELS LIKE</span><strong>{weather.feelsLikeF??weather.temperatureF}°F</strong></div>
              <div><span>HUMIDITY</span><strong>{weather.humidity}%</strong></div>
              <div className="current-ceiling"><span>CEILING</span><strong>{currentPresentation.condition === "neutral" || (!currentPresentation.simulated && (!weather.operationalWeather || weather.operationalWeather.skyCondition === "unavailable")) ? "UNAVAILABLE" : effCoverage && ["BKN","OVC","VV"].includes(effCoverage) ? effBase !== null ? `${effCoverage} ${effBase.toLocaleString()} FT` : "UNAVAILABLE" : "UNLIMITED (UNL)"}</strong></div>
            </div>
            {/* Lightning remains an exception: no report means no row. */}
            {lightningDisplay.severity!=="none"&&(
              <OperationalWarning kind="current" text={lightningDisplay.text} tone={lightningDisplay.colorClass.replace("lightning-", "")}
                pulse={lightningDisplay.shouldPulse} flash={lightningDisplay.shouldFlash} stale={lightningDisplay.isStale}
                sourceTime={lightningDisplay.sourceTime} sourceStamp={aviationStamp(lightningDisplay.sourceTime)} preview={lightning.source === "debug"} />
            )}
          </div>
        </article>
        <article className="wind-card panel">
          <div className="panel-title"><span>WIND & FLIGHT CAT</span></div>
          <div className="wind-main-stacked">
            <WindInstrument wind={effectiveWind} nowMs={now.getTime()} reduced={reduced} />
            <div className="wind-flight-meta-centered">
              <span className="flight-cat-pill" style={{ borderColor: flightCat.color, color: flightCat.color, background: `${flightCat.color}22` }}>{flightCat.cat}</span>
              <span className="wind-vis-tag">VIS <strong>{effVisibility ?? 10} SM</strong></span>
            </div>
          </div>
        </article>
        <article className={`bird-card panel risk-${birdClass}`}>
          <div className="panel-title"><span>BIRD WATCH</span><b>AHAS</b></div>
          <div className="bird-watch-instrument">
            <div className="bird-watch-reading">
              <BirdWatchGlyph />
              <div><span className="bird-watch-label">CONDITION</span><strong className="bird-severity">{birdRisk}</strong></div>
            </div>
            {(() => {
              const bwcIso = parseAhasTimestampIso(weather.birdUpdated, now);
              const calendarStampStr = formatBwcCalendarStamp(bwcIso, birdStamp);
              const ageStr = bwcIso ? calculateBirdObservationAge(bwcIso, now) : "";
              return (
                <div className="bird-watch-update">
                  <div className="bird-observation-age" data-age-state={!ageStr ? "unavailable" : ageStr.startsWith("FUTURE OBS") ? "future" : "elapsed"}>
                    <span className="bird-watch-label">OBSERVATION AGE</span>
                    <div className="bird-age">{ageStr || "AGE UNAVAILABLE"}</div>
                  </div>
                  <div className="bird-timestamp">{calendarStampStr}</div>
                </div>
              );
            })()}
          </div>
        </article>
        {(() => {
          const hasHazard=alertDisplay.severity!=="none";
          const hazardTone=alertDisplay.colorClass.replace("alert-","");
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

          const forecastSource=describeForecastSources(uniqueList.slice(0, 3));
          return (
            <article className={`forecast-card panel ${hasHazard ? "has-taf-hazard" : ""}`}>
              <div className="panel-title">
                <span>FUTURE WEATHER <small>UPCOMING · ZULU</small></span>
                <b className="forecast-source-badge" title={forecastSource.detail}>{forecastSource.label}</b>
              </div>
              {hasHazard && (
                <OperationalWarning kind="weather" text={alertDisplay.text} icon={alertDisplay.icon} tone={hazardTone}
                  pulse={alertDisplay.shouldPulse} flash={alertDisplay.shouldFlash} preview={Boolean(debugAlert)} feedStatus={feed} />
              )}
          <div className="forecast-list">
            {(() => {
              if (!displayForecast.length) return <div className="forecast-empty">FORECAST UNAVAILABLE</div>;
              
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
                // Each of the three rows uses the phenomenon's aviation short form
                // ("LT TSTMS WITH RAIN"); the long label belongs to the wider Current Weather card.
                const conditionLabel=f.operationalWeather?(f.operationalWeather.code?`${f.operationalWeather.shortLabel}${f.operationalWeather.secondaryLabel ? ` · ${f.operationalWeather.secondaryLabel}` : ""}`:skyDisplay.headline):f.description;
                const precipText=formatForecastProbability(f.operationalWeather?.probability,f.precipitationProbability);
                const cigText=skyDisplay.detail;

                return (
                  <div key={`${f.time}-${i}`} className="forecast-item-tile" data-category={f.operationalWeather?.category || "unknown"}>
                    <time className="forecast-time">{timeLabel}</time>
                    <span className="forecast-icon"><WeatherIcon condition={f.condition} codes={f.operationalWeather?.codes ?? f.phenomena} night={isNightAt(f.iso || f.time, solar.sunrise, solar.sunset)} /></span>
                    <div className="forecast-content-col">
                      <b className="forecast-condition">{conditionLabel}</b>
                      <span className="forecast-meta-detail"><span className="forecast-probability">{precipText}</span>{cigText && <span>{cigText}</span>}</span>
                    </div>
                    <strong className="forecast-temp">{f.temperatureF}°<small>F</small></strong>
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
        <span className={`wx-diagnostics clock-status clock-${wxClass}`}><i/><span>{metarDiagnostic}</span><span>{tafDiagnostic}</span><span>{feedDiagnostic}</span><span>{popDiagnostic}</span></span>
        <span>PRESS F11 FOR FULL SCREEN</span>
      </footer>
    </div>
    <PreviewLab active={showPreview} paneDrops={paneDrops} onPaneToggle={setPaneDrops} onWeatherDemo={applyWeatherDemo} quality={perf} onQuality={setPerf}/>
  </main>;
}
