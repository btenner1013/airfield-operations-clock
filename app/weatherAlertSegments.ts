import { resolveWxAlertDisplay, type WxAlertDisplay, type WxAlertDisplayInput } from "./alertPresentation.ts";

/** Preserve Ops Board ordering and each phenomenon's supplied presentation.
 * Old feeds and malformed structured records keep the legacy summary display. */
export function resolveWeatherAlertSegments(primary: unknown, secondary: unknown, legacy: WxAlertDisplayInput): WxAlertDisplay[] {
  if (legacy.visible === false) return [];
  const segments: WxAlertDisplay[] = [];
  for (const value of [primary, secondary]) {
    if (!value || typeof value !== "object") continue;
    const alert = value as Record<string, unknown>;
    const text = typeof alert.displayText === "string" && alert.displayText.trim() ? alert.displayText : alert.text;
    if (typeof text !== "string" || !text.trim()) continue;
    const display = resolveWxAlertDisplay({
      text,
      tone: typeof alert.displayTone === "string" ? alert.displayTone : null,
      code: typeof alert.code === "string" ? alert.code : null,
      category: typeof alert.category === "string" ? alert.category : null,
      sources: Array.isArray(alert.sources) ? alert.sources.filter((source): source is string => typeof source === "string") : null,
      pulse: typeof alert.pulse === "boolean" ? alert.pulse : null,
      flash: typeof alert.flash === "boolean" ? alert.flash : null,
      reducedMotion: legacy.reducedMotion,
    });
    if (display.severity !== "none") segments.push(display);
  }
  if (segments.length) return segments;
  const fallback = resolveWxAlertDisplay(legacy);
  return fallback.severity === "none" ? [] : [fallback];
}
