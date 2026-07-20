"use client";
// Weather FX Preview shell (Phase 2C-A). Gated entirely behind ?previewWeatherFx=1 — renders nothing
// when absent, and never alters the real weather feed, Date.now, or any production default. It reads
// live diagnostics from the DOM (main[data-*] and the precip canvas dataset) on a light 500ms timer,
// deliberately independent of the clock and the per-frame render loop. Interactive controls are
// completed in Phase 2C-D; for now it shows status and quick preset links.
import { useEffect, useState } from "react";

const PRESETS: [string, string][] = [
  ["Clear day", "?debugWeather=clear&debugTime=day"],
  ["Moderate rain", "?debugPhenomena=RA&debugTime=day"],
  ["Heavy rain night", "?debugPhenomena=%2BRA&debugTime=night"],
  ["Snow", "?debugPhenomena=SN&debugTime=day"],
  ["Ice pellets", "?debugPhenomena=PL&debugTime=day"],
];

export default function PreviewLab({ active }: { active: boolean }) {
  const [d, setD] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const m = document.querySelector("main.display") as HTMLElement | null;
      const c = document.querySelector(".precip-canvas") as HTMLElement | null;
      if (!m) return;
      setD({
        precip: m.dataset.precipType || "none", intensity: m.dataset.precipIntensity || "—",
        obscuration: m.dataset.obscuration || "none", vis: m.dataset.visibility || "—",
        coverage: m.dataset.coverage || "—", tier: m.dataset.tier || "—", perf: m.dataset.performance || m.dataset.perf || "—",
        wind: `${m.dataset.winddir || "VRB"}° ${m.dataset.wind || 0}kt`, vec: `${m.dataset.nx ?? ""},${m.dataset.ny ?? ""}`,
        count: c?.dataset.count || "0", canvas: c?.dataset.active === "1" ? "ACTIVE" : "idle", fps: c?.dataset.fps || "—",
      });
    };
    read(); const id = window.setInterval(read, 500);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  return (
    <aside className="fxlab" aria-label="Weather FX Preview">
      <header><b>WEATHER FX PREVIEW</b><button onClick={() => setHidden(h => !h)}>{hidden ? "SHOW" : "HIDE"}</button></header>
      {!hidden && <div className="fxlab-body">
        <dl>
          <div><dt>PRECIP</dt><dd>{d.precip} · {d.intensity}</dd></div>
          <div><dt>CANVAS</dt><dd>{d.canvas} · {d.count} p · {d.fps} fps</dd></div>
          <div><dt>OBSCURATION</dt><dd>{d.obscuration}</dd></div>
          <div><dt>VISIBILITY</dt><dd>{d.vis} SM</dd></div>
          <div><dt>CLOUD</dt><dd>{d.coverage} · tier {d.tier}</dd></div>
          <div><dt>WIND</dt><dd>{d.wind} · vec {d.vec}</dd></div>
          <div><dt>PERF</dt><dd>{d.perf}</dd></div>
        </dl>
        <nav>{PRESETS.map(([label, href]) => <a key={label} href={`${href}&previewWeatherFx=1`}>{label}</a>)}
          <a href="?">LIVE</a></nav>
      </div>}
    </aside>
  );
}
