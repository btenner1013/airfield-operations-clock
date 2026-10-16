import { parseAviationSky } from "./aviationWeatherPriority.ts";
import { classifyMetarFreshness, parseMetarObservedAt } from "./weatherRefresh.ts";
import type { Weather, WeatherFetchResult } from "./weatherTypes";

export type TrendDirection = "up" | "down" | "steady";
export type CurrentTrendMetric = "ceiling" | "visibility" | "temperature";
export type TrendComparison = { direction:TrendDirection; previousObservedAt:string; observedAt:string };
type Ceiling = { kind:"unlimited" } | { kind:"height"; feet:number };
type Visibility = { value:number; bound:"exact"|"at-least"|"more-than"|"less-than" };
export type CurrentTrendObservation = {
  observedAt:string; raw:string; ceiling:Ceiling|null; visibility:Visibility|null; temperatureC:number|null;
};
export type CurrentTrendHistory = { previous:CurrentTrendObservation|null; current:CurrentTrendObservation|null };
export type CurrentWeatherTrends = Record<CurrentTrendMetric,TrendComparison|null>;
const emptyHistory = ():CurrentTrendHistory => ({previous:null,current:null});
const emptyTrends = ():CurrentWeatherTrends => ({ceiling:null,visibility:null,temperature:null});

function coreReport(raw:string):string { return raw.toUpperCase().replace(/\s+/g," ").trim().split(/\sRMK(?:\s|$)/)[0].replace(/=$/,""); }
function current(observation:CurrentTrendObservation,nowMs:number):boolean {
  return classifyMetarFreshness(observation.observedAt,nowMs).state === "CURRENT";
}
function parseVisibility(core:string):Visibility|null {
  const m=core.match(/(?:^|\s)(P|M)?(?:(\d+)\s+)?(\d+)(?:\/(\d+))?SM(?=\s|$)/);
  if(!m || m[4] === "0") return null;
  const value=m[4]?Number(m[2]||0)+Number(m[3])/Number(m[4]):Number(m[3]);
  if(!Number.isFinite(value)||value<0||(value===0&&m[1]==="M")) return null;
  // 10 SM is a capped US report, not evidence of exactly ten miles. CAVOK is
  // deliberately excluded: the existing numeric display does not preserve its units.
  return {value,bound:m[1]==="P"?"more-than":m[1]==="M"?"less-than":value===10?"at-least":"exact"};
}

/** Raw METAR fields only: source=METAR alone can still contain a model temperature fallback. */
export function currentTrendObservation(weather:Weather,nowMs:number):CurrentTrendObservation|null {
  if(weather.source!=="METAR" || weather.metarFetchStatus!=="OK" || !weather.rawMetar || !weather.metarObsIso) return null;
  const raw=weather.rawMetar.toUpperCase().replace(/\s+/g," ").trim(),core=coreReport(raw);
  if(!/^(?:(?:METAR|SPECI)\s+)?(?:COR\s+)?KMEM\s+(?:COR\s+)?\d{6}Z\b/.test(core)) return null;
  const observedAt=parseMetarObservedAt(raw,undefined,new Date(weather.metarObsIso));
  if(!observedAt || Date.parse(observedAt)!==Date.parse(weather.metarObsIso) || classifyMetarFreshness(observedAt,nowMs).state!=="CURRENT") return null;
  const sky=parseAviationSky(core);
  const unknownCeiling=core.split(/\s+/).some(token=>/^(?:BKN|OVC|VV)/.test(token)&&!/^(?:(?:BKN|OVC)\d{3}(?:CB|TCU)?|VV\d{3})$/.test(token));
  const ceiling:Ceiling|null=unknownCeiling?null:sky.ceilingUnlimited?{kind:"unlimited"}:sky.ceilingFt!==null&&Number.isFinite(sky.ceilingFt)?{kind:"height",feet:sky.ceilingFt}:null;
  const temp=core.match(/(?:^|\s)(M?\d{2})\/(?:M?\d{2}|XX)(?=\s|$)/);
  const sourceTemp=weather.rawMetar.match(/\s(M?\d{2})\/(?:M?\d{2}|XX)\s/);
  const temperatureC=temp&&sourceTemp?.[1]===temp[1]?(temp[1].startsWith("M")?-Number(temp[1].slice(1)):Number(temp[1])):null;
  return {observedAt,raw,ceiling,visibility:parseVisibility(core),temperatureC};
}

/** Session-only observation history. Cache restore and fetch timestamps never enter it. */
export function advanceCurrentTrendHistory(history:CurrentTrendHistory,result:Pick<WeatherFetchResult,"weather"|"feedReached"|"metarValid">,nowMs:number):CurrentTrendHistory {
  const next=result.feedReached&&result.metarValid?currentTrendObservation(result.weather,nowMs):null;
  if(!next) return emptyHistory();
  const prior=history.current;
  if(!prior || !current(prior,nowMs)) return {previous:null,current:next};
  const elapsed=Date.parse(next.observedAt)-Date.parse(prior.observedAt);
  if(elapsed<0) return {previous:null,current:prior}; // never roll a baseline backwards
  if(elapsed===0) return next.raw===prior.raw?history:{previous:null,current:next}; // COR is not a new observation time
  return {previous:prior,current:next};
}

function numericTrend(now:number,before:number,threshold:number):TrendDirection {
  return Math.abs(now-before)<threshold?"steady":now>before?"up":"down";
}
function ceilingCategory(value:Ceiling):number {
  return value.kind==="unlimited"?3:value.feet<500?0:value.feet<1000?1:value.feet<=3000?2:3;
}
export function compareCeiling(current:Ceiling|null,previous:Ceiling|null):TrendDirection|null {
  if(!current||!previous) return null;
  const a=ceilingCategory(current),b=ceilingCategory(previous);
  if(a!==b) return a>b?"up":"down";
  // Match the ops-board rule: unlimited versus a high VFR ceiling is not a
  // meaningful category change. Missing sky never reaches this comparison.
  if(current.kind==="unlimited"||previous.kind==="unlimited") return "steady";
  return numericTrend(current.feet,previous.feet,500);
}
function visibilityCategory(value:number):number { return value<1?0:value<3?1:value<=5?2:3; }
function visibilityRange(v:Visibility) {
  const min=v.bound==="less-than"?0:v.value,max=v.bound==="at-least"||v.bound==="more-than"?Infinity:v.value;
  const minCategory=v.bound==="more-than"&&min===5?3:visibilityCategory(min);
  const maxCategory=v.bound==="less-than"&&(max===1||max===3)?visibilityCategory(max)-1:visibilityCategory(max);
  return {min,max,minCategory,maxCategory};
}
export function compareVisibility(current:Visibility|null,previous:Visibility|null):TrendDirection|null {
  if(!current||!previous) return null;
  if(current.value===previous.value&&current.bound===previous.bound) return "steady"; // unchanged reported bucket
  const a=visibilityRange(current),b=visibilityRange(previous);
  if(a.minCategory>b.maxCategory || a.min-b.max>=1) return "up";
  if(a.maxCategory<b.minCategory || b.min-a.max>=1) return "down";
  if(a.minCategory===a.maxCategory&&a.minCategory===b.minCategory&&b.minCategory===b.maxCategory&&Math.max(a.max-b.min,b.max-a.min)<1) return "steady";
  return null; // overlapping P/M or capped ranges do not establish a direction
}

/** Recheck age and exact display provenance on every clock tick, without advancing history. */
export function resolveCurrentWeatherTrends(history:CurrentTrendHistory,weather:Weather,nowMs:number,simulated=false):CurrentWeatherTrends {
  const result=emptyTrends(),a=history.current,b=history.previous;
  if(simulated||!a||!b||weather.requestStatus==="ERROR"||weather.feedStatus==="OFFLINE"||!current(a,nowMs)||!current(b,nowMs)) return result;
  const displayed=currentTrendObservation(weather,nowMs);
  if(!displayed||displayed.raw!==a.raw||displayed.observedAt!==a.observedAt||Date.parse(a.observedAt)<=Date.parse(b.observedAt)) return result;
  const comparison=(direction:TrendDirection|null):TrendComparison|null=>direction?{direction,previousObservedAt:b.observedAt,observedAt:a.observedAt}:null;
  const sky=parseAviationSky(a.raw),ceilingMatches=weather.cloudCoverage===sky.cloudCoverage&&weather.cloudBaseFt===sky.cloudBaseFt;
  if(ceilingMatches&&weather.condition!=="neutral"&&weather.operationalWeather&&weather.operationalWeather.skyCondition!=="unavailable") result.ceiling=comparison(compareCeiling(a.ceiling,b.ceiling));
  if(a.visibility&&weather.visibilitySm===a.visibility.value) result.visibility=comparison(compareVisibility(a.visibility,b.visibility));
  if(a.temperatureC!==null&&b.temperatureC!==null&&weather.temperatureF===Math.round(a.temperatureC*9/5+32)) result.temperature=comparison(numericTrend(a.temperatureC,b.temperatureC,1));
  return result;
}
