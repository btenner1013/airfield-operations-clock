import type {ResolvedRunwayOperations} from './runwayOperations';

/** Read the diagram's resolved state, never the raw feed or wind direction. */
export default function RunwayStatus({operations}:{operations:ResolvedRunwayOperations}) {
  const active=operations.runways.filter(runway=>runway.state==='active');
  const groups=[
    {label:'ARR',state:'active',values:active.flatMap(runway=>runway.arrivals)},
    {label:'DEP',state:'active',values:active.flatMap(runway=>runway.departures)},
    {label:'CLSD',state:'closed',values:operations.runways.filter(runway=>runway.state==='closed').map(runway=>runway.id)},
  ].filter(row=>row.values.length>0);
  if(!groups.length)return null;
  // Fixed SVG coordinates preserve the diagram's size and remain in its empty
  // lower-right area. Ordinary reports use one runway per line. Long reports
  // use two deliberate, top-to-bottom columns without reducing the type size.
  // Closed physical pairs always remain whole on their own line.
  const singleColumnHeight=groups.reduce((height,row)=>height+18+row.values.length*20,0)+(groups.length-1)*10;
  const rows=groups.map(row=>{
    const columns=singleColumnHeight>214&&row.state==='active'&&row.values.length>1?2:1;
    return {...row,columns,lineCount:Math.ceil(row.values.length/columns)};
  });
  const totalHeight=rows.reduce((height,row)=>height+18+row.lineCount*20,0)+(rows.length-1)*10;
  let y=174-totalHeight/2;
  return <svg className="runway-status" viewBox="20 0 300 280" role="img" aria-label={rows.map(row=>`${row.label} ${row.values.join(', ')}`).join('. ')}>
    {rows.map(row=>{
      const top=y;y+=18+row.lineCount*20+10;
      return <g key={row.label} className="runway-status-row" data-runway-status={row.label} data-state={row.state} data-columns={row.columns}>
        <text x="207" y={top} className="runway-status-label">{row.label}</text>
        {row.values.map((value,index)=><text key={value} x={207+Math.floor(index/row.lineCount)*57} y={top+20+(index%row.lineCount)*20} className="runway-status-value">{value}</text>)}
      </g>;
    })}
  </svg>;
}
