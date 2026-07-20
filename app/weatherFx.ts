// Phase 2C — shared weather-effect classification and particle spec.
// Consumes already-parsed present-weather tokens from the normalized scene object; it never
// re-parses the raw METAR. Pure functions only — no DOM, no timers, no React.

export type PrecipType =
  | "none" | "drizzle" | "rain" | "freezing-drizzle" | "freezing-rain"
  | "snow" | "snow-shower" | "blowing-snow" | "drifting-snow" | "snow-grains"
  | "ice-pellets" | "hail" | "small-hail";
export type ObscurationType =
  | "none" | "mist" | "fog" | "freezing-fog" | "haze" | "smoke"
  | "dust" | "sand" | "dust-storm" | "sandstorm" | "dust-whirl" | "volcanic-ash";
export type Intensity = "light" | "moderate" | "heavy";
export type EffectState = { precip: PrecipType; obscuration: ObscurationType; intensity: Intensity; vicinity: boolean; shower: boolean };

// Lower index = more operationally significant when several precips are reported together.
const PRECIP_RANK: PrecipType[] = ["hail", "ice-pellets", "freezing-rain", "freezing-drizzle", "snow", "snow-shower", "blowing-snow", "drifting-snow", "snow-grains", "small-hail", "rain", "drizzle", "none"];
const OBSC_RANK: ObscurationType[] = ["volcanic-ash", "dust-storm", "sandstorm", "freezing-fog", "fog", "smoke", "dust", "sand", "dust-whirl", "haze", "mist", "none"];

function tokenPrecip(t: string): PrecipType {
  if (/FZRA/.test(t)) return "freezing-rain";
  if (/FZDZ/.test(t)) return "freezing-drizzle";
  if (/GR/.test(t) && !/GS/.test(t)) return "hail";
  if (/GS/.test(t)) return "small-hail";
  if (/PL/.test(t)) return "ice-pellets";
  if (/BLSN/.test(t)) return "blowing-snow";
  if (/DRSN/.test(t)) return "drifting-snow";
  if (/SG/.test(t)) return "snow-grains";
  if (/SHSN/.test(t)) return "snow-shower";
  if (/SN/.test(t)) return "snow";
  if (/DZ/.test(t)) return "drizzle";
  if (/RA/.test(t) || /\bUP\b/.test(t)) return "rain";
  return "none";
}
function tokenObsc(t: string): ObscurationType {
  if (/FZFG/.test(t)) return "freezing-fog";
  if (/\bFG\b/.test(t) || /MIFG|BCFG|PRFG/.test(t)) return "fog";
  if (/\bBR\b/.test(t)) return "mist";
  if (/\bHZ\b/.test(t)) return "haze";
  if (/\bFU\b/.test(t)) return "smoke";
  if (/\bVA\b/.test(t)) return "volcanic-ash";
  if (/DS/.test(t)) return "dust-storm";
  if (/SS/.test(t)) return "sandstorm";
  if (/\bDU\b|BLDU|DRDU/.test(t)) return "dust";
  if (/\bSA\b|BLSA|DRSA/.test(t)) return "sand";
  if (/\bPO\b/.test(t)) return "dust-whirl";
  return "none";
}

export function classifyEffect(phenomena: string[]): EffectState {
  let precip: PrecipType = "none", obsc: ObscurationType = "none";
  let vicinity = false, shower = false, hasPlus = false, hasMinus = false;
  for (const raw of phenomena) {
    const t = (raw || "").toUpperCase();
    if (t.startsWith("VC")) vicinity = true;
    if (/SH/.test(t)) shower = true;
    if (t.startsWith("+")) hasPlus = true;
    if (t.startsWith("-")) hasMinus = true;
    const p = tokenPrecip(t); if (p !== "none" && PRECIP_RANK.indexOf(p) < PRECIP_RANK.indexOf(precip)) precip = p;
    const o = tokenObsc(t); if (o !== "none" && OBSC_RANK.indexOf(o) < OBSC_RANK.indexOf(obsc)) obsc = o;
  }
  if (precip === "none" && shower) precip = "rain"; // bare VCSH / SH → distant rain showers
  const intensity: Intensity = hasPlus ? "heavy" : (hasMinus && !hasPlus) ? "light" : precip === "none" ? "light" : "moderate";
  return { precip, obscuration: obsc, intensity, vicinity, shower };
}

// --- particle spec for the single precipitation canvas -----------------------
export type FxShape = "streak" | "flake" | "pellet";
export type PaneSpec = { count: number; freezing: boolean; roll: number; trails: boolean };
export type FxSpec = {
  shape: FxShape; count: number; speed: number; len: number; size: number; thick: number;
  vx: number; sway: number; bounce: boolean; alpha: number; color: string; near: boolean; burst: boolean;
  veil: number; pane: PaneSpec | null;
};

const SNOW: PrecipType[] = ["snow", "snow-shower", "blowing-snow", "drifting-snow", "snow-grains"];
const LIQUID: PrecipType[] = ["drizzle", "rain", "freezing-drizzle", "freezing-rain"];
const isFreezing = (p: PrecipType) => p === "freezing-rain" || p === "freezing-drizzle";

// Build the canvas particle spec from the classified effect + wind + performance. Returns null when
// there is no falling precipitation and no forced pane droplets. paneOverride: null=auto, else forces
// the window-pane droplet layer on/off (preview / debug only).
export function buildFxSpec(fx: EffectState, windNx: number, windSpeedKt: number, perf: "full" | "low", night: boolean, reduced: boolean, paneOverride: boolean | null): FxSpec | null {
  const p = fx.precip;
  const low = perf === "low";
  const light = fx.intensity === "light", heavy = fx.intensity === "heavy";
  const paneOn = paneOverride != null ? paneOverride : LIQUID.includes(p);
  if (p === "none" && !paneOn) return null;
  const scale = low ? 0.5 : 1;
  const iMul = heavy ? 1.55 : light ? 0.55 : 1;
  const drift = Math.min(windSpeedKt, 45) * 12 * (windNx >= 0 ? 1 : -1); // px/s lateral, capped

  let shape: FxShape = "streak", count = 0, speed = 1050, len = 26, size = 1, thick = 1.4;
  let sway = 0, bounce = false, near = false, burst = false, alpha = 0.5;
  if (p === "drizzle" || p === "freezing-drizzle") { shape = "streak"; count = 300; speed = 520; len = 9; thick = 0.8; alpha = 0.34; }
  else if (p === "rain" || p === "freezing-rain") { shape = "streak"; count = 240; speed = 1150; len = 30; thick = 1.4; alpha = 0.46; }
  else if (SNOW.includes(p)) { shape = "flake"; count = 260; speed = 130; size = 1.9; sway = 26; alpha = 0.85; near = true; if (p === "snow-grains") { size = 1.1; speed = 180; sway = 8; } }
  else if (p === "ice-pellets") { shape = "pellet"; count = 220; speed = 1080; size = 1.4; bounce = true; alpha = 0.66; }
  else if (p === "hail" || p === "small-hail") { shape = "pellet"; count = p === "hail" ? 150 : 120; speed = 1500; size = p === "hail" ? 2.4 : 1.6; bounce = true; burst = true; alpha = 0.8; }

  if (fx.vicinity) { count = Math.round(count * 0.35); alpha *= 0.7; }
  count = Math.round(count * iMul * scale);
  if (reduced) { speed *= 0.16; sway *= 0.3; count = Math.round(count * 0.5); }

  // Atmospheric veil: only rain-family, only full/normal motion.
  let veil = (p === "rain" || p === "freezing-rain") ? (heavy ? 0.16 : fx.intensity === "moderate" ? 0.06 : 0) : 0;
  if (low || reduced) veil = 0;

  // Window-pane droplets.
  let pane: PaneSpec | null = null;
  if (paneOn) {
    let dcount = light ? 6 : heavy ? 24 : 14;
    if (fx.vicinity) dcount = 3;
    if (isFreezing(p)) dcount = Math.round(dcount * 0.6);
    if (low) dcount = Math.min(dcount, 8);
    if (reduced) dcount = Math.min(dcount, 5);
    pane = { count: dcount, freezing: isFreezing(p), roll: reduced ? 0.14 : low ? 0.7 : 1, trails: !low && !reduced };
  }

  const baseCol = isFreezing(p) ? [188, 208, 224] : shape === "flake" ? [236, 244, 250] : [200, 220, 235];
  const dim = night ? 0.72 : 1;
  return { shape, count, speed, len, size, thick, vx: drift, sway, bounce, alpha: alpha * dim, color: `rgba(${baseCol[0]},${baseCol[1]},${baseCol[2]},1)`, near, burst, veil, pane };
}
