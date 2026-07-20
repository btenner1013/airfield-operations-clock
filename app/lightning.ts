// Current-METAR lightning awareness and the single cancellable visual scheduler.
// TAF/model products deliberately never enter this module.

export type LightningLevel = "none"|"distant"|"vicinity"|"station"|"severe";
export type LightningSource = "none"|"metar-body"|"metar-remarks"|"debug";
export type LightningFrequency = "occasional"|"frequent"|"continuous"|null;
export type LightningDirection = "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW";
export type LightningReport = {
  level:LightningLevel;
  source:LightningSource;
  code:string|null;
  frequency:LightningFrequency;
  types:string[];
  directions:LightningDirection[];
  awareness:string|null;
};

export const NO_LIGHTNING:LightningReport={level:"none",source:"none",code:null,frequency:null,types:[],directions:[],awareness:null};

const DIRECTIONS=new Set<LightningDirection>(["N","NE","E","SE","S","SW","W","NW"]);
const FREQUENCY:Record<string,LightningFrequency>={OCNL:"occasional",FRQ:"frequent",CONS:"continuous"};
const FREQUENCY_CODE:Record<Exclude<LightningFrequency,null>,string>={occasional:"OCNL",frequent:"FRQ",continuous:"CONS"};

function cleanTokens(text:string):string[]{return text.toUpperCase().replace(/=/g," ").split(/\s+/).map(v=>v.replace(/^[,.;]+|[,.;]+$/g,"")).filter(Boolean);}
function bodyReport(code:string,level:"vicinity"|"station"|"severe"):LightningReport {
  return {level,source:"metar-body",code,frequency:null,types:[],directions:[],awareness:level==="vicinity"?"VCTS":`${code} OVR FIELD`};
}
function directionText(values:LightningDirection[]):string{return values.length<2?(values[0]||""):values.join("–");}

export function parseCurrentLightning(rawMetar:string):LightningReport {
  const upper=(rawMetar||"").toUpperCase(), split=upper.split(/\sRMK\s/,2), body=split[0]||"", remarks=split[1]||"", bodyTokens=cleanTokens(body);
  const bodyThunder=bodyTokens.filter(token=>/^[+-]?TS(?:RA|SN|GR|GS){0,3}$/.test(token));
  const severe=bodyThunder.find(token=>token.startsWith("+"));
  if(severe) return bodyReport(severe,"severe");
  if(bodyThunder.length) return bodyReport(bodyThunder[0],"station");
  const vicinity=bodyTokens.find(token=>/^VCTS(?:RA|SN|GR|GS){0,3}$/.test(token));
  if(vicinity) return bodyReport(vicinity,"vicinity");

  const remarkTokens=cleanTokens(remarks), lightningIndex=remarkTokens.findIndex(token=>/^LTG(?:IC|CC|CG|CA)*$/.test(token));
  if(lightningIndex<0) return {...NO_LIGHTNING};
  const lightningTokens=remarkTokens.filter(token=>/^LTG(?:IC|CC|CG|CA)*$/.test(token));
  const types=[...new Set(lightningTokens.flatMap(token=>token.slice(3).match(/IC|CC|CG|CA/g)||[]))];
  const nearby=remarkTokens.slice(Math.max(0,lightningIndex-3),lightningIndex+7), frequencyKey=nearby.find(token=>token in FREQUENCY), frequency=frequencyKey?FREQUENCY[frequencyKey]:null;
  const directions:LightningDirection[]=[];
  for(const token of remarkTokens.slice(lightningIndex+1,lightningIndex+9)) {
    if(DIRECTIONS.has(token as LightningDirection)){if(!directions.includes(token as LightningDirection)) directions.push(token as LightningDirection);continue;}
    if(["AND","DSNT","VC","OHD","OCNL","FRQ","CONS"].includes(token)||/^LTG/.test(token)) continue;
    break;
  }
  const location=nearby.includes("DSNT")?"DSNT":nearby.includes("VC")?"VC":nearby.includes("OHD")?"OHD":null;
  const level:LightningLevel=location==="DSNT"?"distant":location==="VC"?"vicinity":"station";
  const typeText=types.length?`LTG${types.join("")}`:"LTG", prefix=frequency?`${FREQUENCY_CODE[frequency]} `:"", dir=directionText(directions);
  return {level,source:"metar-remarks",code:typeText,frequency,types,directions,awareness:`${prefix}${typeText}${location?` ${location}`:""}${dir?` ${dir}`:""}`};
}

const DEBUG_METARS:Record<string,string>={
  "none":"METAR KMEM 201853Z 18008KT 10SM SCT040 30/20 A2992",
  "distant-ocnl-ic":"METAR KMEM 201853Z 18008KT 10SM SCT040 30/20 A2992 RMK OCNL LTGIC DSNT NE AND NW",
  "distant-frq-cg":"METAR KMEM 201853Z 18008KT 10SM SCT040 30/20 A2992 RMK FRQ LTGCG DSNT W",
  "vcts":"METAR KMEM 201853Z 18008KT 10SM VCTS SCT040CB 30/20 A2992",
  "ts":"METAR KMEM 201853Z 18008KT 5SM TS BKN030CB 30/20 A2992",
  "tsra":"METAR KMEM 201853Z 18008KT 3SM TSRA BKN030CB 30/20 A2992",
  "severe":"METAR KMEM 201853Z 22022G38KT 1SM +TSRA BKN015CB 30/20 A2992",
  "tsgr":"METAR KMEM 201853Z 22018G30KT 2SM TSGR BKN020CB 28/20 A2992",
  "reduced":"METAR KMEM 201853Z 18008KT 3SM TSRA BKN030CB 30/20 A2992",
  "flash-test":"METAR KMEM 201853Z 18008KT 5SM TS BKN030CB 30/20 A2992",
};

export function debugLightningReport(key:string|null):LightningReport|null {
  if(!key||!(key in DEBUG_METARS)) return null;
  return {...parseCurrentLightning(DEBUG_METARS[key]),source:"debug"};
}

const COORDS:Record<LightningDirection,{x:number;y:number}>={N:{x:50,y:18},NE:{x:78,y:23},E:{x:88,y:43},SE:{x:78,y:62},S:{x:50,y:68},SW:{x:22,y:62},W:{x:12,y:43},NW:{x:22,y:23}};
export function lightningPlacement(report:LightningReport):{x:number;y:number} {
  if(!report.directions.length) return {x:report.level==="distant"?68:62,y:report.level==="distant"?66:32};
  const points=report.directions.map(direction=>COORDS[direction]), x=points.reduce((sum,p)=>sum+p.x,0)/points.length, rawY=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  return {x:Math.round(x),y:Math.round(report.level==="distant"?Math.max(55,rawY+24):rawY)};
}

export type LightningVisualState={active:boolean;pulse:0|1|2;bolt:boolean;cluster:number};
type TimerHandle=ReturnType<typeof setTimeout>;
type VisibilityTarget={visibilityState:string;addEventListener:(name:string,handler:()=>void)=>void;removeEventListener:(name:string,handler:()=>void)=>void};
export type LightningSchedulerOptions={
  reduced?:boolean;flashTest?:boolean;random?:()=>number;
  setTimer?:(callback:()=>void,delayMs:number)=>TimerHandle;clearTimer?:(handle:TimerHandle)=>void;
  visibilityTarget?:VisibilityTarget;onState:(state:LightningVisualState)=>void;
};
export type LightningScheduler={start:()=>void;stop:()=>void;pendingCount:()=>number;isStopped:()=>boolean};

export function lightningQuietRange(level:LightningLevel):[number,number] {
  return level==="distant"?[20000,45000]:level==="vicinity"?[10000,25000]:level==="station"?[7000,18000]:level==="severe"?[4000,12000]:[0,0];
}

export function createLightningScheduler(report:LightningReport,options:LightningSchedulerOptions):LightningScheduler {
  const random=options.random||Math.random,setTimer=options.setTimer||setTimeout,clearTimer=options.clearTimer||clearTimeout,target=options.visibilityTarget;
  const pending=new Set<TimerHandle>();let stopped=false,started=false,cluster=0;
  const visible=()=>!target||target.visibilityState==="visible";
  const emit=(active:boolean,pulse:0|1|2=0,bolt=false)=>options.onState({active,pulse,bolt,cluster});
  const later=(callback:()=>void,delay:number)=>{let handle:TimerHandle;handle=setTimer(()=>{pending.delete(handle);callback();},delay);pending.add(handle);return handle;};
  const clearAll=()=>{for(const handle of pending)clearTimer(handle);pending.clear();};
  const scheduleQuiet=()=>{if(stopped||report.level==="none"||options.reduced||!visible())return;const [min,max]=lightningQuietRange(report.level);later(runCluster,min+Math.round(random()*(max-min)));};
  const runCluster=()=>{
    if(stopped||!visible()){emit(false);return;} cluster++;
    const doublePulse=options.flashTest||random()<(report.level==="distant"?.15:report.level==="vicinity"?.42:report.level==="station"?.55:.72);
    const boltEligible=report.level==="station"||report.level==="severe", bolt=boltEligible&&(options.flashTest||random()<(report.level==="severe"?.56:.34));
    emit(true,1,bolt);later(()=>emit(true,0,false),115);
    if(doublePulse){later(()=>emit(true,2,bolt&&report.level==="severe"),235);later(()=>emit(true,0,false),345);}
    later(()=>{emit(true,0,false);if(!options.flashTest)scheduleQuiet();},doublePulse?455:225);
  };
  const onVisibility=()=>{clearAll();emit(false);if(visible()&&!stopped)scheduleQuiet();};
  return {
    start:()=>{if(started)return;started=true;stopped=false;emit(report.level!=="none"&&!options.reduced);if(report.level==="none"||options.reduced)return;target?.addEventListener("visibilitychange",onVisibility);if(visible()) options.flashTest?later(runCluster,650):scheduleQuiet();},
    stop:()=>{if(stopped)return;stopped=true;clearAll();target?.removeEventListener("visibilitychange",onVisibility);emit(false);},
    pendingCount:()=>pending.size,isStopped:()=>stopped,
  };
}
