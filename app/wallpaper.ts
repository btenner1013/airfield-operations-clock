import type { CloudCoverage, Theme } from "./weatherTypes";
import type { ObscurationType } from "./weatherFx";

export type SolarPhase = "day"|"night"|"sunrise"|"sunset";

const WEATHER_WALLPAPER_FAMILIES = new Set(["rain","thunderstorm","snow"]);

export function sceneFor(condition:Theme,phase:SolarPhase,_coverage:CloudCoverage="CLR"):string {
  const light=phase==="night"?"night":"day";
  if(condition==="rain"||condition==="heavy-rain") return `rain-${light}`;
  if(condition==="thunderstorm") return `thunderstorm-${light}`;
  if(condition==="snow") return `snow-${light}`;
  if(condition==="fog") return `fog-${light}`;
  if(condition==="overcast") return `overcast-${light}`;
  if(condition==="partly-cloudy") return `partly-cloudy-${light}`;
  if(phase==="sunrise"||phase==="sunset") return phase;
  return `clear-${light}`;
}

export function cloudSceneForCoverage(coverage:CloudCoverage,phase:SolarPhase):string {
  const condition:Theme=coverage==="OVC"||coverage==="VV"||coverage==="BKN"?"overcast":coverage==="FEW"||coverage==="SCT"?"partly-cloudy":"clear";
  return sceneFor(condition,phase,coverage);
}

export function sceneForEffects(baseScene:string,obscuration:ObscurationType,visibilitySm:number|null,phase:SolarPhase,coverage:CloudCoverage):string {
  const family=baseScene.split("-",1)[0];
  if(WEATHER_WALLPAPER_FAMILIES.has(family)) return baseScene;

  const light=phase==="night"?"night":"day",visibility=visibilitySm??10;
  if(obscuration==="mist") return sceneFor("partly-cloudy",phase,"SCT");
  if(obscuration==="shallow-fog"||obscuration==="patchy-fog"||obscuration==="partial-fog") return sceneFor("partly-cloudy",phase,"SCT");
  if(obscuration==="fog") return visibility>=1.5?`overcast-${light}`:`fog-${light}`;
  if(obscuration==="freezing-fog") return `fog-${light}`;
  if(obscuration==="haze") return cloudSceneForCoverage(coverage,phase);
  if(obscuration==="smoke"||obscuration==="volcanic-ash") return `overcast-${light}`;
  if(["dust","blowing-dust","drifting-dust","sand","blowing-sand","drifting-sand","dust-storm","sandstorm","dust-whirl"].includes(obscuration)) return sceneFor("partly-cloudy",phase,"SCT");
  return baseScene;
}
