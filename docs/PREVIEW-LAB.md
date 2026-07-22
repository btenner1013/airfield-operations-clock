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
| `debugMoonPhase` | String | `new`, `crescent`, `quarter`, `gibbous`, `full` | Overrides lunar phase name, drawing, and shadow curve. |
| `debugCloud` | String | `CLR`, `FEW`, `SCT`, `BKN`, `OVC`, `VV` | Overrides operational cloud coverage. |
| `debugCloudBase` | Number | `200`, `800`, `1500`, `4500`, `12000`, `25000` | Cloud base altitude in FT (determines ceiling & high-cloud fallbacks). |
| `debugPhenomena` | String | `-DZ`, `DZ`, `-RA`, `RA`, `+RA`, `SHRA`, `VCSH`, `FZRA`, `-SN`, `SN`, `+SN`, `SHSN`, `BLSN`, `DRSN`, `SG`, `IC`, `PL`, `GR`, `GS`, `RASN`, `VCTS`, `TS`, `TSRA`, `+TSRA`, `TSGR`, `BR`, `FG`, `MIFG`, `BCFG`, `PRFG`, `FZFG`, `HZ`, `FU`, `DU`, `SA`, `DS`, `SS`, `VA` | Space-separated METAR weather phenomena tokens. |
| `debugIntensity` | String | `light`, `moderate`, `heavy` | Overrides particle density and intensity scaling. |
| `debugVisibility` | Number | `0.25`, `0.5`, `1`, `3`, `5`, `10` | Statute miles visibility (drives fog veil & flight cat). |
| `debugWind` | Number | `0`–`360` | Wind direction degrees. |
| `debugWindSpeed` | Number | `0`–`60` | Wind speed in knots. |
| `debugGust` | Number | `0`–`80` | Wind gust speed in knots. |
| `debugLightning` | String | `distant-ic`, `distant-cg`, `station`, `severe`, `flash-test` | Overrides active lightning severity & remark. |
| `debugPerformance` | String | `full`, `low` | Overrides graphics performance profile. |
| `debugReducedMotion` | String | `1`, `0` | Overrides prefers-reduced-motion setting. |
| `debugPaneDrops` | String | `on`, `off` | Overrides windshield pane droplet layer. |
| `previewWeatherFx` | String | `1` | Opens the on-screen interactive Weather FX Lab controls. |

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

# Moonlit night with 56.5% Waxing Gibbous shadow:
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
