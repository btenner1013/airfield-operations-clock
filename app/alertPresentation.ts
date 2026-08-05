// Presentation normalization mirrored from the read-only KMEM Ops Board.
// Keep weather detection and source authority outside this module; this layer only
// turns an already-selected alert into one consistent text/color/motion result.

export const OPS_ALERT_COLORS = {
  green: "#00ff88",
  blue: "#35b7ff",
  yellow: "#ffcc00",
  red: "#ff4444",
} as const;

// Base stylesheet timings. A deliberately customized Ops Board can override these
// through its local strong-pulse display setting; the untuned board uses these values.
export const OPS_ALERT_MOTION_MS = {
  weatherPulse: 820,
  lightningPulse: 950,
  flash: 1000,
} as const;

export type OpsAlertSeverity = "none" | "informational" | "caution" | "warning";
export type WxAlertColorClass = "alert-none" | "alert-blue" | "alert-yellow" | "alert-red";
export type LightningColorClass = "lightning-green" | "lightning-yellow" | "lightning-red";

export type WxAlertDisplayInput = {
  text?: string | null;
  icon?: string | null;
  code?: string | null;
  category?: string | null;
  sources?: string | readonly string[] | null;
  tone?: string | null;
  pulse?: boolean | null;
  flash?: boolean | null;
  visible?: boolean;
  reducedMotion?: boolean;
};

export type WxAlertDisplay = {
  text: string;
  icon: string | null;
  severity: OpsAlertSeverity;
  colorClass: WxAlertColorClass;
  shouldPulse: boolean;
  shouldFlash: boolean;
};

export type LightningDisplayInput = {
  text?: string | null;
  awareness?: string | null;
  level?: string | null;
  severity?: string | null;
  tone?: string | null;
  pulse?: boolean | null;
  flash?: boolean | null;
  status?: string | null;
  isStale?: boolean;
  stale?: boolean;
  isUnavailable?: boolean;
  unavailable?: boolean;
  sourceTime?: string | null;
  reducedMotion?: boolean;
};

export type LightningDisplay = {
  text: string;
  severity: OpsAlertSeverity;
  colorClass: LightningColorClass;
  shouldPulse: boolean;
  shouldFlash: boolean;
  isStale: boolean;
  isUnavailable: boolean;
  sourceTime: string | null;
};

type OpsTone = keyof typeof OPS_ALERT_COLORS;
type WxClassification = { tone: OpsTone; pulse: boolean; flash: boolean };
type LightningKind = "none" | "caution" | "warning" | "watch" | "unknown";

const HIGH_IMPACT_CATEGORIES = new Set([
  "thunder",
  "freezing",
  "ice",
  "hail",
  "wind_shear",
  "tornado",
  "squall",
  "ash",
]);
const INFO_CATEGORIES = new Set(["rain", "drizzle", "shower", "mist", "haze"]);
const HEAVY_PRECIP_CODES = new Set(["+RA", "+SHRA", "+DZ", "+SN"]);

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCategory(value: string | null | undefined): string {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeTone(value: string | null | undefined): OpsTone | null {
  const tone = clean(value).toLowerCase();
  if (tone === "green" || tone === "blue" || tone === "yellow" || tone === "red") return tone;
  if (tone === "cyan" || tone === "info" || tone === "informational") return "blue";
  if (tone === "amber" || tone === "caution") return "yellow";
  if (tone === "warning" || tone === "severe" || tone === "bad") return "red";
  return null;
}

function normalizeSources(value: WxAlertDisplayInput["sources"]): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap(item => String(item).toUpperCase().split(/[\s/,]+/)).filter(Boolean);
}

function inferWeatherCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9+\-\s]/g, " ");
  const match = normalized.match(/(?:^|\s)([+-]?(?:TSRA|SHRA|FZRA|FZDZ|FZFG|VCTS|VCSH|LLWS|RA|DZ|SN|SG|PL|GR|GS|FU|VA|HZ|FG|BR|SQ|FC|TS))(?=\s|$)/);
  return match?.[1] || "";
}

function categoryForCode(rawCode: string): string {
  const code = rawCode.toUpperCase().replace(/^[+-]/, "");
  if (code === "TS" || code === "TSRA" || code === "VCTS") return "thunder";
  if (code === "FZRA" || code === "FZDZ") return "freezing";
  if (code === "PL") return "ice";
  if (code === "GR" || code === "GS") return "hail";
  if (code === "SN" || code === "SG") return "snow";
  if (code === "SHRA" || code === "VCSH") return "shower";
  if (code === "RA") return "rain";
  if (code === "DZ") return "drizzle";
  if (code === "FZFG" || code === "FG") return "fog";
  if (code === "BR") return "mist";
  if (code === "HZ") return "haze";
  if (code === "FU") return "smoke";
  if (code === "VA") return "ash";
  if (code === "SQ") return "squall";
  if (code === "FC") return "tornado";
  if (code === "LLWS") return "wind_shear";
  return "";
}

function iconForCategory(category: string): string | null {
  if (category === "thunder") return "⛈️";
  if (category === "freezing" || category === "ice" || category === "hail") return "🧊";
  if (category === "snow") return "❄️";
  if (category === "rain" || category === "drizzle" || category === "shower") return "🌧️";
  if (category === "fog" || category === "mist" || category === "haze") return "🌫️";
  if (category === "ash") return "🌋";
  if (category === "tornado") return "🌪️";
  if (category === "smoke" || category === "squall" || category === "wind_shear") return "💨";
  return null;
}

function splitLeadingIcon(value: string): { text: string; icon: string | null } {
  const match = value.match(/^(\p{Extended_Pictographic}(?:\uFE0F)?)(?:\s+|$)(.*)$/u);
  return match ? { icon: match[1], text: clean(match[2]) } : { icon: null, text: value };
}

function severityForTone(tone: OpsTone): OpsAlertSeverity {
  if (tone === "red") return "warning";
  if (tone === "yellow") return "caution";
  if (tone === "blue") return "informational";
  return "none";
}

function wxColorClass(tone: OpsTone): WxAlertColorClass {
  if (tone === "red") return "alert-red";
  if (tone === "yellow") return "alert-yellow";
  if (tone === "blue") return "alert-blue";
  return "alert-none";
}

function classifyWxAlert(code: string, category: string, sources: string[]): WxClassification {
  const currentSource = sources.some(source => source === "METAR" || source === "ATIS");

  if (HIGH_IMPACT_CATEGORIES.has(category)) {
    return currentSource
      ? { tone: "red", flash: true, pulse: false }
      : { tone: "yellow", flash: false, pulse: true };
  }

  if (HEAVY_PRECIP_CODES.has(code)) return { tone: "yellow", flash: false, pulse: true };
  if (category === "snow") return { tone: "yellow", flash: false, pulse: true };

  if (category === "fog") {
    if (code === "FZFG" && currentSource) return { tone: "red", flash: true, pulse: false };
    return { tone: "yellow", flash: false, pulse: true };
  }

  if (INFO_CATEGORIES.has(category)) return { tone: "blue", flash: false, pulse: false };
  return { tone: "yellow", flash: false, pulse: true };
}

export function resolveWxAlertDisplay(input: WxAlertDisplayInput): WxAlertDisplay {
  const rawText = clean(input.text).replace(/^WX\s+ALERT\s*\|\s*/i, "").trim();
  if (input.visible === false || !rawText || /^(?:NONE|--|N\/A)$/i.test(rawText)) {
    return {
      text: "NONE",
      icon: null,
      severity: "none",
      colorClass: "alert-none",
      shouldPulse: false,
      shouldFlash: false,
    };
  }

  const split = splitLeadingIcon(rawText);
  const code = clean(input.code).toUpperCase() || inferWeatherCode(split.text);
  const category = normalizeCategory(input.category) || categoryForCode(code);
  const fallback = classifyWxAlert(code, category, normalizeSources(input.sources));
  const suppliedTone = normalizeTone(input.tone);
  // A visible Ops WX alert has only blue/yellow/red tones. Green belongs to the
  // no-alert state, so malformed visible green input falls back to classification.
  const tone = suppliedTone && suppliedTone !== "green" ? suppliedTone : fallback.tone;
  const hasMotionTuple = typeof input.flash === "boolean" || typeof input.pulse === "boolean";
  let shouldFlash = hasMotionTuple ? input.flash === true : suppliedTone ? tone === "red" : fallback.flash;
  let shouldPulse = hasMotionTuple ? input.pulse === true : suppliedTone ? tone === "yellow" : fallback.pulse;

  // Ops Board classifications are mutually exclusive; a malformed feed cannot run
  // the flash and pulse animations at the same time.
  if (shouldFlash) shouldPulse = false;
  if (input.reducedMotion) {
    shouldFlash = false;
    shouldPulse = false;
  }

  return {
    text: split.text,
    icon: clean(input.icon) || split.icon || iconForCategory(category),
    severity: severityForTone(tone),
    colorClass: wxColorClass(tone),
    shouldPulse,
    shouldFlash,
  };
}

function lightningKind(input: LightningDisplayInput): LightningKind {
  const raw = clean(input.level || input.severity).toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "none" || raw === "clear" || raw === "no_lightning") return "none";
  if (raw === "distant" || raw === "vicinity" || raw === "caution") return "caution";
  if (raw === "watch") return "watch";
  if (raw === "active_field" || raw === "station" || raw === "severe" || raw === "warning" || raw === "active") return "warning";
  if (raw) return "watch";

  const tone = normalizeTone(input.tone);
  if (input.flash === true || tone === "red") return "warning";
  if (input.pulse === true || tone === "yellow") return "caution";
  if (tone === "green") return "none";
  return "unknown";
}

function lightningColorClass(kind: LightningKind): LightningColorClass {
  if (kind === "warning") return "lightning-red";
  if (kind === "caution" || kind === "watch") return "lightning-yellow";
  return "lightning-green";
}

export function resolveLightningDisplay(input: LightningDisplayInput): LightningDisplay {
  const status = clean(input.status).toUpperCase();
  const isUnavailable = input.isUnavailable === true
    || input.unavailable === true
    || /(?:UNAVAILABLE|FAILED|ERROR|BAD)/.test(status);
  const isStale = input.isStale === true || input.stale === true || /STALE/.test(status);
  const sourceTime = clean(input.sourceTime) || null;

  if (isUnavailable) {
    return {
      text: "NONE",
      severity: "none",
      colorClass: "lightning-green",
      shouldPulse: false,
      shouldFlash: false,
      isStale,
      isUnavailable: true,
      sourceTime,
    };
  }

  const kind = lightningKind(input);
  const rawText = clean(input.text || input.awareness);
  const missingReport = kind === "unknown" && !rawText;
  if (missingReport) {
    return {
      text: "NONE",
      severity: "none",
      colorClass: "lightning-green",
      shouldPulse: false,
      shouldFlash: false,
      isStale,
      isUnavailable: true,
      sourceTime,
    };
  }

  const resolvedKind = kind === "unknown" ? "watch" : kind;
  let shouldPulse = resolvedKind === "caution";
  let shouldFlash = resolvedKind === "warning";

  // An unclassified legacy/watch record follows the Ops Board renderer's supplied
  // motion flags while retaining its yellow watch color.
  if (resolvedKind === "watch") {
    shouldFlash = input.flash === true;
    shouldPulse = !shouldFlash && input.pulse === true;
  }
  if (input.reducedMotion) {
    shouldPulse = false;
    shouldFlash = false;
  }

  const severity: OpsAlertSeverity = resolvedKind === "warning"
    ? "warning"
    : resolvedKind === "caution" || resolvedKind === "watch"
      ? "caution"
      : "none";

  return {
    text: rawText || "NONE",
    severity,
    colorClass: lightningColorClass(resolvedKind),
    shouldPulse,
    shouldFlash,
    isStale,
    isUnavailable: false,
    sourceTime,
  };
}
