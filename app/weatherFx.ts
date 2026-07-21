// Phase 2C — pure weather-effect classification and rendering specifications.
// Inputs are normalized current-METAR tokens only. No DOM, timers, or React state live here.

export type PrecipType =
  | "none" | "drizzle" | "rain" | "freezing-drizzle" | "freezing-rain"
  | "snow" | "snow-shower" | "blowing-snow" | "drifting-snow" | "snow-grains" | "ice-crystals"
  | "ice-pellets" | "hail" | "small-hail";
export type ObscurationType =
  | "none" | "mist" | "fog" | "freezing-fog" | "shallow-fog" | "patchy-fog" | "partial-fog"
  | "haze" | "smoke" | "dust" | "blowing-dust" | "drifting-dust"
  | "sand" | "blowing-sand" | "drifting-sand" | "dust-storm" | "sandstorm" | "dust-whirl" | "volcanic-ash";
export type Intensity = "light" | "moderate" | "heavy";
export type EffectState = {
  precip: PrecipType;
  secondaryPrecip: PrecipType;
  obscuration: ObscurationType;
  intensity: Intensity;
  vicinity: boolean;
  shower: boolean;
  liquidPresent: boolean;
  vicinityLiquid: boolean;
};

const PRECIP_RANK: PrecipType[] = ["hail","small-hail","ice-pellets","freezing-rain","freezing-drizzle","snow-shower","snow","blowing-snow","drifting-snow","snow-grains","ice-crystals","rain","drizzle","none"];
const OBSC_RANK: ObscurationType[] = ["volcanic-ash","dust-storm","sandstorm","freezing-fog","fog","partial-fog","patchy-fog","shallow-fog","smoke","blowing-dust","blowing-sand","dust","sand","drifting-dust","drifting-sand","dust-whirl","haze","mist","none"];

function tokenPrecips(token:string):PrecipType[] {
  const out:PrecipType[]=[];
  if(/FZRA/.test(token)) out.push("freezing-rain");
  else if(/FZDZ/.test(token)) out.push("freezing-drizzle");
  else if(/GR/.test(token)&&!/GS/.test(token)) out.push("hail");
  else if(/GS/.test(token)) out.push("small-hail");
  else if(/PL/.test(token)) out.push("ice-pellets");
  else if(/BLSN/.test(token)) out.push("blowing-snow");
  else if(/DRSN/.test(token)) out.push("drifting-snow");
  else if(/SG/.test(token)) out.push("snow-grains");
  else if(/\bIC\b/.test(token)) out.push("ice-crystals");
  else if(/SHSN/.test(token)) out.push("snow-shower");
  else if(/SN/.test(token)) out.push("snow");
  if(!/FZDZ/.test(token)&&/DZ/.test(token)) out.push("drizzle");
  if(!/FZRA/.test(token)&&/RA/.test(token)) out.push("rain");
  if(/\bUP\b/.test(token)) out.push("rain");
  return [...new Set(out)];
}

function tokenObscuration(token:string):ObscurationType {
  if(/FZFG/.test(token)) return "freezing-fog";
  if(/MIFG/.test(token)) return "shallow-fog";
  if(/BCFG/.test(token)) return "patchy-fog";
  if(/PRFG/.test(token)) return "partial-fog";
  if(/FG/.test(token)) return "fog";
  if(/\bBR\b/.test(token)) return "mist";
  if(/\bHZ\b/.test(token)) return "haze";
  if(/\bFU\b/.test(token)) return "smoke";
  if(/\bVA\b/.test(token)) return "volcanic-ash";
  if(/DS/.test(token)) return "dust-storm";
  if(/SS/.test(token)) return "sandstorm";
  if(/BLDU/.test(token)) return "blowing-dust";
  if(/DRDU/.test(token)) return "drifting-dust";
  if(/(?:^|[+-])DU$/.test(token)||/^VCDU$/.test(token)) return "dust";
  if(/BLSA/.test(token)) return "blowing-sand";
  if(/DRSA/.test(token)) return "drifting-sand";
  if(/(?:^|[+-])SA$/.test(token)||/^VCSA$/.test(token)) return "sand";
  if(/\bPO\b/.test(token)) return "dust-whirl";
  return "none";
}

export function classifyEffect(phenomena:string[]):EffectState {
  const precip=new Set<PrecipType>();
  let obscuration:ObscurationType="none",anyVicinity=false,anyOnStation=false,shower=false,hasPlus=false,hasMinus=false,liquidPresent=false,vicinityLiquid=false;
  for(const raw of phenomena) {
    const token=(raw||"").toUpperCase();
    const precipTypes=tokenPrecips(token),obsc=tokenObscuration(token),meaningful=precipTypes.length>0||obsc!=="none"||/SH|TS/.test(token);
    precipTypes.forEach(type=>precip.add(type));
    if(obsc!=="none"&&OBSC_RANK.indexOf(obsc)<OBSC_RANK.indexOf(obscuration)) obscuration=obsc;
    if(meaningful) token.startsWith("VC")?anyVicinity=true:anyOnStation=true;
    if(/SH/.test(token)) shower=true;
    const tokenHasLiquid=precipTypes.some(type=>type==="rain"||type==="drizzle"||type==="freezing-rain"||type==="freezing-drizzle")||/^VC(?:TS)?SH/.test(token);
    if(tokenHasLiquid){liquidPresent=true;if(token.startsWith("VC"))vicinityLiquid=true;}
    if(token.startsWith("+")) hasPlus=true;
    if(token.startsWith("-")) hasMinus=true;
  }
  if(!precip.size&&shower) precip.add("rain");
  const ordered=[...precip].sort((a,b)=>PRECIP_RANK.indexOf(a)-PRECIP_RANK.indexOf(b));
  const primary=ordered[0]||"none",secondary=ordered.find(type=>type!==primary)||"none";
  const intensity:Intensity=hasPlus?"heavy":hasMinus&&!hasPlus?"light":primary==="none"?"light":"moderate";
  return {precip:primary,secondaryPrecip:secondary,obscuration,intensity,vicinity:anyVicinity&&!anyOnStation,shower,liquidPresent,vicinityLiquid};
}

export type FxShape="streak"|"flake"|"grain"|"crystal"|"pellet"|"hail";
export type ParticleBand="full"|"lower"|"surface";
export type PaneProfile="drizzle"|"rain"|"freezing"|"vicinity";
export type PaneSpec={count:number;freezing:boolean;roll:number;trails:boolean;profile:PaneProfile};
export type ParticleClassSpec={
  type:PrecipType;shape:FxShape;count:number;speed:number;len:number;size:number;thick:number;vx:number;sway:number;
  sizeMin:number;sizeMax:number;bounce:boolean;alpha:number;color:string;near:boolean;burst:boolean;band:ParticleBand;
};
export type FxSpec=ParticleClassSpec&{
  secondary:ParticleClassSpec|null;totalCount:number;veil:number;pane:PaneSpec|null;reduced:boolean;
};
export type ObscurationSpec={type:ObscurationType;density:number;horizon:number;veil:number;layers:number;duration:number;direction:-1|1;reduced:boolean};

const LIQUID:PrecipType[]=["drizzle","rain","freezing-drizzle","freezing-rain"];
const isFreezing=(type:PrecipType)=>type==="freezing-rain"||type==="freezing-drizzle";
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

function particleClass(type:PrecipType,intensity:Intensity,drift:number,perf:"full"|"low",night:boolean,reduced:boolean,vicinity:boolean,secondary=false):ParticleClassSpec {
  let shape:FxShape="streak",count=0,speed=1000,len=26,size=1,sizeMin=.7,sizeMax=1.5,thick=1.3,sway=0,bounce=false,near=false,burst=false,alpha=.5,band:ParticleBand="full",vx=drift;
  if(type==="drizzle"||type==="freezing-drizzle"){count=300;speed=520;len=10;thick=1.05;alpha=.56;}
  else if(type==="rain"||type==="freezing-rain"){count=225;speed=1120;len=29;thick=1.35;alpha=.6;}
  else if(type==="snow"){shape="flake";count=190;speed=112;size=3.25;sizeMin=1.5;sizeMax=intensity==="light"?5.1:7;sway=25;alpha=.9;near=true;}
  else if(type==="snow-shower"){shape="flake";count=230;speed=138;size=3.4;sizeMin=1.6;sizeMax=7;sway=30;alpha=.92;near=true;burst=true;}
  else if(type==="blowing-snow"){shape="grain";count=260;speed=42;size=3;sizeMin=1.8;sizeMax=4.6;sway=5;alpha=.92;near=true;band="lower";vx=(drift<0?-1:1)*Math.max(205,Math.abs(drift)*1.45);}
  else if(type==="drifting-snow"){shape="grain";count=120;speed=16;size=3;sizeMin=2.1;sizeMax=4.3;sway=2;alpha=.9;near=true;band="surface";vx=(drift<0?-1:1)*Math.max(125,Math.abs(drift)*1.08);}
  else if(type==="snow-grains"){shape="grain";count=185;speed=230;size=3.1;sizeMin=2.3;sizeMax=4.1;sway=3;alpha=.96;near=true;}
  else if(type==="ice-crystals"){shape="crystal";count=68;speed=28;size=4.2;sizeMin=3.1;sizeMax=5.6;sway=4;alpha=.98;near=true;}
  else if(type==="ice-pellets"){shape="pellet";count=180;speed=980;size=3.5;sizeMin=2.6;sizeMax=5.4;bounce=true;alpha=.96;near=true;}
  else if(type==="hail"){shape="hail";count=88;speed=1420;size=6.4;sizeMin=5.2;sizeMax=9.8;bounce=true;alpha=.98;near=true;}
  else if(type==="small-hail"){shape="pellet";count=120;speed=1220;size=4.7;sizeMin=3.8;sizeMax=7.5;bounce=true;alpha=.96;near=true;}
  const intensityScale=intensity==="heavy" ? 1.62 : intensity==="light" ? .5 : 1;
  count=Math.round(count*intensityScale*(perf==="low" ? .46 : 1)*(secondary ? .42 : 1)*(vicinity ? .22 : 1));
  alpha*=night ? .88 : 1;
  if(vicinity) alpha*=.58;
  if(perf==="low"){near=false;sizeMax=Math.min(sizeMax,Math.max(sizeMin,4.6));}
  if(reduced){count=Math.round(count*.42);speed*=.16;vx*=.18;sway*=.22;near=false;burst=false;sizeMax=Math.min(sizeMax,3.6);}
  const color=isFreezing(type)?"rgba(188,214,232,1)":shape==="flake"?"rgba(238,247,252,1)":type==="hail"||type==="small-hail"?"rgba(218,237,246,1)":"rgba(202,225,239,1)";
  return {type,shape,count,speed,len,size,sizeMin,sizeMax,thick,vx,sway,bounce,alpha,color,near,burst,band};
}

function visibilityRestriction(visibilitySm:number|null):number {
  if(visibilitySm===null||visibilitySm>=6) return 0;
  if(visibilitySm>=5) return (6-visibilitySm)*.02;
  if(visibilitySm>=3) return .02+(5-visibilitySm)/2*.18;
  if(visibilitySm>=2) return .20+(3-visibilitySm)*.25;
  if(visibilitySm>=1) return .45+(2-visibilitySm)*.35;
  return .80+(1-Math.max(0,visibilitySm))*.18;
}

export function buildFxSpec(fx:EffectState,windNx:number,windSpeedKt:number,perf:"full"|"low",night:boolean,reduced:boolean,paneOverride:boolean|null,visibilitySm:number|null=null):FxSpec|null {
  const direction=windNx<0?-1:1,drift=Math.min(Math.max(windSpeedKt,0),45)*12*direction;
  const hasLiquid=fx.liquidPresent||LIQUID.includes(fx.precip)||LIQUID.includes(fx.secondaryPrecip);
  const paneOn=paneOverride!==null?paneOverride:hasLiquid;
  if(fx.precip==="none"&&!paneOn) return null;
  const primary=particleClass(fx.precip,fx.intensity,drift,perf,night,reduced,fx.vicinity);
  const secondary=fx.secondaryPrecip!=="none"?particleClass(fx.secondaryPrecip,fx.intensity,drift,perf,night,reduced,fx.vicinity,true):null;
  const max=perf==="low"?240:520,total=primary.count+(secondary?.count||0);
  if(total>max){const scale=max/total;primary.count=Math.round(primary.count*scale);if(secondary)secondary.count=Math.round(secondary.count*scale);}
  const restriction=visibilityRestriction(visibilitySm);
  const frozen=["snow","snow-shower","blowing-snow","drifting-snow","snow-grains","ice-crystals"].includes(fx.precip);
  let veil=frozen?(fx.intensity==="heavy" ? .08 : fx.intensity==="moderate" ? .035 : 0)+restriction*.24:(fx.precip==="rain"||fx.precip==="freezing-rain")?(fx.intensity==="heavy" ? .15 : fx.intensity==="moderate" ? .055 : 0)+restriction*.1:restriction*.05;
  if(perf==="low") veil*=.55;if(reduced)veil*=.7;veil=clamp(veil,0,.3);
  let pane:PaneSpec|null=null;
  if(paneOn){const freezing=isFreezing(fx.precip)||isFreezing(fx.secondaryPrecip);let count=fx.intensity==="light"?8:fx.intensity==="heavy"?26:16;let profile:PaneProfile=freezing?"freezing":fx.precip==="drizzle"||fx.secondaryPrecip==="drizzle"?"drizzle":"rain";if(fx.vicinity||fx.vicinityLiquid){count=4;profile="vicinity";}if(freezing)count=Math.round(count*.65);if(perf==="low")count=Math.min(count,8);if(reduced)count=Math.min(count,5);pane={count,freezing,profile,roll:reduced ? .12 : freezing ? .42 : perf==="low" ? .65 : profile==="drizzle" ? .46 : 1,trails:perf==="full"&&!reduced};}
  return {...primary,secondary,totalCount:primary.count+(secondary?.count||0),veil,pane,reduced};
}

export function buildObscurationSpec(fx:EffectState,visibilitySm:number|null,windNx:number,windSpeedKt:number,perf:"full"|"low",reduced:boolean):ObscurationSpec {
  if(fx.obscuration==="none") return {type:"none",density:0,horizon:0,veil:0,layers:0,duration:0,direction:windNx<0?-1:1,reduced};
  const base:Record<Exclude<ObscurationType,"none">,number>={
    mist:.12,fog:.3,"freezing-fog":.34,"shallow-fog":.23,"patchy-fog":.25,"partial-fog":.28,haze:.1,smoke:.2,dust:.16,"blowing-dust":.27,"drifting-dust":.19,sand:.18,"blowing-sand":.3,"drifting-sand":.2,"dust-storm":.48,"sandstorm":.5,"dust-whirl":.16,"volcanic-ash":.32,
  };
  const restriction=visibilityRestriction(visibilitySm);
  let density=base[fx.obscuration]+restriction*.78;
  const fogFamily=["fog","freezing-fog","shallow-fog","patchy-fog","partial-fog"].includes(fx.obscuration);
  const groundFamily=["shallow-fog","patchy-fog","partial-fog"].includes(fx.obscuration);
  let horizon=fogFamily?clamp((groundFamily ? .36 : .28)+restriction*(groundFamily ? .68 : .78),0,.98):density*.55;
  let veil=fogFamily?clamp(restriction*(groundFamily ? .22 : .55),0,.66):density*.16;
  if(fx.obscuration==="mist"){density=.14+restriction*.32;horizon=.16+restriction*.24;veil=restriction*.15;}
  if(fx.obscuration==="shallow-fog"){density=.42+restriction*.45;horizon=.48+restriction*.42;veil=restriction*.05;}
  if(fx.obscuration==="patchy-fog"){density=.44+restriction*.45;horizon=.46+restriction*.42;veil=restriction*.06;}
  if(fx.obscuration==="partial-fog"){density=.42+restriction*.45;horizon=.45+restriction*.42;veil=restriction*.12;}
  if(fx.vicinity){density*=.3;horizon*=.35;veil*=.3;}if(perf==="low"){density*=.82;veil*=.8;}density=clamp(density,0,.92);
  let layers=perf==="low"?Math.min(2,density>.45?2:1):density>.55?3:density>.2?2:1;
  if(fx.obscuration==="mist"||fx.obscuration==="shallow-fog"||fx.obscuration==="partial-fog") layers=1;
  if(fx.obscuration==="patchy-fog") layers=Math.min(2,layers);
  const duration=reduced?0:Math.round(clamp(58-Math.min(Math.max(windSpeedKt,0),40),18,58));
  return {type:fx.obscuration,density,horizon:clamp(horizon),veil:clamp(veil),layers,duration,direction:windNx<0?-1:1,reduced};
}
