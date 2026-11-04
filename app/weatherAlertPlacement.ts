import { resolveWxAlertDisplay, type WxAlertDisplay, type WxAlertDisplayInput } from "./alertPresentation.ts";

export type WeatherAlertScope = "current" | "forecast" | "unverified";
export type WeatherAlertSourceContext = {
  retained?: boolean;
  metarObservedAt?: string | null; atisObservedAt?: string | null;
  metarStatus?: string | null; atisStatus?: string | null;
};
export type PlacedWeatherAlert = WxAlertDisplay & {
  scope: WeatherAlertScope;
  sourceTime: string | null;
  stale: boolean;
};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sources = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).flatMap(value => text(value).toUpperCase().split(/[\s,/]+/)).filter(Boolean);

/** Scope follows evidence, never primary/secondary position or alert severity/color.
 * Contradictory and manual records remain visible without being called current or forecast. */
export function weatherAlertScope(value: unknown, message: string): WeatherAlertScope {
  const alert = record(value), labels = sources(alert.sources), upper = message.toUpperCase();
  if (labels.some(source => source === "MANUAL" || source === "DEBUG")) return "unverified";
  const forecast = labels.some(source => /^TAF(?:_|$)/.test(source)) || text(alert.severity).toLowerCase() === "forecast" ||
    Boolean(text(alert.tafWindow) || text(alert.tafStartIso) || text(alert.tafEndIso)) ||
    /\b(?:TAF|PSBL|FORECAST|TEMPO|BECMG|PROB\d{2})\b|\b\d{2}(?::?\d{2})?\s*[-–]\s*\d{2}(?::?\d{2})?Z\b/.test(upper);
  // NOW inside PSBL NOW-04Z is a forecast window, never an observed condition.
  const observed = labels.some(source => source === "METAR" || source === "ATIS") || /\b(?:METAR|ATIS)\b/.test(upper) || !forecast && /\bNOW\b|\bOVER FIELD\b/.test(upper);
  return observed === forecast ? "unverified" : forecast ? "forecast" : "current";
}

function observation(alert: Record<string, unknown>, display: WxAlertDisplay, scope: WeatherAlertScope, context: WeatherAlertSourceContext, nowMs: number): Pick<PlacedWeatherAlert, "sourceTime" | "stale"> {
  if (scope !== "current") return { sourceTime: null, stale: false };
  // The visible suffix identifies Ops' chosen source when both candidates are listed.
  const suffix = display.text.toUpperCase().match(/\b(ATIS|METAR)\s*$/)?.[1];
  const listed = sources(alert.sources).filter(source => source === "ATIS" || source === "METAR");
  const source = suffix || (listed.length === 1 ? listed[0] : null);
  const candidate = source === "ATIS" ? context.atisObservedAt : source === "METAR" ? context.metarObservedAt : null;
  const raw = text(candidate);
  const status = source === "ATIS" ? context.atisStatus : source === "METAR" ? context.metarStatus : null;
  const validTime = raw && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : null;
  const sourceTime = validTime && new Date(validTime).toISOString().slice(0,16) === validTime.replace(" ","T").slice(0,16) ? validTime : null;
  const age = sourceTime ? (nowMs - Date.parse(sourceTime)) / 60000 : NaN;
  const stale = context.retained === true || /STALE|LAST_GOOD|ERROR|FAILED|UNAVAILABLE/.test(text(status).toUpperCase()) ||
    Number.isFinite(age) && (age < -5 || age >= (source === "ATIS" ? 90 : 75));
  return { sourceTime, stale };
}

/** Move already-selected Ops hazards; do not recalculate severity, source priority, or TAF windows.
 * Legacy summaries are split only at their explicit summary separators. Unclassified text stays
 * in Current Weather as a neutral, time-unverified report, never masquerading as a forecast. */
export function resolveWeatherAlertPlacement(primary: unknown, secondary: unknown, legacy: WxAlertDisplayInput,
  context: WeatherAlertSourceContext = {}, nowMs = Date.now()): { current: PlacedWeatherAlert[]; future: PlacedWeatherAlert[] } {
  const result: { current: PlacedWeatherAlert[]; future: PlacedWeatherAlert[] } = { current: [], future: [] };
  if (legacy.visible === false) return result;
  const selected: PlacedWeatherAlert[] = [];
  const add = (input: WxAlertDisplayInput, value: unknown) => {
    const display = resolveWxAlertDisplay(input);
    if (display.severity === "none") return;
    const scope = weatherAlertScope(value, display.text);
    selected.push({ ...display, scope, ...observation(record(value), display, scope, record(context), nowMs) });
  };
  for (const value of [primary, secondary]) {
    const alert = record(value), message = text(alert.displayText) || text(alert.text);
    if (!message) continue;
    add({ text: message, tone: text(alert.displayTone), code: text(alert.code), category: text(alert.category),
      sources: sources(alert.sources), pulse: typeof alert.pulse === "boolean" ? alert.pulse : null,
      flash: typeof alert.flash === "boolean" ? alert.flash : null, reducedMotion: legacy.reducedMotion }, value);
  }
  const structured = [...selected];
  const summary = text(legacy.text).replace(/^WX\s+ALERT\s*\|\s*/i, "").split(/\s*(?:→|\|)\s*/).filter(Boolean);
  for (const message of summary) {
    const normalized = resolveWxAlertDisplay({ text: message }).text;
    // Same-hazard summaries can abbreviate the forecast to "PSBL <window>".
    if (structured.some(display => display.text === normalized || /^PSBL\s/.test(normalized) && display.scope === "forecast" && display.text.endsWith(normalized))) continue;
    if (structured.length && structured.every(display => normalized.includes(display.text))) continue;
    // Older same-code summaries omit the second hazard. Preserve that relationship when
    // separating the panels, using only an explicit code already present in the source.
    const first = selected.find(display => display.scope === "current");
    const explicitCode = [primary, secondary].map(record).find(alert => weatherAlertScope(alert, text(alert.displayText) || text(alert.text)) === "current")?.code;
    const codePattern = /^[+-]?(?:TSRA|TSGR|TS|VCTS|VCSH|SHRA|FZRA|FZDZ|FZFG|RA|DZ|SN|SG|PL|GR|GS|FU|VA|HZ|FG|BR|SQ|FC|LLWS)$/;
    const candidate = text(explicitCode) || first?.text.split(/\s+/)[0] || "";
    const inherited = /^PSBL\s/.test(normalized) && codePattern.test(candidate) ? `${candidate} ${normalized}` : message;
    add({ ...legacy, text: inherited }, null);
  }
  for (const display of selected) {
    const group = display.scope === "forecast" ? result.future : result.current;
    if (!group.some(existing => existing.text === display.text && existing.colorClass === display.colorClass && existing.shouldPulse === display.shouldPulse && existing.shouldFlash === display.shouldFlash)) group.push(display);
  }
  return result;
}
