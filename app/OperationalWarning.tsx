import type { CSSProperties } from "react";
import { OPS_ALERT_COLORS, type WxAlertDisplay } from "./alertPresentation";

type WarningTone = keyof typeof OPS_ALERT_COLORS;
export type OperationalWarningProps = {
  kind: "current" | "weather";
  segments?: WxAlertDisplay[];
  text: string;
  icon?: string | null;
  tone: string;
  pulse: boolean;
  flash: boolean;
  stale?: boolean;
  sourceTime?: string | null;
  sourceStamp?: string;
  preview?: boolean;
  feedStatus?: string;
};

/** Shared visual treatment only. All wording, severity and motion decisions are supplied
 * by the existing alert resolvers; this component never parses a hazard or time window.
 * Inline base styles also allow faithful isolated rendering without a browser session.
 */
export default function OperationalWarning({ kind, segments, text, icon, tone, pulse, flash, stale = false, sourceTime, sourceStamp, preview = false, feedStatus }: OperationalWarningProps) {
  if (segments?.length) {
    tone = segments[0].colorClass.slice(6);
    pulse = segments[0].shouldPulse;
    flash = segments[0].shouldFlash;
    text = segments.map(segment => segment.text).join(" | ");
  }
  const multiple = Boolean(segments && segments.length > 1);
  const color = OPS_ALERT_COLORS[tone as WarningTone] || OPS_ALERT_COLORS.yellow;
  const background = tone === "red" ? "#25171b" : tone === "blue" ? "#10232e" : "#252316";
  const label = kind === "weather" ? "WEATHER ALERT" : stale ? "REPORTED WX" : "CURRENT WX";
  const status = preview ? "PREVIEW" : kind === "weather" ? "OPS BOARD" : stale ? "STALE REPORT" : sourceStamp && sourceStamp !== "—" ? `OBS ${sourceStamp}` : "TIME UNVERIFIED";
  const note = preview ? null : kind === "current" && stale && sourceStamp && sourceStamp !== "—" ? `OBS ${sourceStamp}` : kind === "weather" && feedStatus && feedStatus !== "OK" ? `FEED ${feedStatus}` : null;
  const container: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", boxSizing: "border-box", width: "100%", minWidth: 0, flexShrink: 0, border: `1px solid ${color}55`, borderLeft: `3px solid ${color}`, borderRadius: 5, backgroundColor: background, color };
  const header: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 5, fontFamily: "Consolas, monospace", lineHeight: 1.1 };
  const small: CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "#bed0dc" };
  return <div className={`ops-warning${!multiple && pulse ? " alert-pulse" : ""}${!multiple && flash ? " alert-flash" : ""}`} data-kind={kind} data-tone={tone} data-stale={stale || undefined} data-preview={preview || undefined} data-source-time={sourceTime || undefined} role="group" aria-label={`${label}. ${status}. ${text}`} style={container}>
    <div className="ops-warning-heading" style={header}>
      <span className="ops-warning-label" style={small}>{label}</span>
      <span className="ops-warning-status" style={{ ...small, color: stale && !preview ? "#f3c17c" : "#bed0dc", fontSize: 8, padding: "2px 4px", border: `1px solid ${stale && !preview ? "#9d794b" : "#526675"}`, borderRadius: 3 }}>{status}</span>
    </div>
    {(segments?.length ? segments : [{ text, icon, colorClass: `alert-${tone}`, shouldPulse: pulse, shouldFlash: flash }]).map((segment, index) => {
      const segmentTone = segment.colorClass.slice(6);
      const segmentColor = OPS_ALERT_COLORS[segmentTone as WarningTone] || color;
      return <div key={index} className={`ops-warning-body${multiple && segment.shouldPulse ? " segment-pulse" : ""}${multiple && segment.shouldFlash ? " segment-flash" : ""}`} data-segment={index} data-tone={segmentTone} style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
        {segment.icon && <span className="ops-warning-icon" aria-hidden="true" style={{ display: "flex", flexShrink: 0, fontSize: 19, lineHeight: 1.15 }}>{segment.icon}</span>}
        <strong className="ops-warning-text" style={{ display: "block", minWidth: 0, color: segmentColor, fontFamily: "Consolas, monospace", fontSize: 18, fontWeight: 800, lineHeight: 1.18, letterSpacing: ".015em", whiteSpace: "normal", overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{segment.text}</strong>
      </div>;
    })}
    {note && <span className="ops-warning-note" style={{ ...small, fontSize: 8, letterSpacing: ".04em" }}>{note}</span>}
  </div>;
}
