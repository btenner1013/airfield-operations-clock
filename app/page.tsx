"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "clear" | "partly-cloudy" | "overcast" | "rain" | "heavy-rain" | "thunderstorm" | "fog" | "snow" | "night" | "sunrise" | "sunset" | "neutral";
type Weather = { temperatureF:number; condition:Theme; description:string; windSpeedMph:number; windDirection:string; humidity:number; sunriseLocal:string; sunsetLocal:string; observationTime:string; stale:boolean };

const CONFIG = { title:"AIRFIELD OPERATIONS", airportCode:"KMEM", locationName:"Memphis, Tennessee", latitude:35.0424, longitude:-89.9767, timeZone:"America/Chicago", weatherRefreshMinutes:15 };
const FALLBACK: Weather = { temperatureF:84, condition:"neutral", description:"Weather unavailable", windSpeedMph:0, windDirection:"—", humidity:0, sunriseLocal:"--:--", sunsetLocal:"--:--", observationTime:"", stale:true };
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
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.latitude}&longitude=${CONFIG.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(CONFIG.timeZone)}&forecast_days=1`;
  const r=await fetch(url); if(!r.ok) throw new Error("weather"); const j=await r.json(); const mapped=mapCode(j.current.weather_code,j.current.wind_speed_10m);
  const tm=(iso:string)=>iso?.slice(11,16)||"--:--";
  return {temperatureF:Math.round(j.current.temperature_2m),...mapped,windSpeedMph:Math.round(j.current.wind_speed_10m),windDirection:windDirection(j.current.wind_direction_10m),humidity:Math.round(j.current.relative_humidity_2m),sunriseLocal:tm(j.daily.sunrise[0]),sunsetLocal:tm(j.daily.sunset[0]),observationTime:j.current.time,stale:false};
}
function weatherGlyph(c:Theme) { return ({clear:"☀",night:"☾",rain:"◒", "heavy-rain":"◒",thunderstorm:"ϟ",snow:"✣",fog:"≋",overcast:"●","partly-cloudy":"◕",sunrise:"◒",sunset:"◓",neutral:"—"} as Record<Theme,string>)[c]; }

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
  const updated=weather.observationTime?new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(weather.observationTime))+"Z":"—";
  const zone=local.timeZoneName||"LOCAL";
  const debugHref=useMemo(()=>DEBUG_THEMES.map(t=>`?debugWeather=${t}`),[]);
  return <main className={`display theme-${displayTheme}`}>
    <div className="sky" aria-hidden="true"><i className="cloud c1"/><i className="cloud c2"/><i className="weather-fx"/><i className="horizon"/><i className="runway"/></div>
    <div className="shade"/><div className="burn-shift">
      <header><div className="brand"><span className="brandmark">⌃</span><div><strong>{CONFIG.title}</strong><small>{CONFIG.airportCode} · MEMPHIS, TENNESSEE</small></div></div><div className="header-date"><small>LOCAL DATE</small><strong>{dateLine(local)}</strong></div></header>
      <section className="clocks" aria-label="Local and Zulu clocks">
        <article className="clock local"><div className="clock-head"><span>LOCAL</span><b><i/> ON STATION</b></div><time>{localTime}</time><div className="clock-foot"><strong>{zone}</strong><span>{dateLine(local)}</span></div></article>
        <article className="clock zulu"><div className="clock-head"><span>ZULU</span><b><i/> UNIVERSAL</b></div><time>{utcTime}<em>Z</em></time><div className="clock-foot"><strong>UTC</strong><span>{dateLine(utc)}</span></div></article>
      </section>
      <section className="info">
        <article className="sun-card panel"><div className="panel-title"><span>SOLAR WINDOW</span><b>{CONFIG.airportCode}</b></div><div className="sun-grid"><div><i className="sunrise-icon">◒</i><span>SUNRISE</span><strong>{weather.sunriseLocal}</strong><small>LOCAL</small></div><div><i className="sunset-icon">◓</i><span>SUNSET</span><strong>{weather.sunsetLocal}</strong><small>LOCAL</small></div></div><div className="solar-line"><i/><b/></div></article>
        <article className="weather-card panel"><div className="panel-title"><span>CURRENT WEATHER</span><b>{CONFIG.locationName.toUpperCase()}</b></div><div className="weather-main"><span className="weather-glyph">{weatherGlyph(displayTheme)}</span><strong>{weather.temperatureF}<sup>°F</sup></strong><div><b>{debug?displayTheme.replace("-"," "):weather.description}</b><small>WIND {weather.windSpeedMph} MPH {weather.windDirection} · HUMIDITY {weather.humidity}%</small></div></div>{weather.stale&&<span className="stale">WEATHER DATA STALE</span>}</article>
        <article className="status-card panel"><div className="panel-title"><span>SYSTEM STATUS</span><b>OPS DISPLAY</b></div><div className="status-grid"><div><span>JULIAN DATE</span><strong>{julian4(now)}</strong></div><div><span>CLOCK SOURCE</span><strong><i/> SYSTEM</strong></div><div><span>WEATHER</span><strong className={online?"good":"warn"}><i/> {online?"CURRENT":"CACHED"}</strong></div><div><span>UPDATED</span><strong>{updated}</strong></div></div></article>
      </section>
      <footer><span><i/> DISPLAY ACTIVE</span><span>DATA: OPEN-METEO · REF {CONFIG.airportCode}</span><span>PRESS F11 FOR FULL SCREEN</span></footer>
    </div>
    {debug&&<nav className="debug" aria-label="Weather theme simulator"><b>SIM</b>{DEBUG_THEMES.map((t,i)=><a className={t===debug?"active":""} href={debugHref[i]} key={t}>{t.replace("-"," ")}</a>)}<a href="?">LIVE</a></nav>}
  </main>;
}
