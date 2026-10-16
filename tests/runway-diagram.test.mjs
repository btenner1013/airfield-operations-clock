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
 assert.doesNotMatch(css,/grid-template|animation:|\.clock time/);
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

test('runway contrast panel shares bottom-card finish without shrinking or clipping SVG',()=>{
 const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 const board=readFileSync(new URL('../app/board-cohesion.css',import.meta.url),'utf8');
 assert.match(board,/\.info > \.panel,\s*\.runway-placement::before \{/);
 assert.match(css,/\.runway-placement::before \{[^}]*inset:-8px;z-index:-1;[^}]*border:1px solid var\(--line\)/s);
 assert.match(css,/width:100%;height:100%;overflow:visible/);
 const panel=css.match(/\.runway-placement::before \{([^}]+)\}/)[1];
 assert.doesNotMatch(panel,/padding:|overflow:hidden|width:|height:/);
 assert.ok(12-8>=4);assert.ok(24-8>=16);
});

test('runway-only translucent background leaves shared cards and solid SVG intact',()=>{
 const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 const board=readFileSync(new URL('../app/board-cohesion.css',import.meta.url),'utf8');
 const panel=css.match(/\.runway-placement::before \{([^}]+)\}/)[1];
 assert.match(panel,/background:linear-gradient\(145deg,rgba\(13,26,34,\.55\),rgba\(5,13,19,\.40\)\)/);
 assert.match(board,/rgba\(13, 26, 34, \.96\), rgba\(5, 13, 19, \.9\)/);
 assert.doesNotMatch(css,/\bopacity\s*:/);
 const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
 assert.ok(layout.indexOf('./runway-diagram.css')>layout.indexOf('./board-cohesion.css'));
});

const statusSource=readFileSync(new URL('../app/RunwayStatus.tsx',import.meta.url),'utf8');
const statusCompiled=ts.transpileModule(statusSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const statusModule={exports:{}};
new Function('require','module','exports',statusCompiled)(require,statusModule,statusModule.exports);
const Status=statusModule.exports.default;
const status=(data=input,now=time)=>renderToStaticMarkup(React.createElement(Status,{operations:operations.resolveRunwayOperations(operations.normalizeRunwayOperations(data),now)}));
const row=(html,label)=>html.match(new RegExp(`<g class="runway-status-row" data-runway-status="${label}"[^>]*>(.*?)</g>`))?.[1]??'';
const closure={text:'RWY 18R/36L CLSD',effectiveStart:'202610161300',effectiveEnd:'202610161930'};
const notams={milNotamUpdatedZ:'2026-10-16T14:55:00Z',milNotamFetchStatus:'OK',milNotamSource:'FAA_NMS_STAGING',runwayClosureNotams:[closure]};

test('compact rows show only effective reported ARR, DEP and physical runway closures',()=>{
 const html=status();
 assert.match(row(html,'ARR'),/>[^<]*36R[^<]*</);assert.match(row(html,'ARR'),/>[^<]*27[^<]*</);
 assert.match(row(html,'DEP'),/>[^<]*36C[^<]*</);assert.match(row(html,'DEP'),/>[^<]*36R[^<]*</);assert.match(row(html,'DEP'),/>[^<]*27[^<]*</);
 assert.match(row(html,'CLSD'),/>18R\/36L</);
 assert.equal((html.match(/data-state="active"/g)||[]).length,2);
 assert.equal((html.match(/data-state="closed"/g)||[]).length,1);
 assert.doesNotMatch(html,/NONE|UNKNOWN|STALE|—/);
});

test('CLSD box disappears completely when nothing is closed; empty ARR and DEP also disappear',()=>{
 const noClosure=status({...input,atisReportedClosedRunways:null});
 assert.equal(row(noClosure,'CLSD'),'');assert.doesNotMatch(noClosure,/CLSD|data-state="closed"/);
 assert.match(noClosure,/data-runway-status="ARR"/);assert.match(noClosure,/data-runway-status="DEP"/);
 const departureOnly=status({...input,atisReportedArrRunways:null,atisReportedClosedRunways:null});
 assert.equal(row(departureOnly,'ARR'),'');assert.equal(row(departureOnly,'CLSD'),'');assert.match(departureOnly,/data-runway-status="DEP"/);
 const closureOnly=status({...input,atisReportedArrRunways:null,atisReportedDepRunways:null});
 assert.equal(row(closureOnly,'ARR'),'');assert.equal(row(closureOnly,'DEP'),'');assert.match(closureOnly,/data-runway-status="CLSD"/);
 assert.equal(status({...input,atisReportedArrRunways:null,atisReportedDepRunways:null,atisReportedClosedRunways:null}),'');
});

test('unknown, stale, cached and failed sources leave no status rows or placeholder container',()=>{
 assert.equal(status(null),'');
 for(const overrides of [
  {atisObservedZ:'2026-10-16T12:00:00Z'}, {atisObservedZ:null}, {atisObservedZ:'2026-10-16T16:00:00Z'},
  {atisFetchStatus:'ERROR'}, {atisSelectedSource:'CACHE'}, {atisSourceIsCurrent:false}, {lastKnownGoodUsed:{atis:true}},
 ])assert.equal(status({...input,...overrides}),'');
 assert.notEqual(status(input,Date.parse(input.atisObservedZ)+90*60000),'');
 assert.equal(status(input,Date.parse(input.atisObservedZ)+90*60000+1),'');
 assert.equal(status({windDirDeg:360,arrRunways:'36R',depRunways:'36C'}),'');
});

test('status rows share diagram closure precedence and cannot repeat conflicting runway use',()=>{
 const data={...input,...notams,atisReportedArrRunways:'36L / 36R',atisReportedDepRunways:'18R / 36C',atisReportedClosedRunways:null};
 const html=status(data);
 assert.doesNotMatch(row(html,'ARR'),/36L|18R/);assert.doesNotMatch(row(html,'DEP'),/36L|18R/);
 assert.match(row(html,'ARR'),/>[^<]*36R[^<]*</);assert.match(row(html,'DEP'),/>[^<]*36C[^<]*</);assert.match(row(html,'CLSD'),/>18R\/36L</);
 assert.doesNotMatch(render(data),/data-end="(?:18R|36L)"/);
 const resolved=operations.resolveRunwayOperations(operations.normalizeRunwayOperations(data),time);
 const svg=renderToStaticMarkup(React.createElement(Diagram,{snapshot:null,nowMs:time,operations:resolved}));
 assert.equal(svg,render(data));
 const placement=readFileSync(new URL('../app/RunwayPlacement.tsx',import.meta.url),'utf8');
 assert.match(placement,/const operations=resolveRunwayOperations\(props.snapshot,props.nowMs\)/);
 assert.match(placement,/<RunwayDiagram[^>]+operations=\{operations\}/);
 assert.match(placement,/<RunwayStatus operations=\{operations\}/);
});

test('ATIS and NOTAM age independently and only effective fresh closures get a CLSD row',()=>{
 const staleAtis={...input,...notams,atisObservedZ:'2026-10-16T12:00:00Z'};
 const closureOnly=status(staleAtis);
 assert.equal(row(closureOnly,'ARR'),'');assert.equal(row(closureOnly,'DEP'),'');assert.match(row(closureOnly,'CLSD'),/18R\/36L/);
 const staleNotam=status({...input,...notams,atisReportedClosedRunways:null,atisReportedArrRunways:'36L / 36R',milNotamUpdatedZ:'2026-10-16T12:00:00Z'});
 assert.equal(row(staleNotam,'CLSD'),'');assert.doesNotMatch(row(staleNotam,'ARR'),/36L/);assert.match(row(staleNotam,'ARR'),/36R/);
 for(const change of [{effectiveStart:'202610161600'},{effectiveEnd:'202610161500'},{effectiveEnd:null}]){
  const html=status({...input,...notams,atisReportedClosedRunways:null,runwayClosureNotams:[{...closure,...change}]});
  assert.equal(row(html,'CLSD'),'');
 }
 const bothStale=status({...staleAtis,milNotamUpdatedZ:'2026-10-16T12:00:00Z'});
 assert.equal(bothStale,'');
});

test('status colors are green for use and red for closed, preserving the original SVG palette and footprint',()=>{
 const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 assert.match(css,/\.runway-status-row \{ color:#62e5a6; \}/);
 assert.match(css,/\.runway-status-row\[data-state="closed"\] \{ color:#ff7179; \}/);
 assert.match(css,/position:absolute;inset:0;width:100%;height:100%;overflow:visible/);
 assert.match(source,/operation==='arrival'\?'#9fe8ff':'#ffd489'/);
 assert.match(source,/viewBox="20 0 300 280"/);
 const placement=readFileSync(new URL('../app/RunwayPlacement.tsx',import.meta.url),'utf8');
 assert.match(placement,/width:height\*300\/280/);
});

test('every physical-runway closure combination keeps compact labels inside the clear right-hand space',()=>{
 for(let mask=0;mask<16;mask++){
  const closed=operations.MEM_RUNWAYS.filter((_,index)=>mask&(1<<index));
  const used=operations.MEM_RUNWAYS.filter((_,index)=>!(mask&(1<<index))).flatMap(runway=>runway.ends);
  const html=status({...input,atisReportedArrRunways:used,atisReportedDepRunways:used,atisReportedClosedRunways:closed.flatMap(runway=>runway.ends)});
  for(const [,x,y,kind,text] of html.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="runway-status-(label|value)">([^<]+)<\/text>/g)){
   assert.ok([207,264].includes(Number(x)));assert.ok(Number(y)>=65&&Number(y)<=265,`${mask}: ${y} ${text}`);
   if(kind==='value')assert.match(text,/^(?:18[CLR]|36[CLR]|09|27)(?:\/(?:18[CLR]|36[CLR]|09|27))?$/,`${mask}: ${text}`);
  }
  assert.equal((html.match(/data-runway-status="CLSD"/g)||[]).length,closed.length?1:0);
 }
});

test('one-runway lines retain every runway-use subset inside the unchanged diagram bounds',()=>{
 const css=readFileSync(new URL('../app/runway-diagram.css',import.meta.url),'utf8');
 assert.match(css,/\.runway-status-label \{ font-size:13px;font-weight:700;letter-spacing:1px; \}/);
 assert.match(css,/\.runway-status-value \{ font-size:17px;font-weight:800; \}/);
 for(let closureMask=0;closureMask<16;closureMask++){
  const closed=operations.MEM_RUNWAYS.filter((_,index)=>closureMask&(1<<index)).flatMap(runway=>runway.ends);
  const available=operations.MEM_RUNWAYS.filter((_,index)=>!(closureMask&(1<<index))).flatMap(runway=>runway.ends);
  for(let useMask=0;useMask<(1<<available.length);useMask++){
   const used=available.filter((_,index)=>useMask&(1<<index));
   // Exercise every available subset; independent ARR/DEP count combinations
   // are covered separately because they can change the column choice.
   const html=status({...input,atisReportedArrRunways:used,atisReportedDepRunways:used,atisReportedClosedRunways:closed});
   for(const [,x,y,kind,text] of html.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="runway-status-(label|value)">([^<]+)<\/text>/g)){
    assert.ok([207,264].includes(Number(x)));assert.ok(Number(y)>=65&&Number(y)<=265,`${closureMask}/${useMask}: ${y} ${text}`);
    if(kind==='value')assert.match(text,/^(?:18[CLR]|36[CLR]|09|27)(?:\/(?:18[CLR]|36[CLR]|09|27))?$/,`${closureMask}/${useMask}: ${text}`);
   }
  }
 }
});

const statusValues=(html,label)=>[...row(html,label).matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="runway-status-value">([^<]+)<\/text>/g)].map(([,x,y,text])=>({x:Number(x),y:Number(y),text}));
test('current two-arrival, three-departure report uses aligned one-runway lines and a consistent group gap',()=>{
 const html=status({...input,atisReportedArrRunways:'36L 36R',atisReportedDepRunways:'36L 36C 36R',atisReportedClosedRunways:null});
 const arrivals=statusValues(html,'ARR'),departures=statusValues(html,'DEP');
 assert.deepEqual(arrivals.map(value=>value.text),['36L','36R']);
 assert.deepEqual(departures.map(value=>value.text),['36L','36C','36R']);
 assert.ok([...arrivals,...departures].every(value=>value.x===207));
 for(const values of [arrivals,departures])for(let i=1;i<values.length;i++)assert.equal(values[i].y-values[i-1].y,20);
 const heading=Number(row(html,'DEP').match(/<text x="207" y="([\d.]+)" class="runway-status-label"/)[1]);
 assert.equal(heading-arrivals.at(-1).y,28);assert.equal(departures[0].y-heading,20);
 assert.doesNotMatch(html,/CLSD|data-columns="2"/);
});

test('long and asymmetric reports use deliberate columns without shrinking or dropping active entries',()=>{
 const ends=operations.MEM_RUNWAYS.flatMap(runway=>runway.ends);
 for(const [arr,dep] of [[ends,ends],[ends,['36R']],[['36R'],ends],[ends.slice(0,6),ends.slice(0,4)]]){
  const html=status({...input,atisReportedArrRunways:arr,atisReportedDepRunways:dep,atisReportedClosedRunways:null});
  assert.deepEqual(statusValues(html,'ARR').map(value=>value.text),arr);
  assert.deepEqual(statusValues(html,'DEP').map(value=>value.text),dep);
  assert.match(html,/data-columns="2"/);
  for(const label of ['ARR','DEP']){
   const values=statusValues(html,label);
   assert.ok(values.every(value=>[207,264].includes(value.x)&&value.y>=65&&value.y<=265));
   for(const x of [207,264]){
    const column=values.filter(value=>value.x===x);
    for(let i=1;i<column.length;i++)assert.equal(column[i].y-column[i-1].y,20);
   }
  }
  assert.doesNotMatch(html,/font-size|fontSize|transform=/);
 }
});

test('every independent arrival/departure count fits with every physical closure combination',()=>{
 for(let mask=0;mask<16;mask++){
  const closed=operations.MEM_RUNWAYS.filter((_,index)=>mask&(1<<index)).flatMap(runway=>runway.ends);
  const available=operations.MEM_RUNWAYS.filter((_,index)=>!(mask&(1<<index))).flatMap(runway=>runway.ends);
  for(let arrivals=0;arrivals<=available.length;arrivals++)for(let departures=0;departures<=available.length;departures++){
   const html=status({...input,atisReportedArrRunways:available.slice(0,arrivals),atisReportedDepRunways:available.slice(0,departures),atisReportedClosedRunways:closed});
   assert.equal(statusValues(html,'ARR').length,arrivals);assert.equal(statusValues(html,'DEP').length,departures);
   for(const label of ['ARR','DEP','CLSD']){
    const values=statusValues(html,label),positions=new Set(values.map(value=>`${value.x}/${value.y}`));
    assert.equal(positions.size,values.length);
    assert.ok(values.every(value=>[207,264].includes(value.x)&&value.y>=65&&value.y<=265));
   }
  }
 }
});
