"use client";
// Dedicated clock lifecycle, deliberately isolated from all weather animation. The displayed time is
// always re-derived from the absolute system clock (Date.now); seconds are never incremented, so a
// delayed, throttled, or skipped tick simply shows the correct current time on the next render. A
// coarse same-origin HTTP Date-header check provides independent verification without ever replacing
// the Windows system clock or blocking the clocks if it fails.
import { useEffect, useMemo, useRef, useState } from "react";

export type ClockState = "VERIFIED" | "CHECK" | "WARNING" | "STALE" | "OFFLINE";
export type ClockStatus = {
  source: "WINDOWS SYSTEM";
  networkSource: string;
  lastCheckedUtc: number | null;
  estimatedOffsetMs: number | null;
  roundTripMs: number | null;
  state: ClockState;
};
export type ClockDebug = { offsetMs?: number; force?: "offline" | "stale" | "warning" };

const NETWORK_SOURCE = "GITHUB EDGE DATE";
const VERIFY_INTERVAL_MS = 10 * 60 * 1000; // periodic re-check ~ every 10 min
const STALE_AFTER_MS = 20 * 60 * 1000;     // no good check in 20 min → STALE
const JUMP_MS = 1000;                       // Date-vs-monotonic discontinuity treated as a jump
const RESUME_GAP_MS = 5000;                 // a tick this late means the tab was throttled/asleep
const MARGIN_MS = 25;                        // fire just past the boundary
const RTT_REJECT_MS = 2000;                  // discard slow/uncertain samples

const nowMono = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// --- pure, testable helpers ------------------------------------------------
export function boundaryDelay(nowMs: number): number { return 1000 - (nowMs % 1000) + MARGIN_MS; }
export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b); const n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function classifyState(offsetMs: number | null, usable: number, online: boolean): ClockState {
  if (!online || usable === 0 || offsetMs === null) return "OFFLINE";
  const a = Math.abs(offsetMs);
  if (usable === 1) return a > 2000 ? "WARNING" : "CHECK";
  if (a <= 1000) return "VERIFIED";
  if (a <= 2000) return "CHECK";
  return "WARNING";
}

// One coarse offset sample from the server Date header. Positive offset ⇒ server ahead of local.
async function sampleOffset(): Promise<{ offset: number; rtt: number } | null> {
  const t0 = Date.now();
  try {
    const res = await fetch(`./?clockcheck=${t0}_${Math.random().toString(36).slice(2)}`, { method: "HEAD", cache: "no-store" });
    const t1 = Date.now();
    const header = res.headers.get("date");
    if (!header) return null;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return null;
    const rtt = t1 - t0;
    if (rtt > RTT_REJECT_MS) return null;
    return { offset: serverMs - (t0 + t1) / 2, rtt }; // midpoint of the local interval
  } catch { return null; }
}

export function useSystemClock(debug?: ClockDebug): { now: Date; status: ClockStatus } {
  const [nowMs, setNowMs] = useState<number>(0); // 0 on first paint (SSR-safe); real time set on mount
  const [status, setStatus] = useState<ClockStatus>({ source: "WINDOWS SYSTEM", networkSource: NETWORK_SOURCE, lastCheckedUtc: null, estimatedOffsetMs: null, roundTripMs: null, state: "CHECK" });
  const anchor = useRef<{ sys: number; mono: number }>({ sys: Date.now(), mono: nowMono() });
  const verifyRef = useRef<(reason: string) => void>(() => {});
  const debugKey = `${debug?.offsetMs ?? ""}|${debug?.force ?? ""}`;

  // Independent network verification — never mutates the clock, only the status badge.
  useEffect(() => {
    let cancelled = false, inFlight = false;
    const verify = async (_reason: string) => {
      if (debug?.force === "offline") { setStatus(s => ({ ...s, state: "OFFLINE", estimatedOffsetMs: null })); return; }
      if (debug?.force === "warning") { setStatus(s => ({ ...s, state: "WARNING", estimatedOffsetMs: 2500, roundTripMs: 60, lastCheckedUtc: Date.now() })); return; }
      if (debug?.force === "stale") { setStatus(s => ({ ...s, state: "STALE" })); return; }
      if (typeof debug?.offsetMs === "number") { setStatus(s => ({ ...s, estimatedOffsetMs: debug.offsetMs!, roundTripMs: 50, lastCheckedUtc: Date.now(), state: classifyState(debug.offsetMs!, 3, true) })); return; }
      if (inFlight) return; inFlight = true;
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      const samples: { offset: number; rtt: number }[] = [];
      if (online) for (let i = 0; i < 3; i++) { const s = await sampleOffset(); if (s) samples.push(s); }
      inFlight = false; if (cancelled) return;
      const usable = samples.length;
      const offset = usable ? median(samples.map(s => s.offset)) : null;
      const rtt = usable ? Math.min(...samples.map(s => s.rtt)) : null;
      setStatus(s => ({ ...s, estimatedOffsetMs: offset === null ? s.estimatedOffsetMs : Math.round(offset), roundTripMs: rtt, lastCheckedUtc: usable ? Date.now() : s.lastCheckedUtc, state: classifyState(offset, usable, online) }));
    };
    verifyRef.current = verify;
    verify("load");
    const id = window.setInterval(() => verify("periodic"), VERIFY_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [debugKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boundary-aligned tick. Re-reads the absolute clock every second and detects jumps/resumes.
  useEffect(() => {
    let stopped = false, timer = 0;
    const tick = () => {
      if (stopped) return;
      const sys = Date.now(), mono = nowMono(), a = anchor.current;
      const sysEl = sys - a.sys, drift = Math.abs(sysEl - (mono - a.mono));
      anchor.current = { sys, mono };
      setNowMs(sys);
      if (drift > JUMP_MS || sysEl > RESUME_GAP_MS) verifyRef.current(drift > JUMP_MS ? "jump" : "resume");
      timer = window.setTimeout(tick, boundaryDelay(sys));
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  // Mark STALE when no good verification has landed within the freshness window.
  useEffect(() => {
    const id = window.setInterval(() => {
      setStatus(s => (s.state !== "OFFLINE" && s.lastCheckedUtc && Date.now() - s.lastCheckedUtc > STALE_AFTER_MS && s.state !== "STALE") ? { ...s, state: "STALE" } : s);
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Immediate recovery on wake/visibility/focus/online: reset the anchor, re-read the clock, re-verify.
  useEffect(() => {
    const refresh = (reason: string) => { const sys = Date.now(); anchor.current = { sys, mono: nowMono() }; setNowMs(sys); verifyRef.current(reason); };
    const onVis = () => { if (document.visibilityState === "visible") refresh("visible"); };
    const onFocus = () => refresh("focus");
    const onShow = () => refresh("pageshow");
    const onOnline = () => refresh("online");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("online", onOnline);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onShow); window.removeEventListener("online", onOnline); };
  }, []);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  return { now, status };
}
