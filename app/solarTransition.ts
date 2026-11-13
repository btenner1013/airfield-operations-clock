/** Approximate geometric solar elevation for visual transitions, not measured light.
 * Solar position: NOAA General Solar Position Calculations.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */
const radians = Math.PI / 180;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (a: number, b: number, x: number) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export function solarPosition(date: Date, latitude: number, longitude: number) {
  if (![date.getTime(), latitude, longitude].every(Number.isFinite) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return null;
  const year=date.getUTCFullYear(), start=Date.UTC(year,0,1), end=Date.UTC(year+1,0,1);
  const hour=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
  const day=Math.floor((date.getTime()-start)/86400000)+1;
  const gamma=2*Math.PI/((end-start)/86400000)*(day-1+(hour-12)/24);
  const eq=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
  const decl=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
  const minutes=((hour*60+eq+4*longitude)%1440+1440)%1440, angle=(minutes/4-180)*radians;
  const cosZenith=Math.sin(latitude*radians)*Math.sin(decl)+Math.cos(latitude*radians)*Math.cos(decl)*Math.cos(angle);
  return {elevation:Math.asin(Math.max(-1,Math.min(1,cosZenith)))/radians, rising:minutes<720};
}
export function solarBlend(elevation:number) {
  // Daylight replaces golden-hour photography above the horizon. Night deepens
  // through civil twilight; never jump between fixed 90-minute scene windows.
  if(!Number.isFinite(elevation)) return {day:0,warm:0,night:1,warmOpacity:0};
  const day=smooth(-2,5,elevation),night=1-smooth(-9,-2,elevation),warm=Math.max(0,1-day-night);
  return {day,warm,night,warmOpacity:day>=1?0:warm/(1-day)};
}

export type SolarLighting = {elevation:number|null;rising:boolean;day:number;warm:number;night:number;phase:'day'|'night'|'sunrise'|'sunset'};
export function solarLighting(date:Date,latitude:number,longitude:number):SolarLighting {
  const position=solarPosition(date,latitude,longitude);
  const weights=solarBlend(position?.elevation??NaN);
  const phase=weights.day===1?'day':weights.night===1?'night':position?.rising?'sunrise':'sunset';
  return {...weights,elevation:position?.elevation??null,rising:position?.rising??true,phase};
}
/** One common grade is applied to the static stack and moving composite. */
export function solarPhotoFilter(condition:string,lighting:Pick<SolarLighting,'day'|'warm'|'night'>):string {
  const {day,warm,night}=lighting;
  const weights=[day,warm,night];
  let grades=[[1.02,1.06,1.02],[1,.95,1.02],[.94,1.03,1.06]];
  if(condition==='rain'||condition==='heavy-rain') grades=[[.96,.94,1.04],[.96,.94,1.04],[.91,.94,1.07]];
  else if(condition==='thunderstorm') grades=[[.9,.92,1.08],[.9,.92,1.08],[.86,.9,1.1]];
  else if(condition==='fog') grades=[[.96,.84,.98],[.96,.84,.98],[.9,.8,1.02]];
  else if(condition==='snow') grades=[[.96,.88,1.01],[.96,.88,1.01],[.9,.88,1.04]];
  const values=[0,1,2].map(index=>grades.reduce((sum,grade,i)=>sum+grade[index]*weights[i],0));
  return `brightness(${values[0].toFixed(4)}) saturate(${values[1].toFixed(4)}) contrast(${values[2].toFixed(4)})`;
}
