"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "clear" | "partly-cloudy" | "overcast" | "rain" | "heavy-rain" | "thunderstorm" | "fog" | "snow" | "night" | "sunrise" | "sunset" | "neutral";
type Forecast = { time:string; iso:string; temperatureF:number; condition:Theme; description:string; precipitation:number; source:"TAF"|"MODEL" };
type Weather = { temperatureF:number; feelsLikeF:number; condition:Theme; description:string; windSpeedKt:number; windDirection:string; windDegrees:number|null; windGustKt:number|null; humidity:number; sunriseLocal:string; sunsetLocal:string; observationTime:string; forecast:Forecast[]; birdRisk:string; birdBasis:string; birdUpdated:string; source:"METAR"|"MODEL"; stale:boolean };
type OpsBoardWeather = { metar?:string; taf?:string; metarFetchStatus?:string; tafFetchStatus?:string; metarObservedZ?:string; bwc?:string; bwcAhasRisk?:string; bwcBasedOn?:string; bwcUpdatedZ?:string; bwcFetchStatus?:string };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:2, opsBoardWeatherUrl:"https://btenner1013.github.io/kmem-ops-board/weather.json" };
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", windSpeedKt:0, windDirection:"—", windDegrees:null, windGustKt:null, humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", observationTime:"", forecast:[], birdRisk:"UNAVAILABLE", birdBasis:"—", birdUpdated:"—", source:"MODEL", stale:true };
const DEBUG_THEMES: Theme[] = ["clear","partly-cloudy","overcast","rain","heavy-rain","thunderstorm","fog","snow","night","sunrise","sunset"];

function parts(date:Date, zone:string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone:zone, hour12:false, weekday:"long", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", timeZoneName:"short" }).formatToParts(date).map(p=>[p.type,p.value]));
}
function dateLine(p:Record<string,string>) { return `${p.weekday.toUpperCase()} • ${p.day} ${p.month.toUpperCase()} ${p.year}`; }
function julian4(date:Date) {
  const p = parts(date, CONFIG.timeZone); const y=Number(p.year), m=Number(new Intl.DateTimeFormat("en-US",{timeZone:CONFIG.timeZone,month:"numeric"}).format(date)), d=Number(p.day);
  const doy=Math.floor((Date.UTC(y,m-1,d)-Date.UTC(y,0,0))/86400000);
  return `${y%10}${String(doy).padStart(3,"0")}`;
}
function windDirection(deg:number) { const d=["N","NE","E","SE","S","SW","W","NW"]; return d[Math.round(deg/45)%8]; }
function mapCode(code:number, wind:number): Pick<Weather,"condition"|"description"> {
  if(code===0) return {condition:"clear",description:"Clear"};
  if(code<=2) return {condition:"partly-cloudy",description:"Partly cloudy"};
  if(code===3) return {condition:"overcast",description:"Overcast"};
  if([45,48].includes(code)) return {condition:"fog",description:"Fog"};
  if(code>=71&&code<=77) return {condition:"snow",description:"Snow"};
  if(code>=95) return {condition:"thunderstorm",description:"Thunderstorm"};
  if(code>=80 || (code>=61&&code<=67)) return {condition: wind>20?"heavy-rain":"rain",description:wind>20?"Heavy rain":"Rain"};
  return {condition:"overcast",description:"Cloudy"};
}
function aviationCondition(text:string):Pick<Weather,"condition"|"description"> {
  const core=(text||"").toUpperCase().split(/\sRMK\s/)[0];
  if(/(?:^|\s)(?:\+|-|VC)?TS[A-Z]*(?:\s|$)/.test(core)) return {condition:"thunderstorm",description:"Thunderstorms"};
  if(/(?:^|\s)\+(?:SH)?RA(?:\s|$)/.test(core)) return {condition:"heavy-rain",description:"Heavy rain"};
  if(/(?:^|\s)(?:\+|-|VC)?(?:SH)?RA(?:\s|$)|(?:^|\s)(?:\+|-)?DZ(?:\s|$)/.test(core)) return {condition:"rain",description:"Rain"};
  if(/(?:^|\s)(?:\+|-)?(?:SH)?SN(?:\s|$)|(?:^|\s)(?:SG|PL)(?:\s|$)/.test(core)) return {condition:"snow",description:"Snow"};
  if(/(?:^|\s)(?:FG|BR|HZ)(?:\s|$)/.test(core)) return {condition:"fog",description:/\bFG\b/.test(core)?"Fog":"Mist / haze"};
  if(/\bOVC\d{3}\b/.test(core)) return {condition:"overcast",description:"Overcast"};
  if(/\bBKN\d{3}\b/.test(core)) return {condition:"overcast",description:"Broken clouds"};
  if(/\bSCT\d{3}\b/.test(core)) return {condition:"partly-cloudy",description:"Scattered clouds"};
  if(/\bFEW\d{3}\b/.test(core)) return {condition:"partly-cloudy",description:"Few clouds"};
  if(/\b(?:CLR|SKC|NSC|CAVOK)\b/.test(core)) return {condition:"clear",description:"Clear"};
  return {condition:"overcast",description:"Cloudy"};
}
function signedCelsius(token:string) { return token.startsWith("M")?-Number(token.slice(1)):Number(token); }
function cToF(c:number) { return Math.round((c*9/5)+32); }
function parseMetar(raw:string) {
  const condition=aviationCondition(raw), temp=raw.match(/\s(M?\d{2})\/(?:M?\d{2}|XX)\s/), wind=raw.match(/(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT(?:\s|$)/);
  const degrees=wind&&wind[1]!=="VRB"?Number(wind[1]):null;
  return { ...condition, temperatureF:temp?cToF(signedCelsius(temp[1])):null, windSpeedKt:wind?Number(wind[2]):null, windGustKt:wind?.[3]?Number(wind[3]):null, windDegrees:degrees, windDirection:degrees===null?"VRB":windDirection(degrees) };
}
function resolveTafDate(day:number,hour:number,minute:number,reference:Date) {
  const candidates=[-1,0,1].map(monthOffset=>new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()+monthOffset,day,hour,minute)));
  return candidates.sort((a,b)=>Math.abs(a.getTime()-reference.getTime())-Math.abs(b.getTime()-reference.getTime()))[0];
}
function tafForecast(model:Forecast[],raw:string,reference:Date):Forecast[] {
  const taf=(raw||"").replace(/\s+/g," ").trim(), validity=taf.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/); if(!validity) return model;
  const periods:{from:Date;condition:Theme;description:string}[]=[];
  const validityEnd=(validity.index||0)+validity[0].length, firstFm=taf.slice(validityEnd).search(/\sFM\d{6}\b/), baseEnd=firstFm<0?taf.length:validityEnd+firstFm;
  const baseCondition=aviationCondition(taf.slice(validityEnd,baseEnd));
  periods.push({from:resolveTafDate(Number(validity[1]),Number(validity[2]),0,reference),...baseCondition});
  const fm=/\bFM(\d{2})(\d{2})(\d{2})\s+([\s\S]*?)(?=\sFM\d{6}\b|$)/g; let match:RegExpExecArray|null;
  while((match=fm.exec(taf))!==null){const parsed=aviationCondition(match[4]);periods.push({from:resolveTafDate(Number(match[1]),Number(match[2]),Number(match[3]),reference),...parsed});}
  periods.sort((a,b)=>a.from.getTime()-b.from.getTime());
  return model.map(slot=>{const target=new Date(slot.iso);let active=periods[0];for(const period of periods){if(period.from<=target) active=period;else break;}return {...slot,condition:active.condition,description:active.description,source:"TAF"};});
}
async function getModelWeather():Promise<Weather> {
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=2`;
  const r=await fetch(url); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  const tm=(iso:string)=>iso?.slice(11,16)||"--:--", utcOffset=Number(j.utc_offset_seconds||0), utcIso=(iso:string)=>new Date(new Date(`${iso}:00Z`).getTime()-utcOffset*1000).toISOString();
  const start=Math.max(0,j.hourly.time.findIndex((t:string)=>t>=j.current.time));
  const forecast:Forecast[]=[2,5,8].map(offset=>{const i=Math.min(start+offset,j.hourly.time.length-1),condition=mapCode(j.hourly.weather_code[i],0);return {time:tm(j.hourly.time[i]),iso:utcIso(j.hourly.time[i]),temperatureF:Math.round(j.hourly.temperature_2m[i]),...condition,precipitation:Math.round(j.hourly.precipitation_probability[i]||0),source:"MODEL"}});
  const windDegrees=Math.round(j.current.wind_direction_10m);
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,windSpeedKt:Math.round(j.current.wind_speed_10m),windDirection:windDirection(windDegrees),windDegrees,windGustKt:null,humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:tm(j.daily.sunrise[0]),sunsetLocal:tm(j.daily.sunset[0]),observationTime:j.current.time,forecast,birdRisk:"UNAVAILABLE",birdBasis:"—",birdUpdated:"—",source:"MODEL",stale:false};
}
async function getWeather():Promise<Weather> {
  const model=await getModelWeather();
  try {
    const response=await fetch(`${CONFIG.opsBoardWeatherUrl}?v=${Date.now()}`,{cache:"no-store"}); if(!response.ok) return model;
    const ops:OpsBoardWeather=await response.json(), rawMetar=ops.metar||"", rawTaf=ops.taf||"";
    const metarValid=/\b(?:METAR\s+)?KMEM\b/.test(rawMetar.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawMetar.toUpperCase());
    const tafValid=/\bTAF\s+KMEM\b/.test(rawTaf.toUpperCase())&&!/UNAVAILABLE|ERROR/.test(rawTaf.toUpperCase());
    const metar=metarValid?parseMetar(rawMetar):null, reference=ops.metarObservedZ?new Date(ops.metarObservedZ):new Date();
    return {...model,temperatureF:metar?.temperatureF??model.temperatureF,condition:metar?.condition??model.condition,description:metar?.description??model.description,windSpeedKt:metar?.windSpeedKt??model.windSpeedKt,windDirection:metar?.windDirection??model.windDirection,windDegrees:metar?.windDegrees??model.windDegrees,windGustKt:metar?.windGustKt??model.windGustKt,observationTime:metarValid?(ops.metarObservedZ||model.observationTime):model.observationTime,forecast:tafValid?tafForecast(model.forecast,rawTaf,reference):model.forecast,birdRisk:(ops.bwcAhasRisk||ops.bwc||"UNAVAILABLE").toUpperCase(),birdBasis:(ops.bwcBasedOn||"AHAS").toUpperCase(),birdUpdated:ops.bwcUpdatedZ||"—",source:metarValid?"METAR":"MODEL",stale:metarValid?ops.metarFetchStatus!=="OK":model.stale};
  } catch { return model; }
}
function weatherGlyph(c:Theme) { return ({clear:"☀",night:"☾",rain:"🌧", "heavy-rain":"🌧",thunderstorm:"⛈",snow:"❄",fog:"≋",overcast:"☁","partly-cloudy":"⛅",sunrise:"☀",sunset:"☀",neutral:"—"} as Record<Theme,string>)[c]; }
function solarPhase(nowParts:Record<string,string>, sunrise:string, sunset:string):"day"|"night"|"sunrise"|"sunset" {
  const clock=Number(nowParts.hour)*60+Number(nowParts.minute), parse=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m};
  const rise=parse(sunrise), set=parse(sunset); if(!Number.isFinite(rise)||!Number.isFinite(set)) return clock<360||clock>1200?"night":"day";
  if(clock>=rise-30&&clock<=rise+60) return "sunrise";
  if(clock>=set-60&&clock<=set+20) return "sunset";
  return clock<rise-30||clock>set+20?"night":"day";
}
function solarProgress(nowParts:Record<string,string>, sunrise:string, sunset:string) { const parse=(v:string)=>{const [h,m]=v.split(":").map(Number);return h*60+m}, current=Number(nowParts.hour)*60+Number(nowParts.minute), rise=parse(sunrise), set=parse(sunset); return Number.isFinite(rise)&&Number.isFinite(set)?Math.max(0,Math.min(100,((current-rise)/(set-rise))*100)):0; }
function zStamp(value:string) { const match=(value||"").match(/\d{4}-\d{2}-(\d{2})[ T](\d{2}):(\d{2})/); return match?`${match[1]}/${match[2]}${match[3]}Z`:"—"; }
function sceneFor(condition:Theme,phase:"day"|"night"|"sunrise"|"sunset") {
  const light=phase==="night"?"night":"day";
  if(condition==="clear") return `clear-${light}`;
  if(condition==="partly-cloudy") return `partly-${light}`;
  if(condition==="overcast") return `overcast-${light}`;
  if(condition==="rain") return `rain-${light}`;
  if(condition==="heavy-rain") return `heavy-rain-${light}`;
  if(condition==="thunderstorm") return `storm-${light}`;
  if(condition==="fog") return `fog-${light}`;
  if(condition==="snow") return `snow-${light}`;
  return phase==="night"?"clear-night":phase==="sunrise"?"sunrise":phase==="sunset"?"sunset":"blue-hour";
}

export default function Home() {
  const [now,setNow]=useState(()=>new Date(0)); const [weather,setWeather]=useState<Weather>(FALLBACK); const [online,setOnline]=useState(true); const [debug,setDebug]=useState<Theme|null>(null); const [debugPhase,setDebugPhase]=useState<"day"|"night"|null>(null); const [debugBird,setDebugBird]=useState<"LOW"|"MODERATE"|"SEVERE"|null>(null);
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),250); return()=>clearInterval(id); },[]);
  useEffect(()=>{
    const q=new URLSearchParams(location.search), sim=q.get("debugWeather") as Theme|null, simPhase=q.get("debugTime"), simBird=q.get("debugBwc")?.toUpperCase(); if(sim&&DEBUG_THEMES.includes(sim)) setDebug(sim); if(simPhase==="day"||simPhase==="night") setDebugPhase(simPhase); if(simBird==="LOW"||simBird==="MODERATE"||simBird==="SEVERE") setDebugBird(simBird);
    const load=async()=>{try{const w=await getWeather();setWeather(w);localStorage.setItem("kmem-weather",JSON.stringify(w));setOnline(true)}catch{const old=localStorage.getItem("kmem-weather");if(old)setWeather({...JSON.parse(old),stale:true});setOnline(false)}};
    load(); const id=setInterval(load,CONFIG.weatherRefreshMinutes*60000); navigator.serviceWorker?.register("./service-worker.js").catch(()=>{}); return()=>clearInterval(id);
  },[]);
  const local=parts(now,CONFIG.timeZone), utc=parts(now,"UTC");
  const localTime=`${local.hour}:${local.minute}:${local.second}`, utcTime=`${utc.hour}:${utc.minute}:${utc.second}`;
  const displayTheme=debug||weather.condition;
  const phase=debugPhase||(debug?(debug==="night"||debug==="sunrise"||debug==="sunset"?debug:"day"):solarPhase(local,weather.sunriseLocal,weather.sunsetLocal));
  const condition=debug&&!(["night","sunrise","sunset"] as Theme[]).includes(debug)?debug:weather.condition;
  const imageBase=process.env.NEXT_PUBLIC_BASE_PATH||"";
  const scene=sceneFor(condition,phase);
  const solarPct=solarProgress(local,weather.sunriseLocal,weather.sunsetLocal);
  const updated=weather.observationTime?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(weather.observationTime))+"Z":"—";
  const zone=local.timeZoneName||"LOCAL";
  const windLabel=weather.windDegrees===null?"VRB":`${String(weather.windDegrees).padStart(3,"0")}° ${weather.windDirection}`;
  const birdRisk=debugBird||weather.birdRisk;
  const birdClass=/SEVERE|HIGH/.test(birdRisk)?"severe":/MODERATE/.test(birdRisk)?"moderate":/LOW/.test(birdRisk)?"low":"unknown", birdStamp=zStamp(weather.birdUpdated);
  const debugHref=useMemo(()=>DEBUG_THEMES.map(t=>`?debugWeather=${t}`),[]);
  return <main className={`display theme-${condition} phase-${phase}`}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/airfield-${scene}.png)`}}/><i className="cloud c1"/><i className="cloud c2"/><i className="fog-layer"/><i className="weather-fx"/><i className="glass-droplets">{Array.from({length:18},(_,i)=><span key={i}/>)}</i><i className="lightning-layer" style={{backgroundImage:`url(${imageBase}/airfield-lightning-overlay.png)`}}/><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><span className="brandmark">⌃</span><div><strong>{CONFIG.title}</strong><small>{CONFIG.airportCode} · MEMPHIS, TENNESSEE</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{zone}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel"><div className="panel-title"><span>SOLAR WINDOW</span><b>{Math.round(solarPct)}% ELAPSED</b></div><div className="sun-grid"><div><i className="sunrise-icon">◒</i><span>SUNRISE</span><strong>{weather.sunriseLocal}</strong><small>LOCAL</small></div><div><i className="sunset-icon">◓</i><span>SUNSET</span><strong>{weather.sunsetLocal}</strong><small>LOCAL</small></div></div><div className="solar-line"><span className="solar-fill" style={{width:`${solarPct}%`}}/><i/><span className="solar-now" style={{left:`${solarPct}%`}}><small>NOW</small></span><b/></div></article>
        <article className="weather-card panel"><div className="panel-title"><span>CURRENT WEATHER</span><b>{weather.source==="METAR"?"KMEM METAR":CONFIG.locationName.toUpperCase()}</b></div><div className="weather-main"><span className="weather-glyph">{weatherGlyph(displayTheme)}</span><strong>{weather.temperatureF}<span className="temp-unit">°F</span></strong><div className="weather-copy"><b>{debug?displayTheme.replace("-"," "):weather.description}</b><small className="feels-like">FEELS LIKE <strong>{weather.feelsLikeF??weather.temperatureF}°F</strong></small><small className="weather-stats"><span className="wind-data"><i className={weather.windDegrees===null?"variable":""} style={weather.windDegrees===null?undefined:{transform:`rotate(${weather.windDegrees+180}deg)`}} aria-hidden="true">{weather.windDegrees===null?"↻":"↑"}</i> WIND {windLabel} {weather.windSpeedKt}{weather.windGustKt?`G${weather.windGustKt}`:""} KT</span><span>HUMIDITY {weather.humidity}%</span></small><small className={`bird-risk risk-${birdClass}`}><span>USAHAS BWC</span><strong>{birdRisk}</strong><time>{weather.birdBasis} · {birdStamp}</time></small></div></div>{weather.stale&&<span className="stale">METAR DATA STALE</span>}</article>
        <article className="forecast-card panel"><div className="panel-title"><span>FUTURE WEATHER · NEXT 9 HOURS</span><b>TAF · JULIAN {julian4(now)}</b></div><div className="forecast-grid">{weather.forecast?.length?weather.forecast.map((f,i)=><div key={`${f.time}-${i}`}><time>{f.time}</time><span>{weatherGlyph(f.condition)}</span><small className="forecast-condition">{f.description}</small><strong>{f.temperatureF}°</strong><small>{f.precipitation}% PRECIP</small></div>):<div className="forecast-empty">FORECAST UNAVAILABLE</div>}</div></article>
      </section>
      <footer><span><i/> DISPLAY ACTIVE · CLOCK: SYSTEM · BURN SHIFT ON</span><span>WX {online?"CURRENT":"CACHED"} · UPDATED {updated} · METAR / TAF + MODEL</span><span>PRESS F11 FOR FULL SCREEN</span></footer>
    </div>
    {debug&&<nav className="debug" aria-label="Weather theme simulator"><b>SIM</b>{DEBUG_THEMES.map((t,i)=><a className={t===debug?"active":""} href={debugHref[i]} key={t}>{t.replace("-"," ")}</a>)}<a className={debugPhase==="day"?"active":""} href={`?debugWeather=${condition}&debugTime=day`}>DAY</a><a className={debugPhase==="night"?"active":""} href={`?debugWeather=${condition}&debugTime=night`}>NIGHT</a>{(["LOW","MODERATE","SEVERE"] as const).map(level=><a className={debugBird===level?"active":""} href={`?debugWeather=${condition}&debugTime=${phase==="night"?"night":"day"}&debugBwc=${level.toLowerCase()}`} key={level}>BWC {level}</a>)}<a href="?">LIVE</a></nav>}
  </main>;
}
