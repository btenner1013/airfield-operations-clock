import type { CurrentTrendMetric, TrendComparison } from "./currentWeatherTrends";

export default function CurrentWeatherTrend({metric,comparison}:{metric:CurrentTrendMetric;comparison:TrendComparison|null}) {
  if(!comparison) return null;
  const names={ceiling:"Ceiling",visibility:"Visibility",temperature:"Temperature"},words={up:"rising",down:"falling",steady:"steady (no meaningful reported change)"},symbols={up:"▲",down:"▼",steady:"▶"};
  const description=`${names[metric]} ${words[comparison.direction]}; Ops JSON reported ${comparison.lookbackHours}-hour-window trend; reference sample ${comparison.referenceAt}; JSON updated ${comparison.updatedAt}`;
  return <i className="current-wx-trend" data-tone={metric==="temperature"?"neutral":comparison.direction} data-trend-metric={metric} role="img" aria-label={description} title={description}>{symbols[comparison.direction]}</i>;
}
