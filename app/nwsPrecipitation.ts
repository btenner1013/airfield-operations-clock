// National Weather Service gridpoint PoP. The gridpoint is the same product line the KMEM
// TAF is written against, so a forecast row's probability and its words come from one
// weather enterprise instead of two that disagree. Parsing is pure; the fetch lives in
// page.tsx alongside the other feeds.

import type { HourlyPrecipitationInput } from "./futureWeather";

export type NwsHourlyPeriod = {
  startTime?:string|null;
  probabilityOfPrecipitation?:{unitCode?:string|null;value?:number|null}|null;
};

export type PrecipitationRow = {
  iso:string;
  precipitationProbability:number|null;
  precipitationSource:string|null;
  precipitationValidTime:string|null;
  precipitationFetchedAt:string|null;
  precipitationAgeMinutes:number|null;
};

export const NWS_PRECIPITATION_SOURCE="NWS";
const PERCENT_UNIT=/(?:^|:)percent$/i;

function utcHourStart(milliseconds:number):number {
  const date=new Date(milliseconds);
  return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),date.getUTCHours());
}

/**
 * Reads hourly PoP out of a gridpoint forecast. A period survives only with a parseable
 * start time and an in-range, percent-typed probability; anything else is dropped rather
 * than guessed at, so a schema or unit change degrades to "no NWS samples" and the model
 * PoP already on the row stands instead of a wrong number replacing it.
 */
export function parseNwsHourlyPrecipitation(payload:unknown, fetchedAtIso:string):HourlyPrecipitationInput[] {
  const periods=(payload as {properties?:{periods?:unknown}})?.properties?.periods;
  if(!Array.isArray(periods)) return [];

  const samples:HourlyPrecipitationInput[]=[];
  for(const period of periods as NwsHourlyPeriod[]) {
    const startedAt=Date.parse(String(period?.startTime||""));
    if(!Number.isFinite(startedAt)) continue;
    const probability=period?.probabilityOfPrecipitation;
    if(!probability||!PERCENT_UNIT.test(String(probability.unitCode||""))) continue;
    const value=probability.value;
    if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>100) continue;
    samples.push({
      precipitationProbability:Math.round(value),
      precipitationSource:NWS_PRECIPITATION_SOURCE,
      precipitationValidTime:new Date(startedAt).toISOString(),
      precipitationFetchedAt:fetchedAtIso,
    });
  }
  return samples;
}

/**
 * Swaps a row's PoP for the gridpoint value covering the same UTC hour. Rows the gridpoint
 * does not reach keep the model number they arrived with, and every row records which
 * source its own figure came from, so a partial gridpoint never disguises its coverage.
 */
export function applyNwsPrecipitation<T extends PrecipitationRow>(rows:readonly T[], samples:readonly HourlyPrecipitationInput[]):T[] {
  if(!samples.length) return [...rows];

  const byHour=new Map<number,HourlyPrecipitationInput>();
  for(const sample of samples) {
    const validAt=Date.parse(String(sample.precipitationValidTime||""));
    if(!Number.isFinite(validAt)) continue;
    const hour=utcHourStart(validAt);
    if(!byHour.has(hour)) byHour.set(hour,sample);
  }

  return rows.map(row=>{
    const rowAt=Date.parse(row.iso);
    if(!Number.isFinite(rowAt)) return row;
    const sample=byHour.get(utcHourStart(rowAt));
    if(!sample||typeof sample.precipitationProbability!=="number") return row;
    return {
      ...row,
      precipitationProbability:sample.precipitationProbability,
      precipitationSource:sample.precipitationSource||NWS_PRECIPITATION_SOURCE,
      precipitationValidTime:String(sample.precipitationValidTime),
      precipitationFetchedAt:sample.precipitationFetchedAt?String(sample.precipitationFetchedAt):row.precipitationFetchedAt,
      precipitationAgeMinutes:0,
    };
  });
}
