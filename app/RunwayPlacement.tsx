"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import RunwayDiagram from './RunwayDiagram';
import {runwayPlacementHeight} from './runwayGeometry';
import type {RunwayOperationsSnapshot} from './runwayOperations';

export default function RunwayPlacement(props:{snapshot:RunwayOperationsSnapshot|null|undefined;nowMs:number}) {
  const ref=useRef<HTMLDivElement>(null),[height,setHeight]=useState(0);
  useLayoutEffect(()=>{
    const host=ref.current,section=host?.parentElement;if(!host||!section)return;
    const feet=[...section.querySelectorAll<HTMLElement>('.clock-foot')];
    const measure=()=>{
      const bounds=section.getBoundingClientRect();
      const bottom=Math.max(...feet.map(foot=>foot.getBoundingClientRect().bottom));
      setHeight(runwayPlacementHeight(bounds.bottom,bottom,bounds.width));
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(section);
    feet.forEach(foot=>observer.observe(foot));
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  return <div ref={ref} className="runway-placement" style={{height,width:height*300/280}} data-ready={height>0}>
    <RunwayDiagram {...props}/>
  </div>;
}
