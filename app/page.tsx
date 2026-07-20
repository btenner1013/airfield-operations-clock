"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSystemClock, type ClockDebug } from "./useClock";
import { classifyEffect, buildFxSpec, type Intensity } from "./weatherFx";
import PrecipCanvas from "./PrecipCanvas";
import PreviewLab from "./PreviewLab";

type Theme = "clear" | "partly-cloudy" | "overcast" | "rain" | "heavy-rain" | "thunderstorm" | "fog" | "snow" | "night" | "sunrise" | "sunset" | "neutral";
type Forecast = { time:string; iso:string; temperatureF:number; condition:Theme; description:string; precipitation:number; source:"TAF"|"MODEL" };
type SolarDay = { date:string; sunriseLocal:string; sunsetLocal:string };
type Flyby = { top:number; cycle:number; delay:number; scale:number; tilt:number; direction:"ltr"|"rtl" };
type CloudCoverage = "CLR"|"FEW"|"SCT"|"BKN"|"OVC"|"VV";
type Phase = "day"|"night"|"sunrise"|"sunset";
type Weather = { temperatureF:number; feelsLikeF:number; condition:Theme; description:string; windSpeedKt:number; windDirection:string; windDegrees:number|null; windGustKt:number|null; humidity:number; sunriseLocal:string; sunsetLocal:string; solarDays:SolarDay[]; observationTime:string; forecast:Forecast[]; birdRisk:string; birdBasis:string; birdUpdated:string; source:"METAR"|"MODEL"; stale:boolean; cloudCoverage:CloudCoverage; cloudBaseFt:number|null; visibilitySm:number|null; phenomena:string[] };
type OpsBoardWeather = { metar?:string; taf?:string; metarFetchStatus?:string; tafFetchStatus?:string; metarObservedZ?:string; bwc?:string; bwcAhasRisk?:string; bwcBasedOn?:string; bwcUpdatedZ?:string; bwcFetchStatus?:string };
// Normalized scene object (Phase 2A): the single source of truth the renderer reads, kept
// deliberately separate from weather parsing so animation layers never re-parse METAR.
type SceneModel = { baseScene:string; cloudCoverage:CloudCoverage; cloudBaseFt:number|null; phenomena:string[]; intensity:"light"|"moderate"|"heavy"; vicinityOnly:boolean; windDirectionDeg:number|null; windSpeedKt:number; gustKt:number|null; visibilitySm:number|null; timePhase:Phase };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:2, opsBoardWeatherUrl:"https://btenner1013.github.io/kmem-ops-board/weather.json" };
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", windSpeedKt:0, windDirection:"—", windDegrees:null, windGustKt:null, humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", solarDays:[], observationTime:"", forecast:[], birdRisk:"UNAVAILABLE", birdBasis:"—", birdUpdated:"—", source:"MODEL", stale:true, cloudCoverage:"CLR", cloudBaseFt:null, visibilitySm:null, phenomena:[] };
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
// Maps the full METAR/TAF present-weather vocabulary onto the eight available scene families so every
// reported condition drives a matching background + animation. `core` strips remarks before matching.
function aviationCondition(text:string):Pick<Weather,"condition"|"description"> {
  const core=(text||"").toUpperCase().split(/\sRMK\s/)[0];
  const has=(re:RegExp)=>re.test(core);
  // Convective / severe first — these dominate the whole-screen scene regardless of what else is reported.
  if(has(/(?:^|\s)\+?FC(?:\s|$)/)) return {condition:"thunderstorm",description:/\+FC/.test(core)?"Tornado":"Funnel cloud"};
  if(has(/(?:^|\s)(?:\+|-|VC)?TS/)) return {condition:"thunderstorm",description:/\+TS/.test(core)?"Severe thunderstorm":has(/TS(?:GR|GS)/)?"Thunderstorm, hail":has(/TSSN/)?"Thunderstorm, snow":has(/TSRA/)?"Thunderstorm, rain":has(/VCTS/)?"Thunderstorm nearby":"Thunderstorm"};
  if(has(/(?:^|\s)SQ(?:\s|$)/)) return {condition:"thunderstorm",description:"Squall"};
  if(has(/(?:^|\s)(?:\+|-|VC|SH)*GR(?:\s|$)/)) return {condition:"thunderstorm",description:"Hail"};
  if(has(/(?:^|\s)(?:\+|-|VC|SH)*GS(?:\s|$)/)) return {condition:"thunderstorm",description:"Small hail"};
  // Freezing precipitation.
  if(has(/FZRA/)) return {condition:/\+FZRA/.test(core)?"heavy-rain":"rain",description:"Freezing rain"};
  if(has(/FZDZ/)) return {condition:"rain",description:"Freezing drizzle"};
  // Frozen precipitation (snow, grains, pellets, ice crystals, blowing/drifting snow).
  const snow=has(/(?:^|\s)(?:\+|-|VC)?(?:MI|PR|BC|DR|BL|SH)?SN(?:\s|$)/)||has(/(?:^|\s)(?:\+|-)?SG(?:\s|$)/)||has(/(?:^|\s)(?:\+|-)?PL(?:\s|$)/)||has(/(?:^|\s)IC(?:\s|$)/);
  const rain=has(/(?:^|\s)(?:\+|-|VC)?(?:SH)?RA(?:\s|$)/)||has(/(?:^|\s)(?:\+|-)?DZ(?:\s|$)/);
  if(snow&&rain) return {condition:"snow",description:"Rain and snow"};
  if(snow) {
    if(has(/PL/)) return {condition:"snow",description:"Ice pellets"};
    if(has(/SG/)) return {condition:"snow",description:"Snow grains"};
    if(has(/IC/)) return {condition:"snow",description:"Ice crystals"};
    if(has(/BLSN|DRSN/)) return {condition:"snow",description:"Blowing snow"};
    return {condition:"snow",description:/\+(?:SH)?SN/.test(core)?"Heavy snow":/-(?:SH)?SN/.test(core)?"Light snow":"Snow"};
  }
  // Liquid precipitation.
  if(rain) {
    if(/\+(?:SH)?RA/.test(core)) return {condition:"heavy-rain",description:"Heavy rain"};
    if(has(/(?:\+|-)?DZ/)&&!has(/RA/)) return {condition:"rain",description:/-DZ/.test(core)?"Light drizzle":"Drizzle"};
    if(has(/SHRA/)) return {condition:"rain",description:"Rain showers"};
    return {condition:"rain",description:/-RA/.test(core)?"Light rain":"Rain"};
  }
  if(has(/(?:^|\s)UP(?:\s|$)/)) return {condition:"rain",description:"Precipitation"};
  if(has(/(?:^|\s)VCSH(?:\s|$)/)) return {condition:"rain",description:"Showers nearby"};
  // Obscurations / low visibility — all mapped to the fog scene.
  if(has(/(?:^|\s)(?:FZ)?FG(?:\s|$)/)) return {condition:"fog",description:/FZFG/.test(core)?"Freezing fog":/\bMIFG\b/.test(core)?"Shallow fog":"Fog"};
  if(has(/(?:^|\s)(?:\+|-)?(?:DS|SS)(?:\s|$)/)) return {condition:"fog",description:/DS/.test(core)?"Dust storm":"Sandstorm"};
  if(has(/(?:^|\s)PO(?:\s|$)/)) return {condition:"fog",description:"Dust whirls"};
  if(has(/(?:^|\s)(?:BL|DR)?DU(?:\s|$)/)) return {condition:"fog",description:"Blowing dust"};
  if(has(/(?:^|\s)(?:BL|DR)?SA(?:\s|$)/)) return {condition:"fog",description:"Blowing sand"};
  if(has(/(?:^|\s)FU(?:\s|$)/)) return {condition:"fog",description:"Smoke"};
  if(has(/(?:^|\s)VA(?:\s|$)/)) return {condition:"fog",description:"Volcanic ash"};
  if(has(/(?:^|\s)BR(?:\s|$)/)) return {condition:"fog",description:"Mist"};
  if(has(/(?:^|\s)HZ(?:\s|$)/)) return {condition:"fog",description:"Haze"};
  if(has(/(?:^|\s)PY(?:\s|$)/)) return {condition:"fog",description:"Spray"};
  // Cloud amount when no significant weather is present.
  if(has(/\bOVC\d{3}\b/)) return {condition:"overcast",description:"Overcast"};
  if(has(/\bBKN\d{3}\b/)) return {condition:"overcast",description:"Broken clouds"};
  if(has(/\bSCT\d{3}\b/)) return {condition:"partly-cloudy",description:"Scattered clouds"};
  if(has(/\bFEW\d{3}\b/)) return {condition:"partly-cloudy",description:"Few clouds"};
  if(has(/\b(?:CLR|SKC|NSC|NCD|CAVOK)\b/)) return {condition:"clear",description:"Clear"};
  return {condition:"overcast",description:"Cloudy"};
}
// Parse the most operationally significant cloud layer, ceiling, and visibility from a raw METAR.
function parseSky(raw:string):{cloudCoverage:CloudCoverage;cloudBaseFt:number|null;visibilitySm:number|null} {
  const core=(raw||"").toUpperCase().split(/\sRMK\s/)[0];
  const rank:Record<string,number>={CLR:0,FEW:1,SCT:2,BKN:3,OVC:4,VV:5};
  let best:{cov:CloudCoverage;base:number|null}={cov:"CLR",base:null};
  const re=/\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g; let m:RegExpExecArray|null;
  while((m=re.exec(core))){ const cov=m[1] as CloudCoverage, base=Number(m[2])*100;
    if(rank[cov]>rank[best.cov] || (rank[cov]===rank[best.cov] && best.base!==null && base<best.base)) best={cov,base};
  }
  let vis:number|null=null;
  const vm=core.match(/(?:^|\s)(?:(\d{1,2})|(\d)\s+(\d)\/(\d)|(\d)\/(\d)|M(\d)\/(\d))SM(?:\s|$)/);
  if(vm){ if(vm[1]) vis=Number(vm[1]); else if(vm[2]) vis=Number(vm[2])+Number(vm[3])/Number(vm[4]); else if(vm[5]) vis=Number(vm[5])/Number(vm[6]); else if(vm[7]) vis=Number(vm[7])/Number(vm[8]); }
  else if(/\bCAVOK\b/.test(core)) vis=10;
  return {cloudCoverage:best.cov, cloudBaseFt:best.base, visibilitySm:vis};
}
// Extract present-weather tokens (intensity+descriptor+phenomena groups) from a raw METAR/TAF.
function extractPhenomena(raw:string):string[] {
  const core=(raw||"").toUpperCase().split(/\sRMK\s/)[0];
  const re=/(?:^|\s)((?:[+-]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|DS|SS|TS|SH)+)(?=\s|$)/g;
  const out:string[]=[]; let m:RegExpExecArray|null;
  while((m=re.exec(core))) out.push(m[1]);
  return out;
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
  return { baseScene:sceneFor(condition,phase), cloudCoverage:debug?coverageFromCondition(condition):(weather.cloudCoverage||"CLR"), cloudBaseFt:debug?null:(weather.cloudBaseFt??null), phenomena, intensity:deriveIntensity(phenomena), vicinityOnly:phenomena.length>0&&phenomena.every(p=>p.startsWith("VC")), windDirectionDeg:weather.windDegrees, windSpeedKt:weather.windSpeedKt, gustKt:weather.windGustKt, visibilitySm:debug?null:(weather.visibilitySm??null), timePhase:phase };
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
  const condition=aviationCondition(raw), temp=raw.match(/\s(M?\d{2})\/(?:M?\d{2}|XX)\s/), wind=raw.match(/(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT(?:\s|$)/);
  const degrees=wind&&wind[1]!=="VRB"?Number(wind[1]):null;
  return { ...condition, temperatureF:temp?cToF(signedCelsius(temp[1])):null, windSpeedKt:wind?Number(wind[2]):null, windGustKt:wind?.[3]?Number(wind[3]):null, windDegrees:degrees, windDirection:degrees===null?"VRB":windDirection(degrees) };
}
function resolveTafDate(day:number,hour:number,minute:number,reference:Date) {
  const candidates=[-1,0,1].map(monthOffset=>new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()+monthOffset,day,hour,minute)));
  return candidates.sort((a,b)=>Math.abs(a.getTime()-reference.getTime())-Math.abs(b.getTime()-reference.getTime()))[0];
}
function tafForecast(model:Forecast[],raw:string,reference:Date):Forecast[] {
  const taf=(raw||"").replace(/\s+/g," ").trim(), validity=taf.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/); if(!validity) return model;
  const periods:{from:Date;condition:Theme;description:string}[]=[];
  const validityEnd=(validity.index||0)+validity[0].length, firstFm=taf.slice(validityEnd).search(/\sFM\d{6}\b/), baseEnd=firstFm<0?taf.length:validityEnd+firstFm;
  const baseCondition=aviationCondition(taf.slice(validityEnd,baseEnd));
  periods.push({from:resolveTafDate(Number(validity[1]),Number(validity[2]),0,reference),...baseCondition});
  const fm=/\bFM(\d{2})(\d{2})(\d{2})\s+([\s\S]*?)(?=\sFM\d{6}\b|$)/g; let match:RegExpExecArray|null;
  while((match=fm.exec(taf))!==null){const parsed=aviationCondition(match[4]);periods.push({from:resolveTafDate(Number(match[1]),Number(match[2]),Number(match[3]),reference),...parsed});}
  periods.sort((a,b)=>a.from.getTime()-b.from.getTime());
  return model.map(slot=>{const target=new Date(slot.iso);let active=periods[0];for(const period of periods){if(period.from<=target) active=period;else break;}return {...slot,condition:active.condition,description:active.description,source:"TAF"};});
}
async function getModelWeather():Promise<Weather> {
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=2`;
  const r=await fetch(url); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  const tm=(iso:string)=>iso?.slice(11,16)||"--:--", utcOffset=Number(j.utc_offset_seconds||0), utcIso=(iso:string)=>new Date(new Date(`${iso}:00Z`).getTime()-utcOffset*1000).toISOString();
  const start=Math.max(0,j.hourly.time.findIndex((t:string)=>t>=j.current.time));
  const forecast:Forecast[]=[2,5,8].map(offset=>{const i=Math.min(start+offset,j.hourly.time.length-1),condition=mapCode(j.hourly.weather_code[i],0);return {time:tm(j.hourly.time[i]),iso:utcIso(j.hourly.time[i]),temperatureF:Math.round(j.hourly.temperature_2m[i]),...condition,precipitation:Math.round(j.hourly.precipitation_probability[i]||0),source:"MODEL"}});
  const windDegrees=Math.round(j.current.wind_direction_10m);
  const solarDays:SolarDay[]=j.daily.time.map((date:string,i:number)=>({date,sunriseLocal:tm(j.daily.sunrise[i]),sunsetLocal:tm(j.daily.sunset[i])}));
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,windSpeedKt:Math.round(j.current.wind_speed_10m),windDirection:windDirection(windDegrees),windDegrees,windGustKt:null,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:solarDays[0]?.sunriseLocal||"--:--",sunsetLocal:solarDays[0]?.sunsetLocal||"--:--",solarDays,observationTime:j.current.time,forecast,birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",stale:false,cloudCoverage:coverageFromCondition(mapped.condition),cloudBaseFt:null,visibilitySm:null,phenomena:phenomenaFromCondition(mapped.condition)};
}
async function getWeather():Promise<Weather> {
  const model=await getModelWeather();
  try {
    const response=await fetch(`${CONFIG.opsBoardWeatherUrl}?v=${Date.now()}`,{cache:"no-store"}); if(!response.ok) return model;
    const ops:OpsBoardWeather=await response.json(), rawMetar=ops.metar||"", rawTaf=ops.taf||"";
    const metarValid=/\b(?:METAR\s+)?KMEM\b/.test(rawMetar.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawMetar.toUpperCase());
    const tafValid=/\bTAF\s+KMEM\b/.test(rawTaf.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawTaf.toUpperCase());
    const metar=metarValid?parseMetar(rawMetar):null, reference=ops.metarObservedZ?new Date(ops.metarObservedZ):new Date();
    const sky=metarValid?parseSky(rawMetar):null, phenomena=metarValid?extractPhenomena(rawMetar):null;
    return {...model,temperatureF:metar?.temperatureF??model.temperatureF,condition:metar?.condition??model.condition,description:metar?.description??model.description,windSpeedKt:metar?.windSpeedKt??model.windSpeedKt,windDirection:metar?.windDirection??model.windDirection,windDegrees:metar?.windDegrees??model.windDegrees,windGustKt:metar?.windGustKt??model.windGustKt,observationTime:metarValid?(ops.metarObservedZ||model.observationTime):model.observationTime,forecast:tafValid?tafForecast(model.forecast,rawTaf,reference):model.forecast,birdRisk:(ops.bwcAhasRisk||ops.bwc||"UNAVAILABLE").toUpperCase(),birdBasis:(ops.bwcBasedOn||"AHAS").toUpperCase(),birdUpdated:ops.bwcUpdatedZ||"—",source:metarValid?"METAR":"MODEL",stale:metarValid?ops.metarFetchStatus!=="OK":model.stale,cloudCoverage:sky?.cloudCoverage??model.cloudCoverage,cloudBaseFt:sky?sky.cloudBaseFt:model.cloudBaseFt,visibilitySm:sky?sky.visibilitySm:model.visibilitySm,phenomena:phenomena&&phenomena.length?phenomena:model.phenomena};
  } catch { return model; }
}
function weatherGlyph(c:Theme) { return ({clear:"☀",night:"☾",rain:"🌧", "heavy-rain":"🌧",thunderstorm:"⛈",snow:"❄",fog:"≋",overcast:"☁","partly-cloudy":"⛅",sunrise:"☀",sunset:"☀",neutral:"—"} as Record<Theme,string>)[c]; }
function WeatherIcon({condition,night=false}:{condition:Theme;night?:boolean}) {
  const theme=condition==="clear"&&night?"night":condition;
  return <i className={`wx-pictogram wxp-${theme} ${night?"wxp-nighttime":""}`} aria-hidden="true"><span className="wxp-sun"/><span className="wxp-moon"/><span className="wxp-cloud"/><span className="wxp-precip"><b/><b/><b/></span><span className="wxp-flakes"><b>✦</b><b>✦</b><b>✦</b></span><span className="wxp-bolt"/><span className="wxp-fog-lines"><b/><b/><b/></span></i>;
}
function isNightAt(time:string,sunrise:string,sunset:string) { const parse=(v:string)=>{const [h,m]=v.split(":").map(Number);return h*60+m}; const clock=parse(time),rise=parse(sunrise),set=parse(sunset); return Number.isFinite(clock)&&Number.isFinite(rise)&&Number.isFinite(set)&&(clock<rise||clock>set); }
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
// Maps a normalized condition + solar phase onto one of the 16 wallpaper assets in
// public/assets/backgrounds/. Precipitation and obscuration always keep their own weather
// wallpaper (day/night) and never fall back to a clear sunrise/sunset frame; only clear skies
// use the dedicated sunrise/sunset art. heavy-rain shares the rain wallpaper (intensity is an
// animation concern, not a separate scene).
function sceneFor(condition:Theme,phase:"day"|"night"|"sunrise"|"sunset") {
  const light=phase==="night"?"night":"day";
  if(condition==="rain"||condition==="heavy-rain") return `rain-${light}`;
  if(condition==="thunderstorm") return `thunderstorm-${light}`;
  if(condition==="snow") return `snow-${light}`;
  if(condition==="fog") return `fog-${light}`;
  if(condition==="overcast") return `overcast-${light}`;
  if(condition==="partly-cloudy") return `partly-cloudy-${light}`;
  // Clear (and neutral / weather-unavailable) — favor the dedicated sunrise/sunset wallpapers.
  if(phase==="sunrise") return "sunrise";
  if(phase==="sunset") return "sunset";
  return `clear-${light}`;
}

export default function Home() {
  const [weather,setWeather]=useState<Weather>(FALLBACK); const [online,setOnline]=useState(true); const [debug,setDebug]=useState<Theme|null>(null); const [debugPhase,setDebugPhase]=useState<"day"|"night"|"sunrise"|"sunset"|null>(null); const [debugBird,setDebugBird]=useState<"LOW"|"MODERATE"|"SEVERE"|null>(null); const [flybys,setFlybys]=useState<Flyby[]>([]);
  const [debugCloud,setDebugCloud]=useState<CloudCoverage|null>(null); const [debugCloudBase,setDebugCloudBase]=useState<number|null>(null); const [debugWind,setDebugWind]=useState<number|null>(null); const [debugWindSpeed,setDebugWindSpeed]=useState<number|null>(null); const [perf,setPerf]=useState<"full"|"low">("full");
  const [debugPhenomena,setDebugPhenomena]=useState<string|null>(null); const [debugIntensity,setDebugIntensity]=useState<Intensity|null>(null); const [debugVisibility,setDebugVisibility]=useState<number|null>(null); const [debugGust,setDebugGust]=useState<number|null>(null); const [reduced,setReduced]=useState(false); const [paneDrops,setPaneDrops]=useState<boolean|null>(null);
  const [showPreview,setShowPreview]=useState(false);
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
    if(q.get("previewWeatherFx")==="1") setShowPreview(true);
    const pd=q.get("debugPaneDrops"); if(pd==="on") setPaneDrops(true); else if(pd==="off") setPaneDrops(false);
    const load=async()=>{try{const w=await getWeather();setWeather(w);localStorage.setItem("kmem-weather",JSON.stringify(w));setOnline(true)}catch{const old=localStorage.getItem("kmem-weather");if(old)setWeather({...JSON.parse(old),stale:true});setOnline(false)}};
    load(); const id=setInterval(load,CONFIG.weatherRefreshMinutes*60000); navigator.serviceWorker?.register("./service-worker.js").catch(()=>{}); return()=>clearInterval(id);
  },[]);
  const local=parts(now,CONFIG.timeZone), utc=parts(now,"UTC");
  const localTime=`${local.hour}:${local.minute}:${local.second}`, utcTime=`${utc.hour}:${utc.minute}:${utc.second}`;
  const displayTheme=debug||weather.condition;
  const phase=debugPhase||(debug?(debug==="night"||debug==="sunrise"||debug==="sunset"?debug:"day"):solarPhase(local,weather.sunriseLocal,weather.sunsetLocal));
  const condition=debug&&!(["night","sunrise","sunset"] as Theme[]).includes(debug)?debug:weather.condition;
  const imageBase=process.env.NEXT_PUBLIC_BASE_PATH||"";
  const scene=sceneFor(condition,phase);
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
  const fxSpec=buildFxSpec(fx,cloudVec.nx,effWindSpd,perf,phase==="night",reduced,paneDrops);
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
  const updated=weather.observationTime?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(weather.observationTime))+"Z":"—";
  const zone=local.timeZoneName||"LOCAL";
  const windLabel=weather.windDegrees===null?"VRB":`${String(weather.windDegrees).padStart(3,"0")}° ${weather.windDirection}`;
  const birdRisk=debugBird||weather.birdRisk;
  const birdClass=/SEVERE|HIGH/.test(birdRisk)?"severe":/MODERATE/.test(birdRisk)?"moderate":/LOW/.test(birdRisk)?"low":"unknown", birdStamp=zStamp(weather.birdUpdated);
  const clockZ=clock.lastCheckedUtc?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(clock.lastCheckedUtc)).replace(":","")+"Z":"—";
  const clockOffset=clock.estimatedOffsetMs!=null?`${clock.estimatedOffsetMs>=0?"+":"-"}${(Math.abs(clock.estimatedOffsetMs)/1000).toFixed(1)} SEC`:"—";
  const clockText=clock.lastCheckedUtc===null&&clock.state!=="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK…":clock.state==="OFFLINE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: OFFLINE":clock.state==="STALE"?"SRC WINDOWS SYSTEM · NETWORK CHECK: STALE (GITHUB EDGE DATE)":`SRC WINDOWS SYSTEM · CHECK GITHUB EDGE DATE: ${clock.state} · OFFSET ${clockOffset} · ${clockZ}`;
  const clockClass=clock.state==="OK"?"ok":clock.state==="OFFLINE"?"off":clock.state==="CHECK"?"chk":"warn";
  const debugHref=useMemo(()=>DEBUG_THEMES.map(t=>`?debugWeather=${t}`),[]);
  return <main className={`display theme-${condition} phase-${phase}`} style={cloudStyle} data-coverage={effCoverage} data-tier={cloudTierV} data-perf={perf} data-performance={perf} data-base={sceneModel.cloudBaseFt??""} data-intensity={sceneModel.intensity} data-vicinity={sceneModel.vicinityOnly?"1":"0"} data-wind={sceneModel.windSpeedKt} data-winddir={sceneModel.windDirectionDeg??""} data-vis={sceneModel.visibilitySm??""} data-nx={cloudVec.nx} data-ny={cloudVec.ny} data-precip-type={fx.precip} data-precip-intensity={fx.intensity} data-precip-active={fxSpec?"1":"0"} data-particle-count={fxSpec?.count??0} data-obscuration={fx.obscuration} data-visibility={effVisibility??""}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${aScene}.png)`,opacity:active==="a"?1:0}}/><i className="sky-base" style={{backgroundImage:`url(${imageBase}/assets/backgrounds/${bScene}.png)`,opacity:active==="b"?1:0}}/><i className="cloud-field"><i className="cloud-layer cl-high"/><i className="cloud-layer cl-mid"/><i className="cloud-layer cl-low"/></i><PrecipCanvas spec={fxSpec} paused={false} night={phase==="night"}/><i className="air-traffic">{flybys.map((flight,i)=><span className={`flyby flyby-${flight.direction}`} key={i} style={{top:`${flight.top}%`,animationDuration:`${flight.cycle}s`,animationDelay:`${flight.delay}s`}}><span className="flight-shape" style={{transform:`rotate(${flight.tilt}deg) scale(${flight.scale}) ${flight.direction==="rtl"?"scaleX(-1)":""}`}}><span className="contrails"><b/><b/></span><span className="aircraft"><b className="airframe"/><i className="wing-strobe strobe-port"/><i className="wing-strobe strobe-starboard"/><i className="anti-collision"/></span></span></span>)}</i><i className="fog-layer"/><i className="weather-fx"/><i className="rain-field">{Array.from({length:56},(_,i)=><span key={i} style={{left:`${(i*37+7)%101}%`,height:`${54+(i*29)%86}px`,animationDelay:`-${((i*31)%29)/10}s`,animationDuration:`${.54+((i*17)%24)/100}s`}}/>)}</i><i className="glass-droplets">{Array.from({length:18},(_,i)=><span key={i}/>)}</i><i className="snow-field">{Array.from({length:44},(_,i)=><span key={i} style={{left:`${(i*43+5)%101}%`,fontSize:`${10+(i*7)%17}px`,animationDelay:`-${((i*19)%71)/10}s`,animationDuration:`${5.8+((i*13)%42)/10}s`}}>❄</span>)}</i><i className="lightning-layer" style={{backgroundImage:`url(${imageBase}/airfield-lightning-overlay.png)`}}/><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><span className="brandmark">⌃</span><div><strong>{CONFIG.title}</strong><small>{CONFIG.airportCode} · MEMPHIS, TENNESSEE</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{zone}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel"><div className="panel-title"><span>SOLAR WINDOW</span><b>{solar.daylight?`${Math.round(solar.progress)}% DAYLIGHT`:`${solar.label} · NEXT SUNRISE`}</b></div><div className="solar-layout"><div className="solar-time solar-rise"><span>SUNRISE</span><strong>{solar.sunrise}</strong><small>LOCAL · {solar.label}</small></div><div className={`solar-arc-wrap ${solar.daylight?"is-daylight":"is-waiting"}`}><span className="solar-horizon"/><span className="solar-arc"/><span className="solar-night-arc"/><i className="solar-rise-dot"/><i className="solar-set-dot"/><span className="solar-sun" style={{left:`${solar.markerX}%`,top:`${solar.markerY}%`}}><small>{solar.daylight?"NOW":"NIGHT"}</small></span></div><div className="solar-time solar-set"><span>SUNSET</span><strong>{solar.sunset}</strong><small>LOCAL · {solar.label}</small></div></div></article>
        <article className="weather-card panel"><div className="panel-title"><span>CURRENT WEATHER</span><b>{weather.source==="METAR"?"KMEM METAR":CONFIG.locationName.toUpperCase()}</b></div><div className="weather-main"><span className="weather-glyph"><WeatherIcon condition={displayTheme} night={phase==="night"}/></span><strong>{weather.temperatureF}<span className="temp-unit">°F</span></strong><div className="weather-copy"><b>{debug?displayTheme.replace("-"," "):weather.description}</b><small className="feels-like">FEELS LIKE <strong>{weather.feelsLikeF??weather.temperatureF}°F</strong></small><small className="weather-stats"><span className="wind-data"><i className={weather.windDegrees===null?"variable":""} style={weather.windDegrees===null?undefined:{transform:`rotate(${weather.windDegrees+180}deg)`}} aria-hidden="true">{weather.windDegrees===null?"↻":"↑"}</i> WIND {windLabel} {weather.windSpeedKt}{weather.windGustKt?`G${weather.windGustKt}`:""} KT</span><span>HUMIDITY {weather.humidity}%</span></small><small className={`bird-risk risk-${birdClass}`}><span>USAHAS BWC</span><strong>{birdRisk}</strong><time>{weather.birdBasis} · {birdStamp}</time></small></div></div>{weather.stale&&<span className="stale">METAR DATA STALE</span>}</article>
        <article className="forecast-card panel"><div className="panel-title"><span>FUTURE WEATHER · NEXT 9 HOURS</span><b>TAF · JULIAN {julian4(now)}</b></div><div className="forecast-grid">{weather.forecast?.length?weather.forecast.map((f,i)=><div key={`${f.time}-${i}`}><time>{f.time}</time><span className="forecast-icon"><WeatherIcon condition={f.condition} night={isNightAt(f.time,solar.sunrise,solar.sunset)}/></span><small className="forecast-condition">{f.description}</small><strong>{f.temperatureF}°</strong><small>{f.precipitation}% PRECIP</small></div>):<div className="forecast-empty">FORECAST UNAVAILABLE</div>}</div></article>
      </section>
      <footer><span className={`clock-status clock-${clockClass}`}><i/> {clockText}</span><span>WX {online?"CURRENT":"CACHED"} · UPDATED {updated} · METAR / TAF + MODEL</span><span>PRESS F11 FOR FULL SCREEN</span></footer>
    </div>
    {debug&&<nav className="debug" aria-label="Weather theme simulator"><b>SIM</b>{DEBUG_THEMES.map((t,i)=><a className={t===debug?"active":""} href={debugHref[i]} key={t}>{t.replace("-"," ")}</a>)}<a className={debugPhase==="day"?"active":""} href={`?debugWeather=${condition}&debugTime=day`}>DAY</a><a className={debugPhase==="night"?"active":""} href={`?debugWeather=${condition}&debugTime=night`}>NIGHT</a><a className={debugPhase==="sunrise"?"active":""} href={`?debugWeather=${condition}&debugTime=sunrise`}>SUNRISE</a><a className={debugPhase==="sunset"?"active":""} href={`?debugWeather=${condition}&debugTime=sunset`}>SUNSET</a>{(["LOW","MODERATE","SEVERE"] as const).map(level=><a className={debugBird===level?"active":""} href={`?debugWeather=${condition}&debugTime=${phase==="night"?"night":"day"}&debugBwc=${level.toLowerCase()}`} key={level}>BWC {level}</a>)}<a href="?">LIVE</a></nav>}
    <PreviewLab active={showPreview} paneDrops={paneDrops} onPaneToggle={setPaneDrops}/>
  </main>;
}
