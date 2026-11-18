import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as compass from '../app/windCompass.ts';
import * as mesh from '../app/windsockMesh.mjs';
import {parseStandardWind} from '../app/currentWind.ts';
const require=createRequire(import.meta.url), mod={exports:{}};
const source=readFileSync(new URL('../app/SceneryWindsock.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',compiled)(id=>id==='./windCompass'?compass:id==='./windsockMesh.mjs'?mesh:require(id),mod,mod.exports);
const now=Date.parse('2026-11-18T12:00:00Z');
const wind=(token,source='METAR',time='2026-11-18T11:54:00Z')=>parseStandardWind(token,source,time);
const render=(wind,reduced=false)=>renderToStaticMarkup(React.createElement(mod.exports.default,{wind,nowMs:now,reduced}));
test('fresh observed wind draws fabric; reduced motion is still',()=>{
  for(const token of ['36002KT','09030G40KT','18015KT','27008KT']){
    assert.match(render(wind(token)),/data-state="directional" data-motion="flutter"/);
    assert.match(render(wind(token)),/<polygon/);
    assert.match(render(wind(token),true),/data-motion="still"/);
  }
});
test('calm has stationary fabric; VRB, stale, model and missing do not fabricate direction',()=>{
  assert.match(render(wind('00000KT')),/data-state="calm" data-motion="still"/);
  assert.match(render(wind('00000KT')),/<polygon/);
  for(const [report,state] of [[wind('VRB03KT'),'variable'],[wind('09030KT','METAR','2026-11-18T09:00:00Z'),'stale'],[wind('09030KT','MODEL'),'unavailable'],[null,'unavailable']]){
    assert.match(render(report),new RegExp(`data-state="${state}" data-motion="still"`));
    assert.doesNotMatch(render(report),/<polygon/);
  }
});
test('live wiring uses actual observation, not debug override; perspective caveat is accessible',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/<SceneryWindsock wind=\{weather.currentWind\}/);
 assert.match(render(wind('36008KT')),/not calibrated to the runway photograph/);
 assert.doesNotMatch(render(wind('36008KT')),/The arrow/);
});
