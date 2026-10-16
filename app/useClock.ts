"use client";
// The clock owns its own lifecycle, independent of weather. Fresh HTTP estimates correct
// only this display, never Windows settings. Failures retain a bounded, labeled holdover.
import { useEffect, useMemo, useState } from "react";
import { boundaryDelay, chooseTimeEstimate, ClockDiscipline, CLOCK_LIMITS, readClock, sampleHttpTime, waitForSample, type ClockStatus, type TimeSample } from "./clockSync.ts";
export type { ClockStatus, ClockState } from "./clockSync.ts";
export type ClockDebug = { offsetMs?: number; exact?: number; force?: "offline" | "stale" | "warning" };

export function useSystemClock(debug?: ClockDebug): { now: Date; status: ClockStatus } {
  const [nowMs, setNowMs] = useState<number>(0); // identical server/client first paint
  const [status, setStatus] = useState<ClockStatus>(() => new ClockDiscipline().read({ wallMs: 0, monoMs: 0 }).status);
  const debugKey = `${debug?.offsetMs ?? ""}|${debug?.exact ?? ""}|${debug?.force ?? ""}`;

  useEffect(() => {
    const discipline = new ClockDiscipline();
    const controller = new AbortController();
    let stopped = false, inFlight = false, pendingRecheck = false, timer = 0;
    // Invalid URL parameters must never create an Invalid Date or disable real sync.
    const exact = typeof debug?.exact === "number" && Number.isFinite(debug.exact) && Math.abs(debug.exact) <= 8.64e15 ? debug.exact : null;
    const offset = typeof debug?.offsetMs === "number" && Number.isFinite(debug.offsetMs) && Math.abs(Date.now() + debug.offsetMs) <= 8.64e15 ? debug.offsetMs : null;
    const preview = exact !== null || offset !== null || !!debug?.force;
    const publish = () => {
      if (stopped) return;
      const reading = readClock(), current = discipline.read(reading);
      const candidate = exact ?? (reading.wallMs + (offset ?? 0));
      const validPreview = Number.isFinite(candidate) && Math.abs(candidate) <= 8.64e15;
      const display = validPreview ? candidate : reading.wallMs;
      setNowMs(preview ? display : current.nowMs);
      setStatus(preview ? { ...current.status, source: "PREVIEW", state: debug?.force === "offline" ? "OFFLINE" : debug?.force === "stale" ? "STALE" : debug?.force === "warning" ? "WARNING" : "CHECK", detail: !validPreview ? "INVALID OFFSET: SYSTEM TIME" : exact !== null ? "FIXED TEST TIME" : "SIMULATED CLOCK", estimatedOffsetMs: validPreview ? offset : null } : current.status);
      return { ...current, nowMs: preview ? display : current.nowMs };
    };
    const verify = async () => {
      if (stopped || preview) return;
      if (inFlight) { pendingRecheck = true; return; }
      if (!navigator.onLine) { discipline.failed(false, "NETWORK UNAVAILABLE"); publish(); return; }
      inFlight = true;
      const samples: TimeSample[] = [];
      let failure = "NO CONSISTENT FRESH SAMPLES";
      try {
        for (let i = 0; i < 3 && !controller.signal.aborted; i++) {
          if (i) await waitForSample(CLOCK_LIMITS.sampleGapMs, controller.signal);
          const result = await sampleHttpTime({ signal: controller.signal });
          if (result.sample) samples.push(result.sample);
          else failure = result.error;
        }
        if (stopped) return;
        const estimate = chooseTimeEstimate(samples);
        if (estimate) {
          discipline.accept(estimate, readClock());
          if (!navigator.onLine) discipline.failed(false, "NETWORK UNAVAILABLE");
        }
        else discipline.failed(navigator.onLine, samples.length ? "NO CONSISTENT FRESH SAMPLES" : failure);
        // Re-align to the corrected second immediately, including after an OS correction.
        clearTimeout(timer);
        tick();
      } finally {
        inFlight = false;
        // A jump/wake that happened while a request was pending must get a fresh batch.
        if (pendingRecheck && !stopped) { pendingRecheck = false; void verify(); }
      }
    };
    const tick = () => {
      if (stopped) return;
      const current = publish();
      if (current?.recheck) void verify();
      timer = window.setTimeout(tick, boundaryDelay(current?.nowMs ?? Date.now()));
    };
    const refresh = () => { clearTimeout(timer); tick(); void verify(); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    const onOffline = () => { discipline.failed(false, "NETWORK UNAVAILABLE"); publish(); };
    tick();
    void verify();
    const interval = window.setInterval(() => void verify(), CLOCK_LIMITS.verifyIntervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true; controller.abort(); clearTimeout(timer); clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", onOffline);
    };
  }, [debugKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { now: useMemo(() => new Date(nowMs), [nowMs]), status };
}
