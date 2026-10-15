import type { Theme } from "./weatherTypes";

type ParsedCode = { intensity: "" | "+" | "-"; vicinity: boolean; descriptor: string; phenomena: string[] };
export type WeatherIconFamily = Theme | "smoke" | "haze" | "dust" | "sand" | "dust-storm" | "sandstorm" | "blowing-dust" | "drifting-dust" | "blowing-sand" | "drifting-sand" | "volcanic-ash" | "dust-whirls" | "spray" | "ice-pellets" | "hail" | "small-hail" | "freezing-rain" | "freezing-drizzle" | "rain-snow" | "freezing-fog" | "snow-grains" | "ice-crystals" | "blowing-snow" | "drifting-snow" | "drizzle" | "squall" | "funnel-cloud" | "tornado" | "unknown-precipitation";

// Consume complete METAR weather tokens. For example, "FUEL" and "GRADUAL"
// must not become smoke or hail just because their text contains FU or GR.
function parseCode(value: string): ParsedCode | null {
  const token = value.trim().toUpperCase();
  const match = token.match(/^([+-]?)(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|DS|SS)){1,3})?$/);
  if (!match || (!match[4] && !["TS", "SH"].includes(match[3] || ""))) return null;
  // Intensity and vicinity are alternatives in an aviation weather token.
  if (match[1] && match[2]) return null;
  return { intensity: match[1] as ParsedCode["intensity"], vicinity: !!match[2], descriptor: match[3] || "", phenomena: match[4]?.match(/.{2}/g) || [] };
}

export function resolveWeatherIconFamily(condition: Theme, codes?: readonly string[]): WeatherIconFamily {
  if (!Array.isArray(codes) || !codes.length) return condition;
  const parsed = codes.filter((code): code is string => typeof code === "string").map(parseCode).filter((code): code is ParsedCode => code !== null);
  if (!parsed.length) return "neutral";
  const has = (base: string) => parsed.some(code => code.phenomena.includes(base));
  const described = (descriptor: string, base: string) => parsed.some(code => code.descriptor === descriptor && code.phenomena.includes(base));

  // Only an actual TS descriptor warrants a lightning bolt. Hail, a funnel,
  // and a squall can share the severe-convection Theme without reporting TS.
  if (has("FC")) return parsed.some(code => code.intensity === "+" && code.phenomena.includes("FC")) ? "tornado" : "funnel-cloud";
  if (parsed.some(code => code.descriptor === "TS")) return "thunderstorm";
  if (has("SQ")) return "squall";
  if (has("GR")) return "hail";
  if (has("GS")) return "small-hail";
  if (described("FZ", "RA")) return "freezing-rain";
  if (described("FZ", "DZ")) return "freezing-drizzle";
  if (has("RA") && has("SN")) return "rain-snow";
  if (has("PL")) return "ice-pellets";
  if (described("BL", "SN")) return "blowing-snow";
  if (described("DR", "SN")) return "drifting-snow";
  if (has("SN")) return "snow";
  if (has("SG")) return "snow-grains";
  if (has("IC")) return "ice-crystals";
  if (has("RA")) return parsed.some(code => code.intensity === "+" && code.phenomena.includes("RA")) ? "heavy-rain" : "rain";
  if (has("DZ")) return "drizzle";
  if (has("UP")) return "unknown-precipitation";
  // SH/VCSH without a reported precipitation type must not invent rain.
  if (parsed.some(code => code.descriptor === "SH" && !code.phenomena.length)) return "unknown-precipitation";
  if (has("VA")) return "volcanic-ash";
  if (has("FU")) return "smoke";
  if (has("DS")) return "dust-storm";
  if (has("SS")) return "sandstorm";
  if (described("BL", "DU")) return "blowing-dust";
  if (described("DR", "DU")) return "drifting-dust";
  if (described("BL", "SA")) return "blowing-sand";
  if (described("DR", "SA")) return "drifting-sand";
  if (has("PO")) return "dust-whirls";
  if (has("DU")) return "dust";
  if (has("SA")) return "sand";
  if (has("PY")) return "spray";
  if (described("FZ", "FG")) return "freezing-fog";
  if (has("FG") || has("BR")) return "fog";
  if (has("HZ")) return "haze";
  return "neutral";
}

const GENERIC_FAMILIES = new Set<WeatherIconFamily>(["clear", "partly-cloudy", "overcast", "rain", "heavy-rain", "thunderstorm", "fog", "snow", "night", "sunrise", "sunset", "neutral"]);

function Cloud() {
  return <path data-part="cloud" d="M27 47C17 47 15 32 25 28C24 15 44 10 51 23C61 14 77 19 79 30C92 28 99 47 84 48H27Z" fill="#d9dde0" stroke="#788087" strokeWidth="3.6" strokeLinejoin="round" />;
}
function Snowflake({ x, y, size = 10 }: { x: number; y: number; size?: number }) {
  return <g data-part="ice-crystal" transform={`translate(${x} ${y}) scale(${size / 10})`} fill="none" stroke="#c7e7f5" strokeWidth="2.4" strokeLinecap="round"><path d="M0-9V9M-7.8-4.5 7.8 4.5M-7.8 4.5 7.8-4.5M-3-6 0-4 3-6M-3 6 0 4 3 6" /></g>;
}
function Drops({ freezing = false, drizzle = false }: { freezing?: boolean; drizzle?: boolean }) {
  const xs = freezing ? [34, 51] : [32, 54, 76];
  return <g data-part={drizzle ? "drizzle" : "rain"} fill={freezing ? "#8bd8f3" : "#33a7e2"}>{xs.map((x, i) => drizzle ? <g key={x}><circle cx={x} cy={57 + i % 2 * 3} r="2.7" /><circle cx={x - 3} cy={69 + i % 2 * 3} r="2.7" /></g> : <path key={x} d={`M${x} 52c-1 5-7 11-7 15a4.5 4.5 0 0 0 9 0c0-4-2-10-2-15Z`} />)}</g>;
}
function WindLines({ low = false }: { low?: boolean }) {
  return <g data-part="wind" fill="none" stroke="#c8b088" strokeWidth="3.7" strokeLinecap="round" transform={low ? "translate(0 20) scale(1 .65)" : undefined}><path d="M15 29H70C86 29 85 13 75 15M25 43H91M12 57H65C79 57 80 70 70 71" /></g>;
}
function Grains({ sand = false, storm = false, low = false }: { sand?: boolean; storm?: boolean; low?: boolean }) {
  const points = storm ? [[14, 14], [35, 19], [56, 10], [96, 24], [14, 43], [43, 35], [67, 47], [91, 55], [20, 72], [42, 65], [54, 77], [88, 75]] : low ? [[18, 62], [32, 71], [48, 61], [67, 70], [84, 59], [94, 72]] : [[18, 13], [34, 22], [52, 12], [96, 33], [18, 70], [38, 62], [55, 74], [92, 66]];
  return <g data-part="grains" fill={sand ? "#dfb578" : "#b8a083"} stroke="none">{points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={sand ? 2.9 : 2.3} />)}</g>;
}

function PhenomenonGlyph({ family, night }: { family: WeatherIconFamily; night: boolean }) {
  if (family === "smoke") return <g data-part="smoke-plumes" fill="none" strokeLinecap="round"><path d="M31 73c-17-13 13-18 2-33C22 25 45 23 38 9" stroke="#939ca5" strokeWidth="9" /><path d="M55 74c-14-16 17-22 5-37C49 23 68 18 63 7" stroke="#c1c7cb" strokeWidth="10" /><path d="M79 71c-11-11 15-17 6-28C74 31 89 27 85 17" stroke="#7f8c98" strokeWidth="7" /></g>;
  if (family === "haze") return <g data-part="haze">{night ? <path data-part="haze-moon" d="M64 15A21 21 0 1 0 73 51A24 24 0 0 1 64 15Z" fill="#a8bccc" opacity=".8" /> : <circle data-part="haze-sun" cx="54" cy="34" r="20" fill="#cdb173" opacity=".8" />}<g fill="none" stroke="#cbbd9d" strokeWidth="5" strokeLinecap="round"><path d="M13 38H94M20 50H87M12 62H96" /></g></g>;
  if (["dust", "sand", "dust-storm", "sandstorm", "blowing-dust", "drifting-dust", "blowing-sand", "drifting-sand"].includes(family)) {
    const sand = family.includes("sand"), storm = family === "dust-storm" || family === "sandstorm", low = family.startsWith("drifting-"), suspended = family === "dust" || family === "sand";
    return <g data-part={sand ? "sand" : "dust"}>{!suspended && <WindLines low={low} />}<Grains sand={sand} storm={storm || suspended} low={low} />{suspended && <g data-part="suspended-particles" fill={sand ? "#dfb578" : "#b8a083"}><circle cx="32" cy="41" r="3" /><circle cx="51" cy="52" r="2.5" /><circle cx="77" cy="30" r="3" /><circle cx="83" cy="46" r="2.5" /></g>}{sand && <path d="M14 78c17-12 28-13 42-7 14 5 26 4 39-1" fill="none" stroke="#d3ad76" strokeWidth="3" strokeLinecap="round" />}{storm && <path d="M11 7C-1 29 6 60 13 79" fill="none" stroke="#a88d6b" strokeWidth="5" opacity=".7" />}</g>;
  }
  if (family === "volcanic-ash") return <g data-part="ash"><path d="M28 34C9 34 12 15 27 17 28 4 45 2 51 14 63 3 78 9 78 20 96 13 103 35 85 36H28Z" fill="#8d949d" stroke="#bcc2c9" strokeWidth="2.5" /><path d="m29 43-4 7 8-1Zm22-3-3 8 7-2Zm25 2-4 6 9 1Zm-38 12-3 7 8-1Zm43 1-2 7 8-3Z" fill="#bdc2c8" /><path d="m31 78 20-24h9l20 24M48 58l7 4 8-4" fill="#737d89" stroke="#b7bec7" strokeWidth="3" strokeLinejoin="round" /></g>;
  if (family === "dust-whirls") return <g data-part="dust-whirl" fill="none" stroke="#c9aa79" strokeWidth="4" strokeLinecap="round"><path d="M22 17c49-15 83 10 43 18-53 11-65 25-21 29 24 3 31 7 9 13M14 43h10M86 56h9" /><Grains low /></g>;
  if (family === "spray") return <g data-part="spray" fill="none" stroke="#8dcde0" strokeWidth="4" strokeLinecap="round"><path d="M15 69c18 0 30-14 34-31 2-12 17-17 26-11-18 1-20 12-13 20 7 10 18 12 31 12M15 76h78" /><g fill="#9edced" stroke="none"><circle cx="71" cy="12" r="3" /><circle cx="88" cy="24" r="3" /><circle cx="95" cy="40" r="3" /><circle cx="52" cy="17" r="2.5" /></g></g>;
  if (family === "squall") return <g data-part="squall-wind" fill="none" stroke="#b5d3dd" strokeWidth="5" strokeLinecap="round"><path d="M10 23h55c20 0 17-20 5-16M21 41h71M9 59h52c22 0 21 22 6 17M76 33l17 8-17 8" /></g>;
  if (family === "funnel-cloud" || family === "tornado") return <g data-part="funnel"><Cloud /><g fill="none" stroke="#b8c7d1" strokeWidth="4" strokeLinecap="round"><path d="M30 51h48M37 59h35M43 67h22M49 75h10" />{family === "tornado" && <path d="M37 79h33M29 73l-5 2M79 73l5 2" />}</g></g>;
  if (family === "ice-crystals") return <g data-part="ice-crystals"><Snowflake x={50} y={39} size={24} /><path d="m20 17-4 7 4 7 4-7Zm66 35-5 9 5 9 5-9Z" fill="#b7e5f5" /></g>;
  if (family === "blowing-snow" || family === "drifting-snow") return <g data-part="windblown-snow"><g fill="none" stroke="#bad4e2" strokeWidth="3.5" strokeLinecap="round"><path d={family === "drifting-snow" ? "M12 54h60M33 68h60" : "M12 20h69M30 42h65M11 65h42"} /></g><Snowflake x={24} y={family === "drifting-snow" ? 68 : 40} size={10} /><Snowflake x={74} y={66} size={10} />{family === "drifting-snow" && <path d="M13 78h82" stroke="#8baebe" strokeWidth="3" />}</g>;
  if (family === "freezing-fog") return <g data-part="freezing-fog"><g fill="none" stroke="#a9bdca" strokeWidth="4" strokeLinecap="round"><path d="M13 24h79M23 39h65M12 55h47M18 70h38" /></g><Snowflake x={78} y={63} size={15} /></g>;
  return <><Cloud />{family === "freezing-rain" || family === "freezing-drizzle" ? <><Drops freezing drizzle={family === "freezing-drizzle"} /><Snowflake x={80} y={65} size={11} /><path data-part="ice-glaze" d="M23 78h66" stroke="#a9e7fa" strokeWidth="3" strokeLinecap="round" /></> : family === "rain-snow" ? <><g data-part="rain" fill="#33a7e2"><path d="M34 53c-2 6-8 10-8 15a5 5 0 0 0 10 0c0-5-2-11-2-15Z" /></g><Snowflake x={66} y={63} /><Snowflake x={84} y={74} size={6} /></> : family === "drizzle" ? <Drops drizzle /> : family === "unknown-precipitation" ? <g data-part="unknown-precipitation" fill="none" stroke="#bacbd4" strokeWidth="3.8" strokeLinecap="round"><path d="M49 59c0-9 14-9 14-1 0 5-7 5-7 10" /><circle cx="56" cy="76" r="2" fill="#bacbd4" stroke="none" /></g> : <g data-part={family} fill="#cce9f5" stroke="#8db8cd" strokeWidth="1.5">{[32, 54, 76].map((x, i) => family === "ice-pellets" ? <path key={x} d={`m${x} ${55 + i % 2 * 9} 5 6-5 6-5-6Z`} /> : family === "snow-grains" ? <rect key={x} x={x - 2.5} y={58 + i % 2 * 10} width="5" height="5" rx=".5" /> : <circle key={x} cx={x} cy={61 + i % 2 * 11} r={family === "hail" ? 6 : 3.5} />)}</g>}</>;
}

export default function WeatherIcon({ condition, night = false, codes }: { condition: Theme; night?: boolean; codes?: readonly string[] }) {
  const family = resolveWeatherIconFamily(condition, codes);
  const theme = family === "clear" && night ? "night" : family;
  if (!GENERIC_FAMILIES.has(family)) return <i className={`wx-pictogram wxp-phenomenon wxp-${family} ${night ? "wxp-nighttime" : ""}`} data-family={family} aria-hidden="true"><svg className="wxp-source-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 82" width="108" height="82" fill="none" focusable="false"><PhenomenonGlyph family={family} night={night} /></svg></i>;
  // Keep the established DOM and CSS pictograms for ordinary theme-only callers.
  return <i className={`wx-pictogram wxp-${theme} ${night ? "wxp-nighttime" : ""}`} data-family={family} aria-hidden="true"><span className="wxp-sun" /><span className="wxp-moon" /><span className="wxp-cloud" /><span className="wxp-precip"><b /><b /><b /></span><span className="wxp-flakes"><b>✦</b><b>✦</b><b>✦</b></span><span className="wxp-bolt" /><span className="wxp-fog-lines"><b /><b /><b /></span></i>;
}
