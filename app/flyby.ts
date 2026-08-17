// Pure eligibility rules for the C-17 flyby. No DOM, timers, or React state live here, so
// the scheduler asks the same question at spawn time that a test can ask directly.

import type { Weather } from "./weatherTypes";

export type FlybyFlightCategory = { cat:string };

/** Any reported present weather grounds the flyby. Mirrors the parsed METAR body vocabulary. */
const PRESENT_WEATHER=/(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|DS|SS|TS|SH)/;

/**
 * Lightning close enough to ground it. A DSNT report is by definition 10 NM or more from
 * the field, which does not stop a visual pass.
 */
const GROUNDING_LIGHTNING=new Set(["vicinity","station","severe"]);

export const FLYBY_MINIMUM_VISIBILITY_SM=5;
export const FLYBY_MINIMUM_CEILING_FT=10000;

export function isFlybyWeatherAllowed(weather:Weather, flightCat:FlybyFlightCategory):boolean {
  if(flightCat.cat!=="VFR") return false;
  if(weather.visibilitySm!==null&&weather.visibilitySm<FLYBY_MINIMUM_VISIBILITY_SM) return false;

  const coverage=weather.cloudCoverage||"CLR";
  const base=weather.cloudBaseFt;
  // A low BKN/OVC/VV ceiling restricts the flyby; high thin cirrus in VFR does not.
  if(["BKN","OVC","VV"].includes(coverage)&&base!==null&&base<FLYBY_MINIMUM_CEILING_FT) return false;

  if(weather.currentLightning&&GROUNDING_LIGHTNING.has(weather.currentLightning.level)) return false;

  // Parsed body tokens only. Scanning the raw METAR made suppression depend on how a remark
  // happened to be written: "TS SE-S MOV E" blocked while "TSB05E43" did not, and a compound
  // token such as TSRA matched no word-boundary alternative at all.
  return !(weather.phenomena||[]).some(token=>PRESENT_WEATHER.test(String(token).toUpperCase()));
}
