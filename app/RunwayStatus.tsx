import type {ResolvedRunwayOperations} from './runwayOperations';

function wrapValues(values:readonly string[]):string[] {
  return values.reduce<string[]>((lines,value)=>{
    const last=lines.length-1;
    if(last>=0&&`${lines[last]} ${value}`.length<=13)lines[last]+=` ${value}`;
    else lines.push(value);
    return lines;
  },[]);
}

/** Read the diagram's resolved state, never the raw feed or wind direction. */
export default function RunwayStatus({operations}:{operations:ResolvedRunwayOperations}) {
  const active=operations.runways.filter(runway=>runway.state==='active');
  const rows=[
    {label:'ARR',state:'active',values:active.flatMap(runway=>runway.arrivals)},
    {label:'DEP',state:'active',values:active.flatMap(runway=>runway.departures)},
    {label:'CLSD',state:'closed',values:operations.runways.filter(runway=>runway.state==='closed').map(runway=>runway.id)},
  ].filter(row=>row.values.length>0).map(row=>({...row,lines:wrapValues(row.values)}));
  if(!rows.length)return null;
  // Fixed SVG coordinates preserve the diagram's size and remain in its empty
  // lower-right area. Whole runway ends/pairs wrap together, never mid-number.
  const totalHeight=rows.reduce((height,row)=>height+13+row.lines.length*16,0)+(rows.length-1)*8;
  let y=174-totalHeight/2;
  return <svg className="runway-status" viewBox="20 0 300 280" role="img" aria-label={rows.map(row=>`${row.label} ${row.values.join(', ')}`).join('. ')}>
    {rows.map(row=>{
      const top=y;y+=13+row.lines.length*16+8;
      return <g key={row.label} className="runway-status-row" data-runway-status={row.label} data-state={row.state}>
        <text x="207" y={top} className="runway-status-label">{row.label}</text>
        {row.lines.map((line,index)=><text key={line} x="207" y={top+16+index*16} className="runway-status-value">{line}</text>)}
      </g>;
    })}
  </svg>;
}
