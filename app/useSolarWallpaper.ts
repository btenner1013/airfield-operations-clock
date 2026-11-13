"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {blendLoadedScenes,createSolarStackLoader,loadSolarImage,type LoadedSolarScene,type SolarSceneRequest,type WeightedSolarScene} from './solarWallpaper';
/** Decoding is keyed by source identities, never the once-per-second solar weights. */
export function useSolarWallpaper(requests:readonly SolarSceneRequest[],base:string,enabled:boolean,tick:number):WeightedSolarScene[] {
  const cache=useRef(new Map<string,Promise<HTMLImageElement>>());
  const loader=useMemo(()=>createSolarStackLoader(src=>{let entry=cache.current.get(src);if(!entry){entry=loadSolarImage(src).catch(error=>{cache.current.delete(src);throw error;});cache.current.set(src,entry);while(cache.current.size>6)cache.current.delete(cache.current.keys().next().value!);}return entry;}),[]);
  const [state,setState]=useState<{current:LoadedSolarScene[];previous:WeightedSolarScene[];requests:SolarSceneRequest[];key:string;started:number}>({current:[],previous:[],requests:[],key:"",started:0});
  const [retry,setRetry]=useState(0),[failed,setFailed]=useState(false);
  const active=useRef<{key:string;requests:readonly SolarSceneRequest[]}>({key:"",requests:[]});
  const completed=useRef<WeightedSolarScene[]>([]);
  const stateRef=useRef(state);stateRef.current=state;
  const requestsRef=useRef(requests);requestsRef.current=requests;
  const sceneKey=[...new Set(requests.map(x=>x.scene))].join('|');
  useEffect(()=>{
    if(!enabled){loader.cancel();return;}
    let cancelled=false,timer:number|undefined;setFailed(false);
    void loader.request(sceneKey.split('|'),base,current=>{
      const prior=stateRef.current;
      // Finish an in-flight weather fade before replacing it. Coalesce repeated
      // changes to the latest decoded stack; never accumulate 9+ source images.
      const delay=prior.previous.length?Math.max(0,prior.started+7000-performance.now()):0;
      const commit=()=>{if(cancelled)return;const previous=[...completed.current];setState({current,previous,requests:[...requestsRef.current],key:sceneKey,started:performance.now()});};
      if(delay>0)timer=window.setTimeout(commit,delay);else commit();
    },()=>{if(!cancelled)setFailed(true);});
    return()=>{cancelled=true;if(timer!==undefined)clearTimeout(timer);loader.cancel();};
  },[loader,sceneKey,base,enabled,retry]);
  useEffect(()=>{if(!failed||!enabled)return;const retryNow=()=>setRetry(x=>x+1),timer=window.setTimeout(retryNow,30000);window.addEventListener('online',retryNow);return()=>{clearTimeout(timer);window.removeEventListener('online',retryNow);};},[failed,enabled]);
  useEffect(()=>()=>{loader.cancel();cache.current.clear();},[loader]);
  const elapsed=typeof performance==='undefined'?0:performance.now()-state.started;
  // Clock ticks provide redraws; CSS eases each opacity step. No extra animation loop.
  void tick;
  const t=state.previous.length?Math.min(1,Math.max(0,elapsed/6000)):1;
  const smooth=t*t*(3-2*t);
  if(state.key===sceneKey)active.current={key:state.key,requests};
  else if(active.current.key!==state.key)active.current={key:state.key,requests:state.requests};
  const activeRequests=active.current.requests;
  completed.current=blendLoadedScenes(state.current,activeRequests,[],1);
  const result=enabled?blendLoadedScenes(state.current,activeRequests,state.previous,smooth):[];
  return result;
}
