# Preview Lab & Simulator Documentation

## 1. Live Production & Demo URLs

- **Live Production Display:** [https://btenner1013.github.io/airfield-operations-clock/](https://btenner1013.github.io/airfield-operations-clock/)
- **Interactive Weather FX Lab:** [https://btenner1013.github.io/airfield-operations-clock/?previewWeatherFx=1](https://btenner1013.github.io/airfield-operations-clock/?previewWeatherFx=1)

---

## 2. Overview

The Airfield Operations Clock includes built-in simulator and Preview Lab controls that allow airfield managers, operators, and developers to test all weather phenomena, solar phases, moon phases, bird risk conditions, flight categories, and display modes without modifying source code or backend feeds.

---

## 3. Supported Query Parameters

| Parameter | Type / Format | Options / Examples | Description |
| :--- | :--- | :--- | :--- |
| `debugWeather` | String | `clear`, `partly-cloudy`, `overcast`, `rain`, `heavy-rain`, `snow`, `thunderstorm`, `fog` | Overrides the base weather condition scene. |
| `debugTime` | String | `day`, `sunrise`, `sunset`, `night` | Overrides solar lighting and background phase. |
| `debugBwc` | String | `LOW`, `MODERATE`, `SEVERE` | Overrides Bird Watch Condition badge & icon. |
| `debugMoonPhase` | String | `new`, `crescent`, `quarter`, `gibbous`, `full`, `waning-gibbous`, `last-quarter`, `waning-crescent` | Overrides lunar phase name and matched north-up geometry; old aliases retained. |
| `debugCloud` | String | `CLR`, `FEW`, `SCT`, `BKN`, `OVC`, `VV` | Overrides operational cloud coverage. |
| `debugCloudBase` | Number | `200`, `800`, `1500`, `4500`, `12000`, `25000` | Cloud base altitude in FT (determines ceiling & high-cloud fallbacks). |
| `debugPhenomena` | String | `-DZ`, `DZ`, `-RA`, `RA`, `+RA`, `SHRA`, `VCSH`, `FZRA`, `-SN`, `SN`, `+SN`, `SHSN`, `BLSN`, `DRSN`, `SG`, `IC`, `PL`, `GR`, `GS`, `RASN`, `VCTS`, `TS`, `TSRA`, `+TSRA`, `TSGR`, `BR`, `FG`, `MIFG`, `BCFG`, `PRFG`, `FZFG`, `HZ`, `FU`, `DU`, `SA`, `DS`, `SS`, `VA` | Space-separated METAR weather phenomena tokens. |
| `debugIntensity` | String | `light`, `moderate`, `heavy` | Overrides particle density and intensity scaling. |
| `debugVisibility` | Number | `0.25`, `0.5`, `1`, `3`, `5`, `10` | Statute miles visibility (drives fog veil & flight cat). |
| `debugWind` | Number | `0`–`360` | Wind direction degrees. |
| `debugWindSpeed` | Number | `0`–`60` | Wind speed in knots. |
| `debugWindMode` | String | `directional`, `gust`, `sector`, `variable`, `calm` | Complete synthetic observation for the wind instrument. Overrides numeric wind parameters. |
| `debugGust` | Number | `0`–`80` | Wind gust speed in knots. |
| `debugLightning` | String | `distant-ic`, `distant-cg`, `station`, `severe`, `flash-test` | Overrides active lightning severity & remark. |
| `debugPerformance` | String | `full`, `low` | Explicit graphics profile; normal default is full with no automatic downgrade. |
| `debugReducedMotion` | String | `1`, `0` | Overrides prefers-reduced-motion setting. |
| `debugPaneDrops` | String | `on`, `off` | Overrides windshield pane droplet layer. |
| `previewWeatherFx` | String | `1` | Opens the on-screen interactive Weather FX Lab controls. |
| `debugFlyby` | String | `on`, `off` | Explicit demonstration override: `on` bypasses weather eligibility; `off` hides flybys. Omit for normal weather-gated operation. |
| `spawnFlyby` | String | `1` | Explicit one-time immediate demo pass, bypassing eligibility. Normal subsequent passes remain weather-gated unless `debugFlyby=on`. |
| `debugFlybyDir` | String | `ltr`, `rtl` | Direction of demonstration passes. |

---

## 4. Presets & Example Testing Scenarios

### Clear Day Sky
```text
?debugWeather=clear&debugTime=day&debugCloud=CLR
```

### High Broken Ceiling (`BKN250`) — Day / Sunset / Night
```text
# Daytime high cirrus:
?debugWeather=overcast&debugTime=day&debugCloud=BKN&debugCloudBase=25000

# Hazy twilight dusk with warm horizon glow:
?debugWeather=overcast&debugTime=sunset&debugCloud=BKN&debugCloudBase=25000

# Night with a waxing-gibbous phase preview:
?debugWeather=overcast&debugTime=night&debugCloud=BKN&debugCloudBase=25000&debugMoonPhase=gibbous
```

### Low Overcast & Low IFR (`OVC008`)
```text
?debugWeather=overcast&debugTime=night&debugCloud=OVC&debugCloudBase=800&debugVisibility=2
```

### Heavy Thunderstorm (`+TSRA` with Isolated Lightning)
```text
?debugWeather=thunderstorm&debugTime=night&debugPhenomena=%2BTSRA&debugLightning=severe
```

### Dense Freezing Fog (`FZFG` / LIFR)
```text
?debugWeather=fog&debugTime=night&debugPhenomena=FZFG&debugVisibility=0.25
```

### Heavy Snow (`+SN` / Low Visibility)
```text
?debugWeather=snow&debugTime=day&debugPhenomena=%2BSN&debugIntensity=heavy&debugVisibility=0.5
```

### Solar/lunar and the information bar

The moon graphic and all lunar phase information appear only during a verified night window. Waxing is lit on the right; waning is lit on the left. The phase view is north-up. The restored circular dial uses the original upper daylight/lower night orbit and marker coordinates, with clearer ticks, depth and an elapsed arc. It does not show lunar position or moonrise/set. The lunar phase calculation is unchanged; tested missing-event and today-versus-tomorrow sunset boundary fixes keep night gating accurate.

The Solar controls now cover all eight lunar phases. `debugMoonPhase=new` and `gibbous` now set matching drawing geometry as well as labels. Explicit aliases `waxing-crescent`, `first-quarter` and `waxing-gibbous` are supported; unknown values leave the live phase unchanged.

See [Information Bar](INFORMATION-BAR.md) for the complete bottom-card redesign, preserved fields, compact/large-display styles and test limits.

### Wind instrument

The reported bearing and cardinal label are where wind comes **FROM**. The white source marker is on that side of the dial; the cyan arrow shows airflow toward the opposite side. The amber arc, when present, shows the reported FROM-direction variability sector. No true/magnetic conversion is implied by this display: the source remains explicitly labeled ATIS or METAR.

```text
?debugWindMode=gust
?debugWindMode=sector
?debugWindMode=variable
?debugWindMode=calm
?debugWind=359&debugWindSpeed=8
```

Calm and variable observations have no directional arrow. Missing/model-only or unverified-time observations show unavailable; stale observations hide the old speed and arrow rather than presenting them as current. Freshness retains the existing source cutoffs: 90 minutes for ATIS and 75 minutes for METAR, inclusive. The instrument respects reduced motion and turns across north by the shortest angle.

### C-17 demonstration

```text
?debugWeather=partly-cloudy&debugTime=day&debugWindMode=gust&debugFlyby=on&debugFlybyDir=ltr&spawnFlyby=1
```

This is an explicitly forced visual demonstration. Remove `debugFlyby` and `spawnFlyby` to restore ordinary eligibility. In normal operation, the scheduler consults the real reported weather plus the displayed flight category before each launch; a clear-sky scene override alone does not make real conditions eligible. Passes take 9–13 seconds, followed by the unchanged 15–30 second launch gap. Weather changes do not interrupt a pass already in progress.

---

## 5. Mobile & Responsive Layout Testing

To test responsive card rail behavior:
1. Open Developer Tools (`F12` in Chrome/Edge).
2. Toggle Device Toolbar (`Ctrl+Shift+M` or `Cmd+Shift+M`).
3. Test viewports:
   - **`390×844`** (Mobile Portrait — vertical layout, single card scroll snap).
   - **`844×390`** (Mobile Landscape — compact side-by-side header).
   - **`1024×768`** (Tablet — reflowed panel grid).
   - **`1920×1080`** (Standard HD Desktop — 5-panel continuous instrument rail).
   - **`3840×2160`** (4K UHD — 360° text-stroked clock digits).

---

## 6. Returning to Live Display

To return to live operational mode with real-time METAR/TAF/AHAS feeds, simply remove all query parameters from the URL:

```text
https://btenner1013.github.io/airfield-operations-clock/
```


## Interactive review controls

Open `?weatherDemo=1` or `?previewWeatherFx=1`. Normal URLs keep the panel hidden.

- Weather buttons switch conditions/severity in place, retaining an explicitly chosen day/night override.
- WIND presets expose gusting, variable-sector, VRB, calm and north-359° examples.
- WEATHER ALERTS exposes none, informational, caution and warning examples.
- Existing solar/day-night/moon-phase, BWC, flight-category, lightning and C-17 spawn/direction presets remain available.
- Preset links replace other query overrides. For a chosen time plus weather combination, select the time first, then use the in-place weather buttons.
- The header LIVE control clears all overrides and closes the preview panel. HIDE/SHOW and DIAG+/DIAG− remain reversible. Diagnostics start collapsed; mobile controls have 44px minimum touch targets.
- The lunar moon graphic is night-only according to resolved solar state, including the explicit time preview. Phase text and its caption are night-only too; the visible north-up caption is removed. The wind arrow design/semantics remain, with no ARROW = FLOW caption.

These controls were verified through actual component callbacks/markup and CSS source rules, not a signed-in browser session.

Preview condition text and icons now follow the selected aviation phenomena (for example FU = SMOKE), not the broad background theme. Weather overrides are labeled SIMULATED; clock-time-only overrides retain live weather labeling. General Ops Board alerts remain source-labeled unless an explicit alert preset is selected.
