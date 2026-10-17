import {RUNWAY_GEOMETRY,runwayArrow,type RunwayPoint} from './runwayGeometry';
import {resolveRunwayOperations,type RunwayOperationsSnapshot,type ResolvedRunwayOperations} from './runwayOperations';
const colors={active:'#62e5a6',closed:'#ff7179',unknown:'#87949e'};
function arrowPath(start:RunwayPoint,end:RunwayPoint) {
  const d=Math.hypot(end.x-start.x,end.y-start.y),ux=(end.x-start.x)/d,uy=(end.y-start.y)/d;
  return `M${start.x} ${start.y} L${end.x} ${end.y} M${end.x-ux*7-uy*4} ${end.y-uy*7+ux*4} L${end.x} ${end.y} L${end.x-ux*7+uy*4} ${end.y-uy*7-ux*4}`;
}
export default function RunwayDiagram({snapshot,nowMs,operations:resolved}:{snapshot:RunwayOperationsSnapshot|null|undefined;nowMs:number;operations?:ResolvedRunwayOperations}) {
  const operations=resolved??resolveRunwayOperations(snapshot??null,nowMs);
  const description=operations.runways.map(r=>`${r.id}: ${r.state==='closed'?'closed':r.state==='active'?'reported in use':'status unknown'}${r.arrivals.length?`; arrivals ${r.arrivals.join(', ')}`:''}${r.departures.length?`; departures ${r.departures.join(', ')}`:''}`).join('. ');
  return <svg className="runway-diagram" viewBox="20 0 300 280" role="img" aria-label={`KMEM runway operations. ${operations.atisLastKnown?"Last-known ATIS configuration. ":""}${description}. Schematic reference only.`} data-atis-current={operations.atisCurrent} data-notams-current={operations.notamsCurrent}>
    <title>KMEM runway operations</title><desc>{description}. Arrival arrows point toward the landing threshold; departure arrows point away from the opposite end. Gray means unknown or an unresolved closure conflict. ATIS colors describe the latest valid report, including when marked last known; they do not provide operational clearance.</desc>
    {RUNWAY_GEOMETRY.map(geometry=>{
      const state=operations.runways.find(r=>r.id===geometry.id)!;
      const [a,b]=geometry.points;const east=geometry.id==='18L/36R',cross=geometry.id==='09/27';
      const color=colors[state.state],x=(a.x+b.x)/2,y=(a.y+b.y)/2;
      return <g key={geometry.id} data-runway={geometry.id} data-state={state.state}>
        <path d={`M${a.x} ${a.y} L${b.x} ${b.y}`} className="runway-outline" />
        <path d={`M${a.x} ${a.y} L${b.x} ${b.y}`} stroke={color} className="runway-strip" />
        {geometry.points.map((p,i)=><text key={geometry.ends[i]} x={p.x+(cross?0:east?9:-9)} y={p.y+(cross?-10:4)} textAnchor={cross?'middle':east?'start':'end'}>{geometry.ends[i]}</text>)}
        {state.state==='closed'&&<g className="runway-closure" aria-label={`${geometry.id} closed`}><path d={`M${x-7} ${y-8} L${x+7} ${y+8} M${x+7} ${y-8} L${x-7} ${y+8}`} stroke="#ffe3e5" strokeWidth="7"/><path d={`M${x-7} ${y-8} L${x+7} ${y+8} M${x+7} ${y-8} L${x-7} ${y+8}`} stroke="#ad0928" strokeWidth="5"/></g>}
        {(['arrival','departure'] as const).flatMap(operation=>(operation==='arrival'?state.arrivals:state.departures).map(end=>{
          const arrow=runwayArrow(geometry,end,operation);if(!arrow)return null;const path=arrowPath(arrow.start,arrow.end);
          return <g key={`${operation}-${end}`} data-operation={operation} data-end={end} aria-label={`${operation} runway ${end}`}><path d={path} className="runway-arrow-outline"/><path d={path} stroke={operation==='arrival'?'#9fe8ff':'#ffd489'} className="runway-arrow"/></g>;
        }))}
      </g>;
    })}
  </svg>;
}
