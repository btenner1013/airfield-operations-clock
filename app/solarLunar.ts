/** Presentation helpers only. Live solar/lunar ephemeris and clock logic remain in page.tsx. */
export type MoonPhaseInfo = { phase: number; name: string };
export type SolarInstrumentWindow = {
  daylight: boolean;
  progress: number;
  sunrise: string;
  sunset: string;
  isTomorrow: boolean;
  markerX: number;
  markerY: number;
};

/** North-up phase convention for KMEM: waxing is lit on the right, waning on the left.
 * The terminator is a projected semicircle, not a linear-width shadow or sky orientation.
 */
export function moonIlluminatedPath(phase: number, radius = 40): string | null {
  if (!Number.isFinite(phase) || !Number.isFinite(radius) || radius <= 0) return null;
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.000001 || p > 0.999999) return null;
  const r = Number(radius.toFixed(4));
  if (Math.abs(p - 0.5) < 0.000001) return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  const waxing = p < 0.5;
  const cosine = Math.cos(2 * Math.PI * p);
  const rx = Number((Math.abs(cosine) * r).toFixed(4));
  const outerSweep = waxing ? 1 : 0;
  const terminatorSweep = waxing ? (cosine >= 0 ? 0 : 1) : (cosine >= 0 ? 1 : 0);
  return `M 0 ${-r} A ${r} ${r} 0 0 ${outerSweep} 0 ${r} ${rx === 0 ? `L 0 ${-r}` : `A ${rx} ${r} 0 0 ${terminatorSweep} 0 ${-r}`} Z`;
}

const MOON_PREVIEWS: Record<string, MoonPhaseInfo> = {
  new: { phase: 0, name: "NEW MOON" },
  crescent: { phase: 0.12, name: "WAXING CRESCENT" },
  "waxing-crescent": { phase: 0.12, name: "WAXING CRESCENT" },
  quarter: { phase: 0.25, name: "FIRST QUARTER" },
  "first-quarter": { phase: 0.25, name: "FIRST QUARTER" },
  gibbous: { phase: 0.375, name: "WAXING GIBBOUS" },
  "waxing-gibbous": { phase: 0.375, name: "WAXING GIBBOUS" },
  full: { phase: 0.5, name: "FULL MOON" },
  "waning-gibbous": { phase: 0.625, name: "WANING GIBBOUS" },
  "last-quarter": { phase: 0.75, name: "LAST QUARTER" },
  "waning-crescent": { phase: 0.88, name: "WANING CRESCENT" },
};

/** Existing preview aliases stay valid; every preview's name now matches its geometry. */
export function resolveMoonPreview(live: MoonPhaseInfo, preview: string | null): MoonPhaseInfo {
  return preview && Object.hasOwn(MOON_PREVIEWS, preview) ? { ...MOON_PREVIEWS[preview] } : live;
}

export function solarLocalTime(value: string): string {
  if (!value || value === "--:--") return "—";
  return value.endsWith("L") ? value : `${value}L`;
}

export function solarDisplayProgress(progress: number): number | null {
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
}

/** A verified solar window is required before exposing any lunar presentation. */
export function solarWindowAvailable(solar: SolarInstrumentWindow): boolean {
  return solarLocalTime(solar.sunrise) !== "—" && solarLocalTime(solar.sunset) !== "—" && solarDisplayProgress(solar.progress) !== null && Number.isFinite(solar.markerX) && Number.isFinite(solar.markerY);
}

export function showLunarInformation(solar: SolarInstrumentWindow): boolean {
  return solarWindowAvailable(solar) && !solar.daylight;
}

/** Retains the original 200 × 150 dial's 88 × 56 day/night ellipse and resolved marker.
 * This only connects that existing marker to the start of its half-cycle.
 */
export function solarDialProgressPath(solar: SolarInstrumentWindow): string | null {
  const progress = solarDisplayProgress(solar.progress);
  if (progress === null || progress === 0 || !Number.isFinite(solar.markerX) || !Number.isFinite(solar.markerY)) return null;
  return `M ${solar.daylight ? 12 : 188} 76 A 88 56 0 0 1 ${solar.markerX.toFixed(3)} ${solar.markerY.toFixed(3)}`;
}
