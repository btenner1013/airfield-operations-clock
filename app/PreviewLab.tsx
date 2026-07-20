"use client";
// Preview-only controls and diagnostics. The real feed, clock and scene defaults are untouched.
import { useEffect, useState } from "react";

type Preset=[label:string,query:string];
const PRECIP:Preset[]=[
  ["Light snow","debugWeather=snow&debugPhenomena=-SN&debugIntensity=light&debugTime=day"],
  ["Moderate snow","debugWeather=snow&debugPhenomena=SN&debugIntensity=moderate&debugTime=day"],
  ["Heavy snow","debugWeather=snow&debugPhenomena=%2BSN&debugIntensity=heavy&debugVisibility=.75&debugTime=night"],
  ["Snow showers","debugWeather=snow&debugPhenomena=SHSN&debugIntensity=moderate&debugTime=day"],
  ["Blowing snow","debugWeather=snow&debugPhenomena=BLSN&debugWind=280&debugWindSpeed=28&debugVisibility=1&debugTime=day"],
  ["Drifting snow","debugWeather=snow&debugPhenomena=DRSN&debugWind=280&debugWindSpeed=15&debugVisibility=4&debugTime=day"],
  ["Snow grains","debugWeather=snow&debugPhenomena=SG&debugTime=day"],
  ["Ice crystals","debugWeather=snow&debugPhenomena=IC&debugTime=night"],
  ["Ice pellets","debugWeather=snow&debugPhenomena=PL&debugTime=day"],
  ["Hail","debugWeather=thunderstorm&debugPhenomena=GR&debugTime=day"],
  ["Small hail","debugWeather=thunderstorm&debugPhenomena=GS&debugTime=day"],
  ["Mixed rain / snow","debugWeather=snow&debugPhenomena=RASN&debugTime=day"],
  ["Drizzle","debugWeather=rain&debugPhenomena=-DZ&debugIntensity=light&debugTime=day"],
  ["Rain","debugWeather=rain&debugPhenomena=RA&debugIntensity=moderate&debugTime=day"],
  ["Heavy rain","debugWeather=heavy-rain&debugPhenomena=%2BRA&debugIntensity=heavy&debugVisibility=1.5&debugTime=night"],
  ["Rain showers","debugWeather=rain&debugPhenomena=SHRA&debugTime=day"],
  ["Vicinity showers","debugWeather=rain&debugPhenomena=VCSH&debugTime=day"],
  ["Freezing rain","debugWeather=rain&debugPhenomena=FZRA&debugTime=night"],
];
const OBSCURATION:Preset[]=[
  ["Mist at 5 SM","debugWeather=fog&debugPhenomena=BR&debugVisibility=5&debugTime=day"],
  ["Fog at 2 SM","debugWeather=fog&debugPhenomena=FG&debugVisibility=2&debugTime=day"],
  ["Fog at 1/2 SM","debugWeather=fog&debugPhenomena=FG&debugVisibility=.5&debugTime=night"],
  ["Shallow fog","debugWeather=fog&debugPhenomena=MIFG&debugVisibility=2&debugTime=day"],
  ["Patchy fog","debugWeather=fog&debugPhenomena=BCFG&debugVisibility=2&debugTime=day"],
  ["Partial fog","debugWeather=fog&debugPhenomena=PRFG&debugVisibility=1&debugTime=day"],
  ["Freezing fog","debugWeather=fog&debugPhenomena=FZFG&debugVisibility=.5&debugTime=night"],
  ["Haze","debugWeather=fog&debugPhenomena=HZ&debugVisibility=4&debugTime=day"],
  ["Smoke","debugWeather=fog&debugPhenomena=FU&debugVisibility=3&debugTime=day"],
  ["Dust","debugWeather=fog&debugPhenomena=DU&debugVisibility=3&debugTime=day"],
  ["Blowing dust","debugWeather=fog&debugPhenomena=BLDU&debugVisibility=1&debugWind=260&debugWindSpeed=30&debugTime=day"],
  ["Drifting dust","debugWeather=fog&debugPhenomena=DRDU&debugVisibility=4&debugWind=260&debugWindSpeed=16&debugTime=day"],
  ["Sand","debugWeather=fog&debugPhenomena=SA&debugVisibility=3&debugTime=day"],
  ["Blowing sand","debugWeather=fog&debugPhenomena=BLSA&debugVisibility=1&debugWind=250&debugWindSpeed=30&debugTime=day"],
  ["Drifting sand","debugWeather=fog&debugPhenomena=DRSA&debugVisibility=4&debugWind=250&debugWindSpeed=16&debugTime=day"],
  ["Dust storm","debugWeather=fog&debugPhenomena=DS&debugVisibility=.5&debugWind=250&debugWindSpeed=35&debugTime=day"],
  ["Sandstorm","debugWeather=fog&debugPhenomena=SS&debugVisibility=.5&debugWind=250&debugWindSpeed=35&debugTime=day"],
  ["Dust whirls","debugWeather=fog&debugPhenomena=PO&debugVisibility=5&debugTime=day"],
  ["Volcanic ash","debugWeather=fog&debugPhenomena=VA&debugVisibility=2&debugTime=day"],
];
const SOLAR:Preset[]=[
  ["Clear day","debugWeather=clear&debugTime=day"],["Clear night","debugWeather=clear&debugTime=night"],
  ["Sunrise","debugWeather=clear&debugTime=sunrise"],["Sunset","debugWeather=clear&debugTime=sunset"],
  ["FEW sunrise","debugWeather=partly-cloudy&debugCloud=FEW&debugTime=sunrise"],
  ["SCT sunset","debugWeather=partly-cloudy&debugCloud=SCT&debugTime=sunset"],
  ["OVC night","debugWeather=overcast&debugCloud=OVC&debugTime=night"],
  ["Low performance","debugWeather=snow&debugPhenomena=%2BSN&debugIntensity=heavy&debugPerformance=low&debugTime=day"],
  ["Reduced motion","debugWeather=snow&debugPhenomena=SN&debugReducedMotion=1&debugTime=day"],
];

export default function PreviewLab({active,paneDrops,onPaneToggle}:{active:boolean;paneDrops:boolean|null;onPaneToggle:(v:boolean|null)=>void}){
  const [d,setD]=useState<Record<string,string>>({}),[hidden,setHidden]=useState(false),[diag,setDiag]=useState(true);
  useEffect(()=>{if(!active)return;const read=()=>{const m=document.querySelector("main.display") as HTMLElement|null,c=document.querySelector(".precip-canvas") as HTMLElement|null;if(!m)return;setD({
    precip:m.dataset.precipType||"none",secondary:m.dataset.secondaryPrecipType||"none",intensity:m.dataset.precipIntensity||"—",
    vis:m.dataset.visibility||"—",coverage:m.dataset.coverage||"—",tier:m.dataset.tier||"—",perf:m.dataset.performance||"—",reduced:m.dataset.reducedMotion==="1"?"yes":"no",
    obsc:m.dataset.obscuration||"none",density:m.dataset.obscurationDensity||"0",layers:m.dataset.activeObscurationLayers||"0",
    wind:`${m.dataset.winddir||"VRB"}° ${m.dataset.wind||0}kt · vec ${m.dataset.nx??""},${m.dataset.ny??""}`,
    count:c?.dataset.count||"0",primary:c?.dataset.primaryCount||"0",secondaryCount:c?.dataset.secondaryCount||"0",canvas:c?.dataset.active==="1"?"ACTIVE":"idle",fps:c?.dataset.fps||"—",
    drops:c?.dataset.dropCount||"0",rolling:c?.dataset.dropRolling||"0",trails:c?.dataset.trails==="1"?"on":"off",pane:c?.dataset.pane==="1"?"on":"off",
    cssW:c?.dataset.canvasCssWidth||"—",cssH:c?.dataset.canvasCssHeight||"—",bufW:c?.dataset.canvasBufferWidth||"—",bufH:c?.dataset.canvasBufferHeight||"—",dpr:c?.dataset.canvasDpr||"—",
  });};read();const id=window.setInterval(read,500);return()=>clearInterval(id);},[active]);
  if(!active)return null;
  const paneLabel=paneDrops===true?"ON":paneDrops===false?"OFF":"AUTO",cyclePane=()=>onPaneToggle(paneDrops===null?true:paneDrops===true?false:null);
  const links=(items:Preset[])=><nav>{items.map(([label,query])=><a key={label} href={`?${query}&previewWeatherFx=1`}>{label}</a>)}</nav>;
  return <aside className="fxlab" aria-label="Weather FX Preview"><header><b>WEATHER FX PREVIEW</b><span><button onClick={()=>setDiag(v=>!v)}>{diag?"DIAG−":"DIAG+"}</button><button onClick={()=>setHidden(v=>!v)}>{hidden?"SHOW":"HIDE"}</button></span></header>{!hidden&&<div className="fxlab-body">
    <div className="fxlab-toggle"><button onClick={cyclePane} className={paneDrops===false?"off":""}>WINDOW DROPLETS: {paneLabel}</button></div>
    {diag&&<dl>
      <div><dt>PRECIP</dt><dd>{d.precip} + {d.secondary} · {d.intensity}</dd></div>
      <div><dt>PARTICLES</dt><dd>{d.count} total · {d.primary}/{d.secondaryCount}</dd></div>
      <div><dt>CANVAS</dt><dd>{d.canvas} · {d.fps} fps</dd></div>
      <div><dt>OBSCURATION</dt><dd>{d.obsc} · {d.density} · {d.layers}L</dd></div>
      <div><dt>VIS / CLOUD</dt><dd>{d.vis}SM · {d.coverage} · tier {d.tier}</dd></div>
      <div><dt>WINDOW DROPS</dt><dd>{d.drops} · {d.rolling} rolling</dd></div>
      <div><dt>PANE / TRAILS</dt><dd>{d.pane} / {d.trails}</dd></div>
      <div><dt>CANVAS CSS</dt><dd>{d.cssW}×{d.cssH}</dd></div>
      <div><dt>BUFFER</dt><dd>{d.bufW}×{d.bufH} · DPR {d.dpr}</dd></div>
      <div><dt>WIND</dt><dd>{d.wind}</dd></div><div><dt>PERF / REDUCED</dt><dd>{d.perf} / {d.reduced}</dd></div>
    </dl>}
    <h4>PRECIPITATION</h4>{links(PRECIP)}<h4>OBSCURATION</h4>{links(OBSCURATION)}<h4>SCENE / PERFORMANCE</h4>{links(SOLAR)}<nav><a href="?">LIVE</a></nav>
  </div>}</aside>;
}
