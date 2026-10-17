import type {ResolvedRunwayOperations} from './runwayOperations';

/** Age belongs to the ATIS observation, never the latest JSON download. */
export default function RunwayReportCue({operations}:{operations:ResolvedRunwayOperations}) {
  if(!operations.atisAvailable||!operations.atisObservedAt||operations.atisAgeMinutes===null)
    return <small className="runway-report-cue" data-last-known="true">ATIS UNAVAILABLE</small>;
  const minutes=Math.max(0,Math.floor(operations.atisAgeMinutes));
  const age=minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h ${minutes%60}m`:`${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h`;
  const observation=new Date(operations.atisObservedAt).toISOString();
  const identity=operations.atisLetter||`${observation.slice(11,13)}${observation.slice(14,16)}Z`;
  const state=operations.atisLastKnown?(minutes>90?' · STALE':' · LAST KNOWN'):'';
  return <small className="runway-report-cue" data-last-known={operations.atisLastKnown}
    title={`Latest valid ATIS report: ${observation}. Source: ${operations.atisSource||'ATIS'}. ${operations.atisLastKnown?'Last-known configuration; not a current operational clearance.':'Reported configuration; not an operational clearance.'} NOTAM closure freshness is evaluated separately.`}>
    ATIS {identity} · {age} ago{state}
  </small>;
}
