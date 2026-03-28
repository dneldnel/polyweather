# Comparison Reference

Reference notes for the `/comparison` feature only. This file is intended to capture the current data model, sync behavior, read path, and known historical coverage limits so future `/comparison` work starts from the actual implementation instead of old assumptions.

## Scope

- This document only covers `/comparison`.
- Homepage behavior, in-memory refresh, and other dashboard features are intentionally out of scope.
- As of the current implementation, `/comparison` reads persisted SQLite/libSQL data only.

## Current Data Model

`/comparison` now uses raw persisted rows and computes day-level results on the server.

Primary tables:

- `wu_observations`
  - One row per Wunderground observation point.
  - Primary key: `(city_slug, observed_at_utc)`.
  - Important columns:
    - `city_slug`
    - `local_date`
    - `station_icao`
    - `location_id`
    - `observed_at_utc`
    - `observed_at_local`
    - `temp_f`
    - `temp_c`
    - `max_temp_f`
    - `max_temp_c`
    - `request_url_imperial`
    - `request_url_metric`
    - `fetched_at`

- `aw_observations`
  - One row per AviationWeather METAR point.
  - Primary key: `(city_slug, observed_at_utc)`.
  - Important columns:
    - `city_slug`
    - `local_date`
    - `station_icao`
    - `observed_at_utc`
    - `observed_at_local`
    - `report_time_raw`
    - `temp_c`
    - `fetched_at`

- `polymarket_days`
  - One row per city/day when a Polymarket event exists.
  - Primary key: `(city_slug, local_date)`.
  - Important columns:
    - `city_slug`
    - `local_date`
    - `polymarket_slug`
    - `status`
    - `winner_raw`
    - `winner_kind`
    - `winner_unit`
    - `winner_value`
    - `winner_min_value`
    - `winner_max_value`
    - `resolution_source`
    - `fetched_at`

Indexes:

- `wu_observations(city_slug, local_date, observed_at_utc)`
- `aw_observations(city_slug, local_date, observed_at_utc)`
- `polymarket_days(city_slug, local_date)`

Legacy table:

- `comparison_days`
  - Kept only for compatibility during the migration.
  - `/comparison` should not treat this as its source of truth anymore.

Implementation entrypoint:

- `lib/comparison/db.ts`

## Sync Script Responsibilities

Script:

- `scripts/compare-weather-settlement.ts`

Purpose:

- Fetch WU historical observations.
- Fetch AW METAR history.
- Fetch Polymarket weather event status and winning bucket.
- Persist raw rows for `/comparison`.

Current persistence rule:

- Sync is window-based per city.
- Before writing new rows for a city and date window, the script deletes existing rows in that same window from:
  - `wu_observations`
  - `aw_observations`
  - `polymarket_days`
- It then inserts the freshly fetched rows.

This means the script is effectively:

- authoritative for the requested city/date window
- idempotent for normal re-runs
- safe against stale rows lingering inside the same window

### Wunderground ingest

- WU history is requested twice for the same window:
  - imperial (`units=e`)
  - metric (`units=m`)
- Rows are merged by `valid_time_gmt`.
- Stored local date is derived from the airport timezone, not UTC.
- All valid observation points in the requested window are stored.

Notes:

- WU point density is not uniform across cities.
- In practice it is often around `24` points/day and can reach `48` points/day.

### AviationWeather ingest

- AW history is pulled from the METAR API using an `hours` lookback.
- Observation time is taken from `obsTime` when available, otherwise `reportTime`.
- Stored local date is derived from the airport timezone.
- All valid temperature points in the requested window are stored.

### Polymarket ingest

- Event slug format:
  - `highest-temperature-in-<city-slug>-on-<month>-<day>-<year>`
- If the event endpoint returns `404`, that day is treated as `missing` and no row is written.
- If the event exists but no winning market is available yet, stored status is `unresolved`.
- If a winning market exists, stored status is `resolved` and the bucket is parsed into:
  - `exact`
  - `range`
  - `at-most`
  - `at-least`
  - fallback `unknown`

Important distinction:

- `missing` means no event row exists in local storage for that city/day.
- `unresolved` means the event exists and is stored, but a winner is not yet available.

## `/comparison` Read Model

Primary server read code:

- `lib/comparison/read-service.ts`

Query normalization:

- `lib/comparison/query.ts`

Comparison evaluation rules:

- `lib/comparison/report.ts`

Page entrypoint:

- `app/comparison/page.tsx`

UI:

- `app/_components/comparison-dashboard.tsx`

### Query parameters

- `startDate`
- `endDate`
- `city`
- `selectedDate`

Behavior:

- `startDate` and `endDate` define the date window.
- `city` narrows the report to one airport city.
- `selectedDate` drives the right-side day detail panel.

### What the page computes

For the requested cities and date window, the server report path reads:

- `resolved` rows from `polymarket_days`
- WU day-level aggregates derived from `wu_observations` for those same resolved city/dates
- AW day-level aggregates derived from `aw_observations` for those same resolved city/dates

This keeps the main `/comparison` table and summary path focused on resolved settlement days and avoids loading all raw observation points for the full window into memory.

The day-detail path still reads raw stored WU and AW points for one city/day when the right-side panel is opened.

### Derived values used by `/comparison`

WU daily summary is computed from raw WU points:

- `maxTempF`
- `maxTempC`
- `peakLocal`
- `pointCount`

AW daily summary is computed from raw AW points:

- `maxTempC`
- `maxTempFRounded`
  - derived from Celsius, then rounded
- `peakLocal`
- `pointCount`

Polymarket comparison status can currently be:

- `match`
- `match-derived-f`
- `boundary-match`
- `mismatch`
- `boundary-mismatch`
- `missing-source-data`
- `unresolved`
- `missing-polymarket`

Meaningful implementation detail:

- When the market resolves in Fahrenheit, AW is compared using rounded Fahrenheit derived from stored Celsius.

## UI Behavior

Current `/comparison` layout:

- Top-level city summary remains a resolved-day summary.
- When a city is selected, the page shows:
  - a left-side daily table for resolved Polymarket dates in the window
  - a right-side detail panel for the selected day

The detail panel reads one city/day and renders:

- WU temperature curve for the full local day
- AW temperature curve for the full local day
- point counts
- peak time
- derived daily high values

The charts are based on persisted raw points, not upstream fetches at request time.

## Operational Notes

- `/comparison` no longer depends on homepage refreshes.
- If raw data is missing for a window, the fix is to re-run `compare-weather-settlement`.
- If comparison logic changes in the future, the current design allows recalculation from stored raw rows without introducing a second summary table.

Example sync command:

```bash
npm run compare:weather-settlement -- --city tokyo --start-date 2026-03-24 --end-date 2026-03-24 --format json
```

Example page URL:

```text
/comparison?startDate=2026-03-24&endDate=2026-03-24&city=tokyo&selectedDate=2026-03-24
```

## Polymarket Historical Coverage

This section records the earliest resolved weather-market day that was retrievable per tracked city using the live Polymarket event-by-slug API.

Check details:

- Checked at: `2026-03-26T02:39:28.753Z`
- Search window tested: `2025-11-01` through `2026-03-24`
- Success condition:
  - slug endpoint returned `200`
  - event had a winning market
  - settlement bucket was readable
- Machine-readable source:
  - `data/comparison-earliest-resolved-days.json`
- Backfill wrapper:
  - `scripts/backfill-comparison-history.ts`
  - Uses the JSON file above as the source of truth.
  - Defaults `endDate` to the current local date in each airport timezone when `--end-date` is omitted.

Observed boundary:

- Earliest overall resolved day among tracked cities: `2026-02-03`
- Latest earliest-city boundary in the tracked set: `2026-03-16`

Per-city earliest resolved day:

| City | Slug | Earliest resolved day |
| --- | --- | --- |
| Ankara | `ankara` | `2026-02-03` |
| Atlanta | `atlanta` | `2026-02-03` |
| Buenos Aires | `buenos-aires` | `2026-02-03` |
| Chicago | `chicago` | `2026-02-03` |
| Dallas | `dallas` | `2026-02-03` |
| London | `london` | `2026-02-03` |
| Miami | `miami` | `2026-02-03` |
| NYC | `nyc` | `2026-02-03` |
| Seattle | `seattle` | `2026-02-03` |
| Toronto | `toronto` | `2026-02-03` |
| Paris | `paris` | `2026-02-11` |
| Sao Paulo | `sao-paulo` | `2026-02-11` |
| Lucknow | `lucknow` | `2026-03-05` |
| Munich | `munich` | `2026-03-05` |
| Tel Aviv | `tel-aviv` | `2026-03-10` |
| Tokyo | `tokyo` | `2026-03-10` |
| Shanghai | `shanghai` | `2026-03-13` |
| Singapore | `singapore` | `2026-03-13` |
| Madrid | `madrid` | `2026-03-16` |
| Milan | `milan` | `2026-03-16` |
| Warsaw | `warsaw` | `2026-03-16` |

Interpretation:

- Historical availability is city-specific.
- Future `/comparison` features must not assume a uniform Polymarket history depth across all 23 cities.
- For product copy or UI validation, use the actual earliest date for the selected city rather than a single global cutoff.
