import {memo} from 'react';
import type {ResolvedRunwayOperations} from './runwayOperations';
import {RUNWAY_AIRCRAFT_BODY,runwayAircraftGroups,runwayAircraftSignature,runwayAircraftStatic,runwayAircraftTracks} from './runwayAircraft';

/** One transport silhouette, including engine pods, for every end and operation. */
function Aircraft(){return <g className="runway-aircraft-symbol">
 <path className="runway-aircraft-body" d={RUNWAY_AIRCRAFT_BODY}/>
 <path className="runway-aircraft-engines" d="M4.9 -1.8 H4.95 Q5.75 -1.8 5.75 -.98 V1.88 Q5.75 2.7 4.95 2.7 H4.9 Q4.1 2.7 4.1 1.88 V-.98 Q4.1 -1.8 4.9 -1.8 Z M7.4 -.2 H7.45 Q8.15 -.2 8.15 .5 V3.6 Q8.15 4.3 7.45 4.3 H7.4 Q6.7 4.3 6.7 3.6 V.5 Q6.7 -.2 7.4 -.2 Z M-4.9 -1.8 H-4.95 Q-5.75 -1.8 -5.75 -.98 V1.88 Q-5.75 2.7 -4.95 2.7 H-4.9 Q-4.1 2.7 -4.1 1.88 V-.98 Q-4.1 -1.8 -4.9 -1.8 Z M-7.4 -.2 H-7.45 Q-8.15 -.2 -8.15 .5 V3.6 Q-8.15 4.3 -7.45 4.3 H-7.4 Q-6.7 4.3 -6.7 3.6 V.5 Q-6.7 -.2 -7.4 -.2 Z"/>
 </g>;}
function RunwayAircraft({operations}:{operations:ResolvedRunwayOperations}){
 const groups=runwayAircraftGroups(operations);if(!groups.length)return null;
 const signature=runwayAircraftSignature(operations);
 return <g className="runway-aircraft" aria-hidden="true" data-aircraft-config={signature}>
  <g key={signature} className="runway-aircraft-motion">
   {groups.flatMap((group,slot)=>group.ends.map(end=>{
    const tracks=runwayAircraftTracks(end,group.operation,slot,groups.length),{initial,duration}=tracks;
    const shared={dur:duration,repeatCount:'indefinite',calcMode:'linear' as const};
    return <g key={`${group.operation}-${end}`} data-aircraft-operation={group.operation} data-aircraft-end={end} opacity="0">
     <animate attributeName="opacity" {...shared} {...tracks.opacity}/>
     <g transform={`translate(${initial.x} ${initial.y})`}>
      <animateTransform attributeName="transform" type="translate" {...shared} {...tracks.translate}/>
      <g transform={`rotate(${initial.angle})`}>
       <animateTransform attributeName="transform" type="rotate" {...shared} {...tracks.rotate}/>
       <g transform={`scale(${initial.scale})`}>
        <animateTransform attributeName="transform" type="scale" {...shared} {...tracks.scale}/>
        <Aircraft/>
       </g>
      </g>
     </g>
    </g>;
   }))}
  </g>
  <g className="runway-aircraft-static">
   {runwayAircraftStatic(operations).map(({end,operation,pose})=><g key={`${operation}-${end}`} data-static-aircraft-end={end} transform={`translate(${pose.x} ${pose.y}) rotate(${pose.angle}) scale(${pose.scale})`}><Aircraft/></g>)}
  </g>
 </g>;
}
// Clock ticks and ATIS age/letter changes must not rebuild or restart motion.
export default memo(RunwayAircraft,(before,after)=>runwayAircraftSignature(before.operations)===runwayAircraftSignature(after.operations));
