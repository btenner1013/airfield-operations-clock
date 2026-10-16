import type { CloudCoverage } from './weatherTypes';
import type { CloudLayer } from './aviationWeatherPriority';

/** Visual sky cover includes upper decks; the lowest ceiling remains operational. */
export function visualCloudCoverage(coverage:CloudCoverage,layers:readonly CloudLayer[]=[]):CloudCoverage {
  const rank:Record<CloudCoverage,number>={CLR:0,FEW:1,SCT:2,BKN:3,OVC:4,VV:5};
  return layers.reduce((result,layer)=>rank[layer.coverage]>rank[result]?layer.coverage:result,coverage);
}

export function getFlightCategory(visSm:number|null,baseFt:number|null,coverage:string|null,available=true) {
  const unknown={cat:'UNAVAILABLE',color:'#94a3b8',label:'FLIGHT CATEGORY UNAVAILABLE'} as const;
  if(!available||visSm===null||!Number.isFinite(visSm)||!coverage) return unknown;
  const ceiling=['BKN','OVC','VV'].includes(coverage);
  if(ceiling&&(baseFt===null||!Number.isFinite(baseFt))) return unknown;
  const cig=ceiling?baseFt!:Infinity;
  if(cig<500||visSm<1) return {cat:'LIFR',color:'#c084fc',label:'LOW IFR'} as const;
  if(cig<1000||visSm<3) return {cat:'IFR',color:'#f87171',label:'IFR'} as const;
  if(cig<=3000||visSm<=5) return {cat:'MVFR',color:'#60a5fa',label:'MARGINAL VFR'} as const;
  return {cat:'VFR',color:'#4ade80',label:'VFR'} as const;
}
