# Polyweather Notes

Last updated: 2026-03-22

## Purpose

This folder is intended to run as a standalone project.

It serves a 23-city airport weather dashboard with:

- `Wunderground` current temperature
- `Wunderground` today's high so far and the observation time of that high
- `AviationWeather` current temperature
- `Open-Meteo ECMWF` today's high forecast
- `Open-Meteo GFS` today's high forecast

Temperatures are displayed in `°F` for US airports and `°C` elsewhere.

## Runtime boundaries

This project is self-contained inside `web/`.

- It does not import application code from parent directories.
- It reads environment variables from `web/.env.local`.
- It depends on external weather APIs over the network.
- It depends on packages installed from `web/package.json`.

## Required environment variables

- `PORT`
  - Default local value: `8787`
- `WUNDERGROUND_SUN_API_KEY`
  - Required on the server side for WU requests

## Airport dataset

The active airport scope is fixed to 23 cities:

1. Ankara
2. Atlanta
3. Buenos Aires
4. Chicago
5. Dallas
6. London
7. Lucknow
8. Madrid
9. Miami
10. Milan
11. Munich
12. NYC
13. Paris
14. Sao Paulo
15. Seattle
16. Seoul
17. Shanghai
18. Singapore
19. Tel Aviv
20. Tokyo
21. Toronto
22. Warsaw
23. Wellington

The local source of truth is `web/lib/airports.ts`.

Each airport record contains:

- city slug
- city name
- airport name
- ICAO code
- country code
- timezone
- latitude
- longitude

## Data-source rules

### 1. Wunderground current temperature

Request shape:

```text
https://api.weather.com/v1/location/<ICAO>:9:<COUNTRY_CODE>/observations/historical.json?units=m&startDate=<YYYYMMDD>&endDate=<YYYYMMDD>&apiKey=<API_KEY>
```

Rule:

1. Compute the airport local date for "today"
2. Request that local day in metric units
3. Sort observations by `valid_time_gmt`
4. Use the latest observation as `WU current`

### 2. Wunderground today's high

Use the same local-day observation response.

Rule:

1. Filter usable observations with both `valid_time_gmt` and `temp`
2. Find the maximum `temp`
3. Display that temperature and the timestamp of the observation where it occurred

Fallback behavior:

- If the local day has no WU observations yet, `WU current` may fall back to the previous local day's latest observation and be marked `stale`
- `WU today high` stays unavailable until same-day observations exist

### 3. AviationWeather current temperature

Request shape:

```text
https://aviationweather.gov/api/data/metar?ids=<ICAO>&format=json
```

Rule:

- Use the most recent METAR row
- Read `temp` as current temperature in Celsius

### 4. Open-Meteo today's high forecast

Request shape:

```text
https://api.open-meteo.com/v1/forecast?latitude=<LAT>&longitude=<LON>&daily=temperature_2m_max&timezone=<TZ>&forecast_days=2&models=<MODEL>
```

Models currently used:

- `ecmwf_ifs`
- `gfs_seamless`

Rule:

1. Request `daily=temperature_2m_max`
2. Match the returned `daily.time[]` to the airport local date for today
3. Use that value as the model's today-high forecast

## Server behavior

- Browser does not call upstream weather sources directly
- Browser calls this app's route handlers only
- `POST /api/weather/refresh` starts a server-side refresh
- `GET /api/weather` returns the current in-memory snapshot
- Snapshot storage is memory-only
- Partial source failures keep older values when possible and mark them `stale`

## Current module layout

- `web/app/`
  - App Router pages and API route handlers
- `web/lib/airports.ts`
  - 23-airport configuration
- `web/lib/refresh-weather.ts`
  - Upstream fetching, normalization, fallback logic, and refresh orchestration
- `web/lib/store.ts`
  - In-memory snapshot store
- `web/lib/types.ts`
  - Shared response and card types
- `web/scripts/run-next.mjs`
  - Starts Next.js with local `PORT`

## Standalone status

As of this note:

- No runtime import points outside `web/`
- No parent-repo config is required
- The only non-local dependencies are:
  - npm packages installed under `web/node_modules`
  - network access to WU, AviationWeather, and Open-Meteo
