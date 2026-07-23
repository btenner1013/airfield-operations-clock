import type { CloudCoverage, Forecast, Theme } from "./weatherTypes";

export type WeatherSourceKind = "METAR"|"TAF_BASE"|"TAF_FM"|"TAF_TEMPO"|"TAF_PROB30"|"TAF_PROB40"|"TAF_PROB30_TEMPO"|"TAF_PROB40_TEMPO"|"MODEL";
export type WeatherCategory = "severe-convection"|"thunderstorm"|"freezing-precipitation"|"winter-precipitation"|"liquid-precipitation"|"obscuration"|"cloud"|"clear"|"unknown";
export type OperationalWeather = {
  code:string|null; codes:string[]; category:WeatherCategory; condition:Theme; label:string; shortLabel:string;
  secondaryLabel?:string|null;
  intensity:"light"|"moderate"|"heavy"|null; vicinity:boolean; temporary:boolean; probability:number|null;
  visibilitySm:number|null; cloudCoverage:CloudCoverage|null; cloudBaseFt:number|null; cloudSummary:string|null; sourceKind:WeatherSourceKind;
};
export type TafTimelinePeriod = { id:string; fromIso:string; toIso:string; raw:string; weather:OperationalWeather };
export type TafTimeline = { issueIso:string; validStartIso:string; validEndIso:string; prevailing:TafTimelinePeriod[]; overlays:TafTimelinePeriod[] };
export type TafHazard = { id:string; fromIso:string; toIso:string; weather:OperationalWeather };

const CATEGORY_RANK:Record<WeatherCategory,number>={"severe-convection":900,thunderstorm:800,"freezing-precipitation":700,"winter-precipitation":600,"liquid-precipitation":500,obscuration:400,cloud:200,clear:100,unknown:0};
const COVERAGE_RANK:Record<CloudCoverage,number>={CLR:0,FEW:1,SCT:2,BKN:3,OVC:4,VV:5};
const WX_TOKEN=/^(?:[+-]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|DS|SS)){1,3}$/;

export function extractAviationPhenomena(text:string):string[] {
  const core=(text||"").toUpperCase().split(/\sRMK\s/)[0], found:string[]=[];
  for(const token of core.split(/\s+/).map(t=>t.replace(/[.,]$/,""))) if(token!=="NSW"&&(WX_TOKEN.test(token)||/^(?:VC)?(?:TS|SH)$/.test(token))) found.push(token);
  return [...new Set(found)];
}

export function parseAviationSky(text:string):{cloudCoverage:CloudCoverage|null;cloudBaseFt:number|null;visibilitySm:number|null;cloudSummary:string|null} {
  const core=(text||"").toUpperCase().split(/\sRMK\s/)[0], layers:{coverage:CloudCoverage;base:number|null;summary:string}[]=[];
  const layer=/\b(FEW|SCT|BKN|OVC)(\d{3})(?:CB|TCU)?\b/g; let match:RegExpExecArray|null;
  while((match=layer.exec(core))) layers.push({coverage:match[1] as CloudCoverage,base:Number(match[2])*100,summary:match[0]});
  const vv=core.match(/\bVV(\d{3}|\/{3})\b/); if(vv) layers.push({coverage:"VV",base:vv[1]==="///"?null:Number(vv[1])*100,summary:vv[0]});
  const ceilings = layers.filter(l => ["BKN", "OVC", "VV"].includes(l.coverage));
  ceilings.sort((a,b) => (a.base??Infinity) - (b.base??Infinity));
  const nonCeilings = layers.filter(l => !["BKN", "OVC", "VV"].includes(l.coverage));
  nonCeilings.sort((a,b)=>COVERAGE_RANK[b.coverage]-COVERAGE_RANK[a.coverage]||(a.base??Infinity)-(b.base??Infinity));
  
  const clear=/\b(?:CLR|SKC|NSC|NCD|CAVOK)\b/.test(core), best=ceilings[0] || nonCeilings[0];
  const vis=core.match(/(?:^|\s)(P|M)?(?:(\d+)\s+)?(\d+)(?:\/(\d+))?SM(?:\s|$)/); let visibilitySm:number|null=null;
  if(vis){visibilitySm=vis[4]?(Number(vis[2]||0)+Number(vis[3])/Number(vis[4])):Number(vis[3]);if(vis[1]==="M") visibilitySm=Math.max(0,visibilitySm);}
  else if(/\bCAVOK\b/.test(core)) visibilitySm=10;
  return {cloudCoverage:best?.coverage||(clear?"CLR":null),cloudBaseFt:best?.base??null,visibilitySm,cloudSummary:best?.summary||(clear?"CLR":null)};
}

function categoryFor(code:string):WeatherCategory {
  const c=code.replace(/^[+-]/,"").replace(/^VC/,"");
  if(/TS/.test(c)) return "thunderstorm";
  if(/FC|SQ|GR|GS/.test(c)) return "severe-convection";
  if(/FZ(?:RA|DZ)/.test(c)) return "freezing-precipitation";
  if(/SN|SG|PL|IC/.test(c)) return "winter-precipitation";
  if(/RA|DZ|UP|SH/.test(c)) return "liquid-precipitation";
  if(/BR|FG|FU|VA|DU|SA|HZ|PY|PO|DS|SS/.test(c)) return "obscuration";
  return "unknown";
}

function intensityFor(code:string,category:WeatherCategory):"light"|"moderate"|"heavy"|null {
  if(!["severe-convection","thunderstorm","freezing-precipitation","winter-precipitation","liquid-precipitation"].includes(category)) return null;
  if(code.startsWith("VC")) return null;
  return code.startsWith("+")?"heavy":code.startsWith("-")?"light":"moderate";
}

function decodeSingleCode(token: string): { label: string; short: string } {
  const intensity = token.startsWith("+") ? "HEAVY" : token.startsWith("-") ? "LIGHT" : "";
  const clean = token.replace(/^[+-]/, "");
  
  if (clean === "FC") return { label: token.startsWith("+") ? "TORNADO" : "FUNNEL CLOUD", short: token.startsWith("+") ? "TORNADO" : "FUNNEL CLOUD" };
  if (clean === "SQ") return { label: "SQUALL", short: "SQUALL" };
  if (clean === "UP") return { label: "UNKNOWN PRECIPITATION", short: "UNKNOWN PRECIP" };
  if (clean === "TS") return { label: "THUNDERSTORMS", short: "TSTMS" };
  if (clean === "VCTS") return { label: "THUNDERSTORMS IN THE VICINITY", short: "VICINITY TSTMS" };
  if (clean.includes("TS")) {
    const hasHail = /GR/.test(clean);
    const hasSmallHail = /GS/.test(clean);
    const hasSnow = /SN/.test(clean);
    const hasRain = /RA/.test(clean);
    
    let base = "THUNDERSTORMS";
    let shortBase = "TSTMS";
    if (hasRain && hasHail) {
      base += " WITH RAIN AND HAIL";
      shortBase += " W/ RAIN & HAIL";
    } else if (hasRain) {
      base += " WITH RAIN";
      shortBase += " WITH RAIN";
    } else if (hasSnow) {
      base += " WITH SNOW";
      shortBase += " WITH SNOW";
    } else if (hasHail) {
      base += " WITH HAIL";
      shortBase += " WITH HAIL";
    } else if (hasSmallHail) {
      base += " WITH SMALL HAIL";
      shortBase += " W/ SMALL HAIL";
    }
    
    const fullLabel = intensity ? `${intensity} ${base}` : base;
    const shortLabel = intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} ${shortBase}` : shortBase;
    return { label: fullLabel, short: shortLabel };
  }
  
  if (clean === "VCSH") return { label: "SHOWERS IN THE VICINITY", short: "VICINITY SHOWERS" };
  if (clean === "SHRA") {
    return {
      label: intensity ? `${intensity} RAIN SHOWERS` : "RAIN SHOWERS",
      short: intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} RAIN SHOWERS` : "RAIN SHOWERS"
    };
  }
  if (clean === "SHSN") {
    return {
      label: intensity ? `${intensity} SNOW SHOWERS` : "SNOW SHOWERS",
      short: intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} SNOW SHOWERS` : "SNOW SHOWERS"
    };
  }
  
  if (clean === "FZRA") {
    return {
      label: intensity ? `${intensity} FREEZING RAIN` : "FREEZING RAIN",
      short: intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} FREEZING RAIN` : "FREEZING RAIN"
    };
  }
  if (clean === "FZDZ") return { label: "FREEZING DRIZZLE", short: "FREEZING DRIZZLE" };
  
  if (clean === "RA") {
    return {
      label: intensity ? `${intensity} RAIN` : "RAIN",
      short: intensity ? `${intensity} RAIN` : "RAIN"
    };
  }
  if (clean === "DZ") {
    return {
      label: intensity ? `${intensity} DRIZZLE` : "DRIZZLE",
      short: intensity ? `${intensity} DRIZZLE` : "DRIZZLE"
    };
  }
  
  if (clean === "SN") {
    return {
      label: intensity ? `${intensity} SNOW` : "SNOW",
      short: intensity ? `${intensity} SNOW` : "SNOW"
    };
  }
  if (clean === "BLSN") {
    return {
      label: intensity ? `${intensity} BLOWING SNOW` : "BLOWING SNOW",
      short: intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} BLOWING SNOW` : "BLOWING SNOW"
    };
  }
  if (clean === "DRSN") return { label: "DRIFTING SNOW", short: "DRIFTING SNOW" };
  if (clean === "SG") return { label: "SNOW GRAINS", short: "SNOW GRAINS" };
  if (clean === "IC") return { label: "ICE CRYSTALS", short: "ICE CRYSTALS" };
  if (clean === "PL") return { label: "ICE PELLETS", short: "ICE PELLETS" };
  if (clean === "GR") return { label: "HAIL", short: "HAIL" };
  if (clean === "GS") return { label: "SMALL HAIL", short: "SMALL HAIL" };
  
  if (clean === "RASN" || clean === "SNRA") return { label: "RAIN AND SNOW", short: "RAIN AND SNOW" };
  
  if (clean === "BR") return { label: "MIST", short: "MIST" };
  if (clean === "FG") return { label: "FOG", short: "FOG" };
  if (clean === "FZFG") return { label: "FREEZING FOG", short: "FREEZING FOG" };
  if (clean === "MIFG") return { label: "SHALLOW FOG", short: "SHALLOW FOG" };
  if (clean === "BCFG") return { label: "PATCHES OF FOG", short: "PATCHES OF FOG" };
  if (clean === "PRFG") return { label: "PARTIAL FOG", short: "PARTIAL FOG" };
  if (clean === "HZ") return { label: "HAZE", short: "HAZE" };
  if (clean === "FU") return { label: "SMOKE", short: "SMOKE" };
  if (clean === "DU") return { label: "DUST", short: "DUST" };
  if (clean === "BLDU") return { label: "BLOWING DUST", short: "BLOWING DUST" };
  if (clean === "DRDU") return { label: "DRIFTING DUST", short: "DRIFTING DUST" };
  if (clean === "SA") return { label: "SAND", short: "SAND" };
  if (clean === "BLSA") return { label: "BLOWING SAND", short: "BLOWING SAND" };
  if (clean === "DRSA") return { label: "DRIFTING SAND", short: "DRIFTING SAND" };
  if (clean === "DS") return { label: "DUST STORM", short: "DUST STORM" };
  if (clean === "SS") return { label: "SANDSTORM", short: "SANDSTORM" };
  if (clean === "VA") return { label: "VOLCANIC ASH", short: "VOLCANIC ASH" };
  
  return { label: token, short: token };
}

export function resolvePhenomenaLabels(codes: string[]): { label: string; shortLabel: string; secondaryLabel: string | null } {
  if (!codes || !codes.length) return { label: "CLEAR", shortLabel: "CLR", secondaryLabel: null };
  const upperCodes = codes.map(c => c.toUpperCase());
  
  const hasFzra = upperCodes.some(c => c.includes("FZRA"));
  const hasPl = upperCodes.some(c => c.includes("PL"));
  if (hasFzra && hasPl) {
    return { label: "FREEZING RAIN AND ICE PELLETS", shortLabel: "FZRA + ICE PELLETS", secondaryLabel: null };
  }
  
  const snToken = codes.find(c => c.toUpperCase().replace(/^[+-]/, "") === "SN");
  const hasBlsn = upperCodes.some(c => c === "BLSN");
  if (snToken && hasBlsn) {
    const intensity = snToken.startsWith("+") ? "HEAVY" : snToken.startsWith("-") ? "LIGHT" : "";
    const base = "SNOW AND BLOWING SNOW";
    const shortBase = "SNOW & BLOWING SNOW";
    return {
      label: intensity ? `${intensity} ${base}` : base,
      shortLabel: intensity ? `${intensity === "LIGHT" ? "LT" : "HVY"} ${shortBase}` : shortBase,
      secondaryLabel: null
    };
  }
  
  const hasRa = upperCodes.some(c => c.replace(/^[+-]/, "") === "RA");
  const hasSn = upperCodes.some(c => c.replace(/^[+-]/, "") === "SN");
  const hasRasn = upperCodes.some(c => c === "RASN" || c === "SNRA");
  if ((hasRa && hasSn) || hasRasn) {
    return { label: "RAIN AND SNOW", shortLabel: "RAIN AND SNOW", secondaryLabel: null };
  }
  
  const sorted = [...codes].sort((a,b)=>CATEGORY_RANK[categoryFor(b)]-CATEGORY_RANK[categoryFor(a)]||({heavy:3,moderate:2,light:1}[intensityFor(b,categoryFor(b))||"light"]-({heavy:3,moderate:2,light:1}[intensityFor(a,categoryFor(a))||"light"])));
  const primaryToken = sorted[0];
  const secondaryToken = sorted[1];
  const primary = decodeSingleCode(primaryToken);
  
  let secondaryLabel: string | null = null;
  if (secondaryToken) {
    const secDecoded = decodeSingleCode(secondaryToken);
    secondaryLabel = secDecoded.label;
  }
  
  return {
    label: primary.label,
    shortLabel: primary.short,
    secondaryLabel
  };
}

function cloudLabel(coverage:CloudCoverage|null, baseFt:number|null = null):string {
  if (!coverage) return "WEATHER UNAVAILABLE";
  const cov = coverage.toUpperCase();
  if (cov === "CLR" || cov === "SKC" || cov === "NSC" || cov === "NCD") return "CLEAR";
  if (cov === "FEW") return "FEW CLOUDS";
  if (cov === "SCT") return "SCATTERED CLOUDS";
  if (cov === "BKN" || cov === "OVC") {
    if (baseFt !== null && baseFt >= 12000) return "PARTLY CLOUDY";
    return cov === "BKN" ? "BROKEN CEILING" : "OVERCAST CEILING";
  }
  if (cov === "VV") return "INDEFINITE CEILING";
  return "WEATHER UNAVAILABLE";
}

export function resolveOperationalWeather(input:{text?:string;codes?:string[];visibilitySm?:number|null;cloudCoverage?:CloudCoverage|null;cloudBaseFt?:number|null;cloudSummary?:string|null;sourceKind:WeatherSourceKind;temporary?:boolean;probability?:number|null}):OperationalWeather {
  const sky=parseAviationSky(input.text||""), codes=input.codes||extractAviationPhenomena(input.text||"");
  const sorted=[...codes].sort((a,b)=>CATEGORY_RANK[categoryFor(b)]-CATEGORY_RANK[categoryFor(a)]||({heavy:3,moderate:2,light:1}[intensityFor(b,categoryFor(b))||"light"]-({heavy:3,moderate:2,light:1}[intensityFor(a,categoryFor(a))||"light"])));
  const code=sorted[0]||null, coverage=input.cloudCoverage??sky.cloudCoverage, base=input.cloudBaseFt??sky.cloudBaseFt, summary=input.cloudSummary??sky.cloudSummary, visibility=input.visibilitySm??sky.visibilitySm;
  
  if(code){
    const category=categoryFor(code);
    const res=resolvePhenomenaLabels(codes);
    const condition=category==="severe-convection"||category==="thunderstorm"?"thunderstorm":category==="freezing-precipitation"?code.startsWith("+")?"heavy-rain":"rain":category==="winter-precipitation"?"snow":category==="liquid-precipitation"?code.startsWith("+")?"heavy-rain":"rain":category==="obscuration"?"fog":"neutral";
    return {
      code,
      codes,
      category,
      condition,
      label: res.label,
      shortLabel: res.shortLabel,
      secondaryLabel: res.secondaryLabel,
      intensity: intensityFor(code,category),
      vicinity: code.startsWith("VC"),
      temporary: !!input.temporary,
      probability: input.probability??null,
      visibilitySm: visibility,
      cloudCoverage: coverage,
      cloudBaseFt: base,
      cloudSummary: summary,
      sourceKind: input.sourceKind
    };
  }
  
  const isHighCirrus = (coverage === "BKN" || coverage === "OVC") && base !== null && base >= 12000;
  const category:WeatherCategory=coverage==="CLR"?"clear":coverage?"cloud":"unknown";
  const condition:Theme=coverage==="CLR"?"clear":(coverage==="FEW"||coverage==="SCT"||isHighCirrus)?"partly-cloudy":coverage?"overcast":"neutral";
  const label=cloudLabel(coverage, base);
  
  return {
    code: null,
    codes: [],
    category,
    condition,
    label,
    shortLabel: summary||coverage||"WX",
    secondaryLabel: null,
    intensity: null,
    vicinity: false,
    temporary: !!input.temporary,
    probability: input.probability??null,
    visibilitySm: visibility,
    cloudCoverage: coverage,
    cloudBaseFt: base,
    cloudSummary: summary,
    sourceKind: input.sourceKind
  };
}

function score(weather:OperationalWeather):number { const intensity=weather.intensity==="heavy"?30:weather.intensity==="moderate"?20:weather.intensity==="light"?10:0;return CATEGORY_RANK[weather.category]+intensity+(weather.probability||0)/100; }
export function choosePrimaryOperationalWeather(values:OperationalWeather[]):OperationalWeather|null { return [...values].sort((a,b)=>score(b)-score(a))[0]||null; }

// Hazard-band eligibility is deliberately narrower than primary-condition selection. A valid
// phenomenon such as VCSH still outranks clouds in its forecast card without becoming an alert.
export function qualifiesForTafHazardBand(weather:OperationalWeather):boolean {
  const codes=weather.codes.length?weather.codes:weather.code?[weather.code]:[];
  const joined=codes.join(" ").toUpperCase();
  const visibility=weather.visibilitySm;
  const restrictiveVisibility=visibility!==null&&visibility<3;
  const restrictiveCeiling=weather.cloudBaseFt!==null&&weather.cloudBaseFt<1000&&["BKN","OVC","VV"].includes(weather.cloudCoverage||"");
  if(/(?:^|\s)(?:[+-]|VC)?(?:TS(?:RA|SN|GR|GS)?|FC|SQ|GR|GS|FZRA|FZDZ|(?:SH|BL|DR)?SN|PL|DS|SS|VA)(?:\s|$)/.test(joined)) return true;
  if(/(?:^|\s)\+(?:SH)?RA(?:\s|$)/.test(joined)) return true;
  if(/(?:^|\s)(?:-)?(?:SH)?RA(?:\s|$)/.test(joined)&&visibility!==null&&visibility<=5) return true;
  if(/(?:^|\s)(?:FZ)?(?:MI|BC|PR)?FG(?:\s|$)/.test(joined)) return true;
  if(/(?:^|\s)(?:BR|HZ|FU|(?:BL|DR)?DU|(?:BL|DR)?SA)(?:\s|$)/.test(joined)&&visibility!==null&&visibility<=3) return true;
  return restrictiveVisibility||restrictiveCeiling;
}

export type TafWindowLabels={full:string;compact:string};
export function formatTafWindow(fromIso:string,toIso:string,displayDate:Date):TafWindowLabels {
  const from=new Date(fromIso),to=new Date(toIso);
  if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||!Number.isFinite(displayDate.getTime())) return {full:"—",compact:"—"};
  const dateKey=(d:Date)=>`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const hour=(d:Date)=>`${String(d.getUTCHours()).padStart(2,"0")}${d.getUTCMinutes()?`:${String(d.getUTCMinutes()).padStart(2,"0")}`:""}`;
  const day=(d:Date)=>String(d.getUTCDate()).padStart(2,"0");
  const month=(d:Date)=>["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()];
  
  if (displayDate.getTime() >= from.getTime() && displayDate.getTime() < to.getTime()) {
    const range = `NOW–${hour(to)}Z`;
    return { full: range, compact: range };
  }

  if(dateKey(from)===dateKey(to)) {
    const range=`${hour(from)}–${hour(to)}Z`;
    return dateKey(from)===dateKey(displayDate)?{full:range,compact:range}:{full:`${day(from)} ${month(from)} · ${range}`,compact:`${day(from)}/${range}`};
  }
  return {full:`${day(from)} ${month(from)} ${hour(from)}Z – ${day(to)} ${month(to)} ${hour(to)}Z`,compact:`${day(from)}/${hour(from)}Z–${day(to)}/${hour(to)}Z`};
}

function dateCandidates(day:number,hour:number,minute:number,reference:Date):Date[] { const out:Date[]=[];if(day<1||day>31||hour<0||hour>24||minute<0||minute>59||hour===24&&minute!==0)return out;for(const offset of [-1,0,1,2]){const start=new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()+offset,1)),base=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),day));if(base.getUTCMonth()===start.getUTCMonth()&&base.getUTCDate()===day)out.push(new Date(base.getTime()+hour*3600000+minute*60000));}return out; }
function nearestDate(day:number,hour:number,minute:number,reference:Date):Date|null { return dateCandidates(day,hour,minute,reference).sort((a,b)=>Math.abs(a.getTime()-reference.getTime())-Math.abs(b.getTime()-reference.getTime()))[0]||null; }
function firstAfter(day:number,hour:number,minute:number,after:Date):Date|null { return dateCandidates(day,hour,minute,after).filter(d=>d>after).sort((a,b)=>a.getTime()-b.getTime())[0]||null; }
function resolveWithin(day:number,hour:number,minute:number,start:Date,end:Date):Date|null { return dateCandidates(day,hour,minute,start).filter(d=>d>=start&&d<end).sort((a,b)=>a.getTime()-b.getTime())[0]||null; }

function groupWeather(raw:string,sourceKind:WeatherSourceKind,temporary=false,probability:number|null=null):OperationalWeather { const sky=parseAviationSky(raw);return resolveOperationalWeather({text:raw,...sky,sourceKind,temporary,probability}); }
export function parseStructuredTaf(raw:string,reference:Date):TafTimeline|null {
  const taf=(raw||"").toUpperCase().replace(/\s+/g," ").trim(),issue=taf.match(/\bKMEM\s+(\d{2})(\d{2})(\d{2})Z\b/),validity=taf.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);if(!issue||!validity)return null;
  const issueDate=nearestDate(Number(issue[1]),Number(issue[2]),Number(issue[3]),reference),validStart=issueDate?nearestDate(Number(validity[1]),Number(validity[2]),0,issueDate):null,validEnd=validStart?firstAfter(Number(validity[3]),Number(validity[4]),0,validStart):null;if(!issueDate||!validStart||!validEnd||validEnd<=validStart||validEnd.getTime()-validStart.getTime()>72*3600000)return null;
  const markerRe=/\b(FM\d{6}|TEMPO\s+\d{4}\/\d{4}|PROB(?:30|40)(?:\s+TEMPO)?\s+\d{4}\/\d{4})\b/g,markers=[...taf.matchAll(markerRe)].filter(m=>(m.index??0)>(validity.index??0)+validity[0].length);
  const body=(index:number)=>taf.slice((markers[index].index??0)+markers[index][0].length,index+1<markers.length?(markers[index+1].index??taf.length):taf.length).trim(),contentStart=(validity.index??0)+validity[0].length;
  const fm=markers.map((m,i)=>({m,i,date:m[0].startsWith("FM")?resolveWithin(Number(m[0].slice(2,4)),Number(m[0].slice(4,6)),Number(m[0].slice(6,8)),validStart,validEnd):null})).filter(x=>x.date) as {m:RegExpMatchArray;i:number;date:Date}[];
  const prevailing:TafTimelinePeriod[]=[];const firstFm=fm[0]?.date||validEnd,baseRaw=taf.slice(contentStart,markers[0]?.index??taf.length).trim();
  const baseStart = issueDate && issueDate < validStart ? issueDate : validStart;
  if(baseStart<firstFm)prevailing.push({id:"base",fromIso:baseStart.toISOString(),toIso:firstFm.toISOString(),raw:baseRaw,weather:groupWeather(baseRaw,"TAF_BASE")});
  fm.forEach((entry,index)=>{const end=fm[index+1]?.date||validEnd;if(entry.date<end){const rawGroup=body(entry.i);prevailing.push({id:`fm-${entry.m[0]}`,fromIso:entry.date.toISOString(),toIso:end.toISOString(),raw:rawGroup,weather:groupWeather(rawGroup,"TAF_FM")});}});
  const overlays:TafTimelinePeriod[]=[];markers.forEach((m,index)=>{if(m[0].startsWith("FM"))return;const range=m[0].match(/(\d{2})(\d{2})\/(\d{2})(\d{2})/);if(!range)return;let start=resolveWithin(Number(range[1]),Number(range[2]),0,validStart,validEnd),end=start?firstAfter(Number(range[3]),Number(range[4]),0,start):null;if(!start||!end)return;start=new Date(Math.max(start.getTime(),validStart.getTime()));end=new Date(Math.min(end.getTime(),validEnd.getTime()));if(start>=end)return;const probability=m[0].startsWith("PROB")?Number(m[0].slice(4,6)):null,temporary=m[0].includes("TEMPO"),sourceKind:WeatherSourceKind=probability===30&&temporary?"TAF_PROB30_TEMPO":probability===40&&temporary?"TAF_PROB40_TEMPO":probability===30?"TAF_PROB30":probability===40?"TAF_PROB40":"TAF_TEMPO",rawGroup=body(index);overlays.push({id:`${m[0].replace(/\s+/g,"-")}-${index}`,fromIso:start.toISOString(),toIso:end.toISOString(),raw:rawGroup,weather:groupWeather(rawGroup,sourceKind,temporary,probability)});});
  return {issueIso:issueDate.toISOString(),validStartIso:validStart.toISOString(),validEndIso:validEnd.toISOString(),prevailing,overlays};
}

export function isTafPeriodActive(period:Pick<TafTimelinePeriod,"fromIso"|"toIso">,time:number):boolean { return Date.parse(period.fromIso)<=time&&time<Date.parse(period.toIso); }
export function applyStructuredTaf(model:Forecast[],timeline:TafTimeline,windowStart:Date):{forecast:Forecast[];hazards:TafHazard[]} {
  const windowStartMs=windowStart.getTime();
  const windowEnd=windowStartMs+9*3600000;
  
  const transitionTimes = new Set<number>();
  transitionTimes.add(windowStartMs);
  for (const p of [...timeline.prevailing, ...timeline.overlays]) {
    const fromMs = Date.parse(p.fromIso);
    if (fromMs > windowStartMs && fromMs <= windowEnd) {
      transitionTimes.add(fromMs);
    }
  }

  const sortedTransitions = Array.from(transitionTimes).sort((a,b) => a - b);
  const forecast:Forecast[] = [];
  
  for (const time of sortedTransitions) {
    const closestSlot = [...model].sort((a,b) => Math.abs(Date.parse(a.iso) - time) - Math.abs(Date.parse(b.iso) - time))[0];
    const prevailing=timeline.prevailing.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather);
    const overlays=timeline.overlays.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather);
    const primary=choosePrimaryOperationalWeather([...prevailing,...overlays]);
    const timeDate = new Date(time);
    const hourLabel = time === windowStartMs ? "NOW" : `${String(timeDate.getUTCHours()).padStart(2,"0")}:00Z`;

    forecast.push({
      ...(closestSlot || model[0]),
      time: hourLabel,
      iso: timeDate.toISOString(),
      condition: primary ? primary.condition : (closestSlot?.condition || "neutral"),
      description: primary ? primary.label : (closestSlot?.description || "Weather unavailable"),
      source: "TAF" as const,
      operationalWeather: primary || null
    });
  }

  let modelIndex = 0;
  while (forecast.length < 3 && modelIndex < model.length) {
     const candidate = model[modelIndex];
     if (!forecast.find(f => Math.abs(Date.parse(f.iso) - Date.parse(candidate.iso)) < 300000)) {
         const time = Date.parse(candidate.iso);
         const prevailing=timeline.prevailing.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather);
         const overlays=timeline.overlays.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather);
         const primary=choosePrimaryOperationalWeather([...prevailing,...overlays]);
         forecast.push({
             ...candidate,
             condition: primary ? primary.condition : candidate.condition,
             description: primary ? primary.label : candidate.description,
             source: "TAF" as const,
             operationalWeather: primary || null
         });
     }
     modelIndex++;
  }

  forecast.sort((a,b) => Date.parse(a.iso) - Date.parse(b.iso));

  const hazards=[...timeline.prevailing,...timeline.overlays].filter(p=>Date.parse(p.fromIso)<windowEnd&&Date.parse(p.toIso)>windowStartMs&&qualifiesForTafHazardBand(p.weather)).map(p=>({id:p.id,fromIso:p.fromIso,toIso:p.toIso,weather:p.weather})).sort((a,b)=>score(b.weather)-score(a.weather)||Number(isTafPeriodActive(b,windowStartMs))-Number(isTafPeriodActive(a,windowStartMs))||Date.parse(a.fromIso)-Date.parse(b.fromIso));
  return {forecast,hazards};
}
