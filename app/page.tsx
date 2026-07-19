"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "clear" | "partly-cloudy" | "overcast" | "rain" | "heavy-rain" | "thunderstorm" | "fog" | "snow" | "night" | "sunrise" | "sunset" | "neutral";
type Forecast = { time:string; temperatureF:number; condition:Theme; precipitation:number };
type Weather = { temperatureF:number; feelsLikeF:number; condition:Theme; description:string; windSpeedMph:number; windDirection:string; humidity:number; sunriseLocal:string; sunsetLocal:string; observationTime:string; forecast:Forecast[]; stale:boolean };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:15 };
const FALLBACK: Weather = { temperatureF:84, feelsLikeF:84, condition:"neutral", description:"Weather unavailable", windSpeedMph:0, windDirection:"—", humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", observationTime:"", forecast:[], stale:true };
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
async function getWeather():Promise<Weather> {
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=2`;
  const r=await fetch(url); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  const tm=(iso:string)=>iso?.slice(11,16)||"--:--";
  const start=Math.max(0,j.hourly.time.findIndex((t:string)=>t>=j.current.time));
  const forecast=[2,5,8].map(offset=>{const i=Math.min(start+offset,j.hourly.time.length-1);return {time:tm(j.hourly.time[i]),temperatureF:Math.round(j.hourly.temperature_2m[i]),condition:mapCode(j.hourly.weather_code[i],0).condition,precipitation:Math.round(j.hourly.precipitation_probability[i]||0)}});
  return {temperatureF:Math.round(j.current.temperature_2m),feelsLikeF:Math.round(j.current.apparent_temperature),...mapped,windSpeedMph:Math.round(j.current.wind_speed_10m),windDirection:windDirection(j.current.wind_direction_10m),humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:tm(j.daily.sunrise[0]),sunsetLocal:tm(j.daily.sunset[0]),observationTime:j.current.time,forecast,stale:false};
}
function weatherGlyph(c:Theme) { return ({clear:"☀",night:"☾",rain:"◒", "heavy-rain":"◒",thunderstorm:"ϟ",snow:"✣",fog:"≋",overcast:"●","partly-cloudy":"◕",sunrise:"◒",sunset:"◓",neutral:"—"} as Record<Theme,string>)[c]; }
function solarPhase(nowParts:Record<string,string>, sunrise:string, sunset:string):"day"|"night"|"sunrise"|"sunset" {
  const clock=Number(nowParts.hour)*60+Number(nowParts.minute), parse=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m};
  const rise=parse(sunrise), set=parse(sunset); if(!Number.isFinite(rise)||!Number.isFinite(set)) return clock<360||clock>1200?"night":"day";
  if(clock>=rise-30&&clock<=rise+60) return "sunrise";
  if(clock>=set-60&&clock<=set+20) return "sunset";
  return clock<rise-30||clock>set+20?"night":"day";
}
function solarProgress(nowParts:Record<string,string>, sunrise:string, sunset:string) { const parse=(v:string)=>{const [h,m]=v.split(":").map(Number);return h*60+m}, current=Number(nowParts.hour)*60+Number(nowParts.minute), rise=parse(sunrise), set=parse(sunset); return Number.isFinite(rise)&&Number.isFinite(set)?Math.max(0,Math.min(100,((current-rise)/(set-rise))*100)):0; }

export default function Home() {
  const [now,setNow]=useState(new Date()); const [weather,setWeather]=useState<Weather>(FALLBACK); const [online,setOnline]=useState(true); const [debug,setDebug]=useState<Theme|null>(null);
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),250); return()=>clearInterval(id); },[]);
  useEffect(()=>{
    const q=new URLSearchParams(location.search), sim=q.get("debugWeather") as Theme|null; if(sim&&DEBUG_THEMES.includes(sim)) setDebug(sim);
    const load=async()=>{try{const w=await getWeather();setWeather(w);localStorage.setItem("kmem-weather",JSON.stringify(w));setOnline(true)}catch{const old=localStorage.getItem("kmem-weather");if(old)setWeather({...JSON.parse(old),stale:true});setOnline(false)}};
    load(); const id=setInterval(load,CONFIG.weatherRefreshMinutes*60000); navigator.serviceWorker?.register("./service-worker.js").catch(()=>{}); return()=>clearInterval(id);
  },[]);
  const local=parts(now,CONFIG.timeZone), utc=parts(now,"UTC");
  const localTime=`${local.hour}:${local.minute}:${local.second}`, utcTime=`${utc.hour}:${utc.minute}:${utc.second}`;
  const displayTheme=debug||weather.condition;
  const phase=debug&&["night","sunrise","sunset"].includes(debug)?debug:solarPhase(local,weather.sunriseLocal,weather.sunsetLocal);
  const condition=debug&&!(["night","sunrise","sunset"] as Theme[]).includes(debug)?debug:weather.condition;
  const imageBase=process.env.NEXT_PUBLIC_BASE_PATH||"";
  const solarPct=solarProgress(local,weather.sunriseLocal,weather.sunsetLocal);
  const updated=weather.observationTime?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(weather.observationTime))+"Z":"—";
  const zone=local.timeZoneName||"LOCAL";
  const debugHref=useMemo(()=>DEBUG_THEMES.map(t=>`?debugWeather=${t}`),[]);
  return <main className={`display theme-${condition} phase-${phase}`}>
    <div className="sky" aria-hidden="true"><i className="sky-base" style={{backgroundImage:`url(${imageBase}/airfield-blue-hour.png)`}}/><i className="cloud c1"/><i className="cloud c2"/><i className="fog-layer"/><i className="weather-fx"/><i className="pavement-reflection"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><span className="brandmark">⌃</span><div><strong>{CONFIG.title}</strong><small>{CONFIG.airportCode} · MEMPHIS, TENNESSEE</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{zone}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel"><div className="panel-title"><span>SOLAR WINDOW</span><b>{Math.round(solarPct)}% DAYLIGHT</b></div><div className="sun-grid"><div><i className="sunrise-icon">◒</i><span>SUNRISE</span><strong>{weather.sunriseLocal}</strong><small>LOCAL</small></div><div><i className="sunset-icon">◓</i><span>SUNSET</span><strong>{weather.sunsetLocal}</strong><small>LOCAL</small></div></div><div className="solar-line"><i/><span className="solar-now" style={{left:`${solarPct}%`}}/><b/></div></article>
        <article className="forecast-card panel"><div className="panel-title"><span>FUTURE WEATHER</span><b>NEXT 9 HOURS</b></div><div className="forecast-grid">{weather.forecast?.length?weather.forecast.map((f,i)=><div key={`${f.time}-${i}`}><time>{f.time}</time><span>{weatherGlyph(f.condition)}</span><small className="forecast-condition">{f.condition.replace("-"," ")}</small><strong>{f.temperatureF}°</strong><small>{f.precipitation}% PRECIP</small></div>):<div className="forecast-empty">FORECAST UNAVAILABLE</div>}</div></article>
        <article className="weather-card panel"><div className="panel-title"><span>CURRENT WEATHER</span><b>JULIAN {julian4(now)}</b></div><div className="weather-main"><span className="weather-glyph">{weatherGlyph(displayTheme)}</span><strong>{weather.temperatureF}<span className="temp-unit">°F</span></strong><div><b>{debug?displayTheme.replace("-"," "):weather.description}</b><small>FEELS LIKE {weather.feelsLikeF??weather.temperatureF}° · WIND {weather.windSpeedMph} MPH {weather.windDirection}</small><small>HUMIDITY {weather.humidity}%</small></div></div>{weather.stale&&<span className="stale">WEATHER DATA STALE</span>}</article>
      </section>
      <footer><span><i/> DISPLAY ACTIVE · CLOCK: SYSTEM</span><span>WX {online?"CURRENT":"CACHED"} · UPDATED {updated} · OPEN-METEO</span><span>PRESS F11 FOR FULL SCREEN</span></footer>
    </div>
    {debug&&<nav className="debug" aria-label="Weather theme simulator"><b>SIM</b>{DEBUG_THEMES.map((t,i)=><a className={t===debug?"active":""} href={debugHref[i]} key={t}>{t.replace("-"," ")}</a>)}<a href="?">LIVE</a></nav>}
  </main>;
}
