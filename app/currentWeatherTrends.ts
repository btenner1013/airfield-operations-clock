import { parseAviationSky } from "./aviationWeatherPriority.ts";
import { parseMetarObservedAt } from "./weatherRefresh.ts";
import type { Weather } from "./weatherTypes";

export type TrendDirection = "up" | "down" | "steady";
export type CurrentTrendMetric = "ceiling" | "visibility" | "temperature";
export type TrendComparison = { direction:TrendDirection; referenceAt:string; updatedAt:string; lookbackHours:3 };
export type CeilingReading = { kind:"unlimited" } | { kind:"height"; feet:number };
type ObservationSource = "METAR" | "ATIS";
type SourceEvidence = { source:ObservationSource; observedAt:string|null; status:string|null; rejected:boolean; reportedAgeMinutes:number|null };
type ReportedMetric<T> = { value:T|null; display:string|null; source:SourceEvidence|null; direction:TrendDirection|null };
export type CurrentOpsWeatherSnapshot = {
  updatedAt:string|null; referenceAt:string|null; lookbackHours:number|null; referenceSource:string|null; sampleCount:number|null;
  ceiling:ReportedMetric<CeilingReading>; visibility:ReportedMetric<number>; temperature:ReportedMetric<number>;
};
export type CurrentWeatherTrends = Record<CurrentTrendMetric,TrendComparison|null>;
type CurrentReading<T> = { value:T; display:string; title:string };
export type CurrentWeatherReadings = {
  usesOps:boolean; ceiling:CurrentReading<CeilingReading>|null; visibility:CurrentReading<number>|null; temperature:CurrentReading<number>|null; trends:CurrentWeatherTrends;
};

// Two normal ten-minute updater cadences. Fetching an old JSON does not renew it.
export const OPS_CURRENT_JSON_MAX_AGE_MINUTES = 20;
const SOURCE_MAX_AGE_MINUTES = { METAR:75, ATIS:90 };
const object = (value:unknown):Record<string,unknown> => value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const string = (value:unknown):string|null => typeof value==="string"&&value.trim()?value.trim():null;
const number = (value:unknown):number|null => typeof value==="number"&&Number.isFinite(value)?value:null;
const inRange = (value:unknown,min:number,max:number):number|null => { const n=number(value);return n!==null&&n>=min&&n<=max?n:null; };
const emptyTrends = ():CurrentWeatherTrends => ({ceiling:null,visibility:null,temperature:null});

/** These feed fields are explicitly UTC. Reject ambiguous local dates and normalized invalid days. */
function timestamp(value:unknown):string|null {
  const text=string(value)?.replace(" ","T");
  if(!text||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(text)) return null;
  const ms=Date.parse(text);
  if(!Number.isFinite(ms)) return null;
  const iso=new Date(ms).toISOString();
  return iso.slice(0,16)===text.slice(0,16)?iso:null;
}

/** Use only the upstream direction; unknown or contradictory symbol/text never means steady. */
export function normalizeReportedTrend(symbol:unknown,text:unknown):TrendDirection|null {
  const symbols:Record<string,TrendDirection>={"↑":"up","▲":"up","↓":"down","▼":"down","→":"steady","►":"steady","▶":"steady"};
  const words:Record<string,TrendDirection>={RISING:"up",FALLING:"down",STEADY:"steady"};
  const a=symbols[string(symbol)||""],b=words[string(text)?.toUpperCase()||""];
  return a&&b&&a===b?a:null;
}

function sourceEvidence(data:Record<string,unknown>,selected:unknown):SourceEvidence|null {
  if(selected!=="METAR"&&selected!=="ATIS") return null;
  const prefix=selected.toLowerCase(),lastGood=object(data.lastKnownGoodUsed);
  const reportedAge=data[`${prefix}AgeMinutes`];
  return {
    source:selected,observedAt:timestamp(data[`${prefix}ObservedZ`]),status:string(data[`${prefix}FetchStatus`])?.toUpperCase()||null,
    rejected:lastGood[prefix]===true||(selected==="ATIS"&&data.atisSourceIsCurrent===false)||
      (reportedAge!==undefined&&(number(reportedAge)===null||Number(reportedAge)<0)),
    reportedAgeMinutes:number(reportedAge),
  };
}

function visibilityDisplay(value:number|null,raw:unknown):string|null {
  if(value===null) return null;
  if(raw===undefined) return `${value} SM`;
  const display=string(raw)?.toUpperCase(),match=display?.match(/^([PM]?)(?:(\d+)\s+)?(\d+(?:\.\d+)?)(?:\/(\d+))?\s*SM$/);
  if(!match||match[4]==="0"||match[2]&&!match[4]) return null;
  const displayed=match[4]?Number(match[2]||0)+Number(match[3])/Number(match[4]):Number(match[3]);
  return displayed===value?display!:null;
}

function confirmedUnlimited(data:Record<string,unknown>):boolean {
  const raw=string(data.metar),observedAt=timestamp(data.metarObservedZ);
  if(data.metarCeilingFt!==undefined&&data.metarCeilingFt!==null||data.atisCeilingFt!==undefined&&data.atisCeilingFt!==null) return false;
  if(!raw||!observedAt||!/^UNL(?:IMITED)?(?:\s*\(UNL\))?$/i.test(string(data.ceilingDisplay)||"")) return false;
  const core=raw.toUpperCase().replace(/\s+/g," ").trim().split(/\sRMK(?:\s|$)/)[0].replace(/=$/,"");
  if(!/^(?:(?:METAR|SPECI)\s+)?(?:COR\s+)?KMEM\s+(?:COR\s+)?\d{6}Z\b/.test(core)) return false;
  if(parseMetarObservedAt(core,undefined,new Date(observedAt))!==observedAt) return false;
  // Upstream null means either unlimited or missing. Never infer unlimited from
  // missing/malformed layers, even when another token happens to say CLR.
  if(core.split(/\s+/).some(token=>/^(?:BKN|OVC|VV)/.test(token)||/^(?:FEW|SCT)/.test(token)&&!/^(?:FEW|SCT)\d{3}(?:CB|TCU)?$/.test(token))) return false;
  return parseAviationSky(core).ceilingUnlimited;
}

/** Keep the selected JSON values and their arrows together; do not redo best-observation selection. */
export function normalizeCurrentOpsWeather(payload:unknown):CurrentOpsWeatherSnapshot|undefined {
  const data=object(payload);
  const keys=["ceilingFt","ceilingDisplay","visibilitySm","visibilityDisplay","tempC","obsFieldSources","ceilingTrend","ceilingTrendText","visibilityTrend","visibilityTrendText","tempTrend","tempTrendText","trendLookbackHours","trendReferenceSource","trendReferenceTimestampZ","trendSampleCount"];
  if(!keys.some(key=>Object.prototype.hasOwnProperty.call(data,key))) return undefined;
  const sources=object(data.obsFieldSources);
  let ceilingValue:CeilingReading|null=null,ceilingSource=sourceEvidence(data,sources.ceiling),ceilingDisplay:string|null=null;
  const feet=inRange(data.ceilingFt,0,100000);
  if(feet!==null&&Number.isInteger(feet)) {
    const label=string(data.ceilingDisplay);
    if((label===null&&data.ceilingDisplay===undefined)||label?.replace(/,/g,"").toUpperCase()===`${feet} FT`) {
      ceilingValue={kind:"height",feet};ceilingDisplay=`${feet.toLocaleString("en-US")} FT`;
    }
  } else if(data.ceilingFt===null&&sources.ceiling==="NONE"&&confirmedUnlimited(data)) {
    ceilingValue={kind:"unlimited"};ceilingDisplay="UNLIMITED (UNL)";ceilingSource=sourceEvidence(data,"METAR");
  }
  const sourceCeiling=ceilingSource?data[`${ceilingSource.source.toLowerCase()}CeilingFt`]:undefined;
  if(sourceCeiling!==undefined&&ceilingValue?.kind==="height"&&sourceCeiling!==ceilingValue.feet) ceilingValue=null;
  const visibilitySource=sourceEvidence(data,sources.visibility),visibilityValue=inRange(data.visibilitySm,0,100);
  let visDisplay=visibilityDisplay(visibilityValue,data.visibilityDisplay);
  const sourceVisibility=visibilitySource?data[`${visibilitySource.source.toLowerCase()}VisibilitySm`]:undefined;
  if(sourceVisibility!==undefined&&sourceVisibility!==visibilityValue) visDisplay=null;
  return {
    updatedAt:timestamp(data.allFeedsUpdatedZ),referenceAt:timestamp(data.trendReferenceTimestampZ),lookbackHours:number(data.trendLookbackHours),referenceSource:string(data.trendReferenceSource),sampleCount:number(data.trendSampleCount),
    ceiling:{value:ceilingValue,display:ceilingDisplay,source:ceilingSource,direction:normalizeReportedTrend(data.ceilingTrend,data.ceilingTrendText)},
    visibility:{value:visibilityValue,display:visDisplay,source:visibilitySource,direction:normalizeReportedTrend(data.visibilityTrend,data.visibilityTrendText)},
    temperature:{value:inRange(data.tempC,-100,60),display:null,source:sourceEvidence(data,sources.tempDp),direction:normalizeReportedTrend(data.tempTrend,data.tempTrendText)},
  };
}

function isCurrent(time:string|null,nowMs:number,maxMinutes:number):boolean {
  const age=time?(nowMs-Date.parse(time))/60000:NaN;
  return Number.isFinite(age)&&age>=-5&&age<maxMinutes;
}
function usableSource(source:SourceEvidence|null,updatedAt:string,nowMs:number):source is SourceEvidence {
  if(!source||source.rejected||!source.status||!["OK","WARN_SOURCE"].includes(source.status)) return false;
  const maximum=SOURCE_MAX_AGE_MINUTES[source.source];
  if(source.reportedAgeMinutes!==null&&source.reportedAgeMinutes>=maximum) return false;
  return isCurrent(source.observedAt,nowMs,maximum)&&Date.parse(source.observedAt!)<=Date.parse(updatedAt)+5*60000;
}
function validReference(snapshot:CurrentOpsWeatherSnapshot):boolean {
  if(snapshot.lookbackHours!==3||snapshot.referenceSource!=="3HR_HISTORY"||!snapshot.referenceAt||!snapshot.updatedAt||snapshot.sampleCount===null||!Number.isInteger(snapshot.sampleCount)||snapshot.sampleCount<1) return false;
  const elapsed=Date.parse(snapshot.updatedAt)-Date.parse(snapshot.referenceAt);
  // allFeedsUpdatedZ is minute-precision; the updater reference retains seconds.
  return elapsed>0&&elapsed<=3*3600000+60000;
}

/** Recheck generation and each selected observation on every render, including after sleep. */
export function resolveCurrentWeatherReadings(weather:Weather,nowMs:number,simulated=false):CurrentWeatherReadings {
  const snapshot=weather.currentOpsWeather,result:CurrentWeatherReadings={usesOps:!simulated&&snapshot!==undefined,ceiling:null,visibility:null,temperature:null,trends:emptyTrends()};
  if(simulated||!snapshot||weather.requestStatus==="ERROR"||weather.feedStatus==="OFFLINE"||!isCurrent(snapshot.updatedAt,nowMs,OPS_CURRENT_JSON_MAX_AGE_MINUTES)) return result;
  const updatedAt=snapshot.updatedAt!,hasReference=validReference(snapshot);
  const read=<T>(metric:ReportedMetric<T>,name:string,display:string|null):CurrentReading<T>|null=>{
    if(metric.value===null||display===null||!usableSource(metric.source,updatedAt,nowMs)) return null;
    return {value:metric.value,display,title:`Ops JSON ${name}; ${metric.source.source} ${metric.source.observedAt} (${metric.source.status}); JSON updated ${updatedAt}`};
  };
  result.ceiling=read(snapshot.ceiling,"ceiling",snapshot.ceiling.display);
  result.visibility=read(snapshot.visibility,"visibility",snapshot.visibility.display);
  const temp=snapshot.temperature.value;
  result.temperature=read(snapshot.temperature,"actual temperature",temp===null?null:String(Math.round(temp*9/5+32)));
  for(const metric of ["ceiling","visibility","temperature"] as const) {
    const direction=snapshot[metric].direction;
    if(result[metric]&&direction&&hasReference) result.trends[metric]={direction,referenceAt:snapshot.referenceAt!,updatedAt,lookbackHours:3};
  }
  return result;
}
