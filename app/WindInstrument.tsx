"use client";

import { useEffect, useState } from "react";
import type { CurrentWindRecord } from "./currentWind";
import { buildWindCompassModel, closestWindRotation } from "./windCompass";

function WindNeedle({ bearing, reduced }: { bearing: number; reduced: boolean }) {
  const [rotation, setRotation] = useState(bearing);
  useEffect(() => { setRotation(previous => closestWindRotation(previous, bearing)); }, [bearing]);
  return <g className={`wind-needle${reduced ? " is-reduced" : ""}`} style={{ transform: `rotate(${rotation}deg)` }}>
    {/* The source marker is at the reported FROM bearing. The arrow points away from it. */}
    <path className="wind-from-marker" d="M60 26 L64 33 L56 33 Z" />
    <path className="wind-flow-line" d="M60 36 V83" />
    <path className="wind-flow-head" d="M60 91 L53 78 L60 81 L67 78 Z" />
    <circle className="wind-pivot" cx="60" cy="60" r="3" />
  </g>;
}

export default function WindInstrument({ wind, nowMs, reduced }: { wind: CurrentWindRecord | null; nowMs: number; reduced: boolean }) {
  const model = buildWindCompassModel(wind, nowMs);
  const directional = model.state === "directional";
  const unavailable = model.state === "unavailable" || model.state === "stale";
  const directionDetail = directional ? model.sector ? `VAR ${model.sector}` : null : model.state === "variable" ? "NO FIXED DIRECTION" : model.state === "calm" ? "NO DIRECTIONAL FLOW" : "NO CURRENT OBSERVATION";
  return <div className={`wind-instrument wind-state-${model.state}`} data-wind-state={model.state} data-wind-source={wind?.source} data-wind-time={wind?.observedAt ?? undefined} role="img" aria-label={model.description}>
    <div className="wind-instrument-body" aria-hidden="true">
      <div className="wind-dial-wrap">
        <svg className="wind-dial" viewBox="0 0 120 120" fill="none">
          <circle className="wind-dial-face" cx="60" cy="60" r="58" />
          <circle className="wind-dial-inner" cx="60" cy="60" r="36" />
          {Array.from({ length: 36 }, (_, index) => <line key={index} className={`wind-dial-tick${index % 3 === 0 ? " major" : ""}`} x1="60" y1="5" x2="60" y2={index % 3 === 0 ? "11" : "8"} transform={`rotate(${index * 10} 60 60)`} />)}
          <g className="wind-dial-cardinals">
            <text className="wind-dial-north" x="60" y="19">N</text><text x="103" y="64">E</text><text x="60" y="109">S</text><text x="17" y="64">W</text>
          </g>
          {model.sectorPath && <path className="wind-sector-arc" d={model.sectorPath} />}
          {directional && model.bearing !== null && <WindNeedle bearing={model.bearing} reduced={reduced} />}
          {model.state === "calm" && <><circle className="wind-calm-ring" cx="60" cy="60" r="18" /><circle className="wind-calm-center" cx="60" cy="60" r="3" /></>}
          {model.state === "variable" && <><circle className="wind-variable-ring" cx="60" cy="60" r="24" /><text className="wind-dial-state" x="60" y="64">VRB</text></>}
          {unavailable && <text className="wind-dial-state" x="60" y="65">—</text>}
        </svg>
      </div>
      <div className="wind-reading">
        <span className="wind-from-label">{directional ? `FROM ${model.cardinal}` : model.state === "variable" ? "DIRECTION" : model.state === "calm" ? "WIND" : "WIND DATA"}</span>
        <strong className="wind-bearing">{unavailable ? model.state === "stale" ? "STALE" : "—" : model.degrees}</strong>
        <div className="wind-speed"><strong>{model.speed}</strong><span>KT</span></div>
        {model.gust !== null && <span className="wind-gust">GUST <strong>{model.gust}</strong> KT</span>}
      </div>
    </div>
    <div className="wind-instrument-detail" aria-hidden="true">
      {directionDetail && <span className="wind-direction-key">{directionDetail}</span>}
      <span className="wind-observation">{model.observation}</span>
    </div>
  </div>;
}
