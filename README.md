# Polyweather Web

Independent airport weather dashboard for 23 active airport cities.

## Standalone status

This project is intended to be copied and run on its own.

- Runtime code stays inside `web/`
- Environment variables are read from `web/.env.local`
- External dependencies are npm packages plus upstream weather APIs

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required environment variable:

- `PORT` defaults to `8787`
- `WUNDERGROUND_SUN_API_KEY`

Optional persistence variables for `/comparison`:

- `DATABASE_URL`
  - Default is local SQLite at `file:./polyweather-web.db`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Optional access control:

- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`
  - If both are set, the entire app and all `/api/*` routes are protected with HTTP Basic Auth.

## Behavior

- Browser never calls upstream weather sources directly.
- Initial page load triggers a server-side refresh through this app.
- Subsequent updates happen through the manual refresh button.
- The server keeps the latest snapshot in memory only.
- Partial refresh failures preserve old values and mark them as `stale`.
- `/comparison` persists raw WU observations, raw AW observations, and Polymarket day rows to libSQL/SQLite.
  - Run `npm run compare:weather-settlement` to fetch and upsert comparison raw data manually.
  - Run `npm run compare:backfill-history` to backfill each city from its earliest known resolved Polymarket day.
  - The `/comparison` page reads persisted raw rows and computes daily comparisons server-side.
- See `COMPARISON_REFERENCE.md` for `/comparison` data model, sync behavior, and history coverage notes.

## Last verified comparison sync

- Local verification completed on 2026-03-25
- Command:
  - `npm --prefix web run compare:weather-settlement -- --city tokyo --start-date 2026-03-24 --end-date 2026-03-24 --format json`
- Result:
  - `polymarketDaysUpserted: 1`
  - `wuObservationPointsUpserted: 48`
  - `awObservationPointsUpserted: 48`
- Browser check:
  - `/comparison?startDate=2026-03-24&endDate=2026-03-24&city=tokyo&selectedDate=2026-03-24`
  - rendered Tokyo's persisted raw-data comparison and day detail successfully
