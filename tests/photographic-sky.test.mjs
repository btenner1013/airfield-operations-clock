import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPhotographicSky, photoSkyHasMotion, photoSkyGeometry, photoSkySamples } from '../app/photographicSky.ts';
const SCENES=['clear-day','clear-night','partly-cloudy-day','partly-cloudy-night','overcast-day','overcast-night','rain-day','rain-night','thunderstorm-day','thunderstorm-night','snow-day','snow-night','fog-day','fog-night','sunrise','sunset'];
const photo=scene=>({width:1672,height:941,id:scene,src:`/clock/assets/backgrounds/${scene}.png`});
function harness(withStar=false) {
 const old=globalThis.document, canvases=[], calls=[], gradients=[]; let readbacks=0;
 const context=id=>{const stack=[],ctx={globalAlpha:1,globalCompositeOperation:'source-over'};
  const record=(method,values)=>{for(const v of values) if(typeof v==='number') assert.ok(Number.isFinite(v)); assert.ok(ctx.globalAlpha>=0&&ctx.globalAlpha<=1);calls.push({id,method,values,alpha:ctx.globalAlpha,blend:ctx.globalCompositeOperation});};
  for(const method of ['clearRect','fillRect','translate','scale','beginPath','moveTo','lineTo','closePath','fill','stroke']) ctx[method]=(...v)=>record(method,v);
  ctx.drawImage=(image,...v)=>record('drawImage',[image.id,...v]);
  ctx.save=()=>stack.push({globalAlpha:ctx.globalAlpha,globalCompositeOperation:ctx.globalCompositeOperation});ctx.restore=()=>Object.assign(ctx,stack.pop());
  for(const method of ['createLinearGradient','createRadialGradient'])ctx[method]=(...values)=>{const g={method,values,stops:[],addColorStop(p,c){assert.ok(p>=0&&p<=1);this.stops.push([p,c]);}};gradients.push(g);return g;};
  ctx.getImageData=(x,y,w,h)=>{readbacks++;const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=60;data[i+1]=80;data[i+2]=100;data[i+3]=255;}if(withStar){for(let i=0;i<data.length;i+=4){data[i]=8;data[i+1]=10;data[i+2]=13;}data.set([90,95,100,255],(30*w+Math.floor(w*.6))*4);}return{data,width:w,height:h};};
  ctx.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});ctx.putImageData=()=>{};return ctx;};
 globalThis.document={createElement(){const c={id:`canvas-${canvases.length}`,width:0,height:0};const ctx=context(c.id);c.getContext=()=>ctx;canvases.push(c);return c;}};
 return{ctx:context('output'),canvases,calls,gradients,get readbacks(){return readbacks;},reset(){calls.length=0;gradients.length=0;},restore(){if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
}
function withSky(f,withStar=false){const h=harness(withStar),s=createPhotographicSky();try{f(s,h);}finally{s.dispose();h.restore();}}

test('explicit artwork policy covers all sixteen assets, without inventing clear-night clouds',()=>{
 for(const scene of SCENES)assert.equal(photoSkyHasMotion(photo(scene)),scene!=='clear-night');
 assert.equal(photoSkyHasMotion({src:'/unknown.png'}),false);
 assert.equal(photoSkyHasMotion({src:'/sunset.png',currentSrc:'/clear-night.png'}),false);
 assert.equal(photoSkyHasMotion({src:'https://example.test/clock/assets/backgrounds/sunrise.png?v=2'}),true);
});
test('photo geometry matches effective centered cover after the CSS cascade at every crop',()=>{
 for(const [w,h]of[[1920,1080],[3840,2160],[1024,768],[768,1024],[3440,1440],[390,844]]){
  const g=photoSkyGeometry(w,h,1672,941);assert.ok(g.width>=w-1e-8&&g.height>=h-1e-8);
  assert.equal(g.x,(w-g.width)/2);assert.equal(g.y,(h-g.height)/2);
 }
});
test('recycle has continuous position and velocity at wrap, with bounded overscan and no turnaround',()=>{
 const eps=1e-8,span=.088;
 for(const sign of [-1,1])for(let i=0;i<300;i++){
  const t=sign*i*.001,p=photoSkySamples(t),q=photoSkySamples(t+sign*eps);
  assert.ok(p.mix>=0&&p.mix<=1);assert.ok(p.offset>=-.044&&p.offset<=.044);
  const effective=p.mix>.999?p.offset-span:p.offset,next=q.mix>.999?q.offset-span:q.offset;
  if(Math.abs(next-effective)<.01)assert.ok((next-effective)*sign>0);
  for(const x of [p.offset,p.offset-span])if(x===p.offset||p.mix>0)assert.ok(x>=-.06600001&&x<=.04400001);
 }
 const a=photoSkySamples(span*.5-eps),b=photoSkySamples(span*.5+eps);
 assert.ok(Math.abs(a.offset-span-b.offset)<eps*3);assert.ok(a.mix>.999999&&b.mix===0);
});
test('every cloud-bearing artwork moves at CLR/FEW with opaque replacement, even in calm',()=>{
 for(const scene of SCENES.filter(s=>s!=='clear-night'))withSky((sky,h)=>{
  const image=photo(scene);sky.draw(h.ctx,1920,1080,0,image,0,0,0,false);
  const output=()=>h.calls.find(c=>c.id==='output'&&c.method==='drawImage');assert.equal(output().alpha,1);
  const first=h.calls.find(c=>c.method==='drawImage'&&c.values[0]?.startsWith('canvas-')&&c.id!=='output').values[1];
  for(let f=0;f<30;f++){h.reset();sky.draw(h.ctx,1920,1080,.1,image,.2,0,0,false);}
  const last=h.calls.find(c=>c.method==='drawImage'&&c.values[0]?.startsWith('canvas-')&&c.id!=='output').values[1];
  assert.ok((last-first)*2>35,scene);assert.equal(output().alpha,1);assert.equal(h.readbacks,1,'source readback only at first decode');
 });
});
test('genuine clear-night and reduced motion allocate nothing and preserve original photograph',()=>{
 for(const scene of SCENES)withSky((sky,h)=>{sky.draw(h.ctx,1920,1080,0,photo(scene),1,1,40,true);assert.equal(h.canvases.length,0);assert.equal(h.calls.length,0);});
 withSky((sky,h)=>{sky.draw(h.ctx,1920,1080,0,photo('clear-night'),0,0,0,false);assert.equal(h.canvases.length,0);assert.equal(h.calls.length,0);});
});
test('bounded cached plates and one composite survive frames, resizes and signed high winds',()=>{
 withSky((sky,h)=>{const image=photo('overcast-day');for(const [w,hh]of[[1920,1080],[3840,2160],[768,1024],[1024,768],[3440,1440],[390,844]])for(let f=0;f<80;f++){
  h.reset();sky.draw(h.ctx,w,hh,.1,image,1,1,f<40?40:-40,false);
  assert.equal(h.canvases.length,3);assert.ok(h.canvases.every(c=>c.width<=960&&c.height<=540));assert.ok(h.calls.length<(f===0?350:90));
 }assert.equal(h.readbacks,1);});
});
test('fixed architecture masks are tight, source-aligned, stationary and cover all seven poles',()=>{
 for(const scene of ['sunset','snow-night','fog-night'])withSky((sky,h)=>{
  const image=photo(scene);sky.draw(h.ctx,1920,1080,0,image,.76,0,0,false);
  const rectangles=()=>h.calls.filter(c=>c.method==='fillRect'&&c.blend==='destination-out').map(c=>c.values);
  const first=rectangles();assert.equal(first.length,35);
  const g=photoSkyGeometry(1920,1080,1672,941),r=first[0];assert.ok(r[2]<g.width*.06*.5,'No broad swept-tower stationary cloud patch');
  for(let f=0;f<300;f++){h.reset();sky.draw(h.ctx,1920,1080,.1,image,.76,0,0,false);}
  assert.equal(rectangles().length,0,'Fixed mask is cached and never follows moving sky');
 });
});
test('image changes crossfade and retire old plates; rapid transitions retain dominant source',()=>{
 withSky((sky,h)=>{const a=photo('sunset'),b=photo('sunrise'),c=photo('overcast-night');sky.draw(h.ctx,1920,1080,0,a,.76,0,0,false);h.reset();sky.draw(h.ctx,1920,1080,.1,b,.76,0,0,false);
  assert.equal(h.readbacks,2);assert.ok(h.calls.some(c=>c.method==='drawImage'&&c.alpha>0&&c.alpha<.04));
  sky.draw(h.ctx,1920,1080,.1,c,1,0,0,false);assert.equal(h.readbacks,3);
  for(let f=0;f<40;f++)sky.draw(h.ctx,1920,1080,.1,c,1,0,0,false);
  assert.equal(h.canvases.filter(c=>c.width>1).length,4,'Only two plate stores, fixed mask and composite remain');
 });
});
test('initial decoded artwork reveal is respected and grading applies only to closed decks',()=>{
 for(const coverage of [0,.2,.44,.76,1])withSky((sky,h)=>{sky.draw(h.ctx,1920,1080,0,photo('sunset'),coverage,0,0,false,.05);
  assert.equal(h.calls.find(c=>c.id==='output').alpha,.05);
  assert.equal(h.calls.some(c=>c.blend==='saturation'),coverage===1);
 });
});
test('renderer has no scheduler; CSS grading and decoded policy govern the shared lifecycle',()=>{
 const s=readFileSync(new URL('../app/photographicSky.ts',import.meta.url),'utf8'),p=readFileSync(new URL('../app/PrecipCanvas.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\b(?:requestAnimationFrame|setTimeout|setInterval|addEventListener|getImageData|putImageData)\s*\(/);
 assert.match(p,/photoMotion=liveLayers[^;]*photoPainter\.drawWeighted\(skyCtx[^;]*:photoPainter\.draw\(skyCtx/);assert.match(p,/const idle=[^;]*!photoMotion/);assert.match(p,/skyCanvas\.style\.filter=stack[^;]*getComputedStyle\(stack\)\.filter/);
 withSky((sky,h)=>{sky.draw(h.ctx,1920,1080,0,photo('sunset'),1,1,0,false);sky.dispose();assert.ok(h.canvases.every(c=>c.width===1&&c.height===1));h.reset();sky.draw(h.ctx,1920,1080,.1,photo('sunrise'),1,1,0,false);assert.equal(h.calls.length,0);});
});

test('background geometry contract is tied to the effective CSS import order',()=>{
 const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
 const tuning=readFileSync(new URL('../app/layout-tuning.css',import.meta.url),'utf8');
 assert.ok(layout.indexOf('./layout-tuning.css')>layout.indexOf('./weather.css'));
 assert.match(tuning,/\.sky-base\s*\{[^}]*inset:\s*0;[^}]*background-size:\s*cover;[^}]*background-position:\s*center;/s);
});

test('weighted solar stack has exact normalized opacity and no implicit source transition',()=>{
 withSky((sky,h)=>{
  const a=photo('clear-night'),b=photo('sunrise'),c=photo('clear-day');
  const draw=layers=>sky.drawWeighted(h.ctx,1920,1080,0,layers,0,0,0,false);
  assert.equal(draw([{image:a,weight:2},{image:b,weight:3},{image:c,weight:5}]),true);
  const composites=()=>h.calls.filter(x=>x.method==='drawImage'&&x.values[0]==='canvas-3'&&x.id==='canvas-2');
  // Two prepared moving plates, then the main and reusable source composites.
  assert.deepEqual(composites().map(x=>x.alpha),[1,.6,.5]);
  assert.equal(h.calls.find(x=>x.id==='output'&&x.method==='drawImage').alpha,1);
  h.reset();draw([{image:c,weight:1}]);
  assert.equal(h.calls.filter(x=>x.id==='canvas-2'&&x.method==='drawImage'&&x.values[0]==='canvas-3').length,1);
  assert.ok(!h.calls.some(x=>x.method==='drawImage'&&x.values[0]===a.id));
 });
});

test('weighted six-source frames reuse plates and surfaces, merge identities and retire sources',()=>{
 withSky((sky,h)=>{
  const images=['sunrise','clear-day','rain-day','snow-day','fog-day','overcast-day'].map(photo);
  const layers=images.map(image=>({image,weight:1}));
  sky.drawWeighted(h.ctx,1920,1080,0,layers,0,0,0,false);
  const allocated=h.canvases.length,readbacks=h.readbacks;
  assert.equal(readbacks,6);assert.equal(allocated,9);
  for(let i=0;i<40;i++)sky.drawWeighted(h.ctx,1920,1080,.1,layers.map((l,j)=>({...l,weight:j+i+1})),0,0,20,false);
  assert.equal(h.canvases.length,allocated);assert.equal(h.readbacks,readbacks);
  h.reset();sky.drawWeighted(h.ctx,1920,1080,.1,[{image:images[0],weight:1},{image:images[0],weight:2}],0,0,20,false);
  assert.equal(h.readbacks,readbacks);assert.equal(h.canvases.filter(c=>c.width>1).length,4);
  assert.ok(h.canvases.every(c=>c.width<=960&&c.height<=540));
 });
});

test('weighted rendering preserves static fallback for reduced, missing, invalid and failed sources',()=>{
 withSky((sky,h)=>{
  const layers=[{image:photo('sunrise'),weight:1}];
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,layers,0,0,0,true),false);
  assert.equal(h.canvases.length,0);
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,[{image:photo('clear-night'),weight:1}],0,0,0,false),false);
  assert.equal(h.canvases.length,0);
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,[{image:{...photo('sunrise'),width:0},weight:1}],0,0,0,false),false);
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,[{image:photo('sunrise'),weight:NaN}],0,0,0,false),false);
  const create=document.createElement;document.createElement=()=>{const c=create();c.getContext=()=>null;return c;};
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,layers,0,0,0,false),false);
  const count=h.canvases.length;
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,layers,0,0,0,false),false);
  assert.equal(h.canvases.length,count,'Readback/context failure stays cached');
  assert.equal(h.calls.filter(c=>c.id==='output').length,0);
 });
});

test('weighted architecture mask is a cached union and disposal releases every surface',()=>{
 withSky((sky,h)=>{
  const layers=['sunset','fog-night','snow-night'].map(scene=>({image:photo(scene),weight:1}));
  sky.drawWeighted(h.ctx,1920,1080,0,layers,0,0,0,false);
  assert.equal(h.calls.filter(c=>c.method==='fillRect'&&c.blend==='destination-out').length,105);
  h.reset();sky.drawWeighted(h.ctx,1920,1080,.1,layers.map((l,i)=>({...l,weight:i+1})),0,0,0,false);
  assert.equal(h.calls.filter(c=>c.method==='fillRect'&&c.blend==='destination-out').length,0);
  sky.dispose();assert.ok(h.canvases.every(c=>c.width===1&&c.height===1));h.reset();
  assert.equal(sky.drawWeighted(h.ctx,1920,1080,.1,layers,0,0,0,false),false);assert.equal(h.calls.length,0);
 });
});

test('weighted sources share cloud travel while stars remain source-aligned',()=>{
 withSky((sky,h)=>{
  const layers=['partly-cloudy-night','sunrise'].map(scene=>({image:photo(scene),weight:.5}));
  sky.drawWeighted(h.ctx,1920,1080,0,layers,0,0,20,false);
  const stars=()=>h.calls.filter(c=>c.method==='drawImage'&&c.blend==='screen');
  const firstStar=stars()[0].values.slice();assert.equal(stars().length,1);
  const firstCloud=h.calls.find(c=>c.method==='drawImage'&&c.values[0]==='canvas-0'&&c.blend==='source-over').values;
  for(let i=0;i<20;i++){h.reset();sky.drawWeighted(h.ctx,1920,1080,.1,layers,0,0,20,false);}
  assert.deepEqual(stars()[0].values,firstStar);
  const cloudA=h.calls.find(c=>c.method==='drawImage'&&c.values[0]==='canvas-0'&&c.blend==='source-over').values;
  const cloudB=h.calls.find(c=>c.method==='drawImage'&&c.values[0]==='canvas-2'&&c.blend==='source-over').values;
  assert.deepEqual(cloudA.slice(1),cloudB.slice(1),'All source crops share one travel and evolution');
  assert.notEqual(firstCloud[1],cloudA[1]);
 },true);
});
