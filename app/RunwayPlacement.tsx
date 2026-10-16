"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import RunwayDiagram from './RunwayDiagram';
import {runwayPlacementHeight} from './runwayGeometry';
import type {RunwayOperationsSnapshot} from './runwayOperations';

export default function RunwayPlacement(props:{snapshot:RunwayOperationsSnapshot|null|undefined;nowMs:number}) {
  const ref=useRef<HTMLDivElement>(null),[height,setHeight]=useState(0);
  useLayoutEffect(()=>{
    const host=ref.current,header=host?.parentElement,board=header?.parentElement;
    if(!host||!header||!board)return;
    const brand=header.querySelector<HTMLElement>('.brand');
    const clocks=board.querySelector<HTMLElement>('.clocks');
    const heads=[...board.querySelectorAll<HTMLElement>('.clock-head')];
    const measure=()=>{
      const bounds=header.getBoundingClientRect();
      const narrow=window.matchMedia('(max-width:720px), (orientation:portrait)').matches;
      setHeight(narrow?Math.min(240,bounds.width*.7*280/300):runwayPlacementHeight(bounds.top,Math.min(...heads.map(head=>head.getBoundingClientRect().top)),bounds.right,brand?.getBoundingClientRect().right??bounds.right));
    };
    measure();const observer=new ResizeObserver(measure);
    [header,brand,clocks,...heads].forEach(el=>{if(el)observer.observe(el);});
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  return <div ref={ref} className="runway-placement" style={{height,width:height*300/280}} data-ready={height>0}>
    <RunwayDiagram {...props}/>
  </div>;
}
