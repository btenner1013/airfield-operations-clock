# KMEM Airfield Operations Clock

A full-screen, 24-hour local/Zulu clock for wall displays, with live Memphis weather, independent dates, four-digit aviation Julian date (`YDDD`), solar times, offline weather fallback, reduced motion, burn-in protection, and condition-responsive visuals.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. The included workflow builds and publishes the site. Open the URL shown by the completed Pages deployment.
4. Use the browser's full-screen or kiosk mode. F11 enters full screen on most Windows browsers.

The project uses no secret API keys and no backend. The clock always follows the device system clock. Local time is formatted in `America/Chicago`, including automatic CST/CDT handling; Zulu is independently formatted in UTC.

## Weather source and resilience

Weather comes from the public Open-Meteo forecast API for the KMEM coordinates. The provider normalization lives in `app/page.tsx`, so another provider can replace `getWeather()` without changing the display components. A successful observation is retained in browser storage. If the feed fails, both clocks continue, the last observation is shown as cached/stale, and a neutral state is used if no observation exists.

## Four-digit Julian date

The status panel uses the common aviation `YDDD` form: the final digit of the local year followed by the zero-padded local day of year. Thus 18 July 2026 is `6199`. The date rolls at local midnight in Memphis.

## Debug and display controls

For complete details on supported query parameters, presets, and interactive testing controls, see the **[Preview Lab & Simulator Guide](docs/PREVIEW-LAB.md)**.

Append one of these query strings to simulate a theme:

`?debugWeather=clear`, `partly-cloudy`, `overcast`, `rain`, `heavy-rain`, `thunderstorm`, `snow`, `fog`, `night`, `sunrise`, or `sunset`.

Remove the query string to return to live weather. The simulator bar appears only while simulation is active. Operating-system reduced-motion preferences stop weather motion and lightning. The full surface shifts by one pixel on a long interval for burn-in protection.

## Local testing

Install Node.js 22 or newer, run `npm ci`, then `npm run dev`. For a GitHub Pages production check, run `npx next build`; the static site is written to `out/`. Test at 1920×1080 and 1024×768, confirm local and Zulu dates around UTC midnight, disable the network to verify cached weather behavior, and exercise each debug theme.

## Configuration

Site/location settings are grouped in the `CONFIG` object near the top of `app/page.tsx`. Update the airport code, display name, coordinates, IANA time zone, or weather refresh interval there. Open-Meteo condition normalization and visual themes remain separate through `mapCode()` and the CSS `theme-*` classes.
