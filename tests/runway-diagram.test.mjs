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
test('new diagram stays centered across both clock columns and leaves card grid unchanged',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 assert.ok(page.indexOf('<RunwayPlacement')>page.indexOf('<article className="clock zulu"'));
 assert.ok(page.indexOf('<RunwayPlacement')<page.indexOf('<section className="info">'));
 assert.match(css,/left:50%/);assert.match(css,/translateX\(-50%\)/);assert.doesNotMatch(css,/grid-template|background:|animation:/);
});


test('placement is bounded below both clock/date blocks at TV and short viewport sizes',()=>{
 for(const [width,bottom,foot] of [[1766,780,580],[1766,780,650],[1260,520,390],[1260,420,390],[330,600,400]]) {
  const height=geometry.runwayPlacementHeight(bottom,foot,width);
  assert.ok(bottom-height>=foot+8);assert.ok(height<=280);assert.ok(height*300/280<=width*.36);
 }
 assert.equal(geometry.runwayPlacementHeight(200,220,1200),0);
 assert.equal(geometry.runwayPlacementHeight(NaN,200,1200),0);
});
