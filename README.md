# KMEM Airfield Operations Clock

A full-screen, 24-hour local/Zulu clock for wall displays, with live Memphis weather, independent dates, four-digit aviation Julian date (`YDDD`), solar times, offline weather fallback, reduced motion, burn-in protection, and condition-responsive visuals.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. The included workflow builds and publishes the site. Open the URL shown by the completed Pages deployment.
4. Use the browser's full-screen or kiosk mode. F11 enters full screen on most Windows browsers.

The project uses no secret API keys and no backend. The clock always follows the device system clock. Local time is formatted in `America/Chicago`, including automatic CST/CDT handling; Zulu is independently formatted in UTC.

## Weather source and resilience

The public KMEM Ops Board feed supplies current METAR conditions, ATIS/METAR wind and lightning, TAF future weather, and AHAS bird risk. Open-Meteo supplies supporting temperature, humidity, solar times, and model fallback data. Hourly precipitation probability prefers the NWS KMEM gridpoint, with explicitly labeled Open-Meteo fallback. TAF forecasts never trigger current weather effects.

Provider normalization lives in `app/page.tsx`. Weather refreshes every two minutes and on wake/reconnection, with independent last-valid observations retained in browser storage. Feed failures remain visible in the diagnostics while both clocks continue. The cinematic renderer reads normalized observations without changing the fetch, cache, or clock lifecycles.

## Four-digit Julian date

The status panel uses the common aviation `YDDD` form: the final digit of the local year followed by the zero-padded local day of year. Thus 18 July 2026 is `6199`. The date rolls at local midnight in Memphis.

## Debug and display controls

For complete details on supported query parameters, presets, and interactive testing controls, see the **[Preview Lab & Simulator Guide](docs/PREVIEW-LAB.md)**.

Open `?weatherDemo=1` for the cinematic weather comparison buttons, quality switch, and rendering diagnostics. See **[Cinematic Weather](docs/CINEMATIC-WEATHER.md)** for architecture, condition examples, performance limits, and verification notes.

Append one of these query strings to simulate a theme:

`?debugWeather=clear`, `partly-cloudy`, `overcast`, `rain`, `heavy-rain`, `thunderstorm`, `snow`, `fog`, `night`, `sunrise`, or `sunset`.

Remove the query string or use the Preview Lab's LIVE link to return to live weather. Demo controls appear only when requested. Operating-system reduced-motion preferences stop weather motion and lightning. The full surface shifts by one pixel on a long interval for burn-in protection.

## Bottom information instruments

The solar/lunar, current weather, bird watch and future-weather cards now have clearer readings and grouping alongside the accepted wind instrument. The original circular solar-lunar dial is restored with clearer markings and depth. The moon graphic and all phase information appear only at night, with correct waxing/waning geometry. See the **[Information Bar guide](docs/INFORMATION-BAR.md)** for data boundaries and preview examples, plus the **[scenario audit](docs/SCENARIO-VERIFICATION.md)** for supported-phenomenon fixes and verification limits.

## Local testing

Install Node.js 22 or newer, run `npm ci`, then `npm run dev`. For a GitHub Pages production check, run `npx next build`; the static site is written to `out/`. Test at 1920×1080 and 1024×768, confirm local and Zulu dates around UTC midnight, disable the network to verify cached weather behavior, and exercise each debug theme.

## Configuration

Site/location settings are grouped in the `CONFIG` object near the top of `app/page.tsx`. Update the airport code, display name, coordinates, IANA time zone, or weather refresh interval there. Observation normalization remains separate from visual behavior in `app/weatherController.ts` and the CSS `theme-*` classes.

### Frozen precipitation motion

Hail/pellet arrivals now remain steady through separate small decaying impacts, with depth-scattered contact points and compact ice shapes. Full-height snow/precipitation starts at distributed cycle positions. See `docs/FROZEN-PRECIPITATION-MOTION.md` for tests, bounded resources, actual native temporal review and limitations.
