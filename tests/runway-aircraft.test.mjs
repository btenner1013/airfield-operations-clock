import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RUNWAY_GEOMETRY,runwayArrow} from '../app/runwayGeometry.ts';
import {normalizeRunwayOperations,resolveRunwayOperations,mergeRunwayOperations} from '../app/runwayOperations.ts';
import {RUNWAY_AIRCRAFT_SMALL, RUNWAY_AIRCRAFT_LARGE,runwayAircraftPose,runwayAircraftScale,runwayAircraftGroups,runwayAircraftSignature,runwayAircraftStatic,runwayAircraftTracks} from '../app/runwayAircraft.ts';
import {Aircraft} from './helpers/runway-aircraft-render.mjs';
const now=Date.parse('2026-10-18T14:00:00Z'),ends=RUNWAY_GEOMETRY.flatMap(r=>r.ends);
const snapshot=(arr='36L / 36R',dep='36L / 36C / 36R',closed='NONE',extra={})=>normalizeRunwayOperations({atisReportedLetter:'Z',atisObservedZ:'2026-10-18T13:54:00Z',atisSelectedSource:'ATIS_INFO_API',atisFetchStatus:'OK',atisReportedArrRunways:arr,atisReportedDepRunways:dep,atisReportedClosedRunways:closed,...extra});
const resolve=(...args)=>resolveRunwayOperations(snapshot(...args),now);
const render=operations=>renderToStaticMarkup(React.createElement(Aircraft,{operations}));
const selected=o=>runwayAircraftGroups(o).flatMap(g=>g.ends);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);
// Body control-point hull plus outer engine extents. An empty bounding rectangle
// overstates the wings near the nose when rotated; this bounds the drawn paths.
const outline=[[-2.1,-11],[2.1,-11],[-2.1,-6],[2.1,-6],[-8.8,1.2],[8.8,1.2],[-8.8,3.8],[8.8,3.8],[-8.15,4.3],[8.15,4.3],[-4.8,10.3],[4.8,10.3]];

test('all ends use one size range, with exactly reversed arrival/departure perspective',()=>{
 assert.equal(RUNWAY_AIRCRAFT_SMALL,.4);assert.equal(RUNWAY_AIRCRAFT_LARGE,.72);
 for(const end of ends){
  assert.equal(runwayAircraftPose(end,'arrival',0).scale,.72);assert.equal(runwayAircraftPose(end,'arrival',1).scale,.4);
  assert.equal(runwayAircraftPose(end,'departure',0).scale,.4);assert.equal(runwayAircraftPose(end,'departure',1).scale,.72);
  let before=.72,after=.4;
  for(let i=0;i<=200;i++){const p=i/200,a=runwayAircraftPose(end,'arrival',p),d=runwayAircraftPose(end,'departure',p);assert.ok(a.scale<=before&&d.scale>=after);before=a.scale;after=d.scale;close(a.scale+d.scale,1.12);}
 }
 assert.equal(runwayAircraftScale('arrival',-1),.72);assert.equal(runwayAircraftScale('departure',2),.72);
});
test('north/south and 09/27 headings respect physical reciprocal geometry',()=>{
 assert.ok(runwayAircraftPose('36L','arrival',1).x<runwayAircraftPose('36R','arrival',1).x);
 assert.ok(runwayAircraftPose('18R','arrival',1).x<runwayAircraftPose('18L','arrival',1).x);
 for(const op of ['arrival','departure']){
  assert.ok(runwayAircraftPose('09',op,1).x>runwayAircraftPose('09',op,0).x);
  assert.ok(runwayAircraftPose('27',op,1).x<runwayAircraftPose('27',op,0).x);
  for(const end of ['36L','36C','36R'])assert.ok(runwayAircraftPose(end,op,1).y<runwayAircraftPose(end,op,0).y);
  for(const end of ['18L','18C','18R'])assert.ok(runwayAircraftPose(end,op,1).y>runwayAircraftPose(end,op,0).y);
 }
});
test('outer routes curve in/out while center and cross-runway routes stay straight',()=>{
 for(const end of ['36L','36R','18L','18R']){
  assert.ok(Math.abs(runwayAircraftPose(end,'arrival',0).angle-runwayAircraftPose(end,'arrival',1).angle)>30);
  assert.ok(Math.abs(runwayAircraftPose(end,'departure',0).angle-runwayAircraftPose(end,'departure',1).angle)>30);
 }
 for(const end of ['36C','18C','09','27'])for(const op of ['arrival','departure'])close(runwayAircraftPose(end,op,0).angle,runwayAircraftPose(end,op,1).angle);
});
test('all 3216 outlined aircraft poses remain within the unchanged panel',()=>{
 for(const end of ends)for(const op of ['arrival','departure'])for(let i=0;i<=200;i++){
  const a=runwayAircraftPose(end,op,i/200),r=a.angle*Math.PI/180;
  for(const [x,y] of outline){
   const xx=a.x+a.scale*(x*Math.cos(r)-y*Math.sin(r)),yy=a.y+a.scale*(x*Math.sin(r)+y*Math.cos(r));
   const xp=10+(350-300*(300/280))/2+(xx-20)*(300/280),yp=20+yy*(300/280);
   const stroke=1.05*a.scale*300/280;
   assert.ok(xp-stroke>=0&&xp+stroke<=385&&yp-stroke>=20&&yp+stroke<=328,`${end} ${op} ${i}: ${xp},${yp}`);
  }
 }
});
test('the complete departure silhouette extends beyond every arrowhead before fading',()=>{
 for(const runway of RUNWAY_GEOMETRY)for(const end of runway.ends){
  const arrow=runwayArrow(runway,end,'departure'),a=runwayAircraftPose(end,'departure',1),r=a.angle*Math.PI/180;
  const distance=Math.hypot(arrow.end.x-arrow.start.x,arrow.end.y-arrow.start.y),u={x:(arrow.end.x-arrow.start.x)/distance,y:(arrow.end.y-arrow.start.y)/distance};
  const closest=Math.min(...outline.map(([x,y])=>{
   const xx=a.x+a.scale*(x*Math.cos(r)-y*Math.sin(r)),yy=a.y+a.scale*(x*Math.sin(r)+y*Math.cos(r));
   return (xx-arrow.end.x)*u.x+(yy-arrow.end.y)*u.y-1.05*a.scale;
  }));
  assert.ok(closest>1,`${end}: full silhouette clears arrowhead by ${closest}`);
  const tracks=runwayAircraftTracks(end,'departure',0,1),times=tracks.translate.keyTimes.split(';').map(Number);
  assert.ok(times.at(-2)<tracks.opacity.keyTimes.split(';').map(Number).at(-2));
 }
 // Center departure passes over the cross-strip, but keeps the cue clear.
 const center=runwayAircraftPose('36C','departure',1);
 assert.ok(center.y-(11+1.05)*center.scale>14);
 assert.equal(center.scale,.72);
});
test('groups come only from resolved reported operations, including one-sided and mixed-axis reports',()=>{
 assert.deepEqual(runwayAircraftGroups(resolve()).map(g=>[g.operation,g.ends]),[['arrival',['36L','36R']],['departure',['36L','36C','36R']]]);
 assert.deepEqual(runwayAircraftGroups(resolve('18L / 18R','18L / 18C / 18R')).map(g=>g.ends),[['18R','18L'],['18R','18C','18L']]);
 for(const end of ends){assert.deepEqual(runwayAircraftGroups(resolve(end,'NONE')).map(g=>g.operation),['arrival']);assert.deepEqual(runwayAircraftGroups(resolve('NONE',end)).map(g=>g.operation),['departure']);}
 const mixed=runwayAircraftGroups(resolve('36R / 27','36C / 27'));
 assert.deepEqual(mixed.map(g=>[g.operation,g.heading,g.ends]),[['arrival','36',['36R']],['arrival','27',['27']],['departure','36',['36C']],['departure','27',['27']]]);
});
test('every closure combination suppresses both operations on both physical ends',()=>{
 for(let mask=0;mask<16;mask++){
  const closed=RUNWAY_GEOMETRY.filter((r,i)=>mask&(1<<i)),o=resolve(ends,ends,closed.map(r=>r.ends[0]));
  for(const r of closed)assert.ok(!selected(o).some(end=>r.ends.includes(end)));
  const expected=RUNWAY_GEOMETRY.filter((r,i)=>!(mask&(1<<i))).flatMap(r=>r.ends);
  assert.deepEqual([...new Set(selected(o))].sort(),expected.sort());
 }
});
test('uncertain NOTAM conflicts suppress motion independently of ATIS freshness',()=>{
 for(const atisObservedZ of ['2026-10-18T13:54:00Z','2026-10-18T10:00:00Z']){
  const o=resolve('36L / 36R','18L / 36C','NONE',{atisObservedZ,runwayClosureNotams:[{text:'RWY 18L/36R CLSD'}],milNotamUpdatedZ:'2026-10-18T10:00:00Z',milNotamFetchStatus:'OK',milNotamSource:'FAA'});
  assert.ok(!selected(o).includes('36R'));assert.ok(!selected(o).includes('18L'));assert.ok(selected(o).includes('36L'));
 }
});
test('age alone never gates movement or changes the motion signature',()=>{
 const s=snapshot(),fresh=resolveRunwayOperations(s,now);
 for(const age of [91,126,1440,10080]){
  const stale=resolveRunwayOperations(s,Date.parse(s.atisObservedAt)+age*60000);
  assert.equal(stale.atisLastKnown,true);assert.equal(runwayAircraftSignature(stale),runwayAircraftSignature(fresh));assert.equal(render(stale),render(fresh));
 }
});
test('unknown, malformed, future and valid empty reports invent no aircraft',()=>{
 for(const s of [null,normalizeRunwayOperations({}),snapshot('NONE','NONE'),snapshot('invalid','36L'),snapshot('36L','36L','NONE',{atisObservedZ:'2027-01-01T00:00:00Z'})]){
  const o=resolveRunwayOperations(s,now);assert.equal(selected(o).length,0);assert.equal(render(o),'');
 }
});
test('invalid refresh retains routes while a new direction or explicit empty report removes old symbols',()=>{
 const previous=snapshot(),invalid=mergeRunwayOperations(previous,normalizeRunwayOperations({}),now);
 assert.equal(runwayAircraftSignature(resolveRunwayOperations(invalid,now)),runwayAircraftSignature(resolveRunwayOperations(previous,now)));
 for(const next of [snapshot('18R / 18L','18C','NONE',{atisObservedZ:'2026-10-18T13:59:00Z'}),snapshot('NONE','NONE','NONE',{atisObservedZ:'2026-10-18T13:59:00Z'})]){
  const o=resolveRunwayOperations(mergeRunwayOperations(previous,next,now),now),markup=render(o);
  assert.doesNotMatch(markup,/data-aircraft-end="36/);assert.ok(!selected(o).some(end=>end.startsWith('36')));
 }
});
test('opposed ends, intersecting axes, and same-runway operations use separate visual slots',()=>{
 const groups=runwayAircraftGroups(resolve('18R / 36L / 09 / 27','18R / 36L / 09 / 27'));
 assert.equal(groups.length,8);
 assert.ok(groups.every(g=>g.ends.length===1));
 assert.equal(runwayAircraftGroups(resolve('36R','36R')).length,2);
});
test('native tracks have matching, finite, strictly increasing timings and bounded tangent changes',()=>{
 for(const end of ends)for(const op of ['arrival','departure'])for(const [slot,count] of [[0,1],[0,2],[1,2],[7,8]]){
  const tracks=runwayAircraftTracks(end,op,slot,count);assert.equal(tracks.duration,`${count*8}s`);
  for(const name of ['translate','rotate','scale','opacity']){
   const times=tracks[name].keyTimes.split(';').map(Number),values=tracks[name].values.split(';');
   assert.equal(times.length,values.length);assert.equal(times[0],0);assert.equal(times.at(-1),1);
   assert.ok(times.every((time,i)=>Number.isFinite(time)&&(!i||time>times[i-1])));
   assert.ok(values.every(value=>value.split(' ').map(Number).every(Number.isFinite)));
  }
  assert.equal(tracks.translate.keyTimes,tracks.rotate.keyTimes);assert.equal(tracks.rotate.keyTimes,tracks.scale.keyTimes);
  const angles=tracks.rotate.values.split(';').map(Number);assert.ok(angles.every((a,i)=>!i||Math.abs(a-angles[i-1])<180));
  const scales=tracks.scale.values.split(';').map(Number);assert.equal(scales[0],op==='arrival'?.72:.4);assert.equal(scales.at(-1),op==='arrival'?.4:.72);
 }
});
test('reduced motion is static on audited paths and omits ambiguous reciprocal aircraft',()=>{
 const o=resolve(),fixed=runwayAircraftStatic(o);assert.equal(fixed.length,5);assert.deepEqual(fixed,runwayAircraftStatic(resolveRunwayOperations(snapshot(),now+126*60000)));
 for(const end of ends)for(const operation of ['arrival','departure']){
  const fixed=runwayAircraftStatic(resolve(operation==='arrival'?end:'NONE',operation==='departure'?end:'NONE'))[0],expected=runwayAircraftPose(end,operation,.5);
  close(fixed.pose.x,expected.x);close(fixed.pose.y,expected.y);close(fixed.pose.scale,.56);
 }
 assert.equal(runwayAircraftStatic(resolve('18R / 36L','18R / 36L')).length,0);
 assert.ok(runwayAircraftStatic(resolve('18C','NONE'))[0].pose.y>60);
});
test('actual markup is decorative, has one shared silhouette and contains native SVG tracks only',()=>{
 const html=render(resolve());assert.match(html,/aria-hidden="true"/);assert.equal((html.match(/data-aircraft-operation=/g)||[]).length,5);
 assert.equal((html.match(/<animateTransform/g)||[]).length,15);assert.equal((html.match(/<animate /g)||[]).length,5);
 assert.match(html,/data-aircraft-config="arrival:36L,36R\|departure:36L,36C,36R"/);
 assert.doesNotMatch(html,/<rect|<foreignObject|<script/);
 const component=readFileSync(new URL('../app/RunwayAircraft.tsx',import.meta.url),'utf8');assert.doesNotMatch(component,/requestAnimationFrame|setInterval|setTimeout|useEffect|Date\.now|Math\.random/);
 assert.match(component,/key=\{signature\}/);
});
test('freshness ticks do not restart memoized motion, but changed routes invalidate it',()=>{
 const fresh={operations:resolve()},stale={operations:resolveRunwayOperations(snapshot(),now+2*3600000)};
 assert.equal(Aircraft.compare(fresh,stale),true);
 assert.equal(Aircraft.compare(fresh,{operations:resolve('18R','18C')}),false);
 assert.equal(Aircraft.compare(fresh,{operations:resolve('36L / 36R','36L / 36C / 36R','36R')}),false);
});
test('ivory contrast and reduced-motion rules stay scoped without changing runway geometry or arrow colors',()=>{
 const css=readFileSync(new URL('../app/runway-aircraft.css',import.meta.url),'utf8'),diagram=readFileSync(new URL('../app/RunwayDiagram.tsx',import.meta.url),'utf8'),layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
 assert.match(css,/fill:#fff4dc;stroke:#06151d;stroke-width:2\.1px/);assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
 assert.match(css,/\[data-reduced-motion="1"\] \.runway-aircraft-motion \{ display:none; \}/);
 assert.match(css,/\[data-reduced-motion="1"\] \.runway-aircraft-static \{ display:inline; \}/);
 assert.match(css,/\.runway-aircraft-motion \{ display:none; \}/);assert.match(css,/\.runway-aircraft-static \{ display:inline; \}/);
 assert.doesNotMatch(css,/(?:^|[;{\s])(?:filter|width|height|position):|drop-shadow/);
 assert.match(diagram,/viewBox="20 0 300 280"/);assert.match(diagram,/operation==='arrival'\?'#9fe8ff':'#ffd489'/);
 assert.ok(layout.indexOf('./runway-aircraft.css')>layout.indexOf('./runway-diagram.css'));
});
