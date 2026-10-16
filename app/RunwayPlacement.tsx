"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import RunwayDiagram from './RunwayDiagram';
import RunwayStatus from './RunwayStatus';
import {runwayPanelWidth,runwayPlacementHeight} from './runwayGeometry';
import {resolveRunwayOperations,type RunwayOperationsSnapshot} from './runwayOperations';

export default function RunwayPlacement(props:{snapshot:RunwayOperationsSnapshot|null|undefined;nowMs:number}) {
  const ref=useRef<HTMLDivElement>(null),[size,setSize]=useState({height:0,width:0});
  const {height,width}=size;
  const operations=resolveRunwayOperations(props.snapshot,props.nowMs);
  useLayoutEffect(()=>{
    const host=ref.current,header=host?.parentElement,board=header?.parentElement;
    if(!host||!header||!board)return;
    const brand=header.querySelector<HTMLElement>('.brand');
    const clocks=board.querySelector<HTMLElement>('.clocks');
    const heads=[...board.querySelectorAll<HTMLElement>('.clock-head')];
    const measure=()=>{
      const bounds=header.getBoundingClientRect();
      const narrow=window.matchMedia('(max-width:720px), (orientation:portrait)').matches;
      const brandRight=brand?.getBoundingClientRect().right??bounds.right;
      const availableWidth=Math.max(0,narrow?bounds.width-16:bounds.right-brandRight-24);
      const height=narrow?Math.min(240,bounds.width*.7*280/300,availableWidth*280/300):runwayPlacementHeight(bounds.top,Math.min(...heads.map(head=>head.getBoundingClientRect().top)),bounds.right,brandRight);
      const width=runwayPanelWidth(height,availableWidth);
      setSize(previous=>previous.height===height&&previous.width===width?previous:{height,width});
    };
    measure();const observer=new ResizeObserver(measure);
    [header,brand,clocks,...heads].forEach(el=>{if(el)observer.observe(el);});
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  return <div ref={ref} className="runway-placement" style={{height,width}} data-ready={height>0}>
    <div className="runway-graphic" style={{height,width:height*300/280}}>
      <RunwayDiagram {...props} operations={operations}/>
    </div>
    <div className="runway-status-placement" style={{height,width:height*300/280}}>
      <RunwayStatus operations={operations}/>
    </div>
  </div>;
}
