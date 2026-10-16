// HTTP Date is a whole-second, unauthenticated-as-a-time-source estimate, not NTP.
// Use fresh, low-latency, advancing responses only. Never persist an offset across reloads.
export const CLOCK_LIMITS = {
  verifyIntervalMs: 5 * 60_000,
  holdoverMs: 20 * 60_000,
  maxRoundTripMs: 1500,
  requestTimeoutMs: 2500,
  sampleGapMs: 1100,
  maxCorrectionMs: 5 * 60_000,
  maxSampleSpreadMs: 1000,
  wallJumpMs: 1000,
  requestWallJumpMs: 100,
  resumeGapMs: 5000,
} as const;

export type ClockReading = { wallMs: number; monoMs: number };
export type TimeSample = {
  offsetMs: number;
  roundTripMs: number;
  uncertaintyMs: number;
  serverDateMs: number;
  received: ClockReading;
};
export type SampleFailure = "NETWORK UNAVAILABLE" | "HTTP ERROR" | "INVALID DATE" | "INVALID CACHE METADATA" | "SLOW RESPONSE" | "SYSTEM TIME CHANGED" | "CANCELLED";
export type SampleResult = { sample: TimeSample; error?: never } | { sample?: never; error: SampleFailure };
export type TimeEstimate = TimeSample & { samples: number };
export type ClockState = "OK" | "CHECK" | "WARNING" | "STALE" | "OFFLINE";
export type ClockStatus = {
  source: "SYSTEM CLOCK" | "GITHUB HTTP" | "HTTP HOLDOVER" | "PREVIEW";
  networkSource: string;
  lastCheckedUtc: number | null;
  estimatedOffsetMs: number | null;
  roundTripMs: number | null;
  uncertaintyMs: number | null;
  state: ClockState;
  detail: string;
};

export const readClock = (): ClockReading => ({ wallMs: Date.now(), monoMs: performance.now() });
export function boundaryDelay(nowMs: number): number { return 1000 - ((nowMs % 1000 + 1000) % 1000) + 25; }
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : 0;
}

export function validateHttpSample(response: Pick<Response, "ok" | "headers" | "redirected">, start: ClockReading, end: ClockReading): SampleResult {
  if (!response.ok || response.redirected) return { error: "HTTP ERROR" };
  const rtt = end.monoMs - start.monoMs;
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > CLOCK_LIMITS.maxRoundTripMs) return { error: "SLOW RESPONSE" };
  if (Math.abs(end.wallMs - start.wallMs - rtt) > CLOCK_LIMITS.requestWallJumpMs) return { error: "SYSTEM TIME CHANGED" };
  const date = response.headers.get("date")?.trim();
  const serverDateMs = date ? Date.parse(date) : NaN;
  if (!date || !Number.isFinite(serverDateMs) || new Date(serverDateMs).toUTCString() !== date) return { error: "INVALID DATE" };
  const age = response.headers.get("age");
  // GitHub's edge regenerates Date even for HIT objects with nonzero Age. Age is the
  // cached object's age, not the age of that regenerated Date; adding it would create
  // a false clock skew. Treat these as candidates only: chooseTimeEstimate requires
  // advancing Date values consistent with elapsed monotonic time before applying any.
  // Frozen cached Date headers therefore cannot discipline the display.
  if (age !== null && (!/^\d+$/.test(age.trim()) || !Number.isSafeInteger(Number(age)))) return { error: "INVALID CACHE METADATA" };
  // Center the server's one-second Date bucket and the measured request interval. Path
  // asymmetry and server timestamp placement are uncertain, so expose the estimate's error.
  const uncertaintyMs = 500 + rtt / 2;
  return { sample: { offsetMs: serverDateMs + 500 - (start.wallMs + rtt / 2), roundTripMs: rtt, uncertaintyMs, serverDateMs, received: end } };
}

export async function sampleHttpTime(options: {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  read?: () => ClockReading;
  timeoutMs?: number;
} = {}): Promise<SampleResult> {
  const controller = new AbortController(), read = options.read ?? readClock;
  if (options.signal?.aborted) return { error: "CANCELLED" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const interrupted = new Promise<SampleResult>(resolve => {
    stop = () => { controller.abort(); resolve({ error: "CANCELLED" }); };
    options.signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => { controller.abort(); resolve({ error: "SLOW RESPONSE" }); }, options.timeoutMs ?? CLOCK_LIMITS.requestTimeoutMs);
  });
  const request = (async (): Promise<SampleResult> => {
    const start = read();
    try {
      // HEAD also bypasses the app's GET-only offline service worker. The URL is same-origin
      // and relative to the deployed repository path; no third-party account or API is used.
      const response = await (options.fetcher ?? fetch)(`./?clockcheck=${start.monoMs}_${Math.random().toString(36).slice(2)}`, {
        method: "HEAD", cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
        headers: { "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" },
      });
      return validateHttpSample(response, start, read());
    } catch { return { error: controller.signal.aborted ? "CANCELLED" : "NETWORK UNAVAILABLE" }; }
  })();
  try { return await Promise.race([request, interrupted]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); }
}

// At least two consistent samples, spanning distinct server seconds, must agree. A single
// outlier may be excluded; repeated frozen Date headers or divergent clocks cannot set time.
export function chooseTimeEstimate(samples: TimeSample[]): TimeEstimate | null {
  const chronological = [...samples].sort((a, b) => a.received.monoMs - b.received.monoMs);
  // Each request may be internally sound even when Windows changed between requests.
  // Reject the entire batch instead of accidentally treating two sides of that jump as consensus.
  if (chronological.some((s, i) => i > 0 && Math.abs((s.received.wallMs - chronological[i - 1].received.wallMs) - (s.received.monoMs - chronological[i - 1].received.monoMs)) > CLOCK_LIMITS.requestWallJumpMs)) return null;
  const valid = chronological.filter(s => Number.isFinite(s.offsetMs) && Math.abs(s.offsetMs) <= CLOCK_LIMITS.maxCorrectionMs);
  let best: TimeSample[] = [];
  for (const first of valid) {
    const group = valid.filter(s => s.offsetMs >= first.offsetMs && s.offsetMs - first.offsetMs <= CLOCK_LIMITS.maxSampleSpreadMs);
    const datesAdvance = group.length > 1 && group[group.length - 1].serverDateMs > group[0].serverDateMs && group.every((s, i) => i === 0 || s.serverDateMs >= group[i - 1].serverDateMs);
    if (group.length < 2 || !datesAdvance) continue;
    if (group.length > best.length || (group.length === best.length && spread(group) < spread(best))) best = group;
  }
  if (best.length < 2) return null;
  const latest = best.reduce((a, b) => a.received.monoMs > b.received.monoMs ? a : b);
  const offsetMs = median(best.map(s => s.offsetMs));
  return { ...latest, offsetMs, roundTripMs: Math.min(...best.map(s => s.roundTripMs)), uncertaintyMs: Math.max(...best.map(s => s.uncertaintyMs + Math.abs(s.offsetMs - offsetMs))), samples: best.length };
}
function spread(samples: TimeSample[]): number { return samples.length ? Math.max(...samples.map(s => s.offsetMs)) - Math.min(...samples.map(s => s.offsetMs)) : Infinity; }

export function waitForSample(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export class ClockDiscipline {
  private estimate: TimeEstimate | null = null;
  private previous: ClockReading | null = null;
  private lastCheckedUtc: number | null = null;
  private state: ClockState = "CHECK";
  private detail = "CHECKING NETWORK";

  accept(estimate: TimeEstimate, now: ClockReading): boolean {
    const elapsed = now.monoMs - estimate.received.monoMs;
    if (elapsed < 0 || elapsed > CLOCK_LIMITS.holdoverMs || Math.abs(now.wallMs - estimate.received.wallMs - elapsed) > CLOCK_LIMITS.requestWallJumpMs) {
      this.failed(true, "SYSTEM TIME CHANGED"); return false;
    }
    this.estimate = estimate;
    this.previous = now;
    this.lastCheckedUtc = estimate.received.wallMs + estimate.offsetMs;
    this.state = "OK"; this.detail = "HTTP ESTIMATE";
    return true;
  }

  failed(online: boolean, detail: string): void { this.state = online ? "WARNING" : "OFFLINE"; this.detail = detail; }

  read(now: ClockReading): { nowMs: number; status: ClockStatus; recheck: boolean } {
    let recheck = false;
    if (this.previous) {
      const wallElapsed = now.wallMs - this.previous.wallMs, monoElapsed = now.monoMs - this.previous.monoMs;
      const jumped = monoElapsed < 0 || Math.abs(wallElapsed - monoElapsed) > CLOCK_LIMITS.wallJumpMs;
      recheck = jumped || Math.max(wallElapsed, monoElapsed) > CLOCK_LIMITS.resumeGapMs;
      if (jumped) {
        this.estimate = null;
        this.state = "CHECK"; this.detail = "SYSTEM TIME CHANGED";
      }
    }
    this.previous = now;
    const age = this.estimate ? now.monoMs - this.estimate.received.monoMs : Infinity;
    if (this.estimate && (age < 0 || age >= CLOCK_LIMITS.holdoverMs)) {
      this.estimate = null;
      this.state = this.state === "OFFLINE" ? "OFFLINE" : "STALE";
      this.detail = "CORRECTION EXPIRED";
      recheck = true;
    }
    const estimate = this.estimate;
    // Re-read an absolute anchor, never increment a second counter. A delayed tick catches
    // up immediately. A wall-clock change cannot accidentally apply the old offset twice.
    const nowMs = estimate ? estimate.received.wallMs + estimate.offsetMs + age : now.wallMs;
    return { nowMs, recheck, status: {
      source: estimate ? this.state === "OK" ? "GITHUB HTTP" : "HTTP HOLDOVER" : "SYSTEM CLOCK",
      networkSource: "GITHUB EDGE DATE", lastCheckedUtc: this.lastCheckedUtc,
      estimatedOffsetMs: estimate ? nowMs - now.wallMs : null,
      roundTripMs: estimate?.roundTripMs ?? null,
      uncertaintyMs: estimate ? estimate.uncertaintyMs + age * 0.0001 : null, // allow 100 ppm holdover drift
      state: this.state, detail: this.detail,
    } };
  }
}

export function formatClockStatus(status: ClockStatus): string {
  const prefix = `SRC ${status.source}`;
  if (status.source === "PREVIEW") return `${prefix} · ${status.detail}`;
  if (status.source === "SYSTEM CLOCK") return `${prefix} · ${status.state === "CHECK" ? status.detail : `NETWORK ${status.state}: ${status.detail}`}`;
  const offset = status.estimatedOffsetMs ?? 0;
  const correction = `${offset >= 0 ? "+" : "-"}${(Math.abs(offset) / 1000).toFixed(1)}S`;
  const error = status.uncertaintyMs === null ? "" : ` · EST ±${(status.uncertaintyMs / 1000).toFixed(1)}S`;
  const last = status.lastCheckedUtc === null ? "" : ` · ${new Date(status.lastCheckedUtc).toISOString().slice(11, 16).replace(":", "")}Z`;
  return `${prefix} · ${status.source === "HTTP HOLDOVER" ? `${status.state} · ` : ""}CORR ${correction}${error}${last}`;
}
