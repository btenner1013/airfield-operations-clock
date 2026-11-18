"use client";
import { useEffect, useRef, useState } from "react";
import type { CurrentWindRecord } from "./currentWind";
import { buildWindCompassModel } from "./windCompass";
import { sockMesh } from "./windsockMesh.mjs";

/** North-up illustrative projection, not calibrated to the background photograph. */
export default function SceneryWindsock({wind, nowMs, reduced}: {wind: CurrentWindRecord|null; nowMs:number; reduced:boolean}) {
  const svgRef=useRef<SVGSVGElement>(null);
  const [topPosition,setTopPosition]=useState<number|null>(null);
  useEffect(()=>{
    const svg=svgRef.current,main=svg?.closest("main"),info=main?.querySelector(".info"),clocks=main?.querySelector(".clocks");
    if(!svg||!main||!info||!clocks)return;
    const update=()=>{
      const box=svg.getBoundingClientRect(), scale=Math.min(box.width/76,box.height/70);
      const baseY=(box.height-70*scale)/2+62.5*scale;
      setTopPosition(info.getBoundingClientRect().top-main.getBoundingClientRect().top-baseY-6);
    };
    const observer=new ResizeObserver(update);[main,info,clocks,svg].forEach(el=>observer.observe(el));
    window.addEventListener("resize",update);update();
    return()=>{observer.disconnect();window.removeEventListener("resize",update);};
  },[]);
  const model=buildWindCompassModel(wind,nowMs);
  const animate=!reduced && model.state==='directional' && Number(model.speed)>0;
  const [phase,setPhase]=useState(0);
  useEffect(()=>{
    if(!animate) return;
    let timer:ReturnType<typeof setInterval>|undefined;
    const sync=()=>{if(timer)clearInterval(timer);timer=undefined;if(!document.hidden)timer=setInterval(()=>setPhase(performance.now()/1000),50);};
    sync();document.addEventListener('visibilitychange',sync);
    return()=>{if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',sync);};
  },[animate]);
  const drawable=model.state==='directional'||model.state==='calm';
  const mesh=sockMesh(model.state==='directional'?model.bearing??0:270,model.state==='directional'?Number(model.speed):0,animate?phase:0);
  const label=`Windsock. ${model.description.replace("The arrow shows airflow", "The fabric trails")} Illustrative north-up perspective, not calibrated to the runway photograph. Fabric motion is illustrative, not a wind-speed gauge.`;
  return <svg ref={svgRef} style={topPosition===null?{visibility:"hidden"}:{top:topPosition}} className="scenery-windsock" viewBox="15 120 76 70" role="img" aria-label={label} data-state={model.state} data-motion={animate?'flutter':'still'}>
    <title>{label}</title>
    <ellipse cx="52" cy="181" rx="4" ry="1.5" fill="#879ba5"/>
    <path d="M52 181 V143" stroke="#b9d5dd" strokeWidth="1.6"/>
    <path d="M51.7 180 V143" stroke="#f0f8fa" strokeWidth=".5"/>
    {drawable ? <g>{mesh.faces.map((face,index)=><polygon key={index} points={face.points} fill={face.fill}/>)}
      <polygon points={mesh.mouth} fill={mesh.dy<-.55?'#68351d':'none'} stroke="#e3edf2" strokeWidth=".7"/>
      <polygon points={mesh.basket} fill="none" stroke="#c9d4dc88" strokeWidth=".35"/>
      {mesh.dy>.55&&<polygon points={mesh.tailRing} fill="#743b22" stroke="#ffc594" strokeWidth=".6"/>}
    </g>:<g><circle cx="52" cy="143" r="4.5" fill="#17252c" stroke="#b9d5dd" strokeWidth=".6"/><text x="52" y="144.5" textAnchor="middle" fill="#eef6f7" fontSize="3.5">{model.state==='variable'?'VRB':model.state==='stale'?'OLD':'—'}</text></g>}
  </svg>;
}
