import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSceneRequests,blendLoadedScenes,sourceOverOpacities,createSolarStackLoader,loadSolarImage} from '../app/solarWallpaper.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const loaded=scene=>({scene,src:`/clock/assets/backgrounds/${scene}.png`,image:{src:scene,naturalWidth:100,naturalHeight:100}});
test('solar weights merge normalize and produce exact source-over composite',()=>{
 const requests=normalizeSceneRequests([{scene:'sunrise',weight:2},{scene:'clear-day',weight:3},{scene:'sunrise',weight:5},{scene:'../bad',weight:1},{scene:'clear-night',weight:NaN}]);
 assert.deepEqual(requests,[{scene:'sunrise',weight:.7},{scene:'clear-day',weight:.3}]);
 assert.deepEqual(sourceOverOpacities([2,3,5]),[1,.6,.5]);
 const current=['sunrise','clear-day'].map(loaded),previous=[{...loaded('clear-night'),weight:1}];
 const blended=blendLoadedScenes(current,requests,previous,.5);
 assert.deepEqual(blended.map(x=>x.weight),[.5,.35,.15]);
 assert.equal(blendLoadedScenes(current,requests,previous,1).length,2);
 assert.equal(blendLoadedScenes(current,requests,previous,0)[0].image,previous[0].image);
});
test('solar loader rejects stale successes and errors and commits complete stacks only',async()=>{
 const pending=new Map(),ready=[],errors=[];
 const loader=createSolarStackLoader(src=>{const d=deferred();pending.set(src,d);return d.promise;});
 const a=loader.request(['a','b','a'],'/clock',layers=>ready.push(layers),()=>errors.push('a'));
 assert.equal(pending.size,2);
 const b=loader.request(['c'],'/clock',layers=>ready.push(layers),()=>errors.push('b'));
 pending.get('/clock/assets/backgrounds/a.png').resolve({});
 pending.get('/clock/assets/backgrounds/b.png').reject(new Error('stale'));
 pending.get('/clock/assets/backgrounds/c.png').resolve({});await Promise.all([a,b]);
 assert.equal(ready.length,1);assert.equal(ready[0][0].scene,'c');assert.deepEqual(errors,[]);
 const c=loader.request(['d','e'],'/clock',layers=>ready.push(layers),()=>errors.push('c'));
 pending.get('/clock/assets/backgrounds/d.png').resolve({});await Promise.resolve();assert.equal(ready.length,1);
 pending.get('/clock/assets/backgrounds/e.png').reject(new Error('failure'));await c;assert.deepEqual(errors,['c']);assert.equal(ready.length,1);
 const d=loader.request(['f'],'/clock',layers=>ready.push(layers),()=>errors.push('d'));loader.cancel();pending.get('/clock/assets/backgrounds/f.png').resolve({});await d;assert.equal(ready.length,1);
 loader.dispose();await loader.request([],'/clock',layers=>ready.push(layers),()=>errors.push('disposed'));assert.equal(ready.length,1);
});
test('decoded solar image tolerates decode rejection but rejects failed or empty image',async()=>{
 const old=globalThis.Image,images=[];globalThis.Image=class{naturalWidth=100;naturalHeight=100;decode=()=>Promise.reject(new Error('browser decode'));constructor(){images.push(this);}};
 try {
  const success=loadSolarImage('/ok.png');images.at(-1).onload();assert.equal(await success,images[0]);assert.equal(images[0].onload,null);assert.equal(images[0].onerror,null);
  const empty=loadSolarImage('/empty.png');images.at(-1).naturalWidth=0;images.at(-1).onload();await assert.rejects(empty,/Empty/);
  const failure=loadSolarImage('/failed.png');images.at(-1).onerror();await assert.rejects(failure,/load failed/);
 }finally{globalThis.Image=old;}
});

test('hook loads by identity only, retains pending stack and rejects stale decode',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm'),ts=await import('typescript');
 const real=await import('../app/solarWallpaper.ts');
 const pending=new Map(),hooks=[],effects=[],queue=[],timers=new Map();let index=0,now=0,nextTimer=0;
 const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
 const sandbox={exports:{},performance:{now:()=>now},window:{setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},addEventListener(){},removeEventListener(){}},clearTimeout(id){timers.delete(id);},require(name){
  if(name==='react')return {
   useRef(value){return hooks[index++]??={current:value};},
   useState(value){const key=index++;if(!(key in hooks))hooks[key]=value;return [hooks[key],value=>{hooks[key]=typeof value==='function'?value(hooks[key]):value;}];},
   useMemo(fn,deps){const key=index++;if(!hooks[key]||changed(hooks[key].deps,deps))hooks[key]={value:fn(),deps};return hooks[key].value;},
   useEffect(fn,deps){const key=index++;if(!effects[key]||changed(effects[key].deps,deps)){const old=effects[key];effects[key]={deps,cleanup:old?.cleanup};queue.push(()=>{old?.cleanup?.();effects[key].cleanup=fn();});}}
  };
  if(name==='./solarWallpaper')return {...real,loadSolarImage(src){const d=deferred();pending.set(src,d);return d.promise;}};
  throw new Error(name);
 }};
 vm.runInNewContext(ts.default.transpileModule(readFileSync(new URL('../app/useSolarWallpaper.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.default.ScriptTarget.ES2022,module:ts.default.ModuleKind.CommonJS}}).outputText,sandbox);
 const render=requests=>{index=0;const result=sandbox.exports.useSolarWallpaper(requests,'/clock',true,now);while(queue.length)queue.shift()();return result;};
 const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 try{
  const requestA=[{scene:'sunrise',weight:.5},{scene:'clear-day',weight:.5}];assert.equal(render(requestA).length,0);
  for(const [src,d]of pending)d.resolve({src,width:100,height:100});await settle();
  let current=render(requestA);assert.equal(current.length,2);const first=current[0].image;
  for(let i=0;i<20;i++){now+=1000;current=render([{scene:'sunrise',weight:.4},{scene:'clear-day',weight:.6}]);}
  assert.equal(pending.size,2);assert.equal(current[0].image,first);assert.equal(current[0].weight,.4);
  const b=[{scene:'rain-day',weight:1}],c=[{scene:'snow-day',weight:1}];
  assert.equal(render(b)[0].image,first);assert.equal(render(c)[0].image,first);
  pending.get('/clock/assets/backgrounds/rain-day.png').resolve({src:'rain'});await settle();assert.equal(render(c)[0].image,first);
  pending.get('/clock/assets/backgrounds/snow-day.png').resolve({src:'snow'});await settle();
  current=render(c);assert.equal(current.find(x=>x.scene==='sunrise').weight,.4,'Replacement starts from latest active solar weights, not initial load weights');now+=7000;
  current=render(c);assert.equal(current.length,1);assert.equal(current[0].scene,'snow-day');
  const trioA=['clear-night','sunrise','clear-day'].map(scene=>({scene,weight:1/3}));
  render(trioA);await settle();render(trioA);now+=7000;render(trioA);
  // Seed any new identities, then start B and interrupt it with C and D.
  for(const [src,d]of pending)d.resolve({src,width:100,height:100});await settle();render(trioA);now+=7000;
  current=render(trioA);assert.equal(current.length,3);
  const trioB=['rain-day','rain-night','fog-day'].map(scene=>({scene,weight:1/3}));
  render(trioB);for(const [src,d]of pending)d.resolve({src,width:100,height:100});await settle();render(trioB);now+=2000;
  current=render(trioB);assert.equal(current.length,6);
  const trioC=['snow-day','snow-night','fog-night'].map(scene=>({scene,weight:1/3}));
  render(trioC);for(const [src,d]of pending)d.resolve({src,width:100,height:100});await settle();
  current=render(trioC);assert.ok(current.length<=6);assert.ok(!current.some(x=>x.scene==='snow-night'));
  const trioD=['overcast-day','overcast-night','sunset'].map(scene=>({scene,weight:1/3}));
  render(trioD);for(const [src,d]of pending)d.resolve({src,width:100,height:100});await settle();
  assert.equal(timers.size,1,'Superseded C commit timer is cancelled');
  now+=6000;render(trioD);for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
  current=render(trioD);assert.ok(current.length<=6);now+=3000;
  current=render(trioD);assert.equal(current.length,6);assert.ok(!current.some(x=>x.scene==='snow-night'),'Cancelled intermediate stack never appears');
  now+=5000;current=render(trioD);assert.equal(current.length,3);assert.ok(current.every(x=>trioD.some(r=>r.scene===x.scene)));

 }finally{for(const effect of effects)effect?.cleanup?.();}
});

test('continuous solar stacks retain adverse weather families through dawn and dusk',async()=>{
 const {sceneFor,sceneForEffects}=await import('../app/wallpaper.ts');
 const {solarBlend}=await import('../app/solarTransition.ts');
 for(const condition of ['rain','heavy-rain','thunderstorm','snow','overcast','fog'])for(const rising of [true,false])for(const elevation of [-12,-7,-3,-1,2,7])for(const obscuration of ['none','fog','mist','freezing-fog','smoke']){
  const weights=solarBlend(elevation),phases=['night',rising?'sunrise':'sunset','day'];
  const requests=normalizeSceneRequests(phases.map((phase,i)=>({scene:sceneForEffects(sceneFor(condition,phase,'OVC'),obscuration,.5,phase,'OVC'),weight:[weights.night,weights.warm,weights.day][i]})));
  assert.ok(requests.length<=2);assert.ok(Math.abs(requests.reduce((n,x)=>n+x.weight,0)-1)<1e-9);
  if(['rain','heavy-rain','thunderstorm','snow'].includes(condition)||['none','fog','freezing-fog','smoke'].includes(obscuration))assert.ok(requests.every(x=>x.scene!=='sunrise'&&x.scene!=='sunset'),'Adverse-weather artwork never becomes a clear golden-hour plate');
  if(['rain','heavy-rain','thunderstorm','snow'].includes(condition))assert.ok(requests.every(x=>x.scene.startsWith(`${condition==='heavy-rain'?'rain':condition}-`)),'Precipitation priority survives obscuration');
 }
});
