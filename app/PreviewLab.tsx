"use client";
// Preview-only controls and diagnostics. The real feed, clock and scene defaults are untouched.
import { useEffect, useState } from "react";

type Preset=[label:string,query:string];
const SNOW:Preset[]=[
  ["-SN","debugWeather=snow&debugPhenomena=-SN&debugIntensity=light&debugTime=day"],
  ["SN","debugWeather=snow&debugPhenomena=SN&debugIntensity=moderate&debugTime=day"],
  ["+SN","debugWeather=snow&debugPhenomena=%2BSN&debugIntensity=heavy&debugVisibility=.75&debugTime=night"],
  ["SHSN","debugWeather=snow&debugPhenomena=SHSN&debugIntensity=moderate&debugTime=day"],
  ["BLSN","debugWeather=snow&debugPhenomena=BLSN&debugWind=280&debugWindSpeed=28&debugVisibility=1&debugTime=day"],
  ["SN BLSN","debugWeather=snow&debugPhenomena=SN%20BLSN&debugWind=280&debugWindSpeed=28&debugVisibility=1&debugTime=day"],
  ["DRSN","debugWeather=snow&debugPhenomena=DRSN&debugWind=280&debugWindSpeed=15&debugVisibility=4&debugTime=day"],
  ["SG","debugWeather=snow&debugPhenomena=SG&debugTime=day"],
  ["IC","debugWeather=snow&debugPhenomena=IC&debugTime=night"],
];
const FROZEN:Preset[]=[
  ["PL","debugWeather=snow&debugPhenomena=PL&debugTime=day"],
  ["GS","debugWeather=thunderstorm&debugPhenomena=GS&debugTime=day"],
  ["GR","debugWeather=thunderstorm&debugPhenomena=GR&debugTime=day"],
];
const RAIN:Preset[]=[
  ["-DZ","debugWeather=rain&debugPhenomena=-DZ&debugIntensity=light&debugTime=day"],
  ["DZ","debugWeather=rain&debugPhenomena=DZ&debugIntensity=moderate&debugTime=day"],
  ["-RA","debugWeather=rain&debugPhenomena=-RA&debugIntensity=light&debugTime=day"],
  ["RA","debugWeather=rain&debugPhenomena=RA&debugIntensity=moderate&debugTime=day"],
  ["+RA","debugWeather=heavy-rain&debugPhenomena=%2BRA&debugIntensity=heavy&debugVisibility=1.5&debugTime=night"],
  ["SHRA","debugWeather=rain&debugPhenomena=SHRA&debugTime=day"],
  ["TSRA","debugWeather=thunderstorm&debugPhenomena=TSRA&debugTime=night"],
  ["VCSH","debugWeather=rain&debugPhenomena=VCSH&debugTime=day"],
  ["FZRA","debugWeather=rain&debugPhenomena=FZRA&debugTime=night"],
  ["RASN","debugWeather=snow&debugPhenomena=RASN&debugTime=day"],
];
const VISIBILITY:Preset[]=[
  ["BR 5SM","debugWeather=fog&debugPhenomena=BR&debugVisibility=5&debugTime=day"],
  ["FG 2SM","debugWeather=fog&debugPhenomena=FG&debugVisibility=2&debugTime=day"],
  ["FG 1SM","debugWeather=fog&debugPhenomena=FG&debugVisibility=1&debugTime=day"],
  ["FG .5SM","debugWeather=fog&debugPhenomena=FG&debugVisibility=.5&debugTime=night"],
  ["MIFG","debugWeather=fog&debugPhenomena=MIFG&debugVisibility=2&debugTime=day"],
  ["BCFG","debugWeather=fog&debugPhenomena=BCFG&debugVisibility=2&debugTime=day"],
  ["PRFG","debugWeather=fog&debugPhenomena=PRFG&debugVisibility=1&debugTime=day"],
  ["FZFG","debugWeather=fog&debugPhenomena=FZFG&debugVisibility=.5&debugTime=night"],
  ["HZ","debugWeather=fog&debugPhenomena=HZ&debugVisibility=4&debugTime=day"],
  ["FU","debugWeather=fog&debugPhenomena=FU&debugVisibility=3&debugTime=day"],
  ["BLDU","debugWeather=fog&debugPhenomena=BLDU&debugVisibility=1&debugWind=260&debugWindSpeed=30&debugTime=day"],
  ["BLSA","debugWeather=fog&debugPhenomena=BLSA&debugVisibility=1&debugWind=250&debugWindSpeed=30&debugTime=day"],
  ["DS","debugWeather=fog&debugPhenomena=DS&debugVisibility=.5&debugWind=250&debugWindSpeed=35&debugTime=day"],
  ["SS","debugWeather=fog&debugPhenomena=SS&debugVisibility=.5&debugWind=250&debugWindSpeed=35&debugTime=day"],
  ["VA","debugWeather=fog&debugPhenomena=VA&debugVisibility=2&debugTime=day"],
];
const SCENE:Preset[]=[
  ["Clear day","debugWeather=clear&debugTime=day"],["Clear night","debugWeather=clear&debugTime=night"],
  ["Sunrise","debugWeather=clear&debugTime=sunrise"],["Sunset","debugWeather=clear&debugTime=sunset"],
  ["Low performance","debugWeather=snow&debugPhenomena=%2BSN&debugIntensity=heavy&debugPerformance=low&debugTime=day"],
  ["Reduced motion","debugWeather=snow&debugPhenomena=SN&debugReducedMotion=1&debugTime=day"],
];

export default function PreviewLab({active,paneDrops,onPaneToggle}:{active:boolean;paneDrops:boolean|null;onPaneToggle:(v:boolean|null)=>void}){
  const [d,setD]=useState<Record<string,string>>({}),[hidden,setHidden]=useState(false),[diag,setDiag]=useState(true);
  useEffect(()=>{if(!active)return;const read=()=>{const m=document.querySelector("main.display") as HTMLElement|null,c=document.querySelector(".precip-canvas") as HTMLElement|null;if(!m)return;setD({
    precip:m.dataset.precipType||"none",secondary:m.dataset.secondaryPrecipType||"none",intensity:m.dataset.precipIntensity||"--",
    vis:m.dataset.visibility||"--",coverage:m.dataset.coverage||"--",tier:m.dataset.tier||"--",scene:m.dataset.wallpaperScene||"--",perf:m.dataset.performance||"--",reduced:m.dataset.reducedMotion==="1"?"yes":"no",
    obsc:m.dataset.obscuration||"none",density:m.dataset.obscurationDensity||"0",horizon:m.dataset.obscurationHorizon||"0",veil:m.dataset.obscurationVeil||"0",layers:m.dataset.activeObscurationLayers||"0",
    wind:`${m.dataset.winddir||"VRB"}deg ${m.dataset.wind||0}kt / vec ${m.dataset.nx??""},${m.dataset.ny??""}`,
    count:c?.dataset.count||"0",primary:c?.dataset.primaryCount||"0",secondaryCount:c?.dataset.secondaryCount||"0",average:c?.dataset.averageSize||"0",near:c?.dataset.nearCount||"0",band:c?.dataset.verticalBand||"none",modulation:c?.dataset.modulation||"steady",canvas:c?.dataset.active==="1"?"ACTIVE":"idle",fps:c?.dataset.fps||"--",
    drops:c?.dataset.dropCount||"0",rolling:c?.dataset.dropRolling||"0",profile:c?.dataset.paneProfile||"none",trails:c?.dataset.trails==="1"?"on":"off",pane:c?.dataset.pane==="1"?"on":"off",
    cssW:c?.dataset.canvasCssWidth||"--",cssH:c?.dataset.canvasCssHeight||"--",bufW:c?.dataset.canvasBufferWidth||"--",bufH:c?.dataset.canvasBufferHeight||"--",dpr:c?.dataset.canvasDpr||"--",
  });};read();const id=window.setInterval(read,500);return()=>clearInterval(id);},[active]);
  if(!active)return null;
  const paneLabel=paneDrops===true?"ON":paneDrops===false?"OFF":"AUTO",cyclePane=()=>onPaneToggle(paneDrops===null?true:paneDrops===true?false:null);
  const links=(items:Preset[])=><nav>{items.map(([label,query])=><a key={label} href={`?${query}&previewWeatherFx=1`}>{label}</a>)}</nav>;
  return <aside className="fxlab" aria-label="Weather FX Preview"><header><b>WEATHER FX PREVIEW</b><span><button onClick={()=>setDiag(v=>!v)}>{diag?"DIAG-":"DIAG+"}</button><button onClick={()=>setHidden(v=>!v)}>{hidden?"SHOW":"HIDE"}</button></span></header>{!hidden&&<div className="fxlab-body">
    <div className="fxlab-toggle"><button onClick={cyclePane} className={paneDrops===false?"off":""}>WINDOW DROPLETS: {paneLabel}</button></div>
    {diag&&<dl>
      <div><dt>PRECIP</dt><dd>{d.precip} + {d.secondary} / {d.intensity}</dd></div>
      <div><dt>PARTICLES</dt><dd>{d.count} total / {d.primary}+{d.secondaryCount}</dd></div>
      <div><dt>SIZE</dt><dd>{d.average}px avg / {d.near} near</dd></div>
      <div><dt>BAND / MODULATION</dt><dd>{d.band} / {d.modulation}</dd></div>
      <div><dt>CANVAS</dt><dd>{d.canvas} / {d.fps} fps</dd></div>
      <div><dt>OBSCURATION</dt><dd>{d.obsc} / {d.density} / {d.layers}L</dd></div>
      <div><dt>FOG DEPTH</dt><dd>horizon {d.horizon} / veil {d.veil}</dd></div>
      <div><dt>WALLPAPER</dt><dd>{d.scene}</dd></div>
      <div><dt>VIS / CLOUD</dt><dd>{d.vis}SM / {d.coverage} / tier {d.tier}</dd></div>
      <div><dt>WINDOW DROPS</dt><dd>{d.drops} / {d.rolling} rolling</dd></div>
      <div><dt>PANE / TRAILS</dt><dd>{d.pane} {d.profile} / {d.trails}</dd></div>
      <div><dt>CANVAS CSS</dt><dd>{d.cssW}x{d.cssH}</dd></div>
      <div><dt>BUFFER</dt><dd>{d.bufW}x{d.bufH} / DPR {d.dpr}</dd></div>
      <div><dt>WIND</dt><dd>{d.wind}</dd></div><div><dt>PERF / REDUCED</dt><dd>{d.perf} / {d.reduced}</dd></div>
    </dl>}
    <h4>SNOW COMPARISON</h4>{links(SNOW)}<h4>FROZEN PRECIPITATION</h4>{links(FROZEN)}<h4>RAIN / WINDOW PANE</h4>{links(RAIN)}<h4>VISIBILITY / OBSCURATION</h4>{links(VISIBILITY)}<h4>SCENE / PERFORMANCE</h4>{links(SCENE)}<nav><a href="?">LIVE</a></nav>
  </div>}</aside>;
}
