import type { CloudCoverage, Forecast, Theme } from "./weatherTypes";

export type WeatherSourceKind = "METAR"|"TAF_BASE"|"TAF_FM"|"TAF_TEMPO"|"TAF_PROB30"|"TAF_PROB40"|"TAF_PROB30_TEMPO"|"TAF_PROB40_TEMPO"|"MODEL";
export type WeatherCategory = "severe-convection"|"thunderstorm"|"freezing-precipitation"|"winter-precipitation"|"liquid-precipitation"|"obscuration"|"cloud"|"clear"|"unknown";
export type OperationalWeather = {
  code:string|null; codes:string[]; category:WeatherCategory; condition:Theme; label:string; shortLabel:string;
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
  layers.sort((a,b)=>COVERAGE_RANK[b.coverage]-COVERAGE_RANK[a.coverage]||(a.base??Infinity)-(b.base??Infinity));
  const clear=/\b(?:CLR|SKC|NSC|NCD|CAVOK)\b/.test(core), best=layers[0];
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
  return code.startsWith("+")?"heavy":code.startsWith("-")?"light":"moderate";
}

function labelFor(code:string,codes:string[],category:WeatherCategory):string {
  const all=codes.join(" "), heavy=code.startsWith("+"), light=code.startsWith("-"), vicinity=code.startsWith("VC");
  if(/\+FC/.test(all)) return "Tornado"; if(/FC/.test(code)) return "Funnel cloud"; if(/SQ/.test(code)) return "Squall";
  if(category==="severe-convection"&&/GR|GS/.test(all)) return /GS/.test(all)?"Small hail":"Hail";
  if(category==="thunderstorm") return /GR|GS/.test(all)?"Thunderstorm, hail":/SN/.test(all)?"Thunderstorm, snow":/RA/.test(all)?"Thunderstorm, rain":vicinity?"Thunderstorm nearby":"Thunderstorm";
  if(/FZRA/.test(code)) return `${heavy?"Heavy ":light?"Light ":""}freezing rain`; if(/FZDZ/.test(code)) return "Freezing drizzle";
  if(/PL/.test(code)) return "Ice pellets"; if(/SG/.test(code)) return "Snow grains"; if(/IC/.test(code)) return "Ice crystals"; if(/BLSN|DRSN/.test(code)) return "Blowing snow";
  if(category==="winter-precipitation") return /RA/.test(all)?"Rain and snow":`${heavy?"Heavy ":light?"Light ":""}snow`;
  if(/DZ/.test(code)&&!/RA/.test(code)) return `${light?"Light ":""}drizzle`; if(/SHRA/.test(code)) return "Rain showers"; if(/RA/.test(code)) return `${heavy?"Heavy ":light?"Light ":""}rain`; if(/SH/.test(code)) return "Showers nearby"; if(/UP/.test(code)) return "Precipitation";
  if(/FZFG/.test(code)) return "Freezing fog"; if(/MIFG/.test(code)) return "Shallow fog"; if(/FG/.test(code)) return "Fog"; if(/BR/.test(code)) return "Mist"; if(/HZ/.test(code)) return "Haze"; if(/FU/.test(code)) return "Smoke"; if(/VA/.test(code)) return "Volcanic ash"; if(/DU/.test(code)) return "Blowing dust"; if(/SA/.test(code)) return "Blowing sand"; if(/PY/.test(code)) return "Spray"; if(/PO/.test(code)) return "Dust whirls"; if(/DS/.test(code)) return "Dust storm"; if(/SS/.test(code)) return "Sandstorm";
  return "Weather";
}

function cloudLabel(coverage:CloudCoverage|null):string { return coverage==="VV"?"Vertical visibility":coverage==="OVC"?"Overcast":coverage==="BKN"?"Broken clouds":coverage==="SCT"?"Scattered clouds":coverage==="FEW"?"Few clouds":coverage==="CLR"?"Clear":"Weather unavailable"; }

export function resolveOperationalWeather(input:{text?:string;codes?:string[];visibilitySm?:number|null;cloudCoverage?:CloudCoverage|null;cloudBaseFt?:number|null;cloudSummary?:string|null;sourceKind:WeatherSourceKind;temporary?:boolean;probability?:number|null}):OperationalWeather {
  const sky=parseAviationSky(input.text||""), codes=input.codes||extractAviationPhenomena(input.text||"");
  const sorted=[...codes].sort((a,b)=>CATEGORY_RANK[categoryFor(b)]-CATEGORY_RANK[categoryFor(a)]||({heavy:3,moderate:2,light:1}[intensityFor(b,categoryFor(b))||"light"]-({heavy:3,moderate:2,light:1}[intensityFor(a,categoryFor(a))||"light"])));
  const code=sorted[0]||null, coverage=input.cloudCoverage??sky.cloudCoverage, base=input.cloudBaseFt??sky.cloudBaseFt, summary=input.cloudSummary??sky.cloudSummary, visibility=input.visibilitySm??sky.visibilitySm;
  if(code){const category=categoryFor(code),label=labelFor(code,codes,category);return {code,codes,category,condition:category==="severe-convection"||category==="thunderstorm"?"thunderstorm":category==="freezing-precipitation"?code.startsWith("+")?"heavy-rain":"rain":category==="winter-precipitation"?"snow":category==="liquid-precipitation"?code.startsWith("+")?"heavy-rain":"rain":category==="obscuration"?"fog":"neutral",label:label.replace(/^./,c=>c.toUpperCase()),shortLabel:code,intensity:intensityFor(code,category),vicinity:code.startsWith("VC"),temporary:!!input.temporary,probability:input.probability??null,visibilitySm:visibility,cloudCoverage:coverage,cloudBaseFt:base,cloudSummary:summary,sourceKind:input.sourceKind};}
  const category:WeatherCategory=coverage==="CLR"?"clear":coverage?"cloud":"unknown", condition:Theme=coverage==="CLR"?"clear":coverage==="FEW"||coverage==="SCT"?"partly-cloudy":coverage?"overcast":"neutral", label=cloudLabel(coverage);
  return {code:null,codes:[],category,condition,label,shortLabel:summary||coverage||"WX",intensity:null,vicinity:false,temporary:!!input.temporary,probability:input.probability??null,visibilitySm:visibility,cloudCoverage:coverage,cloudBaseFt:base,cloudSummary:summary,sourceKind:input.sourceKind};
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
  const prevailing:TafTimelinePeriod[]=[];const firstFm=fm[0]?.date||validEnd,baseRaw=taf.slice(contentStart,markers[0]?.index??taf.length).trim();if(validStart<firstFm)prevailing.push({id:"base",fromIso:validStart.toISOString(),toIso:firstFm.toISOString(),raw:baseRaw,weather:groupWeather(baseRaw,"TAF_BASE")});
  fm.forEach((entry,index)=>{const end=fm[index+1]?.date||validEnd;if(entry.date<end){const rawGroup=body(entry.i);prevailing.push({id:`fm-${entry.m[0]}`,fromIso:entry.date.toISOString(),toIso:end.toISOString(),raw:rawGroup,weather:groupWeather(rawGroup,"TAF_FM")});}});
  const overlays:TafTimelinePeriod[]=[];markers.forEach((m,index)=>{if(m[0].startsWith("FM"))return;const range=m[0].match(/(\d{2})(\d{2})\/(\d{2})(\d{2})/);if(!range)return;let start=resolveWithin(Number(range[1]),Number(range[2]),0,validStart,validEnd),end=start?firstAfter(Number(range[3]),Number(range[4]),0,start):null;if(!start||!end)return;start=new Date(Math.max(start.getTime(),validStart.getTime()));end=new Date(Math.min(end.getTime(),validEnd.getTime()));if(start>=end)return;const probability=m[0].startsWith("PROB")?Number(m[0].slice(4,6)):null,temporary=m[0].includes("TEMPO"),sourceKind:WeatherSourceKind=probability===30&&temporary?"TAF_PROB30_TEMPO":probability===40&&temporary?"TAF_PROB40_TEMPO":probability===30?"TAF_PROB30":probability===40?"TAF_PROB40":"TAF_TEMPO",rawGroup=body(index);overlays.push({id:`${m[0].replace(/\s+/g,"-")}-${index}`,fromIso:start.toISOString(),toIso:end.toISOString(),raw:rawGroup,weather:groupWeather(rawGroup,sourceKind,temporary,probability)});});
  return {issueIso:issueDate.toISOString(),validStartIso:validStart.toISOString(),validEndIso:validEnd.toISOString(),prevailing,overlays};
}

export function isTafPeriodActive(period:Pick<TafTimelinePeriod,"fromIso"|"toIso">,time:number):boolean { return Date.parse(period.fromIso)<=time&&time<Date.parse(period.toIso); }
export function applyStructuredTaf(model:Forecast[],timeline:TafTimeline,windowStart:Date):{forecast:Forecast[];hazards:TafHazard[]} {
  const windowStartMs=windowStart.getTime(),forecast=model.map(slot=>{const time=Date.parse(slot.iso),prevailing=timeline.prevailing.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather),overlays=timeline.overlays.filter(p=>isTafPeriodActive(p,time)).map(p=>p.weather),primary=choosePrimaryOperationalWeather([...prevailing,...overlays]);return primary?{...slot,condition:primary.condition,description:primary.label,source:"TAF" as const,operationalWeather:primary}:slot;});
  const windowEnd=windowStartMs+9*3600000,hazards=[...timeline.prevailing,...timeline.overlays].filter(p=>Date.parse(p.fromIso)<windowEnd&&Date.parse(p.toIso)>windowStartMs&&qualifiesForTafHazardBand(p.weather)).map(p=>({id:p.id,fromIso:p.fromIso,toIso:p.toIso,weather:p.weather})).sort((a,b)=>score(b.weather)-score(a.weather)||Number(isTafPeriodActive(b,windowStartMs))-Number(isTafPeriodActive(a,windowStartMs))||Date.parse(a.fromIso)-Date.parse(b.fromIso));
  return {forecast,hazards};
}
