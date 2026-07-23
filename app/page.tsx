"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
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
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", windSpeedKt:0, windDirection:"—", windDegrees:null, windGustKt:null, humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", solarDays:[], observationTime:"", forecast:[], operationalWeather:null, currentLightning:{...NO_LIGHTNING}, tafHazards:[], wxAlertText:"", wxAlertTone:"none", wxAlertPulse:false, wxAlertFlash:false, wxAlertVisible:false, birdRisk:"UNAVAILABLE", birdBasis:"—", birdUpdated:"—", source:"MODEL", cloudCoverage:"CLR", cloudBaseFt:null, visibilitySm:null, phenomena:[], metarObsIso:null, tafIssueIso:null, tafValidStartIso:null, tafValidEndIso:null, metarFetchStatus:"UNKNOWN", tafFetchStatus:"UNKNOWN", bwcFetchStatus:"UNKNOWN", feedStatus:"DEGRADED", requestStatus:"IDLE", lastRefreshAttemptIso:null, lastRefreshSuccessIso:null, feedError:"NO DATA" };
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
function simplifyLightningRemark(raw: string): string {
  if (!raw) return "";
  let clean = raw.replace(/^ATIS\s*/i, "").trim();
  if (/OCNL\s+LTGIC\s+DSNT/i.test(clean) || /DISTANT\s+LIGHTNING/i.test(clean) || /LTG\s+DSNT/i.test(clean) || /DSNT\s+LTG/i.test(clean)) {
    let dir = "";
    const m = clean.match(/(?:DSNT|LIGHTNING|LTG)\s+([N|S|E|W|NE|NW|SE|SW|\/\-]+)/i) || clean.match(/\b(N|S|E|W|NE|NW|SE|SW|SE\-S|NE\-E)\b/i);
    if (m) dir = m[1].toUpperCase();
    return dir ? `DSNT LIGHTNING ${dir}` : "DSNT LIGHTNING";
  }
  if (/VCTS/i.test(clean)) return "TS IN VICINITY";
  return clean.replace(/\.\s*\d+[-–]\d+\s*NM\.?/i, "").toUpperCase();
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
  const forecast:Forecast[]=[0,1,2,3,4,5,6,7,8,9].map(offset=>{const i=Math.min(start+offset,j.hourly.time.length-1),condition=mapCode(j.hourly.weather_code[i],0);return {time:tm(j.hourly.time[i]),iso:utcIso(j.hourly.time[i]),temperatureF:Math.round(j.hourly.temperature_2m[i]),...condition,precipitation:Math.round(j.hourly.precipitation_probability[i]||0),source:"MODEL",operationalWeather:null}});
  const windDegrees=Math.round(j.current.wind_direction_10m);
  const solarDays:SolarDay[]=j.daily.time.map((date:string,i:number)=>({date,sunriseLocal:tm(j.daily.sunrise[i]),sunsetLocal:tm(j.daily.sunset[i])}));
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,windSpeedKt:Math.round(j.current.wind_speed_10m),windDirection:windDirection(windDegrees),windDegrees,windGustKt:null,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:solarDays[0]?.sunriseLocal||"--:--",sunsetLocal:solarDays[0]?.sunsetLocal||"--:--",solarDays,observationTime:j.current.time,forecast,operationalWeather:null,currentLightning:{...NO_LIGHTNING},tafHazards:[],wxAlertText:"",wxAlertTone:"none",wxAlertPulse:false,wxAlertFlash:false,wxAlertVisible:false,birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",cloudCoverage:coverageFromCondition(mapped.condition),cloudBaseFt:null,visibilitySm:null,phenomena:phenomenaFromCondition(mapped.condition),metarObsIso:null,tafIssueIso:null,tafValidStartIso:null,tafValidEndIso:null,metarFetchStatus:"UNKNOWN",tafFetchStatus:"UNKNOWN",bwcFetchStatus:"UNKNOWN",feedStatus:"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:null};
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
  const weather:Weather={...model,temperatureF:metar?.temperatureF??model.temperatureF,condition:metar?.condition??model.condition,description:metar?.description??model.description,operationalWeather:metar?.operationalWeather??model.operationalWeather,currentLightning:metar?.currentLightning??model.currentLightning,windSpeedKt:metar?.windSpeedKt??model.windSpeedKt,windDirection:metar?.windDirection??model.windDirection,windDegrees:metar?.windDegrees??model.windDegrees,windGustKt:metar?.windGustKt??model.windGustKt,observationTime:metarValid?metarObsIso:model.observationTime,forecast:tafProduct?.forecast??model.forecast,tafHazards:tafProduct?.hazards??[],wxAlertText:ops.wxAlertText||"",wxAlertTone:ops.wxAlertTone||"none",wxAlertPulse:!!ops.wxAlertPulse,wxAlertFlash:!!ops.wxAlertFlash,wxAlertVisible:!!ops.wxAlertVisible,birdRisk:(ops.bwcAhasRisk||ops.bwc||"UNAVAILABLE").toUpperCase(),birdBasis:(ops.bwcBasedOn||"AHAS").toUpperCase(),birdUpdated:ops.bwcUpdatedZ||"—",source:metarValid?"METAR":"MODEL",cloudCoverage:sky?.cloudCoverage??model.cloudCoverage,cloudBaseFt:sky?sky.cloudBaseFt:model.cloudBaseFt,visibilitySm:sky?sky.visibilitySm:model.visibilitySm,phenomena:metarValid?(phenomena??[]):model.phenomena,metarObsIso:metarValid?metarObsIso:null,tafIssueIso:tafTimes.issueIso,tafValidStartIso:tafTimes.validStartIso,tafValidEndIso:tafTimes.validEndIso,metarFetchStatus,tafFetchStatus,bwcFetchStatus,feedStatus:healthy?"OK":"DEGRADED",requestStatus:"IDLE",lastRefreshAttemptIso:null,lastRefreshSuccessIso:null,feedError:healthy?null:"UPSTREAM DEGRADED",rawMetar:metarValid?rawMetar:null};
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
  if(!weather) return "—";
  if(weather.sourceKind === "TAF_FM" || weather.sourceKind === "TAF_BASE") return "—";
  return ({TAF_BASE:"—",TAF_FM:"—",TAF_TEMPO:"TEMPO",TAF_PROB30:"PROB30",TAF_PROB40:"PROB40",TAF_PROB30_TEMPO:"PROB30 TEMPO",TAF_PROB40_TEMPO:"PROB40 TEMPO",METAR:"METAR",MODEL:"—"} as const)[weather.sourceKind] || "—";
}
function tafCardCondition(weather:OperationalWeather|null,fallback:string):string {
  if(!weather) return fallback;
  return weather.label;
}
function getTafHazardDetails(h: any): { severity: "red" | "yellow" | "blue"; text: string } {
  if (!h || !h.weather) return { severity: "yellow", text: "TS PSBL" };
  const w = h.weather;
  const q = tafQualifier(w);
  const rawCode = w.code || (w.codes && w.codes.length ? w.codes[0] : "");
  const psbl = (q.includes("PROB") || w.temporary) ? " PSBL" : "";
  const codeText = rawCode ? `${rawCode}${psbl}` : `${w.shortLabel || w.label || "TS"}${psbl}`;
  let severity: "red" | "yellow" | "blue" = "yellow";
  if (w.category === "severe-convection" || w.category === "thunderstorm" || w.category === "freezing-precipitation") {
    severity = (q.includes("PROB30") || w.temporary) ? "yellow" : "red";
  } else if (w.category === "liquid-precipitation" || w.category === "winter-precipitation") {
    severity = "blue";
  }
  return { severity, text: codeText };
}
function parseAhasTimestampIso(raw: string | undefined | null, now: Date): string | null {
  if (!raw || raw === "—") return null;
  if (!isNaN(Date.parse(raw))) return raw;
  const m = raw.match(/(?:(\d{2})\/)?(\d{2})(\d{2})Z?/i);
  if (m) {
    const day = m[1] ? Number(m[1]) : now.getUTCDate();
    const hour = Number(m[2]);
    const min = Number(m[3]);
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return null;
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
    const nightProgress = Math.max(0, Math.min(1, (nightClock - nightStart) / (nightEnd - nightStart)));
    const nightAngle = nightProgress * Math.PI;
    markerX = 100 + Math.cos(nightAngle) * 88;
    markerY = 76 + Math.sin(nightAngle) * 18;
  }
  const safeX = Number.isFinite(markerX) ? markerX : 100;
  const safeY = Number.isFinite(markerY) ? markerY : 40;
  return {phase, activeObject, sunrise:selected.sunriseLocal, sunset:selected.sunsetLocal, label:daylight?"DAYLIGHT":"MOON", daylight, progress, markerX:safeX, markerY:safeY};
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
  if(phase==="sunrise"||phase==="sunset") return phase;
  if(condition==="overcast") return `overcast-${light}`;
  if(condition==="partly-cloudy") return `partly-cloudy-${light}`;
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

function isFlybyWeatherAllowed(weather: Weather, flightCat: { cat: string }): boolean {
  if (flightCat.cat !== "VFR") return false;
  if (weather.visibilitySm !== null && weather.visibilitySm < 5) return false;
  const coverage = weather.cloudCoverage || "CLR";
  if (["BKN", "OVC", "VV"].includes(coverage)) return false;
  if (!["CLR", "SKC", "FEW", "SCT"].includes(coverage)) return false;
  if (weather.currentLightning && weather.currentLightning.level !== "none") return false;
  const rawMetar = (weather.rawMetar || "").toUpperCase();
  const phen = (weather.phenomena || []).join(" ").toUpperCase();
  const combined = `${rawMetar} ${phen}`;
  if (/\b(?:RA|SN|DZ|SG|PL|GR|GS|UP|SH|TS|VCTS|FG|FZFG|BR|HZ|FU|DU|SA|VA|BLSN|BLSA|BLDU|PO|SQ|FC)\b/.test(combined)) {
    return false;
  }
  return true;
}

export default function Home() {
  const [weather,setWeather]=useState<Weather>(FALLBACK); const weatherRef=useRef<Weather>(FALLBACK); const [debug,setDebug]=useState<Theme|null>(null); const [debugPhase,setDebugPhase]=useState<"day"|"night"|"sunrise"|"sunset"|null>(null); const [debugBird,setDebugBird]=useState<"LOW"|"MODERATE"|"SEVERE"|null>(null); const [debugMoon,setDebugMoon]=useState<string|null>(null);
  const [activeFlyby, setActiveFlyby] = useState<{ id: number; top: number; direction: "ltr" | "rtl"; duration: number } | null>(null);
  const [debugFlybyEnabled, setDebugFlybyEnabled] = useState<boolean | null>(null);
  const [debugFlybyDir, setDebugFlybyDir] = useState<"ltr" | "rtl" | null>(null);
  const [debugCloud,setDebugCloud]=useState<CloudCoverage|null>(null); const [debugCloudBase,setDebugCloudBase]=useState<number|null>(null); const [debugWind,setDebugWind]=useState<number|null>(null); const [debugWindSpeed,setDebugWindSpeed]=useState<number|null>(null); const [perf,setPerf]=useState<"full"|"low">("full");
  const [debugPhenomena,setDebugPhenomena]=useState<string|null>(null); const [debugIntensity,setDebugIntensity]=useState<Intensity|null>(null); const [debugVisibility,setDebugVisibility]=useState<number|null>(null); const [debugGust,setDebugGust]=useState<number|null>(null); const [reduced,setReduced]=useState(false); const [paneDrops,setPaneDrops]=useState<boolean|null>(null);
  const [showPreview,setShowPreview]=useState(false); const [showSim,setShowSim]=useState(false); const [debugLightning,setDebugLightning]=useState<string|null>(null); const mainRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{ if(typeof matchMedia==="undefined") return; const mq=matchMedia("(prefers-reduced-motion: reduce)"); const on=()=>setReduced(mq.matches); on(); mq.addEventListener?.("change",on); return()=>mq.removeEventListener?.("change",on); },[]);
  const [aScene,setAScene]=useState("clear-night"); const [bScene,setBScene]=useState("clear-night"); const [active,setActive]=useState<"a"|"b">("a");
  const cfRef=useRef<{active:"a"|"b";a:string;b:string}>({active:"a",a:"clear-night",b:"clear-night"}); cfRef.current={active,a:aScene,b:bScene};
  const clockDebug=useMemo<ClockDebug|undefined>(()=>{ if(typeof location==="undefined") return undefined; const q=new URLSearchParams(location.search); const off=q.get("debugClockOffset"), chk=q.get("debugClockCheck"), exact=q.get("debugExactTime"); return { offsetMs: off!=null&&off!==""?Number(off):undefined, exact: exact!=null&&exact!==""?Number(exact):undefined, force:(chk==="offline"||chk==="stale"||chk==="warning")?chk:undefined }; },[]);
  const {now,status:clock}=useSystemClock(clockDebug);
  
  // Spawning controls for single C-17 photo flyby
  const activeFlybyRemovalRef = useRef<number | null>(null);
  
  const triggerSpawn = useCallback((forcedDir?: "ltr" | "rtl") => {
    if (activeFlybyRemovalRef.current) window.clearTimeout(activeFlybyRemovalRef.current);
    const dir = forcedDir || debugFlybyDir || (Math.random() > 0.5 ? "ltr" : "rtl");
    const top = 9 + Math.random() * 7; // constrained to upper sky/header 9%-16%
    const duration = 12 + Math.random() * 6; // fast 12s-18s transit
    const newId = Date.now();
    setActiveFlyby({ id: newId, top, direction: dir, duration, forced: true } as any);
    activeFlybyRemovalRef.current = window.setTimeout(() => {
      setActiveFlyby(curr => (curr?.id === newId ? null : curr));
    }, duration * 1000);
  }, [debugFlybyDir]);

  useEffect(() => {
    if (debugFlybyEnabled === false) {
      setActiveFlyby(null);
      return;
    }
    // Restart the normal random schedule only after the forced pass exits (activeFlyby is null)
    if (activeFlyby) return;

    const scheduleNext = () => {
      const delayMs = 15000 + Math.random() * 15000; // 15s - 30s interval
      return window.setTimeout(() => {
        triggerSpawn();
      }, delayMs);
    };
    const timerId = scheduleNext();
    return () => clearTimeout(timerId);
  }, [activeFlyby, debugFlybyEnabled, triggerSpawn]);

  useEffect(()=>{
    const q=new URLSearchParams(location.search), sim=q.get("debugWeather") as Theme|null, simPhase=q.get("debugTime"), simBird=q.get("debugBwc")?.toUpperCase(), simMoon=q.get("debugMoonPhase"); if(sim&&DEBUG_THEMES.includes(sim)) setDebug(sim); if(simPhase==="day"||simPhase==="night"||simPhase==="sunrise"||simPhase==="sunset") setDebugPhase(simPhase); if(simBird==="LOW"||simBird==="MODERATE"||simBird==="SEVERE") setDebugBird(simBird); if(simMoon) setDebugMoon(simMoon);
    if(q.has("debugWeather")||q.has("debugTime")||q.has("debugBwc")||q.has("debugMoonPhase")||q.has("sim")||q.has("demo")) setShowSim(true);
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
    const fb=q.get("debugFlyby"); if(fb==="off") setDebugFlybyEnabled(false); else if(fb==="on") setDebugFlybyEnabled(true);
    const fbd=q.get("debugFlybyDir"); if(fbd==="ltr"||fbd==="rtl") setDebugFlybyDir(fbd);
    if(q.get("spawnFlyby")==="1") triggerSpawn();
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
  useLightningScheduler(mainRef,lightning,reduced,flashTest);
  const sceneStyle={...cloudStyle,"--obsc-opacity":obscuration.density,"--obsc-horizon":obscuration.horizon,"--obsc-veil":obscuration.veil,"--obsc-duration":`${obscuration.duration}s`,"--obsc-direction":obscuration.direction,"--lightning-x":`${lightningPoint.x}%`,"--lightning-y":`${lightningPoint.y}%`} as unknown as CSSProperties;
  
  // Crossfade the wallpaper between two ping-pong layers using a race-safe state machine.
  // We preload the incoming image and ONLY swap `active` when it successfully decodes,
  // ensuring no stale load callbacks supersede newer scene requests.
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
        img.decode().then(commit).catch(() => { /* keep current on decode error */ });
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
    effSolar.markerY = 76 + Math.sin(nightAngle) * 18;
  }

  if (debugPhase) {
    if (debugPhase === "sunrise") effSolar = { ...solar, daylight: true, progress: 5 };
    else if (debugPhase === "sunset") effSolar = { ...solar, daylight: true, progress: 95 };
    else if (debugPhase === "day") effSolar = { ...solar, daylight: true, progress: 50 };
    else if (debugPhase === "night") effSolar = { ...solar, daylight: false, progress: 50 };

    if (effSolar.daylight) {
      const dayAngle = Math.PI - (effSolar.progress / 100) * Math.PI;
      effSolar.markerX = 100 + Math.cos(dayAngle) * 88;
      effSolar.markerY = 76 - Math.sin(dayAngle) * 56;
    } else {
      const nightAngle = (effSolar.progress / 100) * Math.PI;
      effSolar.markerX = 100 + Math.cos(nightAngle) * 88;
      effSolar.markerY = 76 + Math.sin(nightAngle) * 18;
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

  return <main ref={mainRef} className={`display theme-${condition} phase-${phase}`} style={sceneStyle} data-wallpaper-scene={scene}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${aScene}.png)`,opacity:active==="a"?1:0}}/><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${bScene}.png)`,opacity:active==="b"?1:0}}/><i className="cloud-field"><i className="cloud-layer cl-high"/><i className="cloud-layer cl-mid"/><i className="cloud-layer cl-low"/></i><PrecipCanvas spec={fxSpec} paused={false} night={phase==="night"}/><i className="obscuration-field"><b/><b/><b/></i>{(isFlybyWeatherAllowed(weather, flightCat) || debugFlybyEnabled === true) && activeFlyby && debugFlybyEnabled !== false && (<i className="air-traffic"><span className={`flyby flyby-${activeFlyby.direction}`} key={activeFlyby.id} style={{top:`${activeFlyby.top}%`,animationDuration:`${activeFlyby.duration}s`}}><span className="c17-photo-container"><span className="c17-photo-contrails"><b className="contrail-line"/></span><img src={`${imageBase}/assets/c17-source-${activeFlyby.direction}.png`} alt="C-17 Globemaster III" className="c17-photo-img" /><span className="c17-photo-lights"><i className="beacon-tail-red"/><i className="beacon-belly-red"/><i className="nav-port-red"/><i className="nav-starboard-green"/><i className="strobe-wing-white port"/><i className="strobe-wing-white starboard"/></span></span></span></i>)}<i className="lightning-layer"><i className="lightning-glow"/><i className="lightning-horizon-glow"/><i className="lightning-bolt-overlay" style={{backgroundImage:`url(${imageBase}/lightning-bolt-isolated.png)`}}/></i><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><img className="brand-logo" src={`${imageBase}/assets/patch-155.png`} alt="155 Patch" /><div><strong>164AW Airfield Management</strong><small>KMEM - FREDERICK W. SMITH INTERNATIONAL - MEMPHIS, TN</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
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
                <path d="M 188 76 A 88 18 0 0 1 12 76" fill="none" className="lunar-arc-bg" strokeWidth="1.2" strokeDasharray="2, 4" opacity="0.6" />
                <line x1="8" y1="76" x2="192" y2="76" stroke="rgba(180, 211, 221, 0.25)" strokeWidth="1" strokeDasharray="4, 2" />
                {effSolar.activeObject === "sun" ? (() => {
                  const sunIntensity = Math.max(0, 1 - Math.abs(effSolar.progress - 50) / 50);
                  const sunRadius = 6 + 4 * sunIntensity;
                  return (
                    <g className="sun-group">
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={10 + 14 * sunIntensity} fill="url(#sunOuterHalo)" className="sun-pulse-halo" opacity={sunIntensity} />
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={14 + 10 * sunIntensity} fill="url(#sunGlow)" opacity={0.3 + 0.7 * sunIntensity} />
                      <circle cx={effSolar.markerX} cy={effSolar.markerY} r={sunRadius} fill="#ffffff" opacity={0.8 + 0.2 * sunIntensity} />
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
              <strong>{effSolar.activeObject === "sun" ? `${Math.round(effSolar.progress)}% DAYLIGHT ELAPSED` : `MOON - ${moonInfo.name}`}</strong>
            </div>
            <div className="solar-times-row">
              <div className="solar-time solar-rise"><span>SUNRISE</span><strong>{solar.sunrise}</strong><small>LOCAL · {solar.label}</small></div>
              <div className="solar-time solar-set"><span>SUNSET</span><strong>{solar.sunset}</strong><small>LOCAL · {solar.label}</small></div>
            </div>
          </div>
        </article>
        <article className="weather-card panel">
          <div className="panel-title">
            <span>CURRENT WEATHER</span>
            <b>KMEM METAR</b>
          </div>
          <div className="weather-main">
            <div className="weather-left-block">
              <div className="weather-left-top">
                <span className="weather-glyph"><WeatherIcon condition={condition} night={phase === "night"} /></span>
                <strong>{weather.temperatureF ?? "--"}°<small style={{ fontSize: "0.4em", color: "#8899a0" }}>F</small></strong>
              </div>
              <span className="humidity-under-glyph">HUMIDITY <strong>{weather.humidity}%</strong></span>
            </div>
            <div className="weather-copy">
              <b>{debug?displayTheme.replace("-"," "):weather.description}{weather.operationalWeather?.secondaryLabel && <span className="weather-modifier"> · {weather.operationalWeather.secondaryLabel}</span>}</b>
              <div className="feels-like-container">
                <span className="feels-like">FEELS LIKE <strong>{weather.feelsLikeF??weather.temperatureF}°F</strong></span>
                <span className="ceiling-line">CEILING <strong>{weather.cloudCoverage && ["BKN","OVC","VV"].includes(weather.cloudCoverage) && weather.cloudBaseFt !== null ? `${weather.cloudBaseFt.toLocaleString()} FT` : "UNL"}</strong></span>
              </div>
              {lightning.awareness&&<small className="lightning-awareness">{simplifyLightningRemark(lightning.awareness)}</small>}
            </div>
          </div>
          <div className={`metar-health health-${feed !== "OK" ? (feed === "OFFLINE" ? "unavailable" : "stale") : metarState.toLowerCase()}`}>
            <span>{feed !== "OK" ? `METAR FEED ${feed}` : `METAR ${metarState}`}</span>
          </div>
        </article>
        <article className="wind-card panel"><div className="panel-title"><span>WIND & FLIGHT CAT</span></div><div className="wind-main"><div className="compass-wrap"><div className="compass-dial"><svg className="compass-ticks" viewBox="0 0 100 100" fill="none" stroke="currentColor"><circle cx="50" cy="50" r="48" stroke="var(--cyan)" strokeWidth="1.2" opacity="0.4" /><circle cx="50" cy="50" r="42" stroke="var(--line)" strokeWidth="0.5" strokeDasharray="1.5, 3" /><line x1="50" y1="2" x2="50" y2="8" stroke="var(--cyan)" strokeWidth="2" /><line x1="50" y1="92" x2="50" y2="98" stroke="var(--muted)" strokeWidth="1.2" /><line x1="2" y1="50" x2="8" y2="50" stroke="var(--muted)" strokeWidth="1.2" /><line x1="92" y1="50" x2="98" y2="50" stroke="var(--muted)" strokeWidth="1.2" /><circle cx="50" cy="50" r="4" fill="var(--cyan)" box-shadow="0 0 6px var(--cyan)" /></svg><span className="compass-label compass-n">N</span><span className="compass-label compass-e">E</span><span className="compass-label compass-s">S</span><span className="compass-label compass-w">W</span><div className="compass-arrow" style={effWindDir !== null ? { transform: `rotate(${effWindDir + 180}deg)` } : undefined}>{effWindDir !== null ? <svg viewBox="0 0 100 100" className="compass-arrow-svg" fill="none" stroke="currentColor"><path d="M50 10 L60 38 L50 32 L40 38 Z" fill="var(--cyan)" stroke="var(--cyan)" strokeWidth="1.5" strokeLinejoin="round" /><line x1="50" y1="32" x2="50" y2="78" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" /><circle cx="50" cy="78" r="2.5" fill="var(--cyan)" /></svg> : <div className="compass-calm-indicator">↻</div>}</div></div></div><div className="wind-info"><strong>{effWindSpd === 0 ? "CALM" : `${effWindDir !== null ? String(effWindDir).padStart(3,"0") : "VRB"} @ ${String(effWindSpd).padStart(2,"0")}${effGust ? ` G ${effGust}` : ""}`}</strong>{effWindDir !== null && effWindSpd > 0 && <small className="wind-from">FROM {bearingToCardinal(effWindDir)}</small>}<div className="wind-flight-meta"><span className="flight-cat-pill" style={{ borderColor: flightCat.color, color: flightCat.color, background: `${flightCat.color}22` }}>{flightCat.cat}</span><span className="wind-vis-tag">VIS <strong>{effVisibility ?? 10} SM</strong></span></div></div></div></article>
        <article className={`bird-card panel risk-${birdClass}`}>
          <div className="panel-title"><span>BIRD WATCH CONDITION</span><b>AHAS</b></div>
          <div className="bird-main">
            <div className="bird-center-row">
              <span className="bird-icon-symbol" aria-label="Bird hazard icon">𓅪</span>
              <strong className="bird-severity">{birdRisk}</strong>
            </div>
            <div className="bird-card-meta">
              {(() => {
                const bwcIso = parseAhasTimestampIso(weather.birdUpdated, now);
                const bwcMs = bwcIso ? Date.parse(bwcIso) : NaN;
                const ageMin = Number.isFinite(bwcMs) ? Math.max(0, Math.floor((now.getTime() - bwcMs) / 60000)) : null;
                return `${birdStamp || "1730Z"}${ageMin !== null ? ` · ${ageMin < 60 ? `${ageMin} MIN AGO` : `${Math.floor(ageMin / 60)}H ${ageMin % 60}M AGO`}` : ""}`;
              })()}
            </div>
          </div>
        </article>
        <article className={`forecast-card panel ${weather.wxAlertVisible?"has-taf-hazard":""}`}><div className="panel-title"><span>FUTURE WEATHER · NEXT 9 HOURS</span><b>TAF · JULIAN {julian4(now)}</b></div>{weather.wxAlertVisible && ( <div className={`taf-hazard-band ${weather.wxAlertPulse ? "alert-pulse" : ""} ${weather.wxAlertFlash ? "alert-flash" : ""}`} data-tone={weather.wxAlertTone}><em>{weather.wxAlertText}</em></div> )}<div className="forecast-list">{weather.forecast?.length?weather.forecast.map((f,i)=>{ const d=new Date(f.iso); const timeLabel=Number.isFinite(d.getTime())?`${String(d.getUTCHours()).padStart(2,"0")}:00Z`:f.time; return <div key={`${f.time}-${i}`} className="forecast-item" data-category={f.operationalWeather?.category||"unknown"}><div className="forecast-item-top"><time>{timeLabel}</time><span className="forecast-icon"><WeatherIcon condition={f.condition} night={isNightAt(f.time,solar.sunrise,solar.sunset)}/></span>{tafQualifier(f.operationalWeather) !== "—" && <span className="forecast-badge">{tafQualifier(f.operationalWeather)}</span>}<b className="forecast-condition">{tafCardCondition(f.operationalWeather,f.description)}</b><strong className="forecast-temp">{f.temperatureF}°</strong></div><div className="forecast-item-sub"><span className="forecast-meta-detail">{f.precipitation}% PRECIP{f.operationalWeather?.cloudBaseFt !== null && f.operationalWeather?.cloudBaseFt !== undefined ? ` · ${["BKN","OVC","VV"].includes(f.operationalWeather?.cloudCoverage || "") ? "CIG" : "CLD"} ${f.operationalWeather.cloudBaseFt.toLocaleString()} FT` : ""}</span></div></div>;}):<div className="forecast-empty">FORECAST UNAVAILABLE</div>}</div></article>
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
