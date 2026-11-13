export type SolarSceneRequest={scene:string;weight:number};
export type LoadedSolarScene={scene:string;src:string;image:HTMLImageElement};
export type WeightedSolarScene=LoadedSolarScene&{weight:number};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export function normalizeSceneRequests(requests:readonly SolarSceneRequest[]):SolarSceneRequest[] {
  const merged=new Map<string,number>();
  for(const {scene,weight} of requests) if(/^[a-z-]+$/.test(scene)&&Number.isFinite(weight)&&weight>0)merged.set(scene,(merged.get(scene)||0)+weight);
  const total=[...merged.values()].reduce((a,b)=>a+b,0);
  return total>0?[...merged].map(([scene,weight])=>({scene,weight:weight/total})):[];
}
export function blendLoadedScenes(current:readonly LoadedSolarScene[],requests:readonly SolarSceneRequest[],previous:readonly WeightedSolarScene[]=[],transition=1):WeightedSolarScene[] {
  const next=normalizeSceneRequests(requests).flatMap(request=>{const loaded=current.find(x=>x.scene===request.scene);return loaded?[{...loaded,weight:request.weight}]:[];});
  if(!next.length)return [...previous];
  const t=clamp(transition),all=[...previous.map(x=>({...x,weight:x.weight*(1-t)})),...next.map(x=>({...x,weight:x.weight*t}))];
  const merged=new Map<string,WeightedSolarScene>();
  for(const layer of all){const existing=merged.get(layer.src);if(existing)existing.weight+=layer.weight;else merged.set(layer.src,{...layer});}
  const total=[...merged.values()].reduce((a,b)=>a+b.weight,0);
  return total>0?[...merged.values()].filter(x=>x.weight>1e-8).map(x=>({...x,weight:x.weight/total})):next;
}
/** Source-over alpha for an opaque weighted stack, in the given bottom-to-top order. */
export function sourceOverOpacities(weights:readonly number[]):number[] {
  let total=0;return weights.map(weight=>{const w=Number.isFinite(weight)?Math.max(0,weight):0;total+=w;return total>0?w/total:0;});
}
/** Latest request wins, even if old image load/decode callbacks resolve late. */
export function createSolarStackLoader(load:(src:string)=>Promise<HTMLImageElement>) {
  let generation=0,disposed=false;
  return {async request(scenes:readonly string[],base:string,onReady:(layers:LoadedSolarScene[])=>void,onError:()=>void){
    const ticket=++generation;
    try{const layers=await Promise.all([...new Set(scenes)].map(async scene=>{const src=`${base}/assets/backgrounds/${scene}.png`;return {scene,src,image:await load(src)};}));
      if(!disposed&&ticket===generation)onReady(layers);
    }catch{if(!disposed&&ticket===generation)onError();}
  },cancel(){generation++;},dispose(){disposed=true;generation++;}};
}
export function loadSolarImage(src:string):Promise<HTMLImageElement> {
  return new Promise((resolve,reject)=>{const image=new Image();image.decoding='async';
    image.onload=()=>{image.onload=null;image.onerror=null;const finish=()=>image.naturalWidth>0&&image.naturalHeight>0?resolve(image):reject(new Error('Empty wallpaper'));if(image.decode)image.decode().then(finish,finish);else finish();};
    image.onerror=()=>{image.onload=null;image.onerror=null;reject(new Error('Wallpaper load failed'));};image.src=src;
  });
}
