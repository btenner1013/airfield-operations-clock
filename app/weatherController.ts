/** Observation → presentation boundary. Forecasts and clock state never enter this controller. */
import { buildFxSpec, buildObscurationSpec, classifyEffect, type Intensity } from "./weatherFx.ts";
import { lightningAnimationEligible, type LightningReport } from "./lightning.ts";
import type { AtmosphereSpec } from "./atmosphereRenderer";
import type { CloudCoverage, Theme } from "./weatherTypes";

export type WeatherEffectInput = {
  phenomena: string[];
  coverage: CloudCoverage | "SKC";
  ceiling: number | null;
  visibility: number | null;
  windDirection: number | null;
  windSpeed: number;
  gust: number | null;
  lightning: LightningReport;
  night: boolean;
  quality: "full" | "low";
  reduced: boolean;
  intensity?: Intensity | null;
  paneDrops?: boolean | null;
  available?: boolean;
};
const finite = (value: number | null | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const CLOUD_AMOUNTS: Record<CloudCoverage | "SKC", number> = { SKC: 0, CLR: 0, FEW: .2, SCT: .44, BKN: .76, OVC: 1, VV: 1 };

/** Flat-screen projection, not a claim about the photographed camera's geographic bearing. */
export function projectWind(direction: number | null, speed: number, gust: number | null) {
  const knots = clamp(finite(speed), 0, 80);
  const known = direction !== null && Number.isFinite(direction);
  const to = (finite(direction) + 180) * Math.PI / 180;
  return {
    x: knots === 0 ? 0 : known ? Math.sin(to) : .22,
    y: knots === 0 ? 0 : known ? -Math.cos(to) : 0,
    speed: knots,
    gust: clamp((finite(gust, knots) - knots) / 35),
  };
}

export function buildWeatherEffects(input: WeatherEffectInput) {
  const available = input.available !== false;
  const fxBase = classifyEffect(available ? input.phenomena : []);
  const fx = { ...fxBase, intensity: input.intensity || fxBase.intensity };
  const wind = projectWind(input.windDirection, input.windSpeed, input.gust);
  const visibility = input.visibility === null || !Number.isFinite(input.visibility) ? null : clamp(input.visibility, 0, 100);
  const spec = buildFxSpec(fx, wind.x, wind.speed, input.quality, input.night, input.reduced, available ? input.paneDrops ?? null : false, visibility);
  // The original spec uses only the wind sign. Keep family/speed distinctions while using the
  // full horizontal component: northerly/southerly winds must not become full sideways rain.
  if (spec) {
    const classes = spec.secondary ? [spec, spec.secondary] : [spec];
    for (const cls of classes) {
      cls.vx *= Math.abs(wind.x);
      if (cls.shape === "streak") {
        const drizzle = cls.type.includes("drizzle");
        const vicinity = cls === spec ? fx.precipVicinity ?? fx.vicinity : fx.secondaryPrecipVicinity ?? fx.vicinity;
        cls.alpha = (drizzle ? .38 : fx.intensity === "heavy" ? .85 : fx.intensity === "moderate" ? .65 : .52)
          * (input.night ? .88 : 1) * (vicinity ? .58 : 1);
        cls.thick = drizzle ? .7 : fx.intensity === "heavy" ? 1.3 : 1;
        cls.burst = fx.shower && !input.reduced;
      }
    }
  }
  const obscuration = buildObscurationSpec(fx, visibility, wind.x, wind.speed, input.quality, input.reduced);
  const observedThunder = available && lightningAnimationEligible(input.lightning) && !input.lightning.isStale && !input.lightning.isUnavailable;
  const thunder = available && input.phenomena.some(token => /^[+-]?(?:VC)?TS/.test(token));
  const storm = observedThunder || thunder ? (fx.intensity === "heavy" || input.lightning.level === "severe" ? 1 : .68) :
    fx.liquidPresent ? (fx.intensity === "heavy" ? .46 : fx.intensity === "moderate" ? .22 : .08) : 0;
  const atmosphere: AtmosphereSpec = {
    coverage: available ? CLOUD_AMOUNTS[input.coverage] ?? 0 : 0,
    ceiling: input.ceiling === null ? null : Math.max(0, finite(input.ceiling)),
    storm, obscuration: obscuration.type, density: obscuration.density,
    horizon: obscuration.horizon, veil: Math.max(obscuration.veil, spec?.veil || 0),
    windX: wind.x * (1.5 + wind.speed * .6), windY: wind.y * wind.speed * .12,
    gust: wind.gust, night: input.night, reduced: input.reduced, quality: input.quality,
    lightningLevel: observedThunder ? input.lightning.level : "none",
  };
  return { fx, spec, obscuration, atmosphere };
}

export type WeatherDemo = {
  label: string; condition: Theme; coverage: CloudCoverage; phenomena: string;
  visibility: number; speed: number; gust: number | null; lightning: string;
};
// Explicit demo state only; these never overwrite observations, caches, or refresh state.
export const WEATHER_DEMOS: WeatherDemo[] = [
  {label:"Clear", condition:"clear", coverage:"CLR", phenomena:"", visibility:10, speed:4, gust:null, lightning:"none"},
  {label:"Partly cloudy", condition:"partly-cloudy", coverage:"SCT", phenomena:"", visibility:10, speed:10, gust:null, lightning:"none"},
  {label:"Overcast", condition:"overcast", coverage:"OVC", phenomena:"", visibility:10, speed:12, gust:null, lightning:"none"},
  {label:"Light rain", condition:"rain", coverage:"BKN", phenomena:"-RA", visibility:6, speed:8, gust:null, lightning:"none"},
  {label:"Heavy rain", condition:"heavy-rain", coverage:"OVC", phenomena:"+RA", visibility:1.5, speed:20, gust:28, lightning:"none"},
  {label:"Thunderstorm", condition:"thunderstorm", coverage:"BKN", phenomena:"TSRA", visibility:3, speed:18, gust:26, lightning:"tsra"},
  {label:"Severe thunderstorm", condition:"thunderstorm", coverage:"OVC", phenomena:"+TSRA", visibility:1, speed:28, gust:42, lightning:"severe"},
  {label:"Fog", condition:"fog", coverage:"VV", phenomena:"FG", visibility:.5, speed:3, gust:null, lightning:"none"},
  {label:"Snow", condition:"snow", coverage:"OVC", phenomena:"SN", visibility:2, speed:8, gust:null, lightning:"none"},
  {label:"Blowing snow", condition:"snow", coverage:"OVC", phenomena:"SN BLSN", visibility:.75, speed:30, gust:40, lightning:"none"},
  {label:"High winds", condition:"partly-cloudy", coverage:"SCT", phenomena:"", visibility:10, speed:35, gust:48, lightning:"none"},
];
