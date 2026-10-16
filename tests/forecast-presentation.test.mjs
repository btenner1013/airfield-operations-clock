import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeForecastSources, formatForecastWind } from "../app/forecastPresentation.ts";
import { parseForecastWindToken } from "../app/forecastWind.ts";
const taf = { source: "TAF", operationalWeather: { code: "-RA" } };
const hourly = { source: "MODEL", operationalWeather: null };

test("TAF conditions are honestly labeled as combined with hourly products", () => {
  const result = describeForecastSources([taf, taf, taf]);
  assert.equal(result.label, "TAF + HOURLY");
  assert.match(result.detail, /hourly temperature/);
  assert.match(result.detail, /PROB30\/40/);
});
test("TAF-tagged rows without operational weather remain hourly fallback in source label", () => {
  assert.equal(describeForecastSources([{ source: "TAF", operationalWeather: null }]).label, "HOURLY");
  assert.equal(describeForecastSources([{ source: "TAF" }]).label, "HOURLY");
  assert.equal(describeForecastSources([hourly, hourly]).label, "HOURLY");
});
test("mixed visible rows expose both TAF and hourly sources, without mutating input", () => {
  const rows = Object.freeze([Object.freeze(taf), Object.freeze(hourly)]);
  assert.equal(describeForecastSources(rows).label, "TAF + HOURLY");
  assert.equal(rows[0], taf);
  assert.equal(rows[1], hourly);
});
test("empty or missing metadata never claims TAF", () => {
  assert.equal(describeForecastSources([]).label, "NO DATA");
  assert.equal(describeForecastSources([{}]).label, "SOURCE N/A");
});
test("header describes exactly the selected first-three rows, retaining existing future/unique/Zulu logic", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const forecastSource=describeForecastSources\(uniqueList.slice\(0, 3\)\)/);
  assert.match(page, /className="forecast-source-badge" title=\{forecastSource.detail\}>\{forecastSource.label\}/);
  for (const code of ['f.time !== "NOW"', 'Number.isFinite(t)', '(debugFutureWeather||t > now.getTime())', 'seenLabels.has(label)', 'uniqueList.slice(0, 3).map', 'd.getUTCHours()', 'd.getUTCMinutes()']) assert.ok(page.includes(code), code);
  const filter = page.indexOf('const displayList = displayForecast.filter');
  const header = page.indexOf('const forecastSource=describeForecastSources');
  assert.ok(filter > 0 && filter < header);
});


const issueIso = "2026-10-16T17:20:00.000Z";
const validFromIso = "2026-10-16T20:00:00.000Z";
const validToIso = "2026-10-17T03:00:00.000Z";
const windContext = Object.freeze({tafIssueIso:issueIso,tafValidStartIso:"2026-10-16T18:00:00.000Z",tafValidEndIso:"2026-10-18T00:00:00.000Z",tafFetchStatus:"OK",requestStatus:"IDLE"});
const realNow = Date.parse("2026-10-16T20:15:00.000Z");
const standardWind = Object.freeze({directionType:"directional",directionDegrees:350,speedKt:15,gustKt:25,raw:"35015G25KT",source:"TAF",sourceKind:"TAF_FM",issueIso,validFromIso,validToIso});
const windRow = Object.freeze({source:"TAF",iso:"2026-10-16T21:00:00.000Z",forecastWind:standardWind});
const display = (wind = standardWind, context = windContext, time = realNow) => formatForecastWind({...windRow,forecastWind:wind},context,time);

test("forecast wind uses compact padded direction, speed, gust and explicit knots", () => {
  const value = display();
  assert.equal(value.text,"350 @ 15 G25 KT");
  assert.equal(value.state,"available");
  assert.match(value.detail,/Prevailing TAF wind/);
  assert.match(value.detail,/TEMPO\/PROB wind changes are not included/);
  assert.equal(display({...standardWind,directionDegrees:20,speedKt:7,gustKt:null,raw:"02007KT"}).text,"020 @ 07 KT");
  assert.equal(display({...standardWind,directionDegrees:360,gustKt:null,raw:"36015KT"}).text,"360 @ 15 KT");
});

test("forecast calm and variable wind remain distinct with no invented direction", () => {
  assert.equal(display({...standardWind,directionType:"calm",directionDegrees:null,speedKt:0,gustKt:null,raw:"00000KT"}).text,"CALM");
  assert.equal(display({...standardWind,directionType:"variable",directionDegrees:null,speedKt:3,gustKt:null,raw:"VRB03KT"}).text,"VRB @ 03 KT");
});

test("converted wind speeds round to whole knots only at presentation", () => {
  const wind = {...standardWind,...parseForecastWindToken("35010G15MPS")};
  assert.equal(display(wind).text,"350 @ 19 G29 KT");
  assert.equal(wind.speedKt,10*(3600/1852));
});

test("future group validity is checked against the row, not real current time", () => {
  const futureWind = {...standardWind,validFromIso:"2026-10-17T03:00:00.000Z",validToIso:"2026-10-17T06:00:00.000Z"};
  assert.equal(formatForecastWind({...windRow,iso:futureWind.validFromIso,forecastWind:futureWind},windContext,realNow).state,"available");
  assert.equal(formatForecastWind({...windRow,iso:futureWind.validToIso,forecastWind:futureWind},windContext,realNow).text,"N/A");
});

test("expired TAF and explicit upstream stale status are visibly unavailable", () => {
  for (const result of [display(standardWind,windContext,Date.parse(windContext.tafValidEndIso)),display(standardWind,{...windContext,tafFetchStatus:"STALE"})]) {
    assert.equal(result.text,"N/A · STALE");
    assert.equal(result.state,"stale");
  }
  assert.equal(display(standardWind,{...windContext,tafFetchStatus:"ERROR"}).text,"N/A");
  assert.equal(display(standardWind,{...windContext,tafFetchStatus:"UNKNOWN"}).text,"N/A");
  assert.equal(display(standardWind,{...windContext,requestStatus:"ERROR"}).text,"N/A");
});

test("fresh verified TAF survives unrelated METAR degradation and 12h issue age", () => {
  const wind = {...standardWind,validToIso:windContext.tafValidEndIso};
  const nextDay = Date.parse("2026-10-17T08:00:00.000Z");
  const context = {...windContext,feedStatus:"DEGRADED",metarFetchStatus:"ERROR"};
  assert.equal(formatForecastWind({...windRow,iso:"2026-10-17T09:00:00.000Z",forecastWind:wind},context,nextDay).state,"available");
});

test("unknown, malformed, observed and model wind cannot become forecast wind", () => {
  for (const wind of [undefined,null,{},"35015G25KT",{...standardWind,speedKt:NaN},{...standardWind,directionDegrees:361},{...standardWind,source:"METAR"},{...standardWind,sourceKind:"TAF_TEMPO"},{...standardWind,directionType:"calm"},{...standardWind,gustKt:-1},{...standardWind,raw:""},{...standardWind,validToIso:"bad"}]) {
    assert.equal(formatForecastWind({...windRow,forecastWind:wind},windContext,realNow).text,"N/A",JSON.stringify(wind));
  }
  assert.equal(formatForecastWind({...windRow,source:"MODEL"},windContext,realNow).text,"N/A");
});

test("mismatched issue, future-issued product, missing envelope and out-of-range rows fail closed", () => {
  assert.equal(display(standardWind,{...windContext,tafIssueIso:"2026-10-16T18:20:00.000Z"}).text,"N/A");
  assert.equal(display(standardWind,windContext,Date.parse(issueIso)-6*60000).text,"N/A");
  for (const context of [{...windContext,tafIssueIso:null},{...windContext,tafValidStartIso:null},{...windContext,tafValidEndIso:null},{...windContext,tafValidStartIso:windContext.tafValidEndIso}]) assert.equal(display(standardWind,context).text,"N/A");
  for (const iso of ["bad","2026-10-16T17:59:59.999Z",validToIso,windContext.tafValidEndIso]) assert.equal(formatForecastWind({...windRow,iso},windContext,realNow).text,"N/A");
  assert.equal(display(standardWind,windContext,NaN).text,"N/A");
});

test("wind formatting never mutates source forecast or shared context", () => {
  const before = JSON.stringify({windRow,windContext});
  assert.equal(formatForecastWind(windRow,windContext,realNow).state,"available");
  assert.equal(JSON.stringify({windRow,windContext}),before);
});

test("forecast row shows separate compact wind without replacing weather, cloud, PoP or temperature", () => {
  const page = readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  const css = readFileSync(new URL("../app/information-bar.css",import.meta.url),"utf8");
  assert.match(page,/formatForecastWind\(f,weather,Date.now\(\)\)/);
  assert.match(page,/className="forecast-wind" data-state=\{forecastWind.state\} title=\{forecastWind.detail\}/);
  assert.match(page,/temporary\|\|f.operationalWeather\?\.probability\?"PREV WIND":"WIND"/);
  for (const value of ["{conditionLabel}","{precipText}","{cigText}","{f.temperatureF}","{forecastWind.text}"]) assert.ok(page.includes(value),value);
  assert.match(css,/forecast-wind b \{ white-space: nowrap/);
  assert.match(css,/forecast-wind \{ font-size: 7px/);
});


test("failed requests clear forecast wind before a later refresh can expose retained rows", () => {
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/onError:[^\n]+forecast:weatherRef\.current\.forecast\.map\(row=>\(\{\.\.\.row,forecastWind:null\}\)\)/);
});
