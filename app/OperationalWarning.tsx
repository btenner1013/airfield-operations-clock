import type { CSSProperties } from "react";
import { OPS_ALERT_COLORS } from "./alertPresentation";

type WarningTone = keyof typeof OPS_ALERT_COLORS;
export type OperationalWarningProps = {
  kind: "current" | "weather";
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
export default function OperationalWarning({ kind, text, icon, tone, pulse, flash, stale = false, sourceTime, sourceStamp, preview = false, feedStatus }: OperationalWarningProps) {
  const color = OPS_ALERT_COLORS[tone as WarningTone] || OPS_ALERT_COLORS.yellow;
  const background = tone === "red" ? "#25171b" : tone === "blue" ? "#10232e" : "#252316";
  const label = kind === "weather" ? "WEATHER ALERT" : stale ? "REPORTED WX" : "CURRENT WX";
  const status = preview ? "PREVIEW" : kind === "weather" ? "OPS BOARD" : stale ? "STALE REPORT" : sourceStamp && sourceStamp !== "—" ? `OBS ${sourceStamp}` : "TIME UNVERIFIED";
  const note = preview ? null : kind === "current" && stale && sourceStamp && sourceStamp !== "—" ? `OBS ${sourceStamp}` : kind === "weather" && feedStatus && feedStatus !== "OK" ? `FEED ${feedStatus}` : null;
  const container: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", boxSizing: "border-box", width: "100%", minWidth: 0, flexShrink: 0, border: `1px solid ${color}55`, borderLeft: `3px solid ${color}`, borderRadius: 5, backgroundColor: background, color };
  const header: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 5, fontFamily: "Consolas, monospace", lineHeight: 1.1 };
  const small: CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "#bed0dc" };
  return <div className={`ops-warning${pulse ? " alert-pulse" : ""}${flash ? " alert-flash" : ""}`} data-kind={kind} data-tone={tone} data-stale={stale || undefined} data-preview={preview || undefined} data-source-time={sourceTime || undefined} role="group" aria-label={`${label}. ${status}. ${text}`} style={container}>
    <div className="ops-warning-heading" style={header}>
      <span className="ops-warning-label" style={small}>{label}</span>
      <span className="ops-warning-status" style={{ ...small, color: stale && !preview ? "#f3c17c" : "#bed0dc", fontSize: 8, padding: "2px 4px", border: `1px solid ${stale && !preview ? "#9d794b" : "#526675"}`, borderRadius: 3 }}>{status}</span>
    </div>
    <div className="ops-warning-body" style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
      {icon && <span className="ops-warning-icon" aria-hidden="true" style={{ display: "flex", flexShrink: 0, fontSize: 19, lineHeight: 1.15 }}>{icon}</span>}
      <strong className="ops-warning-text" style={{ display: "block", minWidth: 0, color, fontFamily: "Consolas, monospace", fontSize: 18, fontWeight: 800, lineHeight: 1.18, letterSpacing: ".015em", whiteSpace: "normal", overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{text}</strong>
    </div>
    {note && <span className="ops-warning-note" style={{ ...small, fontSize: 8, letterSpacing: ".04em" }}>{note}</span>}
  </div>;
}
