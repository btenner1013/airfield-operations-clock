export type SkyPhase = "day" | "night" | "sunrise" | "sunset";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Sunset grading belongs to a low/mid cloud deck, not every golden-hour sky.
 * Keep the existing clear/high-cirrus and adverse-weather photographs intact.
 */
export function cloudSunsetStrength(phase: SkyPhase | undefined, coverage: number, ceiling: number | null, storm: number): number {
  if (phase !== "sunset" || ceiling === null || !Number.isFinite(ceiling) || !Number.isFinite(coverage) || !Number.isFinite(storm)) return 0;
  return clamp((coverage - 0.44) / 0.32) * clamp((12000 - ceiling) / 2000) * (1 - clamp(storm / 0.08));
}

