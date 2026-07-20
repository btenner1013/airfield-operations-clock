"use client";
// The one and only precipitation canvas: a single element, at most one rAF loop. Falling precip and
// the window-pane droplets are two particle classes sharing this loop. It never calls React setState
// per frame (diagnostics -> canvas dataset), reuses its arrays, caps DPR, measures the full .sky host
// via ResizeObserver (CSS-pixel particle bounds), and is fully isolated from the clock.
import { useEffect, useRef } from "react";
import type { FxSpec } from "./weatherFx";

type Particle = { x: number; y: number; v: number; vx: number; len: number; size: number; ph: number };
type Drop = { x: number; y: number; r: number; rMax: number; vy: number; vx: number; trailY: number; rolling: boolean; wob: number };
const DPR_CAP = 2;

export default function PrecipCanvas({ spec, paused, night }: { spec: FxSpec | null; paused?: boolean; night?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<FxSpec | null>(spec); specRef.current = spec;
  const pausedRef = useRef<boolean>(!!paused); pausedRef.current = !!paused;
  const nightRef = useRef<boolean>(!!night); nightRef.current = !!night;
  const parts = useRef<Particle[]>([]);
  const drops = useRef<Drop[]>([]);
  const raf = useRef<number>(0);
  const dims = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const api = useRef<{ sync: () => void; start: () => void }>({ sync: () => {}, start: () => {} });

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) { canvas.dataset.active = "0"; return; }
    const host = (canvas.parentElement as HTMLElement | null) || canvas;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    const measure = () => {
      const rect = host.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width)), cssH = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const prev = dims.current, changed = Math.abs(cssW - prev.w) > 2 || Math.abs(cssH - prev.h) > 2;
      dims.current = { w: cssW, h: cssH };
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.dataset.canvasCssWidth = String(cssW); canvas.dataset.canvasCssHeight = String(cssH);
      canvas.dataset.canvasBufferWidth = String(canvas.width); canvas.dataset.canvasBufferHeight = String(canvas.height);
      canvas.dataset.canvasDpr = String(dpr);
      if (changed) { for (const p of parts.current) { p.x = rnd(0, cssW); p.y = rnd(-cssH, cssH); } for (const d of drops.current) { d.x = rnd(0, cssW); d.y = Math.min(d.y, cssH); } }
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (ro) ro.observe(host);
    window.addEventListener("resize", measure);

    const sync = () => { // falling-particle target only; droplets manage their own lifecycle
      const s = specRef.current, { w, h } = dims.current, arr = parts.current, target = s ? s.count : 0;
      while (arr.length < target) arr.push({ x: rnd(0, w || 1000), y: rnd(-(h || 800), h || 800), v: 0, vx: 0, len: 0, size: 0, ph: rnd(0, 6.28) });
      if (arr.length > target) arr.length = target;
      if (s) for (const p of arr) { p.v = s.speed * rnd(0.75, 1.25); p.vx = s.vx * rnd(0.7, 1.1); p.len = s.len; p.size = s.size * rnd(0.7, 1.3); }
      canvas.dataset.count = String(target);
      canvas.dataset.pane = s && s.pane ? "1" : "0";
      canvas.dataset.trails = s && s.pane && s.pane.trails ? "1" : "0";
    };

    const drawDrop = (d: Drop, freezing: boolean, nightNow: boolean, trails: boolean) => {
      const r = d.r;
      if (trails && d.rolling) { ctx.globalAlpha = 0.05; ctx.fillStyle = freezing ? "#a9c4d6" : "#bcd2e0"; ctx.fillRect(d.x - 0.6, d.trailY, 1.2, d.y - d.trailY); }
      const g = ctx.createRadialGradient(d.x - r * 0.35, d.y - r * 0.5, r * 0.1, d.x, d.y + r * 0.2, r * 1.1);
      g.addColorStop(0, freezing ? "rgba(212,230,242,0.82)" : "rgba(220,235,245,0.78)");
      g.addColorStop(0.5, freezing ? "rgba(150,178,196,0.26)" : "rgba(168,196,214,0.24)");
      g.addColorStop(1, freezing ? "rgba(38,58,72,0.5)" : "rgba(28,46,58,0.44)");
      ctx.globalAlpha = nightNow ? 0.78 : 1; ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, r * 0.82, r, 0, 0, 6.283); ctx.fill();
      ctx.globalAlpha = nightNow ? 0.45 : 0.62; ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.ellipse(d.x - r * 0.32, d.y - r * 0.42, r * 0.16, r * 0.22, 0, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    };

    let last = performance.now(), frames = 0, fpsT = 0;
    const frame = (now: number) => {
      const s = specRef.current, { w, h } = dims.current, dropsArr = drops.current, nightNow = nightRef.current;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (pausedRef.current || (!s && dropsArr.length === 0)) { ctx.clearRect(0, 0, w, h); raf.current = 0; canvas.dataset.active = s ? "1" : "0"; return; }
      canvas.dataset.active = "1";
      frames++; fpsT += dt; if (fpsT >= 0.5) { canvas.dataset.fps = String(Math.round(frames / fpsT)); frames = 0; fpsT = 0; }
      ctx.clearRect(0, 0, w, h);
      const arr = parts.current;
      if (s) {
        if (s.veil > 0) { const vg = ctx.createLinearGradient(0, 0, 0, h); vg.addColorStop(0, `rgba(200,214,226,${s.veil})`); vg.addColorStop(0.55, `rgba(200,214,226,${s.veil * 0.4})`); vg.addColorStop(1, "rgba(200,214,226,0)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h); }
        if (s.shape === "streak") {
          ctx.strokeStyle = s.color; ctx.globalAlpha = s.alpha; ctx.lineWidth = s.thick; ctx.lineCap = "round";
          for (const p of arr) { p.y += p.v * dt; p.x += p.vx * dt; if (p.y > h + 40) { p.y = rnd(-60, -10); p.x = rnd(-40, w + 40); } if (p.x < -60) p.x += w + 100; else if (p.x > w + 60) p.x -= w + 100; const dx = p.v ? p.vx * (p.len / p.v) : 0; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx, p.y - p.len); ctx.stroke(); }
        } else if (s.shape === "flake") {
          ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
          for (const p of arr) { p.ph += dt * 1.3; p.y += p.v * dt; p.x += p.vx * dt + Math.sin(p.ph) * s.sway * dt; if (p.y > h + 12) { p.y = rnd(-40, -6); p.x = rnd(0, w); } if (p.x < -20) p.x += w + 40; else if (p.x > w + 20) p.x -= w + 40; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
        } else {
          ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
          for (const p of arr) { p.y += p.v * dt; p.x += p.vx * dt; if (s.bounce && p.v > 0 && p.y > h * 0.86 && Math.random() < 0.05) p.v = -p.v * 0.26; if (p.y > h + 12 || (p.v < 0 && p.y < h * 0.6)) { p.y = rnd(-40, -6); p.x = rnd(0, w); p.v = s.speed * rnd(0.8, 1.2); } ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
      }
      // window-pane droplets (share this loop). Spawn toward target; existing drops drain naturally.
      const pane = s ? s.pane : null;
      if (pane && dropsArr.length < pane.count && Math.random() < 0.05) {
        let x = rnd(0, w);
        if (Math.random() < 0.3 && dropsArr.length) { const t = dropsArr[(Math.random() * dropsArr.length) | 0]; x = t.x + rnd(-6, 6); }
        dropsArr.push({ x, y: rnd(h * 0.08, h * 0.85), r: rnd(1.2, 2.6), rMax: rnd(3.4, 7), vy: 0, vx: (pane.freezing ? 0.02 : 0.04) * (s ? s.vx : 0), trailY: 0, rolling: false, wob: rnd(0, 6) });
      }
      const roll = pane ? pane.roll : 0.7, freezing = pane ? pane.freezing : false, trails = pane ? pane.trails : false;
      let rolling = 0;
      for (let i = dropsArr.length - 1; i >= 0; i--) {
        const d = dropsArr[i];
        if (!d.rolling) { d.r += 2 * dt * (0.6 + Math.random() * 0.4); if (d.r > d.rMax || Math.random() < 0.004) { d.rolling = true; d.trailY = d.y; } }
        else { d.vy = Math.min(d.vy + d.r * roll * 14 * dt, d.r * roll * 30); d.y += d.vy * dt; d.wob += dt * 2; d.x += (d.vx + Math.sin(d.wob) * 4) * dt; rolling++; }
        if (d.y - d.r > h) { dropsArr.splice(i, 1); continue; }
        drawDrop(d, freezing, nightNow, trails);
      }
      canvas.dataset.dropCount = String(dropsArr.length); canvas.dataset.dropRolling = String(rolling);
      raf.current = requestAnimationFrame(frame);
    };

    const start = () => { if ((specRef.current || drops.current.length > 0) && !pausedRef.current && !raf.current) { last = performance.now(); raf.current = requestAnimationFrame(frame); } };
    api.current = { sync, start };
    sync(); start();
    return () => { window.removeEventListener("resize", measure); if (ro) ro.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, []);

  useEffect(() => { api.current.sync(); api.current.start(); }, [spec, paused]);

  return <canvas ref={ref} className="precip-canvas" aria-hidden="true" data-active="0" />;
}
