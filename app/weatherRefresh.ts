import type { Weather, WeatherFetchResult } from "./weatherTypes";

export type MetarFreshness = { state:"CURRENT"|"STALE"|"UNAVAILABLE"; ageMinutes:number|null };
export type TafFreshness = "CURRENT"|"PENDING"|"EXPIRED"|"UNAVAILABLE";
export type TafTimes = { issueIso:string|null; validStartIso:string|null; validEndIso:string|null };
export type RefreshReason = "initial"|"interval"|"focus"|"visible"|"pageshow"|"online"|"superseded";

const METAR_CURRENT_MS = 75 * 60 * 1000;
const CACHE_VERSION = 2;
const THEMES = new Set(["clear","partly-cloudy","overcast","rain","heavy-rain","thunderstorm","fog","snow","night","sunrise","sunset","neutral"]);
const COVERAGE = new Set(["CLR","FEW","SCT","BKN","OVC","VV"]);

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

const METAR_KEYS:(keyof Weather)[]=["temperatureF","condition","description","operationalWeather","windSpeedKt","windDirection","windDegrees","windGustKt","observationTime","source","cloudCoverage","cloudBaseFt","visibilitySm","phenomena","metarObsIso"];
const TAF_KEYS:(keyof Weather)[]=["forecast","tafHazards","tafIssueIso","tafValidStartIso","tafValidEndIso"];
const MODEL_KEYS:(keyof Weather)[]=["feelsLikeF","humidity","sunriseLocal","sunsetLocal","solarDays"];

function preserve(target:Weather, previous:Weather, keys:(keyof Weather)[]) {
  const mutable=target as unknown as Record<string,unknown>, prior=previous as unknown as Record<string,unknown>;
  for(const key of keys) mutable[key]=prior[key];
}

export function mergeWeather(previous:Weather, result:WeatherFetchResult):Weather {
  const merged={...previous,...result.weather};
  if(!result.modelValid) preserve(merged,previous,MODEL_KEYS);
  if(!result.metarValid&&validDate(previous.metarObsIso)) preserve(merged,previous,METAR_KEYS);
  if(!result.tafValid&&validDate(previous.tafValidEndIso)) preserve(merged,previous,TAF_KEYS);
  if(result.tafValid&&!result.weather.forecast.length&&previous.forecast.length) merged.forecast=previous.forecast;
  if(result.weather.birdRisk==="UNAVAILABLE"&&previous.birdRisk!=="UNAVAILABLE") preserve(merged,previous,["birdRisk","birdBasis","birdUpdated"]);
  return merged;
}

export function canCacheWeather(weather:Weather):boolean {
  return validDate(weather.metarObsIso)||(validDate(weather.tafIssueIso)&&validDate(weather.tafValidStartIso)&&validDate(weather.tafValidEndIso));
}

function isWeather(value:unknown):value is Weather {
  if(!value||typeof value!=="object") return false;
  const w=value as Partial<Weather>;
  const finite=[w.temperatureF,w.feelsLikeF,w.windSpeedKt,w.humidity].every(v=>typeof v==="number"&&Number.isFinite(v));
  const nullableNumber=(v:unknown)=>v===null||typeof v==="number"&&Number.isFinite(v), nullableDate=(v:unknown)=>v===null||validDate(typeof v==="string"?v:null);
  const solar=Array.isArray(w.solarDays)&&w.solarDays.every(d=>!!d&&typeof d.date==="string"&&typeof d.sunriseLocal==="string"&&typeof d.sunsetLocal==="string");
  const operational=(v:unknown)=>v===null||!!v&&typeof v==="object"&&typeof (v as {category?:unknown}).category==="string"&&typeof (v as {condition?:unknown}).condition==="string";
  const forecast=Array.isArray(w.forecast)&&w.forecast.every(f=>!!f&&typeof f.time==="string"&&validDate(f.iso)&&typeof f.temperatureF==="number"&&Number.isFinite(f.temperatureF)&&typeof f.condition==="string"&&THEMES.has(f.condition)&&typeof f.description==="string"&&typeof f.precipitation==="number"&&Number.isFinite(f.precipitation)&&(f.source==="TAF"||f.source==="MODEL")&&operational(f.operationalWeather));
  const hazards=Array.isArray(w.tafHazards)&&w.tafHazards.every(h=>!!h&&typeof h.id==="string"&&validDate(h.fromIso)&&validDate(h.toIso)&&operational(h.weather));
  return finite&&typeof w.condition==="string"&&THEMES.has(w.condition)&&typeof w.description==="string"&&operational(w.operationalWeather)&&typeof w.windDirection==="string"&&nullableNumber(w.windDegrees)&&nullableNumber(w.windGustKt)&&typeof w.sunriseLocal==="string"&&typeof w.sunsetLocal==="string"&&solar&&forecast&&hazards&&Array.isArray(w.phenomena)&&w.phenomena.every(p=>typeof p==="string")&&typeof w.cloudCoverage==="string"&&COVERAGE.has(w.cloudCoverage)&&nullableNumber(w.cloudBaseFt)&&nullableNumber(w.visibilitySm)&&nullableDate(w.metarObsIso)&&nullableDate(w.tafIssueIso)&&nullableDate(w.tafValidStartIso)&&nullableDate(w.tafValidEndIso)&&typeof w.source==="string"&&["METAR","MODEL"].includes(w.source)&&canCacheWeather(w as Weather);
}

export function serializeWeatherCache(weather:Weather, savedAtIso:string):string|null {
  if(!isWeather(weather)||!validDate(savedAtIso)) return null;
  return JSON.stringify({version:CACHE_VERSION,savedAtIso,weather});
}

export function restoreWeatherCache(raw:string|null):Weather|null {
  if(!raw) return null;
  try {
    const parsed=JSON.parse(raw) as {version?:number;savedAtIso?:string;weather?:unknown};
    if(!validDate(parsed.savedAtIso)||!parsed.weather||typeof parsed.weather!=="object") return null;
    const candidate=parsed.version===1?{...(parsed.weather as Weather),operationalWeather:null,tafHazards:[],forecast:Array.isArray((parsed.weather as Weather).forecast)?(parsed.weather as Weather).forecast.map(f=>({...f,operationalWeather:null})):[]} : parsed.weather;
    if(![1,CACHE_VERSION].includes(parsed.version||0)||!isWeather(candidate)) return null;
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
