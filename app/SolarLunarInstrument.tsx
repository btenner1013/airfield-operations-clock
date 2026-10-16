"use client";

import { useId } from "react";
import { moonIlluminatedPath, solarDialProgressPath, solarDisplayProgress, solarLocalTime, solarWindowAvailable, showLunarInformation, type MoonPhaseInfo, type SolarInstrumentWindow } from "./solarLunar";

/** Decorative maria/craters stay fixed under the phase mask. No rotating texture or moon-position claim. */
export function MoonPhaseDisc({ phase, name, x, y, size }: MoonPhaseInfo & { x?: number; y?: number; size?: number }) {
  const id = `moon-${useId().replace(/:/g, "")}`;
  const illuminated = moonIlluminatedPath(phase);
  const surface = (
      <g>
        <circle r="40" fill={`url(#${id}-body)`} />
        {/* Broad, irregular albedo markings read as lunar terrain at small display sizes. */}
        <g fill="#677d84" opacity=".4">
          <path d="M-27 -23 C-23 -32 -9 -34 -3 -27 C1 -23 -1 -16 -7 -14 C-13 -11 -12 -6 -20 -5 C-28 -5 -32 -15 -27 -23Z" />
          <path d="M-4 -17 C1 -25 13 -27 18 -20 C22 -17 18 -11 24 -8 C27 -3 23 5 16 6 C7 9 4 1 -1 0 C-8 -3 -9 -11 -4 -17Z" />
          <path d="M23 -23 C28 -27 35 -20 34 -13 C34 -6 29 -4 25 -9 C22 -13 19 -19 23 -23Z" />
          <path d="M-30 -1 C-27 -7 -16 -5 -12 1 C-9 7 -17 13 -23 12 C-31 12 -35 5 -30 -1Z" />
          <path d="M-11 4 C-5 0 3 7 0 14 C-4 19 -11 17 -13 12Z" />
        </g>
        <g fill="none" stroke="#5b707b" strokeWidth="1.1" opacity=".38">
          <circle cx="-14" cy="-19" r="5.5" /><circle cx="16" cy="-10" r="4.2" /><circle cx="-22" cy="7" r="3.4" />
          <circle cx="8" cy="22" r="5.5" /><circle cx="-5" cy="29" r="3" /><circle cx="26" cy="14" r="3.1" />
          <circle cx="-24" cy="23" r="2" /><circle cx="4" cy="-31" r="2.1" /><circle cx="29" cy="-1" r="2" />
        </g>
        <g fill="none" stroke="#eef0e8" strokeWidth=".8" opacity=".55">
          <path d="M2.5 22 A5.5 5.5 0 0 1 13.5 22 M-8 29 A3 3 0 0 1 -2 29 M22.9 14 A3.1 3.1 0 0 1 29.1 14" />
          <path d="M8 17 L8 11 M12 19 L18 14 M13 24 L20 28 M6 27 L3 35 M3 23 L-4 25" opacity=".5" />
        </g>
        <g fill="#f0eee3" opacity=".6"><circle cx="8" cy="22" r="1.6" /><circle cx="-8" cy="-3" r="1.2" /><circle cx="-20" cy="-29" r="1" /><circle cx="20" cy="29" r="1.1" /><circle cx="-29" cy="-10" r=".8" /></g>
        <circle r="40" fill={`url(#${id}-limb)`} />
      </g>
  );
  return <svg className="lunar-disc" x={x} y={y} width={size} height={size} viewBox="-50 -50 100 100" role="img" aria-label={`${name.toLowerCase()}, north-up phase view`}>
    <defs>
      <radialGradient id={`${id}-body`} cx="36%" cy="30%" r="74%"><stop offset="0" stopColor="#f0eee3" /><stop offset=".48" stopColor="#c8cecd" /><stop offset=".83" stopColor="#a3afb2" /><stop offset="1" stopColor="#687e88" /></radialGradient>
      <radialGradient id={`${id}-limb`} cx="48%" cy="45%" r="53%"><stop offset=".64" stopColor="#07131b" stopOpacity="0" /><stop offset="1" stopColor="#07131b" stopOpacity=".42" /></radialGradient>
      <radialGradient id={`${id}-halo`}><stop offset=".65" stopColor="#a8cfdf" stopOpacity=".09" /><stop offset="1" stopColor="#a8cfdf" stopOpacity="0" /></radialGradient>
      <clipPath id={`${id}-disc`}><circle r="40" /></clipPath>
      <clipPath id={`${id}-lit`}>{illuminated && <path d={illuminated} />}</clipPath>

    </defs>
    <circle r="49" fill={`url(#${id}-halo)`} />
    <circle r="40" fill="#09151d" />
    <g clipPath={`url(#${id}-disc)`}>
      <g opacity=".105">{surface}</g>
      {illuminated && <g clipPath={`url(#${id}-lit)`}>{surface}</g>}
    </g>
    <circle r="40" fill="none" stroke="#b2cad4" strokeOpacity=".32" strokeWidth=".65" />
  </svg>;
}

/** The original sun-above / moon-below cycle, polished without changing its geometry. */
export function SolarLunarDial({ solar, moon }: { solar: SolarInstrumentWindow; moon: MoonPhaseInfo }) {
  const id = `solar-${useId().replace(/:/g, "")}`;
  const progress = solarDisplayProgress(solar.progress);
  const available = solarWindowAvailable(solar);
  const elapsed = available ? solarDialProgressPath(solar) : null;
  const sunColor = progress !== null && progress >= 85 ? "#f5a076" : "#f1c578";
  const phaseText = available ? solar.daylight ? "DAYLIGHT" : "NIGHT" : "SOLAR TIMES";
  return <svg className="solar-lunar-dial" viewBox="-12 -4 224 164" role="img" aria-label={available ? `${solar.daylight ? "Daylight" : "Night"}, ${Math.round(progress!)} percent elapsed. ${showLunarInformation(solar) ? `${moon.name.toLowerCase()}, north-up phase view. ` : ""}Schematic time progress, not celestial position.` : "Solar times unavailable."} data-cycle={available ? solar.daylight ? "day" : "night" : "unavailable"}>
    <defs>
      <linearGradient id={`${id}-day`} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0" stopColor="#efb66a" /><stop offset=".5" stopColor="#f8dca3" /><stop offset="1" stopColor="#e99772" /></linearGradient>
      <radialGradient id={`${id}-sun-halo`}><stop offset="0" stopColor={sunColor} stopOpacity=".45" /><stop offset="1" stopColor={sunColor} stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-sun-core`} cx="38%" cy="30%" r="75%"><stop offset="0" stopColor="#fffdf0" /><stop offset=".55" stopColor="#fff0c4" /><stop offset="1" stopColor={sunColor} /></radialGradient>
    </defs>
    <ellipse cx="100" cy="78" rx="108" ry="76" fill="#01070b" fillOpacity=".48" />
    <ellipse cx="100" cy="76" rx="106" ry="74" fill="#142a37" stroke="#526e7d" strokeWidth="1.1" />
    <ellipse cx="100" cy="76" rx="103" ry="71" fill="#091720" stroke="#020b11" strokeWidth="1.3" />
    <ellipse cx="100" cy="76" rx="101" ry="69" fill="none" stroke="#7894a3" strokeOpacity=".12" strokeWidth=".7" />
    <path d="M12 76 A88 56 0 0 1 188 76 Z" fill="#f1bd6d" fillOpacity=".025" />
    <path d="M188 76 A88 56 0 0 1 12 76 Z" fill="#76bde4" fillOpacity=".035" />
    {Array.from({ length: 36 }, (_, index) => {
      const a = index * Math.PI / 18;
      const major = index % 3 === 0;
      return <line key={index} className={major ? "solar-dial-tick major" : "solar-dial-tick"} x1={(100 + Math.cos(a) * 98).toFixed(3)} y1={(76 + Math.sin(a) * 66).toFixed(3)} x2={(100 + Math.cos(a) * (major ? 93 : 95)).toFixed(3)} y2={(76 + Math.sin(a) * (major ? 61 : 63)).toFixed(3)} stroke={index > 18 ? "#d1b28a" : "#7fabc1"} strokeWidth={major ? 1 : .65} strokeOpacity={major ? .68 : .38} />;
    })}
    <path className="solar-dial-day-arc" d="M12 76 A88 56 0 0 1 188 76" fill="none" stroke={`url(#${id}-day)`} strokeOpacity={solar.daylight ? ".48" : ".22"} strokeWidth="2" />
    <path className="solar-dial-night-arc" d="M188 76 A88 56 0 0 1 12 76" fill="none" stroke="#83b7d1" strokeOpacity={solar.daylight ? ".24" : ".45"} strokeWidth="1.5" strokeDasharray="2 4" />
    {elapsed && <path className="solar-dial-elapsed" d={elapsed} fill="none" stroke={solar.daylight ? `url(#${id}-day)` : "#a5d1e7"} strokeWidth={solar.daylight ? "2.7" : "2.2"} strokeLinecap="round" />}
    <path d="M5 76 H195" stroke="#7f9aa8" strokeOpacity=".28" strokeWidth=".75" strokeDasharray="2 3" />
    <circle cx="12" cy="76" r="2.1" fill="#e8bc80" /><circle cx="188" cy="76" r="2.1" fill="#dfa17c" />
    <rect x="49" y="47" width="102" height="61" rx="12" fill="#091720" fillOpacity=".94" />
    <g textAnchor="middle" fontFamily="Consolas, monospace">
      <text className="solar-dial-cycle-label" x="100" y="62" fontSize="11" fontWeight="800" letterSpacing="1.2" fill={solar.daylight ? "#ffdda0" : "#d1edfc"}>{phaseText}</text>
      <text className="solar-dial-percentage" x="100" y="88" fontSize={available ? "29" : "20"} fontWeight="900" letterSpacing="-.7" fill="#f6fbff">{available ? `${Math.round(progress!)}%` : "—"}</text>
      <text className="solar-dial-progress-label" x="100" y="103" fontSize="8" fontWeight="700" letterSpacing=".8" fill="#b8d0dc">{available ? "CYCLE ELAPSED" : "UNAVAILABLE"}</text>
    </g>
    {/* The moon graphic appears only during the existing resolved night window. */}
    {available && solar.daylight && <g className="solar-dial-sun" transform={`translate(${solar.markerX.toFixed(3)} ${solar.markerY.toFixed(3)})`}>
      <circle r="23" fill={`url(#${id}-sun-halo)`} />
      <g stroke={sunColor} strokeWidth="1.05" strokeLinecap="round">{Array.from({ length: 8 }, (_, n) => <path key={n} d="M0 -11 V-14" transform={`rotate(${n * 45})`} />)}</g>
      <circle r="8" fill={`url(#${id}-sun-core)`} stroke="#fff4d2" strokeWidth=".6" />
    </g>}
    {available && !solar.daylight && <g className="solar-dial-moon" data-marker-x={solar.markerX} data-marker-y={solar.markerY}><MoonPhaseDisc phase={moon.phase} name={moon.name} x={solar.markerX - 22.5} y={solar.markerY - 22.5} size={45} /></g>}
  </svg>;
}

export default function SolarLunarInstrument({ solar, moon }: { solar: SolarInstrumentWindow; moon: MoonPhaseInfo }) {
  const dayLabel = solar.isTomorrow ? "TOMORROW" : "TODAY";
  const showMoon = showLunarInformation(solar);
  return <div className={`solar-lunar-instrument${solar.daylight ? " is-daylight" : " is-night"}`} data-moon-phase={showMoon ? moon.phase : undefined}>
    <div className="solar-dial-wrap"><SolarLunarDial solar={solar} moon={moon} /></div>
    {showMoon && <div className="solar-lunar-caption"><strong>{moon.name}</strong><small>MOON PHASE</small></div>}
    <div className="solar-lunar-times">
      <div><span>SUNRISE</span><strong>{solarLocalTime(solar.sunrise)}</strong><small>{dayLabel}</small></div>
      <div><span>SUNSET</span><strong>{solarLocalTime(solar.sunset)}</strong><small>{dayLabel}</small></div>
    </div>
  </div>;
}
