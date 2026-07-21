"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSystemClock, type ClockDebug } from "./useClock";
import { buildFxSpec, buildObscurationSpec, classifyEffect, type Intensity } from "./weatherFx";
import PrecipCanvas from "./PrecipCanvas";
import PreviewLab from "./PreviewLab";
import { NO_LIGHTNING, debugLightningReport, lightningPlacement, parseCurrentLightning, type LightningLevel, type LightningSource, type LightningReport } from "./lightning";
import { useLightningScheduler } from "./useLightning";
import { applyStructuredTaf, extractAviationPhenomena, formatTafWindow, parseAviationSky, parseStructuredTaf, resolveOperationalWeather, type OperationalWeather } from "./aviationWeatherPriority";
import { classifyMetarFreshness, classifyTafFreshness, createRefreshCoordinator, installWeatherRefreshLifecycle, mergeWeather, parseMetarObservedAt, parseTafTimes, restoreWeatherCache, serializeWeatherCache } from "./weatherRefresh";
import type { CloudCoverage, Forecast, SolarDay, Theme, Weather, WeatherFetchResult } from "./weatherTypes";

type Flyby = { top:number; cycle:number; delay:number; scale:number; tilt:number; direction:"ltr"|"rtl" };
type Phase = "day"|"night"|"sunrise"|"sunset";
type OpsBoardWeather = {
  metar?:string;
  taf?:string;
  metarFetchStatus?:string;
  tafFetchStatus?:string;
  metarObservedZ?:string;
  bwc?:string;
  bwcAhasRisk?:string;
  bwcBasedOn?:string;
  bwcUpdatedZ?:string;
  bwcFetchStatus?:string;
  lightning?:string;
  lightningSeverity?:string;
  lightningFlash?:boolean;
  lightningPulse?:boolean;
  lightningSource?:string;
  lightningLogText?:string;
};
// Normalized scene object (Phase 2A): the single source of truth the renderer reads, kept
// deliberately separate from weather parsing so animation layers never re-parse METAR.
type SceneModel = { baseScene:string; cloudCoverage:CloudCoverage; cloudBaseFt:number|null; phenomena:string[]; intensity:"light"|"moderate"|"heavy"; vicinityOnly:boolean; windDirectionDeg:number|null; windSpeedKt:number; gustKt:number|null; visibilitySm:number|null; timePhase:Phase };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:2, opsBoardWeatherUrl:"https://btenner1013.github.io/kmem-ops-board/weather.json" };
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", windSpeedKt:0, windDirection:"—", windDegrees:null, windGustKt:null, humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", solarDays:[], observationTime:"", forecast:[], operationalWeather:null, currentLightning:{...NO_LIGHTNING}, tafHazards:[], birdRisk:"UNAVAILABLE", birdBasis:"—", birdUpdated:"—", source:"MODEL", cloudCoverage:"CLR", cloudBaseFt:null, visibilitySm:null, phenomena:[], metarObsIso:null, tafIssueIso:null, tafValidStartIso:null, tafValidEndIso:null, metarFetchStatus:"UNKNOWN", tafFetchStatus:"UNKNOWN", bwcFetchStatus:"UNKNOWN", feedStatus:"DEGRADED", requestStatus:"IDLE", lastRefreshAttemptIso:null, lastRefreshSuccessIso:null, feedError:"NO DATA" };
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
function windDirection(deg:number) { const d=["N","NE","E","SE","S","SW","W","NW"]; return d[Math.round(deg/45)%8]; }
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
  return { baseScene:sceneFor(condition,phase,coverage), cloudCoverage:coverage, cloudBaseFt:debug?null:(weather.cloudBaseFt??null), phenomena, intensity:deriveIntensity(phenomena), vicinityOnly:phenomena.length>0&&phenomena.every(p=>p.startsWith("VC")), windDirectionDeg:weather.windDegrees, windSpeedKt:weather.windSpeedKt, gustKt:weather.windGustKt, visibilitySm:debug?null:(weather.visibilitySm??null), timePhase:phase };
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
  const sky=parseAviationSky(raw), operationalWeather=resolveOperationalWeather({text:raw,...sky,sourceKind:"METAR"}), currentLightning=parseCurrentLightning(raw), temp=raw.match(/\s(M?\d{2})\/(?:M?\d{2}|XX)\s/), wind=raw.match(/(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT(?:\s|$)/);
  const degrees=wind&&wind[1]!=="VRB"?Number(wind[1]):null;
  return { condition:operationalWeather.condition, description:operationalWeather.label, operationalWeather, currentLightning, temperatureF:temp?cToF(signedCelsius(temp[1])):null, windSpeedKt:wind?Number(wind[2]):null, windGustKt:wind?.[3]?Number(wind[3]):null, windDegrees:degrees, windDirection:degrees===null?"VRB":windDirection(degrees) };
}
async function getModelWeather(signal?:AbortSignal):Promise<Weather> {
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=2`;
  const r=await fetch(url,{signal}); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  const tm=(iso:string)=>iso?.slice(11,16)||"--:--", utcOffset=Number(j.utc_offset_seconds||0), utcIso=(iso:string)=>new Date(new Date(`${iso}:00Z`).getTime()-utcOffset*1000).toISOString();
  const start=Math.max(0,j.hourly.time.findIndex((t:string)=>t>=j.current.time));
  const forecast:Forecast[]=[2,5,8].map(offset=>{const i=Math.min(start+offset,j.hourly.time.length-1),condition=mapCode(j.hourly.weather_code[i],0);return {time:tm(j.hourly.time[i]),iso:utcIso(j.hourly.time[i]),temperatureF:Math.round(j.hourly.temperature_2m[i]),...condition,precipitation:Math.round(j.hourly.precipitation_probability[i]||0),source:"MODEL",operationalWeather:null}});
  const windDegrees=Math.round(j.current.wind_direction_10m);
  const solarDays:SolarDay[]=j.daily.time.map((date:string,i:number)=>({date,sunriseLocal:tm(j.daily.sunrise[i]),sunsetLocal:tm(j.daily.sunset[i])}));
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,windSpeedKt:Math.round(j.current.wind_speed_10m),windDirection:windDirection(windDegrees),windDegrees,windGustKt:null,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:solarDays[0]?.sunriseLocal||"--:--",sunsetLocal:solarDays[0]?.sunsetLocal||"--:--",solarDays,observationTime:j.current.time,forecast,operationalWeather:null,currentLightning:{...NO_LIGHTNING},tafHazards:[],birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",cloudCoverage:coverageFromCondition(mapped.condition),cloudBaseFt:null,visibilitySm:null,phenomena:phenomenaFromCondition(mapped.condition),metarObsIso:null,tafIssueIso:null,tafValidStartIso:null,tafValidEndIso:null,metarFetchStatus:"UNKNOWN",tafFetchStatus:"UNKNOWN",bwcFetchStatus:"UNKNOWN",feedStatus:"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:null};
}
function isOpsBoardWeather(value:unknown):value is OpsBoardWeather { return !!value&&typeof value==="object"&&(typeof (value as OpsBoardWeather).metar==="string"||typeof (value as OpsBoardWeather).taf==="string"); }
function upstreamStatus(value:string|undefined) { return (value||"UNKNOWN").trim().toUpperCase(); }
function resolveCurrentLightning(ops:OpsBoardWeather, metarFallback:LightningReport):LightningReport {
  const sev = ops.lightningSeverity?.toLowerCase();
  if (sev && ["none","distant","vicinity","station","severe"].includes(sev)) {
    if (sev === "none") return { level:"none",source:"none",code:null,frequency:null,types:[],directions:[],awareness:null };
    const level = sev as LightningLevel;
    const source = (ops.lightningSource?.toLowerCase().replace("_","-") || "none") as LightningSource;
    const awareness = ops.lightningLogText || metarFallback.awareness || (level === "vicinity" ? "VCTS" : "TS OVR FIELD");
    return {
      level,
      source,
      code: metarFallback.code || "TS",
      frequency: metarFallback.frequency,
      types: metarFallback.types,
      directions: metarFallback.directions,
      awareness
    };
  }
  return metarFallback;
}
async function getWeather(signal?:AbortSignal):Promise<WeatherFetchResult> {
  const feed=fetch(`${CONFIG.opsBoardWeatherUrl}?v=${Date.now()}_${Math.random().toString(36).slice(2)}`,{cache:"no-store",signal}).then(async response=>{if(!response.ok) throw new Error(`FEED HTTP ${response.status}`);const json:unknown=await response.json();if(!isOpsBoardWeather(json)) throw new Error("MALFORMED FEED");return json;});
  const [modelResult,feedResult]=await Promise.allSettled([getModelWeather(signal),feed]);
  if(signal?.aborted) throw new DOMException("Weather refresh aborted","AbortError");
  const modelValid=modelResult.status==="fulfilled", model=modelValid?modelResult.value:{...FALLBACK};
  if(feedResult.status==="rejected") return {weather:{...model,feedStatus:"DEGRADED",feedError:feedResult.reason instanceof Error?feedResult.reason.message:"FEED FETCH FAILED"},metarValid:false,tafValid:false,modelValid,feedReached:false};
  const ops=feedResult.value, rawMetar=ops.metar||"", rawTaf=ops.taf||"", reference=new Date();
  const metarSyntax=/\b(?:(?:METAR|SPECI)\s+)?KMEM\b/.test(rawMetar.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawMetar.toUpperCase());
  const metarObsIso=metarSyntax?parseMetarObservedAt(rawMetar,ops.metarObservedZ,reference):null, metarValid=metarSyntax&&metarObsIso!==null;
  const tafSyntax=/\bTAF(?:\s+(?:AMD|COR))?\s+KMEM\b/.test(rawTaf.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawTaf.toUpperCase());
  const tafTimes=tafSyntax?parseTafTimes(rawTaf,reference):{issueIso:null,validStartIso:null,validEndIso:null}, tafEnvelopeValid=tafSyntax&&tafTimes.issueIso!==null&&tafTimes.validStartIso!==null&&tafTimes.validEndIso!==null;
  const tafTimeline=tafEnvelopeValid?parseStructuredTaf(rawTaf,reference):null, tafValid=tafEnvelopeValid&&tafTimeline!==null;
  const tafProduct=tafTimeline?applyStructuredTaf(model.forecast,tafTimeline,reference):null;
  const metar=metarValid?parseMetar(rawMetar):null, sky=metarValid?parseAviationSky(rawMetar):null, phenomena=metarValid?extractAviationPhenomena(rawMetar):null;
  const metarFetchStatus=upstreamStatus(ops.metarFetchStatus), tafFetchStatus=upstreamStatus(ops.tafFetchStatus), bwcFetchStatus=upstreamStatus(ops.bwcFetchStatus);
  const healthy=metarValid&&tafValid&&metarFetchStatus==="OK"&&tafFetchStatus==="OK";
  const weather:Weather={...model,temperatureF:metar?.temperatureF??model.temperatureF,condition:metar?.condition??model.condition,description:metar?.description??model.description,operationalWeather:metar?.operationalWeather??model.operationalWeather,currentLightning:metar?.currentLightning??model.currentLightning,windSpeedKt:metar?.windSpeedKt??model.windSpeedKt,windDirection:metar?.windDirection??model.windDirection,windDegrees:metar?.windDegrees??model.windDegrees,windGustKt:metar?.windGustKt??model.windGustKt,observationTime:metarValid?metarObsIso:model.observationTime,forecast:tafProduct?.forecast??model.forecast,tafHazards:tafProduct?.hazards??[],birdRisk:(ops.bwcAhasRisk||ops.bwc||"UNAVAILABLE").toUpperCase(),birdBasis:(ops.bwcBasedOn||"AHAS").toUpperCase(),birdUpdated:ops.bwcUpdatedZ||"—",source:metarValid?"METAR":"MODEL",cloudCoverage:sky?.cloudCoverage??model.cloudCoverage,cloudBaseFt:sky?sky.cloudBaseFt:model.cloudBaseFt,visibilitySm:sky?sky.visibilitySm:model.visibilitySm,phenomena:metarValid?(phenomena??[]):model.phenomena,metarObsIso:metarValid?metarObsIso:null,tafIssueIso:tafTimes.issueIso,tafValidStartIso:tafTimes.validStartIso,tafValidEndIso:tafTimes.validEndIso,metarFetchStatus,tafFetchStatus,bwcFetchStatus,feedStatus:healthy?"OK":"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:healthy?null:"UPSTREAM DEGRADED",rawMetar:metarValid?rawMetar:null};
  weather.currentLightning=resolveCurrentLightning(ops,weather.currentLightning);
  return {weather,metarValid,tafValid,modelValid,feedReached:true};
}
function weatherGlyph(c:Theme) { return ({clear:"☀",night:"☾",rain:"🌧", "heavy-rain":"🌧",thunderstorm:"⛈",snow:"❄",fog:"≋",overcast:"☁","partly-cloudy":"⛅",sunrise:"☀",sunset:"☀",neutral:"—"} as Record<Theme,string>)[c]; }
function WeatherIcon({condition,night=false}:{condition:Theme;night?:boolean}) {
  const theme=condition==="clear"&&night?"night":condition;
  return <i className={`wx-pictogram wxp-${theme} ${night?"wxp-nighttime":""}`} aria-hidden="true"><span className="wxp-sun"/><span className="wxp-moon"/><span className="wxp-cloud"/><span className="wxp-precip"><b/><b/><b/></span><span className="wxp-flakes"><b>✦</b><b>✦</b><b>✦</b></span><span className="wxp-bolt"/><span className="wxp-fog-lines"><b/><b/><b/></span></i>;
}
function isNightAt(time:string,sunrise:string,sunset:string) { const parse=(v:string)=>{const [h,m]=v.split(":").map(Number);return h*60+m}; const clock=parse(time),rise=parse(sunrise),set=parse(sunset); return Number.isFinite(clock)&&Number.isFinite(rise)&&Number.isFinite(set)&&(clock<rise||clock>set); }
function tafQualifier(weather:OperationalWeather|null):string {
  if(!weather) return "MODEL";
  return ({TAF_BASE:"PREVAILING",TAF_FM:"FM",TAF_TEMPO:"TEMPO",TAF_PROB30:"PROB30",TAF_PROB40:"PROB40",TAF_PROB30_TEMPO:"PROB30 TEMPO",TAF_PROB40_TEMPO:"PROB40 TEMPO",METAR:"METAR",MODEL:"MODEL"} as const)[weather.sourceKind];
}
function tafCardCondition(weather:OperationalWeather|null,fallback:string):string {
  if(!weather) return fallback;
  const qualifier=tafQualifier(weather),qualified=!['PREVAILING','FM','MODEL','METAR'].includes(qualifier);
  const condition=weather.label;
  return qualified?`${qualifier} ${condition}`:condition;
}
function solarPhase(nowParts:Record<string,string>, sunrise:string, sunset:string):"day"|"night"|"sunrise"|"sunset" {
  const clock=Number(nowParts.hour)*60+Number(nowParts.minute), parse=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m};
  const rise=parse(sunrise), set=parse(sunset); if(!Number.isFinite(rise)||!Number.isFinite(set)) return clock<360||clock>1200?"night":"day";
  if(clock>=rise-30&&clock<=rise+60) return "sunrise";
  if(clock>=set-60&&clock<=set+20) return "sunset";
  return clock<rise-30||clock>set+20?"night":"day";
}
function dateKey(date:Date,zone:string) { const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
function solarWindow(now:Date,nowParts:Record<string,string>,days:SolarDay[],fallbackRise:string,fallbackSet:string) {
  const parse=(v:string)=>{const [h,m]=v.split(":").map(Number);return h*60+m}, today=dateKey(now,CONFIG.timeZone), current=Number(nowParts.hour)*60+Number(nowParts.minute)+Number(nowParts.second||0)/60;
  const todayIndex=Math.max(0,days.findIndex(d=>d.date===today)), todaySolar=days[todayIndex]||{date:today,sunriseLocal:fallbackRise,sunsetLocal:fallbackSet};
  const todaySet=parse(todaySolar.sunsetLocal), afterSunset=Number.isFinite(todaySet)&&current>todaySet, selected=afterSunset?(days[todayIndex+1]||todaySolar):todaySolar;
  const rise=parse(selected.sunriseLocal), set=parse(selected.sunsetLocal), selectedIsToday=selected.date===today, daylight=selectedIsToday&&current>=rise&&current<=set;
  const progress=daylight&&set>rise?Math.max(0,Math.min(100,((current-rise)/(set-rise))*100)):0;
  let markerX=8+progress*.84, markerY=76-Math.sin((progress/100)*Math.PI)*59;
  if(!daylight) { const nightStart=parse(todaySolar.sunsetLocal), nightEnd=1440+rise, nightClock=current<rise?current+1440:current, nightProgress=Math.max(0,Math.min(1,(nightClock-nightStart)/(nightEnd-nightStart))); markerX=92-nightProgress*84; markerY=76+Math.sin(nightProgress*Math.PI)*18; }
  return {sunrise:selected.sunriseLocal,sunset:selected.sunsetLocal,label:selectedIsToday?"TODAY":"TOMORROW",daylight,progress,markerX,markerY};
}
function zStamp(value:string) { const match=(value||"").match(/\d{4}-\d{2}-(\d{2})[ T](\d{2}):(\d{2})/); return match?`${match[1]}/${match[2]}${match[3]}Z`:"—"; }
function aviationStamp(value:string|null) { const time=value?Date.parse(value):NaN; if(!Number.isFinite(time)) return "—"; const d=new Date(time); return `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCHours()).padStart(2,"0")}${String(d.getUTCMinutes()).padStart(2,"0")}Z`; }
// Maps a normalized condition + solar phase onto one of the 16 wallpaper assets in
// public/assets/backgrounds/. Precipitation and obscuration always keep their own weather
// wallpaper (day/night) and never fall back to a clear sunrise/sunset frame; only clear skies
// use the dedicated sunrise/sunset art. heavy-rain shares the rain wallpaper (intensity is an
// animation concern, not a separate scene).
function sceneFor(condition:Theme,phase:"day"|"night"|"sunrise"|"sunset",coverage:CloudCoverage="CLR") {
  const light=phase==="night"?"night":"day";
  if(condition==="rain"||condition==="heavy-rain") return `rain-${light}`;
  if(condition==="thunderstorm") return `thunderstorm-${light}`;
  if(condition==="snow") return `snow-${light}`;
  if(condition==="fog") return `fog-${light}`;
  // Clear/partly/overcast with no significant weather: at sunrise/sunset use the dedicated solar
  // wallpaper only when coverage is light enough (CLR/FEW/SCT) so the horizon stays dominant. BKN/OVC/
  // VV keep their cloudy/overcast wallpaper and receive solar grading via the phase-* class instead.
  if((phase==="sunrise"||phase==="sunset")&&(coverage==="CLR"||coverage==="FEW"||coverage==="SCT")) return phase;
  if(condition==="overcast") return `overcast-${light}`;
  if(condition==="partly-cloudy") return `partly-cloudy-${light}`;
  if(phase==="sunrise") return "sunrise";
  if(phase==="sunset") return "sunset";
  return `clear-${light}`;
}
function cloudSceneForCoverage(coverage:CloudCoverage,phase:Phase) {
  const condition:Theme=coverage==="OVC"||coverage==="VV"||coverage==="BKN"?"overcast":coverage==="FEW"||coverage==="SCT"?"partly-cloudy":"clear";
  return sceneFor(condition,phase,coverage);
}
// Obscurations need a recognizable world behind their procedural layers. Mild/spatial variants use
// a readable runway scene, while only genuinely dense full fog uses the photographic fog family.
function sceneForEffects(baseScene:string,obscuration:ReturnType<typeof buildObscurationSpec>["type"],visibilitySm:number|null,phase:Phase,coverage:CloudCoverage) {
  const light=phase==="night"?"night":"day",visibility=visibilitySm??10;
  if(obscuration==="mist") return sceneFor("partly-cloudy",phase,"SCT");
  if(obscuration==="shallow-fog"||obscuration==="patchy-fog"||obscuration==="partial-fog") return sceneFor("partly-cloudy",phase,"SCT");
  if(obscuration==="fog") return visibility>=1.5?`overcast-${light}`:`fog-${light}`;
  if(obscuration==="freezing-fog") return `fog-${light}`;
  if(obscuration==="haze") return cloudSceneForCoverage(coverage,phase);
  if(obscuration==="smoke"||obscuration==="volcanic-ash") return `overcast-${light}`;
  if(["dust","blowing-dust","drifting-dust","sand","blowing-sand","drifting-sand","dust-storm","sandstorm","dust-whirl"].includes(obscuration)) return sceneFor("partly-cloudy",phase,"SCT");
  return baseScene;
}

export default function Home() {
  const [weather,setWeather]=useState<Weather>(FALLBACK); const weatherRef=useRef<Weather>(FALLBACK); const [debug,setDebug]=useState<Theme|null>(null); const [debugPhase,setDebugPhase]=useState<"day"|"night"|"sunrise"|"sunset"|null>(null); const [debugBird,setDebugBird]=useState<"LOW"|"MODERATE"|"SEVERE"|null>(null); const [flybys,setFlybys]=useState<Flyby[]>([]);
  const [debugCloud,setDebugCloud]=useState<CloudCoverage|null>(null); const [debugCloudBase,setDebugCloudBase]=useState<number|null>(null); const [debugWind,setDebugWind]=useState<number|null>(null); const [debugWindSpeed,setDebugWindSpeed]=useState<number|null>(null); const [perf,setPerf]=useState<"full"|"low">("full");
  const [debugPhenomena,setDebugPhenomena]=useState<string|null>(null); const [debugIntensity,setDebugIntensity]=useState<Intensity|null>(null); const [debugVisibility,setDebugVisibility]=useState<number|null>(null); const [debugGust,setDebugGust]=useState<number|null>(null); const [reduced,setReduced]=useState(false); const [paneDrops,setPaneDrops]=useState<boolean|null>(null);
  const [showPreview,setShowPreview]=useState(false); const [debugLightning,setDebugLightning]=useState<string|null>(null); const mainRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{ if(typeof matchMedia==="undefined") return; const mq=matchMedia("(prefers-reduced-motion: reduce)"); const on=()=>setReduced(mq.matches); on(); mq.addEventListener?.("change",on); return()=>mq.removeEventListener?.("change",on); },[]);
  const [aScene,setAScene]=useState("clear-night"); const [bScene,setBScene]=useState("clear-night"); const [active,setActive]=useState<"a"|"b">("a");
  const cfRef=useRef<{active:"a"|"b";a:string;b:string}>({active:"a",a:"clear-night",b:"clear-night"}); cfRef.current={active,a:aScene,b:bScene};
  const clockDebug=useMemo<ClockDebug|undefined>(()=>{ if(typeof location==="undefined") return undefined; const q=new URLSearchParams(location.search); const off=q.get("debugClockOffset"), chk=q.get("debugClockCheck"); return { offsetMs: off!=null&&off!==""?Number(off):undefined, force:(chk==="offline"||chk==="stale"||chk==="warning")?chk:undefined }; },[]);
  const {now,status:clock}=useSystemClock(clockDebug);
  useEffect(()=>{ setFlybys(Array.from({length:3},(_,i)=>({top:11+Math.random()*25,cycle:96+i*23+Math.random()*19,delay:7+i*39+Math.random()*16,scale:.78+Math.random()*.25,tilt:-2+Math.random()*4,direction:Math.random()>.5?"ltr":"rtl"}))); },[]);
  useEffect(()=>{
    const q=new URLSearchParams(location.search), sim=q.get("debugWeather") as Theme|null, simPhase=q.get("debugTime"), simBird=q.get("debugBwc")?.toUpperCase(); if(sim&&DEBUG_THEMES.includes(sim)) setDebug(sim); if(simPhase==="day"||simPhase==="night"||simPhase==="sunrise"||simPhase==="sunset") setDebugPhase(simPhase); if(simBird==="LOW"||simBird==="MODERATE"||simBird==="SEVERE") setDebugBird(simBird);
    const cc=q.get("debugCloud")?.toUpperCase(); if(cc&&["CLR","FEW","SCT","BKN","OVC","VV"].includes(cc)) setDebugCloud(cc as CloudCoverage);
    const cb=q.get("debugCloudBase"); if(cb!==null&&cb!=="") setDebugCloudBase(Number(cb));
    const wd=q.get("debugWind"); if(wd!==null&&wd!=="") setDebugWind(Number(wd));
    const ws=q.get("debugWindSpeed"); if(ws!==null&&ws!=="") setDebugWindSpeed(Number(ws));
    const pf=q.get("debugPerformance"); setPerf(pf==="low"?"low":pf==="full"?"full":detectPerf());
    const ph=q.get("debugPhenomena"); if(ph!==null&&ph!=="") setDebugPhenomena(ph);
    const it=q.get("debugIntensity"); if(it==="light"||it==="moderate"||it==="heavy") setDebugIntensity(it);
    const vv=q.get("debugVisibility"); if(vv!==null&&vv!=="") setDebugVisibility(Number(vv));
    const gu=q.get("debugGust"); if(gu!==null&&gu!=="") setDebugGust(Number(gu));
    const rm=q.get("debugReducedMotion"); setReduced(rm==="1"?true:rm==="0"?false:matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(q.get("previewWeatherFx")==="1") setShowPreview(true);
    const pd=q.get("debugPaneDrops"); if(pd==="on") setPaneDrops(true); else if(pd==="off") setPaneDrops(false);
    const ltg=q.get("debugLightning"); if(ltg) setDebugLightning(ltg);
    navigator.serviceWorker?.register("./service-worker.js").catch(()=>{});
  },[]);
  // Weather refresh lifecycle — deliberately separate from the clock. One coordinator owns the
  // request, timeout, interval, wake listeners, supersession, cache, and unmount cleanup.
  useEffect(()=>{
    const commit=(next:Weather)=>{weatherRef.current=next;setWeather(next);};
    try{const cached=restoreWeatherCache(localStorage.getItem("kmem-weather"));if(cached) commit(cached);}catch{}
    const coordinator=createRefreshCoordinator<WeatherFetchResult>({
      fetcher:signal=>getWeather(signal),
      onAttempt:(_reason,atIso)=>commit({...weatherRef.current,requestStatus:"REFRESHING",lastRefreshAttemptIso:atIso,feedError:null}),
      onResult:(result,_reason,atIso)=>{
        const prior=weatherRef.current, feedStatus=result.feedReached?result.weather.feedStatus:(navigator.onLine?"DEGRADED":"OFFLINE");
        const validFeedSnapshot=result.feedReached&&(result.metarValid||result.tafValid);
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
  const displayTheme=debug||weather.condition;
  const phase=debugPhase||(debug?(debug==="night"||debug==="sunrise"||debug==="sunset"?debug:"day"):solarPhase(local,weather.sunriseLocal,weather.sunsetLocal));
  const condition=debug&&!(["night","sunrise","sunset"] as Theme[]).includes(debug)?debug:weather.condition;
  const imageBase=process.env.NEXT_PUBLIC_BASE_PATH||"";
  const sceneModel=buildScene(weather,condition,phase,!!debug);
  // Phase 2B — effective cloud params (debug overrides win) feed the procedural cloud layers via CSS.
  const effCoverage=debugCloud||sceneModel.cloudCoverage;
  const effBase=debugCloudBase!=null?debugCloudBase:sceneModel.cloudBaseFt;
  const effWindDir=debugWind!=null?debugWind:sceneModel.windDirectionDeg;
  const effWindSpd=debugWindSpeed!=null?debugWindSpeed:sceneModel.windSpeedKt;
  const effGust=debugGust!=null?debugGust:sceneModel.gustKt;
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
  
  // High-ceiling visual sanity correction:
  // If the lowest ceiling is at/above 18,000 ft, lower FEW/SCT layers are present, and there is no active rain/snow/thunderstorm,
  // fall back to the partly-cloudy theme background visually.
  let visualBaseScene = sceneModel.baseScene;
  const metarText = weather.rawMetar || "";
  
  // 1. High-ceiling visual sanity rule (18,000 ft + lower SCT/FEW breaks)
  const isHighCeiling = (effCoverage === "BKN" || effCoverage === "OVC") && effBase !== null && effBase >= 18000;
  const hasLowerLayer = /\b(FEW|SCT)\d{3}\b/.test(metarText);
  const forceHighCeiling = isHighCeiling && (hasLowerLayer || debugCloudBase !== null);

  // 2. Mid/High BKN/OVC ceiling sanity rule (>= 5,000 ft, daylight, no active precip/fog/thunderstorm/snow)
  const isDaylight = phase === "day" || phase === "sunrise" || phase === "sunset";
  const hasNoSevereWx = !["rain", "heavy-rain", "thunderstorm", "fog", "snow"].includes(condition);
  const isHighOrMidCeiling = effBase !== null && effBase >= 5000;
  const forceMidCeilingBrighter = (effCoverage === "BKN" || effCoverage === "OVC") && isDaylight && hasNoSevereWx && isHighOrMidCeiling;

  if ((forceHighCeiling || forceMidCeilingBrighter) && visualBaseScene.startsWith("overcast-")) {
    visualBaseScene = sceneFor("partly-cloudy", phase, effCoverage);
  }

  const scene=sceneForEffects(visualBaseScene,obscuration.type,effVisibility,phase,effCoverage);
  const lightning=debugLightningReport(debugLightning)??weather.currentLightning??NO_LIGHTNING, lightningPoint=lightningPlacement(lightning), flashTest=debugLightning==="flash-test";
  useLightningScheduler(mainRef,lightning,reduced,flashTest);
  const sceneStyle={...cloudStyle,"--obsc-opacity":obscuration.density,"--obsc-horizon":obscuration.horizon,"--obsc-veil":obscuration.veil,"--obsc-duration":`${obscuration.duration}s`,"--obsc-direction":obscuration.direction,"--lightning-x":`${lightningPoint.x}%`,"--lightning-y":`${lightningPoint.y}%`} as unknown as CSSProperties;
  // Crossfade the wallpaper between two ping-pong layers: preload the incoming image, then flip the
  // active slot so CSS transitions opacity. Exactly two layers ever exist, so rapid scene changes
  // (live METAR or debug) can never accumulate stale layers or timers.
  useEffect(()=>{
    const {active:ac,a,b}=cfRef.current, shown=ac==="a"?a:b; if(shown===scene) return;
    let cancelled=false; const img=new Image(); img.decoding="async";
    const commit=()=>{ if(cancelled) return; if(cfRef.current.active==="a"){setBScene(scene);setActive("b");} else {setAScene(scene);setActive("a");} };
    img.onload=commit; img.onerror=commit; img.src=`${imageBase}/assets/backgrounds/${scene}.png`;
    return ()=>{ cancelled=true; };
  },[scene,imageBase]);
  const solar=solarWindow(now,local,weather.solarDays||[],weather.sunriseLocal,weather.sunsetLocal);
  // Observation freshness (from actual METAR obs time) is tracked separately from feed-fetch health.
  const metarFreshness=classifyMetarFreshness(weather.metarObsIso,now.getTime()), metarState=metarFreshness.state, metarAgeMin=metarFreshness.ageMinutes;
  const tafState=classifyTafFreshness({issueIso:weather.tafIssueIso,validStartIso:weather.tafValidStartIso,validEndIso:weather.tafValidEndIso},now.getTime());
  const ageStr=metarAgeMin!=null?(metarAgeMin<60?`${metarAgeMin}M`:`${Math.floor(metarAgeMin/60)}H${metarAgeMin%60}M`):"—";
  const feed=weather.feedStatus;
  const wxClass=metarState==="STALE"||metarState==="UNAVAILABLE"?"warn":feed==="OK"?"ok":feed==="OFFLINE"?"off":"chk";
  const metarDiagnostic=metarState==="UNAVAILABLE"?"METAR UNAVAILABLE":`METAR ${aviationStamp(weather.metarObsIso)} · AGE ${ageStr} · ${metarState}`;
  const tafDiagnostic=tafState==="UNAVAILABLE"?"TAF UNAVAILABLE":`TAF ${aviationStamp(weather.tafIssueIso)} · ${tafState==="CURRENT"?`VALID TO ${aviationStamp(weather.tafValidEndIso)}`:tafState}`;
  const feedDiagnostic=feed==="OK"?`FEED OK · UPDATED ${aviationStamp(weather.lastRefreshSuccessIso)}`:`FEED ${feed} · LAST OK ${aviationStamp(weather.lastRefreshSuccessIso)}`;
  const zone=local.timeZoneName||"LOCAL";
  const windLabel=weather.windDegrees===null?"VRB":`${String(weather.windDegrees).padStart(3,"0")}° ${weather.windDirection}`;
  const birdRisk=debugBird||weather.birdRisk;
  const birdClass=/SEVERE|HIGH/.test(birdRisk)?"severe":/MODERATE/.test(birdRisk)?"moderate":/LOW/.test(birdRisk)?"low":"unknown", birdStamp=zStamp(weather.birdUpdated);
  const clockZ=clock.lastCheckedUtc?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(clock.lastCheckedUtc)).replace(":","")+"Z":"—";
  const clockOffset=clock.estimatedOffsetMs!=null?`${clock.estimatedOffsetMs>=0?"+":"-"}${(Math.abs(clock.estimatedOffsetMs)/1000).toFixed(1)} SEC`:"—";
  const clockText=clock.lastCheckedUtc===null&&clock.state!=="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK…":clock.state==="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: OFFLINE":clock.state==="STALE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: STALE (GITHUB EDGE DATE)":`SRC WINDOWS SYSTEM · CHECK GITHUB EDGE DATE: ${clock.state} · OFFSET ${clockOffset} · ${clockZ}`;
  const clockClass=clock.state==="OK"?"ok":clock.state==="OFFLINE"?"off":clock.state==="CHECK"?"chk":"warn";
  const debugHref=useMemo(()=>DEBUG_THEMES.map(t=>`?debugWeather=${t}`),[]);
  return <main ref={mainRef} className={`display theme-${condition} phase-${phase}`} style={sceneStyle} data-wallpaper-scene={scene} data-coverage={effCoverage} data-tier={cloudTierV} data-perf={perf} data-performance={perf} data-base={sceneModel.cloudBaseFt??""} data-intensity={fx.intensity} data-vicinity={fx.vicinity?"1":"0"} data-wind={effWindSpd} data-winddir={effWindDir??""} data-vis={effVisibility??""} data-nx={cloudVec.nx} data-ny={cloudVec.ny} data-precip-type={fx.precip} data-secondary-precip-type={fx.secondaryPrecip} data-precip-intensity={fx.intensity} data-precip-active={fxSpec?"1":"0"} data-particle-count={fxSpec?.totalCount??0} data-primary-particle-count={fxSpec?.count??0} data-secondary-particle-count={fxSpec?.secondary?.count??0} data-obscuration={obscuration.type} data-obscuration-density={obscuration.density.toFixed(2)} data-obscuration-horizon={obscuration.horizon.toFixed(2)} data-obscuration-veil={obscuration.veil.toFixed(2)} data-obscuration-direction={obscuration.direction} data-active-obscuration-layers={obscuration.layers} data-visibility={effVisibility??""} data-reduced-motion={reduced?"1":"0"} data-lightning-level={lightning.level} data-lightning-source={lightning.source} data-lightning-frequency={lightning.frequency||"none"} data-lightning-direction={lightning.directions.join("-")||"none"} data-lightning-types={lightning.types.join(",")||"none"} data-lightning-reduced={reduced?"1":"0"}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${aScene}.png)`,opacity:active==="a"?1:0}}/><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${bScene}.png)`,opacity:active==="b"?1:0}}/><i className="cloud-field"><i className="cloud-layer cl-high"/><i className="cloud-layer cl-mid"/><i className="cloud-layer cl-low"/></i><PrecipCanvas spec={fxSpec} paused={false} night={phase==="night"}/><i className="obscuration-field"><b/><b/><b/></i><i className="air-traffic">{flybys.map((flight,i)=><span className={`flyby flyby-${flight.direction}`} key={i} style={{top:`${flight.top}%`,animationDuration:`${flight.cycle}s`,animationDelay:`${flight.delay}s`}}><span className="flight-shape" style={{transform:`rotate(${flight.tilt}deg) scale(${flight.scale}) ${flight.direction==="rtl"?"scaleX(-1)":""}`}}><span className="contrails"><b/><b/></span><span className="aircraft"><b className="airframe"/><i className="wing-strobe strobe-port"/><i className="wing-strobe strobe-starboard"/><i className="anti-collision"/></span></span></span>)}</i><i className="lightning-layer"><i className="lightning-glow"/><i className="lightning-horizon-glow"/><i className="lightning-bolt-overlay" style={{backgroundImage:`url(${imageBase}/lightning-bolt-isolated.png)`}}/></i><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><img className="brand-logo" src={`${imageBase}/assets/patch-155.png`} alt="155 Patch" /><div><strong>164AW Airfield Management</strong><small>KMEM - Frederick W. Smith International - Memphis, TN</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{zone}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel"><div className="panel-title"><span>SOLAR WINDOW</span><b>{solar.daylight?`${Math.round(solar.progress)}% DAYLIGHT`:`${solar.label} · NEXT SUNRISE`}</b></div><div className="solar-layout"><div className="solar-time solar-rise"><span>SUNRISE</span><strong>{solar.sunrise}</strong><small>LOCAL · {solar.label}</small></div><div className={`solar-arc-wrap ${solar.daylight?"is-daylight":"is-waiting"}`}><span className="solar-horizon"/><span className="solar-arc"/><i className="solar-rise-dot"/><i className="solar-set-dot"/><span className="solar-sun" style={{left:`${solar.markerX}%`,top:`${solar.markerY}%`}}><small>{solar.daylight?"NOW":"NIGHT"}</small></span></div><div className="solar-time solar-set"><span>SUNSET</span><strong>{solar.sunset}</strong><small>LOCAL · {solar.label}</small></div></div></article>
        <article className="weather-card panel"><div className="panel-title"><span>CURRENT WEATHER</span><b>{weather.source==="METAR"?"KMEM METAR":CONFIG.locationName.toUpperCase()}</b></div><div className="weather-main"><span className="weather-glyph"><WeatherIcon condition={displayTheme} night={phase==="night"}/></span><strong>{weather.temperatureF}<span className="temp-unit">°F</span></strong><div className="weather-copy"><b>{debug?displayTheme.replace("-"," "):weather.description}{weather.operationalWeather?.secondaryLabel && <span className="weather-modifier"> · {weather.operationalWeather.secondaryLabel}</span>}{weather.operationalWeather?.codes.length ? <code className="current-raw-code">{weather.operationalWeather.codes.join(" ")}</code> : null}</b><small className="feels-like">FEELS LIKE <strong>{weather.feelsLikeF??weather.temperatureF}°F</strong>{weather.cloudCoverage && ["BKN","OVC","VV"].includes(weather.cloudCoverage) && weather.cloudBaseFt !== null && <> · CEILING <strong>{weather.cloudBaseFt.toLocaleString()} FT</strong></>}</small>{lightning.awareness&&<small className="lightning-awareness">{lightning.awareness}</small>}<small className="weather-stats"><span>HUMIDITY {weather.humidity}%</span></small></div></div><div className={`metar-health health-${metarState.toLowerCase()}`}><span>METAR {metarState}</span>{feed!=="OK"&&<span className={`feed-${feed.toLowerCase()}`}>FEED {feed}</span>}</div></article>
        <article className="wind-card panel"><div className="panel-title"><span>WIND</span><b>{weather.source==="METAR"?"KMEM METAR":"CURRENT"}</b></div><div className="wind-main"><div className="compass-wrap"><div className="compass-dial"><svg className="compass-ticks" viewBox="0 0 100 100" fill="none" stroke="currentColor"><circle cx="50" cy="50" r="48" stroke="var(--cyan)" strokeWidth="1.2" opacity="0.4" /><circle cx="50" cy="50" r="42" stroke="var(--line)" strokeWidth="0.5" strokeDasharray="1.5, 3" /><line x1="50" y1="2" x2="50" y2="8" stroke="var(--cyan)" strokeWidth="2" /><line x1="50" y1="92" x2="50" y2="98" stroke="var(--muted)" strokeWidth="1.2" /><line x1="2" y1="50" x2="8" y2="50" stroke="var(--muted)" strokeWidth="1.2" /><line x1="92" y1="50" x2="98" y2="50" stroke="var(--muted)" strokeWidth="1.2" /><line x1="15" y1="15" x2="20" y2="20" stroke="var(--line)" strokeWidth="1" /><line x1="85" y1="15" x2="80" y2="20" stroke="var(--line)" strokeWidth="1" /><line x1="15" y1="85" x2="20" y2="80" stroke="var(--line)" strokeWidth="1" /><line x1="85" y1="85" x2="80" y2="80" stroke="var(--line)" strokeWidth="1" /><circle cx="50" cy="50" r="4" fill="var(--cyan)" box-shadow="0 0 6px var(--cyan)" /></svg><span className="compass-label compass-n">N</span><span className="compass-label compass-e">E</span><span className="compass-label compass-s">S</span><span className="compass-label compass-w">W</span><div className="compass-arrow" style={effWindDir !== null ? { transform: `rotate(${effWindDir + 180}deg)` } : undefined}>{effWindDir !== null ? <svg viewBox="0 0 100 100" className="compass-arrow-svg" fill="none" stroke="currentColor"><path d="M50 10 L60 38 L50 32 L40 38 Z" fill="var(--cyan)" stroke="var(--cyan)" strokeWidth="1.5" strokeLinejoin="round" /><line x1="50" y1="32" x2="50" y2="78" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" /><circle cx="50" cy="78" r="2.5" fill="var(--cyan)" /></svg> : <div className="compass-calm-indicator">↻</div>}</div></div></div><div className="wind-info"><strong>{effWindSpd === 0 ? "CALM" : `${effWindDir !== null ? String(effWindDir).padStart(3,"0") : "VRB"} @ ${String(effWindSpd).padStart(2,"0")}${effGust ? ` G ${effGust}` : ""}`}</strong>{effWindDir !== null && effWindSpd > 0 && <small className="wind-from">FROM {bearingToCardinal(effWindDir)}</small>}</div></div></article>
        <article className={`bird-card panel risk-${birdClass}`}><div className="panel-title"><span>BIRD WATCH CONDITION</span><b>USAF AHAS</b></div><div className="bird-main"><svg className="bird-icon-svg" viewBox="0 0 64 40" fill="currentColor" aria-hidden="true"><path d="M4 18 C16 12 28 8 38 2 C36 10 38 18 46 22 C54 24 60 20 64 16 C58 24 50 28 42 28 C46 32 52 34 58 35 C48 37 40 35 34 31 C31 35 28 38 24 40 C26 35 26 30 24 27 C18 26 10 24 4 18 Z" /></svg><div className="bird-info"><strong className="bird-severity">{birdRisk}</strong><small className="bird-card-meta">AHAS · UPDATED {birdStamp || "1730Z"}</small></div></div></article>
        <article className={`forecast-card panel ${weather.tafHazards.length?"has-taf-hazard":""}`}><div className="panel-title"><span>FUTURE WEATHER · NEXT 9 HOURS</span><b>TAF · JULIAN {julian4(now)}</b></div>{weather.tafHazards.length>0&&<div className="taf-hazard-band"><span>TAF HAZARD</span>{weather.tafHazards.slice(0,1).map(h=>{const window=formatTafWindow(h.fromIso,h.toIso,now);return <b key={h.id} data-category={h.weather.category}><time><span>{window.full}</span><small>{window.compact}</small></time><em>{tafQualifier(h.weather)}</em>{h.weather.label}{h.weather.code ? ` (${h.weather.code})` : ""}</b>})}{weather.tafHazards.length>1&&<i>+{weather.tafHazards.length-1}</i>}</div>}<div className="forecast-grid">{weather.forecast?.length?weather.forecast.map((f,i)=><div key={`${f.time}-${i}`} data-category={f.operationalWeather?.category||"unknown"}><time>{f.time}</time><span className="forecast-icon"><WeatherIcon condition={f.condition} night={isNightAt(f.time,solar.sunrise,solar.sunset)}/></span><small className="forecast-condition">{tafCardCondition(f.operationalWeather,f.description)}{f.operationalWeather?.secondaryLabel && <span className="forecast-modifier"> · {f.operationalWeather.secondaryLabel}</span>}</small><strong>{f.temperatureF}°</strong><small>{tafQualifier(f.operationalWeather)} · {f.precipitation}% PRECIP{f.operationalWeather?.code ? ` · ${f.operationalWeather.code}` : ""}{f.operationalWeather?.cloudCoverage && ["BKN","OVC","VV"].includes(f.operationalWeather.cloudCoverage) && f.operationalWeather.cloudBaseFt !== null ? ` · CIG ${f.operationalWeather.cloudBaseFt.toLocaleString()} FT` : ""}</small></div>):<div className="forecast-empty">FORECAST UNAVAILABLE</div>}</div></article>
      </section>
      <footer><span className={`clock-status clock-${clockClass}`}><i/> {clockText}</span><span className={`wx-diagnostics clock-status clock-${wxClass}`}><i/><span>{metarDiagnostic}</span><span>{tafDiagnostic}</span><span>{feedDiagnostic}</span></span><span>PRESS F11 FOR FULL SCREEN</span></footer>
    </div>
    {debug&&<nav className="debug" aria-label="Weather theme simulator"><b>SIM</b>{DEBUG_THEMES.map((t,i)=><a className={t===debug?"active":""} href={debugHref[i]} key={t}>{t.replace("-"," ")}</a>)}<a className={debugPhase==="day"?"active":""} href={`?debugWeather=${condition}&debugTime=day`}>DAY</a><a className={debugPhase==="night"?"active":""} href={`?debugWeather=${condition}&debugTime=night`}>NIGHT</a><a className={debugPhase==="sunrise"?"active":""} href={`?debugWeather=${condition}&debugTime=sunrise`}>SUNRISE</a><a className={debugPhase==="sunset"?"active":""} href={`?debugWeather=${condition}&debugTime=sunset`}>SUNSET</a>{(["LOW","MODERATE","SEVERE"] as const).map(level=><a className={debugBird===level?"active":""} href={`?debugWeather=${condition}&debugTime=${phase==="night"?"night":"day"}&debugBwc=${level.toLowerCase()}`} key={level}>BWC {level}</a>)}<a href="?">LIVE</a></nav>}
    <PreviewLab active={showPreview} paneDrops={paneDrops} onPaneToggle={setPaneDrops}/>
  </main>;
}
