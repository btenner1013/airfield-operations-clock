"use client";
// The one and only precipitation canvas: a single element driving at most one requestAnimationFrame
// loop. It never calls React setState per frame (diagnostics go to the canvas dataset), reuses one
// particle array, cancels the loop when there is no active spec or on unmount, caps the
// device-pixel-ratio, and is fully isolated from the clock — a canvas failure is silent and cannot
// affect any other UI. Sizing is measured from the full .sky host (not the canvas's intrinsic
// 300x150), so particles fill the whole scene; particle bounds are always CSS pixels.
import { useEffect, useRef } from "react";
import type { FxSpec } from "./weatherFx";

type Particle = { x: number; y: number; v: number; vx: number; len: number; size: number; ph: number };
const DPR_CAP = 2;

export default function PrecipCanvas({ spec, paused }: { spec: FxSpec | null; paused?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<FxSpec | null>(spec); specRef.current = spec;
  const pausedRef = useRef<boolean>(!!paused); pausedRef.current = !!paused;
  const parts = useRef<Particle[]>([]);
  const raf = useRef<number>(0);
  const dims = useRef<{ w: number; h: number }>({ w: 0, h: 0 }); // CSS-pixel scene size
  const api = useRef<{ sync: () => void; start: () => void }>({ sync: () => {}, start: () => {} });

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) { canvas.dataset.active = "0"; return; }
    const host = (canvas.parentElement as HTMLElement | null) || canvas;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    // Measure the full scene container and size the drawing buffer to CSS × capped DPR, applying the
    // scale exactly once via setTransform. Redistributes particles only on a real size change.
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
      if (changed) for (const p of parts.current) { p.x = rnd(0, cssW); p.y = rnd(-cssH, cssH); }
    };
    measure();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (ro) ro.observe(host);
    window.addEventListener("resize", measure);

    const sync = () => {
      const s = specRef.current, { w, h } = dims.current, arr = parts.current, target = s ? s.count : 0;
      while (arr.length < target) arr.push({ x: rnd(0, w || 1000), y: rnd(-(h || 800), h || 800), v: 0, vx: 0, len: 0, size: 0, ph: rnd(0, 6.28) });
      if (arr.length > target) arr.length = target;
      if (s) for (const p of arr) { p.v = s.speed * rnd(0.75, 1.25); p.vx = s.vx * rnd(0.7, 1.1); p.len = s.len; p.size = s.size * rnd(0.7, 1.3); }
      canvas.dataset.count = String(target);
    };

    let last = performance.now(), frames = 0, fpsT = 0;
    const frame = (now: number) => {
      const s = specRef.current, { w, h } = dims.current;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (!s || pausedRef.current) { ctx.clearRect(0, 0, w, h); raf.current = 0; canvas.dataset.active = "0"; return; }
      canvas.dataset.active = "1";
      frames++; fpsT += dt; if (fpsT >= 0.5) { canvas.dataset.fps = String(Math.round(frames / fpsT)); frames = 0; fpsT = 0; }
      ctx.clearRect(0, 0, w, h);
      const arr = parts.current;
      if (s.shape === "streak") {
        ctx.strokeStyle = s.color; ctx.globalAlpha = s.alpha; ctx.lineWidth = s.thick; ctx.lineCap = "round";
        for (const p of arr) {
          p.y += p.v * dt; p.x += p.vx * dt;
          if (p.y > h + 40) { p.y = rnd(-60, -10); p.x = rnd(-40, w + 40); }
          if (p.x < -60) p.x += w + 100; else if (p.x > w + 60) p.x -= w + 100;
          const dx = p.v ? p.vx * (p.len / p.v) : 0;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx, p.y - p.len); ctx.stroke();
        }
      } else if (s.shape === "flake") {
        ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
        for (const p of arr) {
          p.ph += dt * 1.3; p.y += p.v * dt; p.x += p.vx * dt + Math.sin(p.ph) * s.sway * dt;
          if (p.y > h + 12) { p.y = rnd(-40, -6); p.x = rnd(0, w); }
          if (p.x < -20) p.x += w + 40; else if (p.x > w + 20) p.x -= w + 40;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      } else { // pellet — small fast dots with a short restrained ground bounce
        ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
        for (const p of arr) {
          p.y += p.v * dt; p.x += p.vx * dt;
          if (s.bounce && p.v > 0 && p.y > h * 0.86 && Math.random() < 0.05) p.v = -p.v * 0.26;
          if (p.y > h + 12 || (p.v < 0 && p.y < h * 0.6)) { p.y = rnd(-40, -6); p.x = rnd(0, w); p.v = s.speed * rnd(0.8, 1.2); }
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(frame);
    };

    const start = () => { if (specRef.current && !pausedRef.current && !raf.current) { last = performance.now(); raf.current = requestAnimationFrame(frame); } };
    api.current = { sync, start };
    sync(); start();

    return () => { window.removeEventListener("resize", measure); if (ro) ro.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, []); // one-time setup; spec/paused flow through refs

  useEffect(() => { api.current.sync(); api.current.start(); }, [spec, paused]);

  return <canvas ref={ref} className="precip-canvas" aria-hidden="true" data-active="0" />;
}
