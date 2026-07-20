import type { OperationalWeather, TafHazard } from "./aviationWeatherPriority";
import type { LightningReport } from "./lightning";

export type Theme = "clear" | "partly-cloudy" | "overcast" | "rain" | "heavy-rain" | "thunderstorm" | "fog" | "snow" | "night" | "sunrise" | "sunset" | "neutral";
export type Forecast = { time:string; iso:string; temperatureF:number; condition:Theme; description:string; precipitation:number; source:"TAF"|"MODEL"; operationalWeather:OperationalWeather|null };
export type SolarDay = { date:string; sunriseLocal:string; sunsetLocal:string };
export type CloudCoverage = "CLR"|"FEW"|"SCT"|"BKN"|"OVC"|"VV";
export type FeedStatus = "OK" | "DEGRADED" | "OFFLINE";
export type WeatherRequestStatus = "IDLE" | "REFRESHING" | "ERROR";

export type Weather = {
  temperatureF:number;
  feelsLikeF:number;
  condition:Theme;
  description:string;
  windSpeedKt:number;
  windDirection:string;
  windDegrees:number|null;
  windGustKt:number|null;
  humidity:number;
  sunriseLocal:string;
  sunsetLocal:string;
  solarDays:SolarDay[];
  observationTime:string;
  forecast:Forecast[];
  operationalWeather:OperationalWeather|null;
  currentLightning:LightningReport;
  tafHazards:TafHazard[];
  birdRisk:string;
  birdBasis:string;
  birdUpdated:string;
  source:"METAR"|"MODEL";
  cloudCoverage:CloudCoverage;
  cloudBaseFt:number|null;
  visibilitySm:number|null;
  phenomena:string[];
  metarObsIso:string|null;
  tafIssueIso:string|null;
  tafValidStartIso:string|null;
  tafValidEndIso:string|null;
  metarFetchStatus:string;
  tafFetchStatus:string;
  bwcFetchStatus:string;
  feedStatus:FeedStatus;
  requestStatus:WeatherRequestStatus;
  lastRefreshAttemptIso:string|null;
  lastRefreshSuccessIso:string|null;
  feedError:string|null;
};

export type WeatherFetchResult = {
  weather:Weather;
  metarValid:boolean;
  tafValid:boolean;
  modelValid:boolean;
  feedReached:boolean;
};
