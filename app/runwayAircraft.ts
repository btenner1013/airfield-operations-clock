import {RUNWAY_GEOMETRY,type RunwayPoint} from './runwayGeometry.ts';
import type {ResolvedRunwayOperations,RunwayEnd} from './runwayOperations';

export type RunwayAircraftOperation='arrival'|'departure';
export type RunwayAircraftGroup={operation:RunwayAircraftOperation;heading:string;ends:RunwayEnd[]};
export type RunwayAircraftPose=RunwayPoint&{angle:number;scale:number};
export const RUNWAY_AIRCRAFT_SMALL=.40;
export const RUNWAY_AIRCRAFT_LARGE=.72;
export const RUNWAY_AIRCRAFT_SLOT_SECONDS=8;
export const RUNWAY_AIRCRAFT_SAMPLES=128;
export const RUNWAY_AIRCRAFT_BODY='M0 -11 C1.2 -10.9 2.1 -8.9 2.1 -6 L2.1 -3 L8.8 1.2 L8.8 3.8 L2.1 1.8 L1.8 6.9 L4.8 8.6 L4.8 10.3 L0 9.1 L-4.8 10.3 L-4.8 8.6 L-1.8 6.9 L-2.1 1.8 L-8.8 3.8 L-8.8 1.2 L-2.1 -3 L-2.1 -6 C-2.1 -8.9 -1.2 -10.9 0 -11 Z';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>n*n*(3-2*n);
const add=(a:RunwayPoint,u:RunwayPoint,n:number):RunwayPoint=>({x:a.x+u.x*n,y:a.y+u.y*n});
function line(a:RunwayPoint,b:RunwayPoint,p:number){return {x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p,dx:b.x-a.x,dy:b.y-a.y};}
function curve(a:RunwayPoint,b:RunwayPoint,c:RunwayPoint,d:RunwayPoint,p:number){
 const q=1-p;
 return {x:q*q*q*a.x+3*q*q*p*b.x+3*q*p*p*c.x+p*p*p*d.x,y:q*q*q*a.y+3*q*q*p*b.y+3*q*p*p*c.y+p*p*p*d.y,
  dx:3*q*q*(b.x-a.x)+6*q*p*(c.x-b.x)+3*p*p*(d.x-c.x),dy:3*q*q*(b.y-a.y)+6*q*p*(c.y-b.y)+3*p*p*(d.y-c.y)};
}
export function runwayAircraftScale(operation:RunwayAircraftOperation,progress:number){
 const change=(RUNWAY_AIRCRAFT_LARGE-RUNWAY_AIRCRAFT_SMALL)*ease(clamp(progress));
 return operation==='arrival'?RUNWAY_AIRCRAFT_LARGE-change:RUNWAY_AIRCRAFT_SMALL+change;
}

/** Illustrative paths in the existing viewBox, never aircraft positions or procedures.
 * Name the physical strip first: 18R is screen-left, although 36L is its reciprocal.
 * Departures continue beyond the arrowheads. The 36C aircraft passes over the
 * schematic cross-strip as an airborne symbol; its provenance margin stays clear. */
export function runwayAircraftPose(end:RunwayEnd,operation:RunwayAircraftOperation,progress:number):RunwayAircraftPose|null {
 const runway=RUNWAY_GEOMETRY.find(runway=>runway.ends.includes(end));if(!runway)return null;
 const p=clamp(progress),index=runway.ends.indexOf(end),threshold=runway.points[index],opposite=runway.points[1-index];
 const distance=Math.hypot(opposite.x-threshold.x,opposite.y-threshold.y),u={x:(opposite.x-threshold.x)/distance,y:(opposite.y-threshold.y)/distance};
 const center=runway.id==='18C/36C',cross=runway.id==='09/27',north=u.y<0,side=runway.id==='18R/36L'?-1:1;
 let point:ReturnType<typeof line>;
 if(cross){
  const anchor=operation==='arrival'?threshold:opposite;
  point=line(add(anchor,u,operation==='arrival'?-37:-44),add(anchor,u,operation==='arrival'?43:53),p);
 }else if(operation==='arrival'){
  const finish=add(threshold,u,30);
  if(center)point=line(add(threshold,u,north?-33:-9.3),finish,p);
  else {
   const start=add(threshold,u,-33);start.x+=side*27;
   const bend=add(threshold,u,-11),control1={x:bend.x+side*5,y:start.y+u.y},control2=add(bend,u,-12);
   point=p<.56?curve(start,control1,control2,bend,p/.56):line(bend,finish,(p-.56)/.44);
  }
 }else{
  const start=add(opposite,u,-58);
  if(center)point=line(start,add(opposite,u,north?30.8:43),p);
  else {
   const bend=add(opposite,u,north?20:11),finish=add(opposite,u,north?47:43);finish.x+=side*35;
   const control1=add(bend,u,north?13:12),control2=add(finish,u,-7);control2.x-=side*14;
   point=p<.68?line(start,bend,p/.68):curve(bend,control1,control2,finish,(p-.68)/.32);
  }
 }
 return {x:point.x,y:point.y,angle:Math.atan2(point.dy,point.dx)*180/Math.PI+90,scale:runwayAircraftScale(operation,p)};
}

/** The resolver alone decides usable routes. Age is deliberately not a gate.
 * Different headings and ARR/DEP use separate visual slots to avoid crossed or
 * opposed symbols. The sequence conveys use, never operational separation. */
export function runwayAircraftGroups(operations:ResolvedRunwayOperations):RunwayAircraftGroup[]{
 const groups:RunwayAircraftGroup[]=[];
 for(const operation of ['arrival','departure'] as const)for(const heading of ['36','18','09','27']){
  const ends=operations.runways.filter(runway=>runway.state==='active'&&!runway.closureUncertain)
   .flatMap(runway=>operation==='arrival'?runway.arrivals:runway.departures)
   .filter(end=>(end.startsWith('36')?'36':end.startsWith('18')?'18':end)===heading);
  if(ends.length)groups.push({operation,heading,ends});
 }
 return groups;
}
export const runwayAircraftSignature=(operations:ResolvedRunwayOperations)=>runwayAircraftGroups(operations).map(g=>`${g.operation}:${g.ends.join(',')}`).join('|');

export function runwayAircraftStatic(operations:ResolvedRunwayOperations){
 const ambiguous=new Set(operations.runways.filter(runway=>new Set([...runway.arrivals,...runway.departures]).size>1).map(runway=>runway.id));
 return runwayAircraftGroups(operations).flatMap(group=>group.ends.flatMap(end=>{
  const runway=RUNWAY_GEOMETRY.find(runway=>runway.ends.includes(end));
  if(!runway||ambiguous.has(runway.id))return [];
  const pose=runwayAircraftPose(end,group.operation,.5);
  return pose?[{end,operation:group.operation,pose:{...pose,scale:(RUNWAY_AIRCRAFT_SMALL+RUNWAY_AIRCRAFT_LARGE)/2}}]:[];
 }));
}
const number=(n:number)=>Number(n.toFixed(6)).toString();
function track(points:{time:number;value:string}[]){
 const unique=points.filter((point,index)=>!index||point.time!==points[index-1].time);
 return {keyTimes:unique.map(point=>number(point.time)).join(';'),values:unique.map(point=>point.value).join(';')};
}
/** Native SVG interpolation owns motion; no per-frame React work, timers or RAF.
 * Identical normalized samples make translation, tangent rotation and scale use
 * the same clock. Outside its group slot each aircraft is invisible and held. */
export function runwayAircraftTracks(end:RunwayEnd,operation:RunwayAircraftOperation,slot:number,slotCount:number){
 const count=Math.max(1,slotCount),start=slot/count,finish=(slot+1)/count;
 const samples=Array.from({length:RUNWAY_AIRCRAFT_SAMPLES+1},(_,i)=>{
  const pose=runwayAircraftPose(end,operation,i/RUNWAY_AIRCRAFT_SAMPLES);
  if(!pose)throw new Error('Unknown runway end');
  return {time:start+(.03+.89*i/RUNWAY_AIRCRAFT_SAMPLES)/count,pose};
 });
 // Avoid a full spin if an outward tangent crosses the ±180° representation.
 for(let i=1;i<samples.length;i++){
  while(samples[i].pose.angle-samples[i-1].pose.angle>180)samples[i].pose.angle-=360;
  while(samples[i].pose.angle-samples[i-1].pose.angle< -180)samples[i].pose.angle+=360;
 }
 // Reach the far endpoint before fading, so the complete departure silhouette
 // is visibly beyond the arrowhead rather than disappearing while crossing it.
 const held=[{time:0,pose:samples[0].pose},...samples,{time:1,pose:samples.at(-1)!.pose}];
 const fade=.3/(RUNWAY_AIRCRAFT_SLOT_SECONDS*count);
 return {
  duration:`${count*RUNWAY_AIRCRAFT_SLOT_SECONDS}s`,initial:samples[0].pose,
  translate:track(held.map(({time,pose})=>({time,value:`${number(pose.x)} ${number(pose.y)}`}))),
  rotate:track(held.map(({time,pose})=>({time,value:number(pose.angle)}))),
  scale:track(held.map(({time,pose})=>({time,value:number(pose.scale)}))),
  opacity:track([{time:0,value:'0'},...(start>0?[{time:start,value:'0'}]:[]),{time:start+fade,value:'1'},{time:finish-fade,value:'1'},{time:finish,value:'0'},...(finish<1?[{time:1,value:'0'}]:[])]),
 };
}
