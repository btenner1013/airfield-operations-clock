import type { Weather } from './weatherTypes';

/** Only the Ops-selected actual observation is retained, never model/feels-like data. */
export type ReportedTemperature = { celsius:number; source:'ATIS'|'METAR'; observedAt:string; reportedAt:string };
const time=(v:unknown):number=>{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)) return NaN;
  const ms=Date.parse(v);
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===v.slice(0,19)?ms:NaN;
};
export function validateReportedTemperature(value:unknown,nowMs:number):ReportedTemperature|null {
  if(!Number.isFinite(nowMs)||!value||typeof value!=='object') return null;
  const v=value as ReportedTemperature,observed=time(v.observedAt),reported=time(v.reportedAt);
  if(typeof v.celsius!=='number'||!Number.isFinite(v.celsius)||v.celsius< -90||v.celsius>60||!['ATIS','METAR'].includes(v.source)||!Number.isFinite(observed)||!Number.isFinite(reported)||observed>reported+300000||reported>nowMs+300000||observed>nowMs+300000) return null;
  return {celsius:v.celsius,source:v.source,observedAt:v.observedAt,reportedAt:v.reportedAt};
}
export function retainReportedTemperature(previous:unknown,weather:Pick<Weather,'currentOpsWeather'>,nowMs:number):ReportedTemperature|null {
  const prior=validateReportedTemperature(previous,nowMs),snapshot=weather.currentOpsWeather,metric=snapshot?.temperature,source=metric?.source;
  const next=source&&(!source.rejected||source.reportedAgeMinutes!==null)&&(source.reportedAgeMinutes===null||Number.isFinite(source.reportedAgeMinutes)&&source.reportedAgeMinutes>=0)&&['OK','WARN_SOURCE','STALE_SOURCE','USED_LAST_GOOD','STALE'].includes(source.status||'')?validateReportedTemperature({celsius:metric?.value,source:source.source,observedAt:source.observedAt,reportedAt:snapshot?.updatedAt},nowMs):null;
  return next&&(!prior||time(next.observedAt)>=time(prior.observedAt))?next:prior;
}
/** Deliberately independent of unrelated TAF expiry and local-calendar cache guards. */
export function restoreReportedTemperature(raw:string|null,nowMs:number):ReportedTemperature|null {
  try {
    const cache=JSON.parse(raw||'null');
    if(!cache||![1,2,3,4].includes(cache.version)||!Number.isFinite(time(cache.savedAtIso))||time(cache.savedAtIso)>nowMs+300000||!cache.weather) return null;
    return retainReportedTemperature(cache.weather.lastReportedTemperature,cache.weather,Math.min(nowMs,time(cache.savedAtIso)));
  } catch {return null;}
}
export function lastTemperatureLabel(report:ReportedTemperature,nowMs:number):string {
  const age=Math.max(0,Math.floor((nowMs-time(report.observedAt))/60000));
  return `LAST ${report.source} ${report.observedAt.slice(8,10)}${report.observedAt.slice(11,13)}${report.observedAt.slice(14,16)}Z · ${age}M OLD · STALE`;
}
