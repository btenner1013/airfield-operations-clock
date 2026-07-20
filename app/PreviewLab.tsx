"use client";
// Weather FX Preview shell. Gated entirely behind ?previewWeatherFx=1 — renders nothing when absent,
// and never alters the real weather feed, Date.now, or any production default. Reads live diagnostics
// from the DOM (main[data-*] + the precip canvas dataset) on a light 500ms timer, independent of the
// clock and the render loop. The WINDOW DROPLETS toggle affects preview state only.
import { useEffect, useState } from "react";

const PRESETS: [string, string][] = [
  ["Drizzle", "?debugPhenomena=DZ&debugIntensity=light&debugTime=day"],
  ["Moderate rain", "?debugPhenomena=RA&debugIntensity=moderate&debugTime=day"],
  ["Heavy rain night", "?debugPhenomena=%2BRA&debugIntensity=heavy&debugTime=night"],
  ["Rain showers", "?debugPhenomena=SHRA&debugIntensity=moderate&debugTime=day"],
  ["Vicinity showers", "?debugPhenomena=VCSH&debugTime=day"],
  ["Freezing rain", "?debugPhenomena=FZRA&debugIntensity=moderate&debugTime=night"],
  ["Ice pellets", "?debugPhenomena=PL&debugTime=day"],
  ["Hail", "?debugPhenomena=GR&debugTime=day"],
];
const SOLAR: [string, string][] = [
  ["Clear day", "?debugWeather=clear&debugTime=day"],
  ["Clear night", "?debugWeather=clear&debugTime=night"],
  ["Sunrise", "?debugWeather=clear&debugTime=sunrise"],
  ["Sunset", "?debugWeather=clear&debugTime=sunset"],
  ["FEW sunrise", "?debugWeather=partly-cloudy&debugCloud=FEW&debugTime=sunrise"],
  ["SCT sunrise", "?debugWeather=partly-cloudy&debugCloud=SCT&debugTime=sunrise"],
  ["FEW sunset", "?debugWeather=partly-cloudy&debugCloud=FEW&debugTime=sunset"],
  ["SCT sunset", "?debugWeather=partly-cloudy&debugCloud=SCT&debugTime=sunset"],
  ["OVC sunset", "?debugWeather=overcast&debugCloud=OVC&debugTime=sunset"],
];

export default function PreviewLab({ active, paneDrops, onPaneToggle }: { active: boolean; paneDrops: boolean | null; onPaneToggle: (v: boolean | null) => void }) {
  const [d, setD] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState(false);
  const [diag, setDiag] = useState(true);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const m = document.querySelector("main.display") as HTMLElement | null;
      const c = document.querySelector(".precip-canvas") as HTMLElement | null;
      if (!m) return;
      setD({
        precip: m.dataset.precipType || "none", intensity: m.dataset.precipIntensity || "—",
        vis: m.dataset.visibility || "—", coverage: m.dataset.coverage || "—", tier: m.dataset.tier || "—",
        perf: m.dataset.performance || m.dataset.perf || "—", wind: `${m.dataset.winddir || "VRB"}° ${m.dataset.wind || 0}kt · vec ${m.dataset.nx ?? ""},${m.dataset.ny ?? ""}`,
        count: c?.dataset.count || "0", canvas: c?.dataset.active === "1" ? "ACTIVE" : "idle", fps: c?.dataset.fps || "—",
        drops: c?.dataset.dropCount || "0", rolling: c?.dataset.dropRolling || "0", trails: c?.dataset.trails === "1" ? "on" : "off", pane: c?.dataset.pane === "1" ? "on" : "off",
        cssW: c?.dataset.canvasCssWidth || "—", cssH: c?.dataset.canvasCssHeight || "—",
        bufW: c?.dataset.canvasBufferWidth || "—", bufH: c?.dataset.canvasBufferHeight || "—", dpr: c?.dataset.canvasDpr || "—",
      });
    };
    read(); const id = window.setInterval(read, 500);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const paneLabel = paneDrops === true ? "ON" : paneDrops === false ? "OFF" : "AUTO";
  const cyclePane = () => onPaneToggle(paneDrops === null ? true : paneDrops === true ? false : null);
  return (
    <aside className="fxlab" aria-label="Weather FX Preview">
      <header><b>WEATHER FX PREVIEW</b><span><button onClick={() => setDiag(v => !v)}>{diag ? "DIAG−" : "DIAG+"}</button><button onClick={() => setHidden(h => !h)}>{hidden ? "SHOW" : "HIDE"}</button></span></header>
      {!hidden && <div className="fxlab-body">
        <div className="fxlab-toggle"><button onClick={cyclePane} className={paneDrops === false ? "off" : ""}>WINDOW DROPLETS: {paneLabel}</button></div>
        {diag && <dl>
          <div><dt>PRECIP</dt><dd>{d.precip} · {d.intensity}</dd></div>
          <div><dt>FALLING</dt><dd>{d.canvas} · {d.count} p · {d.fps} fps</dd></div>
          <div><dt>WINDOW DROPS</dt><dd>{d.drops} · {d.rolling} rolling</dd></div>
          <div><dt>PANE / TRAILS</dt><dd>{d.pane} / {d.trails}</dd></div>
          <div><dt>CANVAS CSS</dt><dd>{d.cssW}×{d.cssH}</dd></div>
          <div><dt>CANVAS BUFFER</dt><dd>{d.bufW}×{d.bufH} · DPR {d.dpr}</dd></div>
          <div><dt>CLOUD</dt><dd>{d.coverage} · tier {d.tier}</dd></div>
          <div><dt>WIND</dt><dd>{d.wind}</dd></div>
          <div><dt>PERF</dt><dd>{d.perf}</dd></div>
        </dl>}
        <nav>{PRESETS.map(([label, href]) => <a key={label} href={`${href}&previewWeatherFx=1`}>{label}</a>)}
          <a href="?">LIVE</a></nav>
        <nav>{SOLAR.map(([label, href]) => <a key={label} href={`${href}&previewWeatherFx=1`}>{label}</a>)}</nav>
      </div>}
    </aside>
  );
}
