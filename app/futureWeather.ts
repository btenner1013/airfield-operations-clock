export type FutureSkyCoverage = "FEW" | "SCT" | "BKN" | "OVC" | "VV" | "SKC" | "CLR" | "NSC" | "NCD";

export type FutureSkyLayerInput = {
  coverage:string;
  cloudBaseFt?:number|null;
  baseFt?:number|null;
};

export type FutureSkyInput = {
  skyCondition?:string|null;
  skyCoverage?:string|null;
  cloudCoverage?:string|null;
  cloudBaseFt?:number|null;
  layers?:readonly FutureSkyLayerInput[];
  cloudLayers?:readonly FutureSkyLayerInput[];
};

export type FutureSkyDisplay = {
  headline:string;
  detail:string;
  coverage:FutureSkyCoverage|null;
  cloudBaseFt:number|null;
  ceilingFt:number|null;
  ceilingUnlimited:boolean;
};

type NormalizedLayer = {
  coverage:"FEW"|"SCT"|"BKN"|"OVC"|"VV";
  cloudBaseFt:number|null;
  order:number;
};

const LAYER_COVERAGE = new Set<FutureSkyCoverage>(["FEW","SCT","BKN","OVC","VV"]);
const CLEAR_COVERAGE = new Set<FutureSkyCoverage>(["SKC","CLR","NSC","NCD"]);
const CEILING_COVERAGE = new Set<FutureSkyCoverage>(["BKN","OVC","VV"]);
const COVERAGE_PRIORITY:Record<NormalizedLayer["coverage"],number>={FEW:1,SCT:2,BKN:3,OVC:4,VV:5};

function normalizedCoverage(value:string|null|undefined):FutureSkyCoverage|null {
  const normalized=(value||"").trim().toUpperCase();
  return LAYER_COVERAGE.has(normalized as FutureSkyCoverage)||CLEAR_COVERAGE.has(normalized as FutureSkyCoverage)
    ? normalized as FutureSkyCoverage
    : null;
}

function normalizedAltitude(value:number|null|undefined):number|null {
  return typeof value==="number"&&Number.isFinite(value)&&value>=0?Math.round(value):null;
}

function formatAltitude(value:number):string {
  return value.toLocaleString("en-US");
}

function layerHeadline(coverage:NormalizedLayer["coverage"]):string {
  if(coverage==="FEW") return "FEW CLOUDS";
  if(coverage==="SCT") return "SCATTERED CLOUDS";
  if(coverage==="BKN") return "BROKEN CEILING";
  if(coverage==="OVC") return "OVERCAST CEILING";
  return "INDEFINITE CEILING";
}

function layerDetail(layer:NormalizedLayer):string {
  const {coverage,cloudBaseFt}=layer;
  if(CEILING_COVERAGE.has(coverage)) return cloudBaseFt===null?"CIG HEIGHT UNAVAILABLE":`CIG ${formatAltitude(cloudBaseFt)} FT`;
  return cloudBaseFt===null?`${coverage} CLDS HEIGHT UNAVAILABLE`:`${coverage} CLDS ${formatAltitude(cloudBaseFt)} FT`;
}

function compareLayers(a:NormalizedLayer,b:NormalizedLayer):number {
  const altitude=(a.cloudBaseFt??Infinity)-(b.cloudBaseFt??Infinity);
  return altitude||COVERAGE_PRIORITY[b.coverage]-COVERAGE_PRIORITY[a.coverage]||a.order-b.order;
}

/**
 * Produces all sky text and ceiling semantics from one forecast-sky input.
 * Clear codes deliberately discard an accompanying numeric base: SKC/CLR/NSC
 * never describe a cloud layer. When layers are supplied, the lowest measured
 * BKN/OVC/VV layer is authoritative for the ceiling.
 */
export function normalizeFutureSkyDisplay(input:FutureSkyInput):FutureSkyDisplay {
  const primaryCoverage=normalizedCoverage(input.skyCoverage??input.cloudCoverage??input.skyCondition);
  const rawLayers:FutureSkyLayerInput[]=[...(input.layers||[]),...(input.cloudLayers||[])];
  if(primaryCoverage&&LAYER_COVERAGE.has(primaryCoverage)) {
    rawLayers.push({coverage:primaryCoverage,cloudBaseFt:input.cloudBaseFt??null});
  }

  const layers=rawLayers.map((layer,order)=>{
    const coverage=normalizedCoverage(layer.coverage);
    if(!coverage||!LAYER_COVERAGE.has(coverage)) return null;
    return {coverage:coverage as NormalizedLayer["coverage"],cloudBaseFt:normalizedAltitude(layer.cloudBaseFt??layer.baseFt),order};
  }).filter((layer):layer is NormalizedLayer=>layer!==null);

  const ceilings=layers.filter(layer=>CEILING_COVERAGE.has(layer.coverage)).sort(compareLayers);
  const nonCeilings=layers.filter(layer=>!CEILING_COVERAGE.has(layer.coverage)).sort((a,b)=>
    COVERAGE_PRIORITY[b.coverage]-COVERAGE_PRIORITY[a.coverage]||compareLayers(a,b)
  );
  const displayed=ceilings[0]||nonCeilings[0]||null;

  if(displayed) {
    const isCeiling=CEILING_COVERAGE.has(displayed.coverage);
    return {
      headline:layerHeadline(displayed.coverage),
      detail:layerDetail(displayed),
      coverage:displayed.coverage,
      cloudBaseFt:displayed.cloudBaseFt,
      ceilingFt:isCeiling?displayed.cloudBaseFt:null,
      ceilingUnlimited:!isCeiling,
    };
  }

  if(primaryCoverage&&CLEAR_COVERAGE.has(primaryCoverage)) {
    return {
      headline:primaryCoverage==="NSC"?"NO SIGNIFICANT CLOUDS":"CLEAR",
      detail:"CEILING UNLIMITED",
      coverage:primaryCoverage,
      cloudBaseFt:null,
      ceilingFt:null,
      ceilingUnlimited:true,
    };
  }

  return {
    headline:"WEATHER UNAVAILABLE",
    detail:"SKY DATA UNAVAILABLE",
    coverage:null,
    cloudBaseFt:null,
    ceilingFt:null,
    ceilingUnlimited:false,
  };
}

export type HourlyPrecipitationInput = {
  precipitationProbability:unknown;
  precipitationSource?:string|null;
  precipitationValidTime:string|number|Date|null;
  precipitationFetchedAt?:string|number|Date|null;
};

export type NormalizedPrecipitation = {
  precipitationProbability:number|null;
  precipitationSource:string|null;
  precipitationValidTime:string|null;
  precipitationFetchedAt:string|null;
  precipitationAgeMinutes:number|null;
};

export type HourlyPrecipitationMatchOptions = {
  now?:string|number|Date;
};

/** Matching never crosses a UTC-hour boundary; the strict distance limit is one hour. */
export const HOURLY_PRECIPITATION_TOLERANCE_MS=60*60*1000;

export function normalizePrecipitationProbability(value:unknown):number|null {
  return typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=100?Math.round(value):null;
}

export function formatPrecipitationDisplay(value:unknown):string {
  const probability=normalizePrecipitationProbability(value);
  return probability===null?"—% PRECIP":`${probability}% PRECIP`;
}

function normalizeTime(value:string|number|Date|null|undefined):{iso:string;milliseconds:number}|null {
  if(value===null||value===undefined||value==="") return null;
  const milliseconds=value instanceof Date?value.getTime():typeof value==="number"?value:Date.parse(value);
  return Number.isFinite(milliseconds)?{iso:new Date(milliseconds).toISOString(),milliseconds}:null;
}

function utcHourStart(milliseconds:number):number {
  const date=new Date(milliseconds);
  return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),date.getUTCHours());
}

function unavailablePrecipitation():NormalizedPrecipitation {
  return {
    precipitationProbability:null,
    precipitationSource:null,
    precipitationValidTime:null,
    precipitationFetchedAt:null,
    precipitationAgeMinutes:null,
  };
}

/**
 * Matches an hourly PoP to a Future Weather row. Candidates must be in the
 * target's same UTC calendar hour and less than one hour away; consequently a
 * closer sample from an adjacent hour is never selected. Ties resolve by valid
 * time and then original source order. No match returns nullable/unavailable
 * PoP rather than carrying a prior hour forward.
 */
export function matchHourlyPrecipitation(
  targetValidTime:string|number|Date,
  samples:readonly HourlyPrecipitationInput[],
  options:HourlyPrecipitationMatchOptions={},
):NormalizedPrecipitation {
  const target=normalizeTime(targetValidTime);
  if(!target) return unavailablePrecipitation();
  const targetHour=utcHourStart(target.milliseconds);

  const candidates=samples.map((sample,index)=>{
    const valid=normalizeTime(sample.precipitationValidTime);
    if(!valid) return null;
    const distance=Math.abs(valid.milliseconds-target.milliseconds);
    if(utcHourStart(valid.milliseconds)!==targetHour||distance>=HOURLY_PRECIPITATION_TOLERANCE_MS) return null;
    return {sample,index,valid,distance};
  }).filter((candidate):candidate is NonNullable<typeof candidate>=>candidate!==null)
    .sort((a,b)=>a.distance-b.distance||a.valid.milliseconds-b.valid.milliseconds||a.index-b.index);

  const matched=candidates[0];
  if(!matched) return unavailablePrecipitation();

  const fetched=normalizeTime(matched.sample.precipitationFetchedAt);
  const now=normalizeTime(options.now??Date.now());
  const age=fetched&&now?Math.max(0,Math.floor((now.milliseconds-fetched.milliseconds)/60000)):null;
  const source=(matched.sample.precipitationSource||"").trim()||null;
  return {
    precipitationProbability:normalizePrecipitationProbability(matched.sample.precipitationProbability),
    precipitationSource:source,
    precipitationValidTime:matched.valid.iso,
    precipitationFetchedAt:fetched?.iso||null,
    precipitationAgeMinutes:age,
  };
}
