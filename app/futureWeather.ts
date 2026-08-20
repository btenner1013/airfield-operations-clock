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

/** An hourly PoP sample describes the hour that begins at its own valid time. */
export const HOURLY_PRECIPITATION_COVERAGE_MS=60*60*1000;

export function normalizePrecipitationProbability(value:unknown):number|null {
  return typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=100?Math.round(value):null;
}

export function formatPrecipitationDisplay(value:unknown):string {
  const probability=normalizePrecipitationProbability(value);
  return probability===null?"—% PRECIP":`${probability}% PRECIP`;
}

/** TAF probability groups are only ever PROB30 or PROB40. */
const TAF_PROBABILITIES=new Set([30,40]);

export function normalizeTafProbability(value:unknown):number|null {
  return typeof value==="number"&&TAF_PROBABILITIES.has(value)?value:null;
}

/**
 * A row states one probability: the one that belongs to the words printed beside it.
 * When a PROB group wins the row, its label came from the forecaster, so the forecaster's
 * own figure is shown in TAF form rather than a model PoP that answers a different
 * question and will disagree. Every other row falls back to the hourly model PoP.
 */
export function formatForecastProbability(tafProbability:unknown, modelProbability:unknown):string {
  const taf=normalizeTafProbability(tafProbability);
  return taf===null?formatPrecipitationDisplay(modelProbability):`PROB${taf}`;
}

function normalizeTime(value:string|number|Date|null|undefined):{iso:string;milliseconds:number}|null {
  if(value===null||value===undefined||value==="") return null;
  const milliseconds=value instanceof Date?value.getTime():typeof value==="number"?value:Date.parse(value);
  return Number.isFinite(milliseconds)?{iso:new Date(milliseconds).toISOString(),milliseconds}:null;
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
 * Matches hourly PoP to one Future Weather row. A row is a period, not an
 * instant: it stands from its own valid time until the next TAF transition, so
 * every hourly sample whose hour overlaps that period is eligible and the
 * highest probability wins — a 3-hour block reports the worst hour inside it
 * rather than only the hour it happens to start on.
 *
 * Overlap is strict: a sample is never borrowed from outside the period, so no
 * prior hour is carried forward. A sample with no usable probability still
 * qualifies (retaining provenance) but ranks below any real number. Remaining
 * ties resolve by valid time and then original source order. An empty or
 * unmatched period returns unavailable PoP rather than a fabricated zero.
 *
 * A missing or non-positive period end falls back to the single hour beginning
 * at `periodStart`, which is the most a lone timestamp can honestly claim.
 */
export function matchPeriodPrecipitation(
  periodStart:string|number|Date,
  periodEnd:string|number|Date|null|undefined,
  samples:readonly HourlyPrecipitationInput[],
  options:HourlyPrecipitationMatchOptions={},
):NormalizedPrecipitation {
  const start=normalizeTime(periodStart);
  if(!start) return unavailablePrecipitation();
  const suppliedEnd=normalizeTime(periodEnd);
  const endMs=suppliedEnd&&suppliedEnd.milliseconds>start.milliseconds
    ? suppliedEnd.milliseconds
    : start.milliseconds+HOURLY_PRECIPITATION_COVERAGE_MS;

  const candidates=samples.map((sample,index)=>{
    const valid=normalizeTime(sample.precipitationValidTime);
    if(!valid) return null;
    const overlaps=valid.milliseconds<endMs&&valid.milliseconds+HOURLY_PRECIPITATION_COVERAGE_MS>start.milliseconds;
    if(!overlaps) return null;
    return {sample,index,valid,probability:normalizePrecipitationProbability(sample.precipitationProbability)};
  }).filter((candidate):candidate is NonNullable<typeof candidate>=>candidate!==null)
    .sort((a,b)=>(b.probability??-1)-(a.probability??-1)||a.valid.milliseconds-b.valid.milliseconds||a.index-b.index);

  const matched=candidates[0];
  if(!matched) return unavailablePrecipitation();

  const fetched=normalizeTime(matched.sample.precipitationFetchedAt);
  const now=normalizeTime(options.now??Date.now());
  const age=fetched&&now?Math.max(0,Math.floor((now.milliseconds-fetched.milliseconds)/60000)):null;
  const source=(matched.sample.precipitationSource||"").trim()||null;
  return {
    precipitationProbability:matched.probability,
    precipitationSource:source,
    precipitationValidTime:matched.valid.iso,
    precipitationFetchedAt:fetched?.iso||null,
    precipitationAgeMinutes:age,
  };
}
