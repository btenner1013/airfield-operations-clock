import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as geometry from '../app/runwayGeometry.ts';
import * as operations from '../app/runwayOperations.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../app/RunwayDiagram.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='./runwayGeometry'?geometry:name==='./runwayOperations'?operations:require(name),module,module.exports);
const Diagram=module.exports.default;
const time=Date.parse('2026-10-16T15:00:00Z');
const input={atisObservedZ:'2026-10-16T14:54:00Z',atisFetchStatus:'OK',atisSelectedSource:'ATIS_INFO_API',atisReportedArrRunways:'36R / 27',atisReportedDepRunways:'36C / 36R / 27',atisReportedClosedRunways:'18R / 36L'};
const render=(data=input,now=time)=>renderToStaticMarkup(React.createElement(Diagram,{snapshot:operations.normalizeRunwayOperations(data),nowMs:now}));
test('geometry keeps FAA relative lengths, near east pair and staggered north ends',()=>{
 const g=geometry.RUNWAY_GEOMETRY;const scale=Math.hypot(g[1].points[1].x-g[1].points[0].x,g[1].points[1].y-g[1].points[0].y)/11120;
 for(const r of g)assert.ok(Math.abs(Math.hypot(r.points[1].x-r.points[0].x,r.points[1].y-r.points[0].y)-r.lengthFt*scale)<1e-8);
 assert.ok(g[2].points[1].x-g[1].points[1].x<(g[1].points[1].x-g[0].points[1].x)/2);
 assert.ok(g[1].points[0].y<g[0].points[0].y&&g[0].points[0].y<g[2].points[0].y);
});
test('every end places landing arrows outside entry and departure arrows beyond opposite exit',()=>{
 for(const r of geometry.RUNWAY_GEOMETRY)for(const end of r.ends){
  const i=r.ends.indexOf(end),p=r.points[i],q=r.points[1-i],dx=q.x-p.x,dy=q.y-p.y;
  for(const op of ['arrival','departure']){
   const a=geometry.runwayArrow(r,end,op),anchor=op==='arrival'?p:q;
   const start=(a.start.x-anchor.x)*dx+(a.start.y-anchor.y)*dy;
   const finish=(a.end.x-anchor.x)*dx+(a.end.y-anchor.y)*dy;
   assert.ok(op==='arrival'?start<finish&&finish<0:finish>start&&start>0,`${end} ${op}`);
  }
 }
});
test('actual markup contains both ARR and DEP arrows and suppresses closed physical runway',()=>{
 const html=render();assert.match(html,/data-end="36R"/);assert.equal((html.match(/data-end="36R"/g)||[]).length,2);
 assert.equal((html.match(/data-operation="arrival"/g)||[]).length,2);assert.equal((html.match(/data-operation="departure"/g)||[]).length,3);
 assert.match(html,/stroke="#ad0928"/);assert.match(html,/stroke="#ffe3e5"/);
 assert.doesNotMatch(html,/data-end="(?:18R|36L)"/);
 assert.doesNotMatch(html,/<rect|<header|<foreignObject/);
});
test('stale and absent data render four gray runways without operational arrows or red X',()=>{
 for(const html of [render(input,time+91*60000),render(null)]){
  assert.equal((html.match(/data-state="unknown"/g)||[]).length,4);
  assert.doesNotMatch(html,/data-operation=|runway-closure/);
 }
});
test('diagram occupies header right and Julian group sits below both clocks',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 assert.ok(page.indexOf('<RunwayPlacement')<page.indexOf('<section className="clocks"'));
 assert.ok(page.indexOf('<div className="header-date julian-date">')>page.indexOf('<article className="clock zulu"'));
 assert.equal((page.match(/className="header-date julian-date"/g)||[]).length,1);
 assert.match(css,/right:0;top:0/);assert.match(css,/min-height:clamp/);
 assert.match(css,/\.clocks > \.header-date \{\s*display:flex/);
 assert.doesNotMatch(css,/grid-template|background:|animation:|\.clock time/);
});
test('header placement stays above clock labels and right of branding',()=>{
 for(const [top,clock,right,brand] of [[58,370,1842,910],[41,280,1311,700],[22,230,1072,850]]) {
  const height=geometry.runwayPlacementHeight(top,clock,right,brand);
  assert.ok(top+height<=clock-12);assert.ok(height<=300);assert.ok(right-height*300/280>=brand+24);
 }
 assert.ok(geometry.runwayPlacementHeight(58,370,1842,910)>=280);
 assert.ok(geometry.runwayPlacementHeight(41,280,1311,700)>=210);
 assert.equal(geometry.runwayPlacementHeight(200,205,1200,800),0);
 assert.equal(geometry.runwayPlacementHeight(50,400,800,790),0);
 assert.equal(geometry.runwayPlacementHeight(NaN,200,1200,800),0);
});

test('each clock has exactly one larger date and Julian retains local-calendar rollover',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 assert.equal((page.match(/\{dateLine\(local\)\}/g)||[]).length,1);
 assert.equal((page.match(/\{dateLine\(utc\)\}/g)||[]).length,1);
 assert.doesNotMatch(page,/LOCAL DATE/);
 assert.match(css,/font-size:clamp\(14px,1\.3vw,25px\)/);
 const functions=page.slice(page.indexOf('function parts('),page.indexOf('function getMoonPhase('));
 const compiled=ts.transpileModule(functions+'\nmodule.exports={parts,dateLine,julian4};',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};new Function('module','CONFIG',compiled)(mod,{timeZone:'America/Chicago'});
 const {parts,dateLine,julian4}=mod.exports;
 const now=new Date('2027-01-01T02:00:00Z');
 assert.match(dateLine(parts(now,'America/Chicago')),/31 DEC 2026/);
 assert.match(dateLine(parts(now,'UTC')),/01 JAN 2027/);
 assert.equal(julian4(now),'6365');
 assert.equal(julian4(new Date('2027-01-01T06:00:00Z')),'7001');
});
