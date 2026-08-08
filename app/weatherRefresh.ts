import { ATIS_WIND_CURRENT_MINUTES, METAR_WIND_CURRENT_MINUTES, type CurrentWindRecord } from "./currentWind.ts";
import { matchPeriodPrecipitation } from "./futureWeather.ts";
import type { Weather, WeatherFetchResult } from "./weatherTypes";

export type MetarFreshness = { state:"CURRENT"|"STALE"|"UNAVAILABLE"; ageMinutes:number|null };
export type TafFreshness = "CURRENT"|"PENDING"|"EXPIRED"|"UNAVAILABLE";
export type TafTimes = { issueIso:string|null; validStartIso:string|null; validEndIso:string|null };
export type RefreshReason = "initial"|"interval"|"focus"|"visible"|"pageshow"|"online"|"superseded";

const METAR_CURRENT_MS = 75 * 60 * 1000;
const MAX_CACHED_PRECIPITATION_AGE_MINUTES = 180;
const CACHE_VERSION = 4;
const THEMES = new Set(["clear","partly-cloudy","overcast","rain","heavy-rain","thunderstorm","fog","snow","night","sunrise","sunset","neutral"]);
const COVERAGE = new Set(["CLR","FEW","SCT","BKN","OVC","VV"]);
const LEGACY_NO_LIGHTNING={level:"none",source:"none",code:null,frequency:null,types:[],directions:[],awareness:null,tone:"green",flash:false,pulse:false} as const;

function validDate(value:string|null|undefined):value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function monthCandidates(day:number, hour:number, minute:number, reference:Date):Date[] {
  if(!Number.isInteger(day)||day<1||day>31||!Number.isInteger(hour)||hour<0||hour>24||!Number.isInteger(minute)||minute<0||minute>59||hour===24&&minute!==0) return [];
  const out:Date[]=[];
  for(const offset of [-1,0,1,2]) {
    const monthStart=new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()+offset,1));
    const base=new Date(Date.UTC(monthStart.getUTCFullYear(),monthStart.getUTCMonth(),day));
    if(base.getUTCFullYear()!==monthStart.getUTCFullYear()||base.getUTCMonth()!==monthStart.getUTCMonth()||base.getUTCDate()!==day) continue;
    out.push(new Date(base.getTime()+hour*3600000+minute*60000));
  }
  return out;
}

export function resolveAviationDate(day:number,hour:number,minute:number,reference:Date):Date|null {
  if(!Number.isFinite(reference.getTime())) return null;
  const candidates=monthCandidates(day,hour,minute,reference);
  return candidates.sort((a,b)=>Math.abs(a.getTime()-reference.getTime())-Math.abs(b.getTime()-reference.getTime()))[0]||null;
}

function firstDateAfter(day:number,hour:number,minute:number,after:Date):Date|null {
  return monthCandidates(day,hour,minute,after).filter(d=>d.getTime()>after.getTime()).sort((a,b)=>a.getTime()-b.getTime())[0]||null;
}

export function parseMetarObservedAt(raw:string, reportedIso:string|undefined, reference:Date):string|null {
  if(reportedIso) {
    const reported=Date.parse(reportedIso);
    if(Number.isFinite(reported)&&Math.abs(reported-reference.getTime())<=7*86400000) return new Date(reported).toISOString();
  }
  const match=(raw||"").toUpperCase().match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  const parsed=match?resolveAviationDate(Number(match[1]),Number(match[2]),Number(match[3]),reference):null;
  return parsed?.toISOString()||null;
}

// Freshness-only TAF parsing. Structured TEMPO/PROB interpretation remains Checkpoint 2.
export function parseTafTimes(raw:string, reference:Date):TafTimes {
  const taf=(raw||"").toUpperCase().replace(/\s+/g," ").trim();
  const issue=taf.match(/\bKMEM\s+(\d{2})(\d{2})(\d{2})Z\b/);
  const validity=taf.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  const issueDate=issue?resolveAviationDate(Number(issue[1]),Number(issue[2]),Number(issue[3]),reference):null;
  const startReference=issueDate||reference;
  const start=validity?resolveAviationDate(Number(validity[1]),Number(validity[2]),0,startReference):null;
  let end:Date|null=null;
  if(validity&&start) end=firstDateAfter(Number(validity[3]),Number(validity[4]),0,start);
  if(!issueDate||!start||!end||end.getTime()-start.getTime()>72*3600000) return {issueIso:issueDate?.toISOString()||null,validStartIso:null,validEndIso:null};
  return {issueIso:issueDate.toISOString(),validStartIso:start.toISOString(),validEndIso:end.toISOString()};
}

export function classifyMetarFreshness(observedIso:string|null, nowMs:number):MetarFreshness {
  const observed=observedIso?Date.parse(observedIso):NaN;
  if(!Number.isFinite(observed)||!Number.isFinite(nowMs)) return {state:"UNAVAILABLE",ageMinutes:null};
  const elapsed=nowMs-observed;
  return {state:elapsed<=METAR_CURRENT_MS?"CURRENT":"STALE",ageMinutes:Math.max(0,Math.floor(elapsed/60000))};
}

export function classifyTafFreshness(times:TafTimes, nowMs:number):TafFreshness {
  const start=times.validStartIso?Date.parse(times.validStartIso):NaN, end=times.validEndIso?Date.parse(times.validEndIso):NaN;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(nowMs)) return "UNAVAILABLE";
  if(nowMs<start) return "PENDING";
  if(nowMs>=end) return "EXPIRED";
  return "CURRENT";
}

const METAR_KEYS:(keyof Weather)[]=["temperatureF","condition","description","operationalWeather","observationTime","source","cloudCoverage","cloudBaseFt","visibilitySm","phenomena","metarObsIso","rawMetar"];
const TAF_KEYS:(keyof Weather)[]=["forecast","tafHazards","tafIssueIso","tafValidStartIso","tafValidEndIso"];
const MODEL_KEYS:(keyof Weather)[]=["feelsLikeF","humidity","sunriseLocal","sunsetLocal","solarDays"];

function integerInRange(value:unknown,min:number,max:number):value is number {
  return typeof value==="number"&&Number.isInteger(value)&&value>=min&&value<=max;
}

/** Validate the whole record so a cached direction can never be paired with another source's speed. */
function isCurrentWind(value:unknown):value is CurrentWindRecord {
  if(!value||typeof value!=="object") return false;
  const wind=value as Partial<CurrentWindRecord>;
  if(!["directional","variable","calm"].includes(String(wind.directionType))) return false;
  if(!["ATIS","METAR","MODEL"].includes(String(wind.source))||typeof wind.raw!=="string"||wind.raw.trim().length===0) return false;
  if(!integerInRange(wind.speedKt,0,999)) return false;
  if(wind.gustKt!==null&&!integerInRange(wind.gustKt,0,999)) return false;
  if(wind.observedAt!==null&&!validDate(wind.observedAt)) return false;

  const sectorAbsent=wind.variableFromDegrees===null&&wind.variableToDegrees===null;
  const sectorPresent=integerInRange(wind.variableFromDegrees,0,360)&&integerInRange(wind.variableToDegrees,0,360);
  if(!sectorAbsent&&!sectorPresent) return false;
  if(wind.directionType==="calm") return wind.directionDegrees===null&&wind.speedKt===0&&wind.gustKt===null&&sectorAbsent;
  if(wind.directionType==="variable") return wind.directionDegrees===null&&sectorAbsent;
  return integerInRange(wind.directionDegrees,1,360)&&(sectorAbsent||sectorPresent);
}

function isObservedWind(value:unknown):value is CurrentWindRecord {
  return isCurrentWind(value)&&(value.source==="ATIS"||value.source==="METAR");
}

function isCurrentObservedWind(value:unknown, referenceIso:string|null):value is CurrentWindRecord {
  if(!isObservedWind(value)||!validDate(value.observedAt)||!validDate(referenceIso)) return false;
  const ageMinutes=(Date.parse(referenceIso)-Date.parse(value.observedAt))/60000;
  const maximum=value.source==="ATIS"?ATIS_WIND_CURRENT_MINUTES:METAR_WIND_CURRENT_MINUTES;
  return ageMinutes>=-5&&ageMinutes<=maximum;
}

function preserve(target:Weather, previous:Weather, keys:(keyof Weather)[]) {
  const mutable=target as unknown as Record<string,unknown>, prior=previous as unknown as Record<string,unknown>;
  for(const key of keys) mutable[key]=prior[key];
}

/**
 * Retained rows keep the same period semantics the TAF builder gave them: a row
 * stands until the next row's valid time, so re-matched PoP cannot drift from what
 * a fresh TAF would have produced for the identical block.
 */
function rematchPrecipitation(rows:Weather["forecast"], samples:Weather["forecast"], result:WeatherFetchResult):Weather["forecast"] {
  const now=result.weather.lastRefreshAttemptIso||Date.now();
  return rows.map((row,index)=>({...row,...matchPeriodPrecipitation(row.iso,rows[index+1]?.iso??null,samples,{now})}));
}

export function mergeWeather(previous:Weather, result:WeatherFetchResult):Weather {
  const incomingForecast=result.weather.forecast;
  const merged={...previous,...result.weather};
  if(!result.modelValid) preserve(merged,previous,MODEL_KEYS);
  if(!result.metarValid&&validDate(previous.metarObsIso)) preserve(merged,previous,METAR_KEYS);
  if(!result.windValid&&isCurrentObservedWind(previous.currentWind,result.weather.lastRefreshAttemptIso)) merged.currentWind=previous.currentWind;
  if(!result.feedReached) merged.currentLightning={...result.weather.currentLightning,isStale:false,isUnavailable:true};
  if(!result.tafValid&&validDate(previous.tafValidEndIso)) {
    preserve(merged,previous,TAF_KEYS);
    const samples=result.modelValid?incomingForecast:[];
    merged.forecast=rematchPrecipitation(previous.forecast,samples,result);
  }
  if(result.tafValid&&!result.weather.forecast.length&&previous.forecast.length) {
    merged.forecast=rematchPrecipitation(previous.forecast,[],result);
  }
  if(result.weather.birdRisk==="UNAVAILABLE"&&previous.birdRisk!=="UNAVAILABLE") preserve(merged,previous,["birdRisk","birdBasis","birdUpdated"]);
  return merged;
}

export function canCacheWeather(weather:Weather):boolean {
  return validDate(weather.metarObsIso)||(validDate(weather.tafIssueIso)&&validDate(weather.tafValidStartIso)&&validDate(weather.tafValidEndIso));
}

function isWeather(value:unknown):value is Weather {
  if(!value||typeof value!=="object") return false;
  const w=value as Partial<Weather>;
  const finite=[w.temperatureF,w.feelsLikeF,w.humidity].every(v=>typeof v==="number"&&Number.isFinite(v));
  const nullableNumber=(v:unknown)=>v===null||typeof v==="number"&&Number.isFinite(v), nullableDate=(v:unknown)=>v===null||validDate(typeof v==="string"?v:null);
  const solar=Array.isArray(w.solarDays)&&w.solarDays.every(d=>!!d&&typeof d.date==="string"&&typeof d.sunriseLocal==="string"&&typeof d.sunsetLocal==="string");
  const operational=(v:unknown)=>v===null||!!v&&typeof v==="object"&&typeof (v as {category?:unknown}).category==="string"&&typeof (v as {condition?:unknown}).condition==="string";
  const lightning=(v:unknown)=>!!v&&typeof v==="object"&&["none","distant","vicinity","station","severe"].includes(String((v as {level?:unknown}).level))&&Array.isArray((v as {types?:unknown}).types)&&Array.isArray((v as {directions?:unknown}).directions)&&["green","blue","yellow","red"].includes(String((v as {tone?:unknown}).tone))&&typeof (v as {flash?:unknown}).flash==="boolean"&&typeof (v as {pulse?:unknown}).pulse==="boolean";
  const forecast=Array.isArray(w.forecast)&&w.forecast.every(f=>{
    if(!f||typeof f.time!=="string"||!validDate(f.iso)||typeof f.temperatureF!=="number"||!Number.isFinite(f.temperatureF)||typeof f.condition!=="string"||!THEMES.has(f.condition)||typeof f.description!=="string"||(f.source!=="TAF"&&f.source!=="MODEL")||!operational(f.operationalWeather)) return false;
    const probability=f.precipitationProbability;
    if(probability!==null&&!(typeof probability==="number"&&Number.isFinite(probability)&&probability>=0&&probability<=100)) return false;
    if(f.precipitationSource!==null&&!(typeof f.precipitationSource==="string"&&f.precipitationSource.trim().length>0)) return false;
    if(!nullableDate(f.precipitationValidTime)||!nullableDate(f.precipitationFetchedAt)) return false;
    return f.precipitationAgeMinutes===null||typeof f.precipitationAgeMinutes==="number"&&Number.isFinite(f.precipitationAgeMinutes)&&f.precipitationAgeMinutes>=0;
  });
  const hazards=Array.isArray(w.tafHazards)&&w.tafHazards.every(h=>!!h&&typeof h.id==="string"&&validDate(h.fromIso)&&validDate(h.toIso)&&operational(h.weather));
  return finite&&typeof w.condition==="string"&&THEMES.has(w.condition)&&typeof w.description==="string"&&operational(w.operationalWeather)&&lightning(w.currentLightning)&&isCurrentWind(w.currentWind)&&typeof w.sunriseLocal==="string"&&typeof w.sunsetLocal==="string"&&solar&&forecast&&hazards&&typeof w.wxAlertText==="string"&&typeof w.wxAlertTone==="string"&&typeof w.wxAlertPulse==="boolean"&&typeof w.wxAlertFlash==="boolean"&&typeof w.wxAlertVisible==="boolean"&&Array.isArray(w.phenomena)&&w.phenomena.every(p=>typeof p==="string")&&typeof w.cloudCoverage==="string"&&COVERAGE.has(w.cloudCoverage)&&nullableNumber(w.cloudBaseFt)&&nullableNumber(w.visibilitySm)&&nullableDate(w.metarObsIso)&&nullableDate(w.tafIssueIso)&&nullableDate(w.tafValidStartIso)&&nullableDate(w.tafValidEndIso)&&typeof w.source==="string"&&["METAR","MODEL"].includes(w.source)&&canCacheWeather(w as Weather);
}

function normalizedCacheDate(value:unknown):string|null {
  return typeof value==="string"&&validDate(value)?new Date(value).toISOString():null;
}

function migrateLegacyWind(value:Record<string,unknown>):CurrentWindRecord|null {
  if(!integerInRange(value.windSpeedKt,0,999)) return null;
  const speedKt=value.windSpeedKt;
  const gustKt=value.windGustKt===null||value.windGustKt===undefined?null:value.windGustKt;
  if(gustKt!==null&&!integerInRange(gustKt,0,999)) return null;
  const label=typeof value.windDirection==="string"?value.windDirection.trim().toUpperCase():"";
  const degrees=value.windDegrees;
  const source:CurrentWindRecord["source"]=value.source==="METAR"?"METAR":"MODEL";
  const observedAt=source==="METAR"?normalizedCacheDate(value.metarObsIso):normalizedCacheDate(value.observationTime);
  if(speedKt===0&&(degrees===0||label==="CALM")) {
    return {directionType:"calm",directionDegrees:null,speedKt:0,gustKt:null,variableFromDegrees:null,variableToDegrees:null,source,observedAt,raw:"00000KT"};
  }
  const speed=String(speedKt).padStart(2,"0"), gust=gustKt===null?"":`G${String(gustKt).padStart(2,"0")}`;
  if(label==="VRB"||label==="VARIABLE") {
    return {directionType:"variable",directionDegrees:null,speedKt,gustKt,variableFromDegrees:null,variableToDegrees:null,source,observedAt,raw:`VRB${speed}${gust}KT`};
  }
  if(!integerInRange(degrees,1,360)) return null;
  return {directionType:"directional",directionDegrees:degrees,speedKt,gustKt,variableFromDegrees:null,variableToDegrees:null,source,observedAt,raw:`${String(degrees).padStart(3,"0")}${speed}${gust}KT`};
}

function migrateLegacyForecast(value:unknown):unknown {
  if(!value||typeof value!=="object") return value;
  const migrated={...(value as Record<string,unknown>)};
  delete migrated.precipitation;
  // Legacy PoP had neither a trustworthy hourly match nor provenance. It is
  // deliberately unavailable until a new fetch supplies a traceable sample.
  migrated.precipitationProbability=null;
  migrated.precipitationSource=null;
  migrated.precipitationValidTime=null;
  migrated.precipitationFetchedAt=null;
  migrated.precipitationAgeMinutes=null;
  return migrated;
}

function migrateLegacyCache(value:Record<string,unknown>,version:number):Record<string,unknown>|null {
  let migrated={...value};
  if(version===1) {
    migrated={...migrated,operationalWeather:null,currentLightning:{...LEGACY_NO_LIGHTNING},tafHazards:[],forecast:Array.isArray(migrated.forecast)?migrated.forecast.map(f=>({...((f&&typeof f==="object")?f:{}),operationalWeather:null})):[]};
  } else if(version===2) {
    migrated={...migrated,currentLightning:{...LEGACY_NO_LIGHTNING}};
  }
  if(version<=3) {
    const currentWind=migrateLegacyWind(migrated);
    if(!currentWind) return null;
    migrated={...migrated,currentWind,forecast:Array.isArray(migrated.forecast)?migrated.forecast.map(migrateLegacyForecast):[]};
    delete migrated.windSpeedKt;
    delete migrated.windDirection;
    delete migrated.windDegrees;
    delete migrated.windGustKt;
  }
  return migrated;
}

function refreshPrecipitationAges(value:Record<string,unknown>,nowMs:number):Record<string,unknown> {
  if(!Array.isArray(value.forecast)) return value;
  return {...value,forecast:value.forecast.map(item=>{
    if(!item||typeof item!=="object") return item;
    const row={...(item as Record<string,unknown>)}, fetched=typeof row.precipitationFetchedAt==="string"?Date.parse(row.precipitationFetchedAt):NaN;
    const age=Number.isFinite(fetched)?Math.max(0,Math.floor((nowMs-fetched)/60000)):null;
    row.precipitationAgeMinutes=age;
    if(age===null||age>MAX_CACHED_PRECIPITATION_AGE_MINUTES) row.precipitationProbability=null;
    return row;
  })};
}

export function serializeWeatherCache(weather:Weather, savedAtIso:string):string|null {
  if(!isWeather(weather)||!validDate(savedAtIso)) return null;
  return JSON.stringify({version:CACHE_VERSION,savedAtIso,weather});
}

export function restoreWeatherCache(raw:string|null, displayNow: Date):Weather|null {
  if(!raw) return null;
  try {
    const parsed=JSON.parse(raw) as {version?:number;savedAtIso?:string;weather?:unknown};
    const version=parsed.version||0;
    if(![1,2,3,CACHE_VERSION].includes(version)||!validDate(parsed.savedAtIso)||!parsed.weather||typeof parsed.weather!=="object") return null;
    
    // Invalidate if date rolled over (which breaks solarWindow timezone logic)
    // We use the authoritative displayNow (which respects debugExactTime) instead of an unrelated new Date().
    const w = parsed.weather as Weather;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(displayNow).map(x => [x.type, x.value]));
    const today = `${p.year}-${p.month.padStart(2,"0")}-${p.day.padStart(2,"0")}`;
    
    // Keep both validations: TAF iso times must exist, and solarDays must match current authoritative date.
    if (!w.tafValidStartIso || !w.tafValidEndIso) return null;
    if (w.solarDays && w.solarDays.length > 0 && w.solarDays[0].date !== today) return null;
    
    const migrated=migrateLegacyCache(parsed.weather as Record<string,unknown>,version);
    if(!migrated) return null;
    const aged=refreshPrecipitationAges(migrated,displayNow.getTime());
    const candidate={...aged,currentLightning:{...LEGACY_NO_LIGHTNING,...(aged.currentLightning&&typeof aged.currentLightning==="object"?aged.currentLightning:{})}};
    if(!isWeather(candidate)) return null;
    return {...candidate,feedStatus:"DEGRADED",requestStatus:"IDLE",feedError:"RESTORED CACHE"};
  } catch { return null; }
}

type TimerHandle=ReturnType<typeof setTimeout>;
export type RefreshCoordinator<T> = { refresh:(reason:RefreshReason)=>Promise<void>; stop:()=>void; isActive:()=>boolean };
export function createRefreshCoordinator<T>(options:{
  fetcher:(signal:AbortSignal,reason:RefreshReason)=>Promise<T>;
  onAttempt?:(reason:RefreshReason,atIso:string)=>void;
  onResult:(result:T,reason:RefreshReason,atIso:string)=>void;
  onError:(error:unknown,reason:RefreshReason,atIso:string,timedOut:boolean)=>void;
  timeoutMs?:number;
  now?:()=>number;
  setTimer?:(callback:()=>void,delay:number)=>TimerHandle;
  clearTimer?:(handle:TimerHandle)=>void;
}):RefreshCoordinator<T> {
  const now=options.now||Date.now, setTimer=options.setTimer||setTimeout, clearTimer=options.clearTimer||clearTimeout, timeoutMs=options.timeoutMs??12000;
  let stopped=false, active:{controller:AbortController;promise:Promise<void>}|null=null, rerun=false;
  const run=(reason:RefreshReason):Promise<void>=>{
    if(stopped) return Promise.resolve();
    if(active){ rerun=true; active.controller.abort("superseded"); return active.promise; }
    const controller=new AbortController(); let timedOut=false;
    options.onAttempt?.(reason,new Date(now()).toISOString());
    const timeout=setTimer(()=>{timedOut=true;controller.abort("timeout");},timeoutMs);
    const promise=(async()=>{
      try {
        const result=await options.fetcher(controller.signal,reason);
        if(!stopped) options.onResult(result,reason,new Date(now()).toISOString());
      } catch(error) {
        const superseded=controller.signal.aborted&&controller.signal.reason==="superseded";
        if(!stopped&&!superseded) options.onError(error,reason,new Date(now()).toISOString(),timedOut);
      } finally {
        clearTimer(timeout); active=null;
        if(rerun&&!stopped){rerun=false;void run("superseded");}
      }
    })();
    active={controller,promise};
    return promise;
  };
  return {refresh:run,stop:()=>{stopped=true;rerun=false;active?.controller.abort("unmount");},isActive:()=>active!==null};
}

type LifecycleWindow = Pick<Window,"addEventListener"|"removeEventListener"|"setInterval"|"clearInterval">;
type LifecycleDocument = Pick<Document,"addEventListener"|"removeEventListener"|"visibilityState">;
export function installWeatherRefreshLifecycle(refresh:(reason:RefreshReason)=>void,intervalMs:number,targetWindow:LifecycleWindow=window,targetDocument:LifecycleDocument=document):()=>void {
  const onFocus=()=>refresh("focus"), onShow=()=>refresh("pageshow"), onOnline=()=>refresh("online"), onVisible=()=>{if(targetDocument.visibilityState==="visible") refresh("visible");};
  refresh("initial");
  const interval=targetWindow.setInterval(()=>refresh("interval"),intervalMs);
  targetWindow.addEventListener("focus",onFocus); targetWindow.addEventListener("pageshow",onShow); targetWindow.addEventListener("online",onOnline); targetDocument.addEventListener("visibilitychange",onVisible);
  return ()=>{targetWindow.clearInterval(interval);targetWindow.removeEventListener("focus",onFocus);targetWindow.removeEventListener("pageshow",onShow);targetWindow.removeEventListener("online",onOnline);targetDocument.removeEventListener("visibilitychange",onVisible);};
}
