"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComparisonDatabaseUrl = getComparisonDatabaseUrl;
exports.getComparisonDbClient = getComparisonDbClient;
exports.ensureComparisonDb = ensureComparisonDb;
exports.getWundergroundObservationRows = getWundergroundObservationRows;
exports.getAviationObservationRows = getAviationObservationRows;
exports.getPolymarketDayRows = getPolymarketDayRows;
exports.getResolvedPolymarketDayRows = getResolvedPolymarketDayRows;
exports.getLatestResolvedPolymarketDate = getLatestResolvedPolymarketDate;
exports.getEarliestUnresolvedPolymarketDate = getEarliestUnresolvedPolymarketDate;
exports.getLatestStoredComparisonResumeDate = getLatestStoredComparisonResumeDate;
exports.getWundergroundDaySummariesForResolvedPolymarket = getWundergroundDaySummariesForResolvedPolymarket;
exports.getAviationDaySummariesForResolvedPolymarket = getAviationDaySummariesForResolvedPolymarket;
exports.getWundergroundObservationDay = getWundergroundObservationDay;
exports.getAviationObservationDay = getAviationObservationDay;
exports.getPolymarketDay = getPolymarketDay;
exports.getWundergroundFutureHighHourlyStats = getWundergroundFutureHighHourlyStats;
exports.deleteWundergroundObservationWindow = deleteWundergroundObservationWindow;
exports.deleteAviationObservationWindow = deleteAviationObservationWindow;
exports.deletePolymarketDayWindow = deletePolymarketDayWindow;
exports.replaceWundergroundFutureHighHourlyStats = replaceWundergroundFutureHighHourlyStats;
exports.upsertWundergroundObservations = upsertWundergroundObservations;
exports.upsertAviationObservations = upsertAviationObservations;
exports.upsertPolymarketDays = upsertPolymarketDays;
const client_1 = require("@libsql/client");
const DEFAULT_DATABASE_URL = "file:./polyweather-web.db";
function getComparisonDatabaseUrl() {
    return process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
function getDatabaseAuthToken() {
    return process.env.TURSO_AUTH_TOKEN;
}
function getComparisonDbClient() {
    if (!globalThis.__polyweatherComparisonDbClient__) {
        globalThis.__polyweatherComparisonDbClient__ = (0, client_1.createClient)({
            url: getComparisonDatabaseUrl(),
            authToken: getDatabaseAuthToken(),
        });
    }
    return globalThis.__polyweatherComparisonDbClient__;
}
async function execute(sql, args) {
    return getComparisonDbClient().execute(sql, args);
}
async function ensureComparisonDb() {
    if (!globalThis.__polyweatherComparisonDbInitPromise__) {
        globalThis.__polyweatherComparisonDbInitPromise__ = (async () => {
            // Legacy summary table retained for compatibility during the migration.
            await execute(`
        CREATE TABLE IF NOT EXISTS comparison_days (
          city_slug TEXT NOT NULL,
          local_date TEXT NOT NULL,
          city TEXT NOT NULL,
          airport_name TEXT NOT NULL,
          station_icao TEXT NOT NULL,
          country_code TEXT NOT NULL,
          timezone TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          polymarket_slug TEXT NOT NULL,
          polymarket_winner_raw TEXT NOT NULL,
          polymarket_winner_kind TEXT NOT NULL,
          polymarket_winner_unit TEXT,
          polymarket_winner_value REAL,
          polymarket_winner_min_value REAL,
          polymarket_winner_max_value REAL,
          polymarket_resolution_source TEXT,
          wunderground_max_temp_f REAL,
          wunderground_max_temp_c REAL,
          wunderground_peak_local TEXT,
          wunderground_request_url TEXT,
          aviationweather_max_temp_c REAL,
          aviationweather_max_temp_f_rounded REAL,
          wunderground_comparison_status TEXT NOT NULL,
          aviationweather_comparison_status TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (city_slug, local_date)
        )
      `);
            await execute(`
        CREATE INDEX IF NOT EXISTS comparison_days_local_date_idx
        ON comparison_days(local_date)
      `);
            await execute(`
        CREATE TABLE IF NOT EXISTS wu_observations (
          city_slug TEXT NOT NULL,
          local_date TEXT NOT NULL,
          station_icao TEXT NOT NULL,
          location_id TEXT NOT NULL,
          observed_at_utc TEXT NOT NULL,
          observed_at_local TEXT NOT NULL,
          temp_f REAL,
          temp_c REAL,
          max_temp_f REAL,
          max_temp_c REAL,
          request_url_imperial TEXT,
          request_url_metric TEXT,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (city_slug, observed_at_utc)
        )
      `);
            await execute(`
        CREATE INDEX IF NOT EXISTS wu_observations_city_date_idx
        ON wu_observations(city_slug, local_date, observed_at_utc)
      `);
            await execute(`
        CREATE TABLE IF NOT EXISTS wu_future_high_hourly_stats (
          city_slug TEXT NOT NULL,
          hour_bucket INTEGER NOT NULL,
          probability REAL NOT NULL,
          sample_count INTEGER NOT NULL,
          future_higher_count INTEGER NOT NULL,
          eligible_day_count INTEGER NOT NULL,
          method TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          PRIMARY KEY (city_slug, hour_bucket)
        )
      `);
            await execute(`
        CREATE INDEX IF NOT EXISTS wu_future_high_hourly_stats_city_idx
        ON wu_future_high_hourly_stats(city_slug, hour_bucket)
      `);
            await execute(`
        CREATE TABLE IF NOT EXISTS aw_observations (
          city_slug TEXT NOT NULL,
          local_date TEXT NOT NULL,
          station_icao TEXT NOT NULL,
          observed_at_utc TEXT NOT NULL,
          observed_at_local TEXT NOT NULL,
          report_time_raw TEXT,
          temp_c REAL NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (city_slug, observed_at_utc)
        )
      `);
            await execute(`
        CREATE INDEX IF NOT EXISTS aw_observations_city_date_idx
        ON aw_observations(city_slug, local_date, observed_at_utc)
      `);
            await execute(`
        CREATE TABLE IF NOT EXISTS polymarket_days (
          city_slug TEXT NOT NULL,
          local_date TEXT NOT NULL,
          polymarket_slug TEXT NOT NULL,
          status TEXT NOT NULL,
          winner_raw TEXT,
          winner_kind TEXT,
          winner_unit TEXT,
          winner_value REAL,
          winner_min_value REAL,
          winner_max_value REAL,
          resolution_source TEXT,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (city_slug, local_date)
        )
      `);
            await execute(`
        CREATE INDEX IF NOT EXISTS polymarket_days_city_date_idx
        ON polymarket_days(city_slug, local_date)
      `);
        })();
    }
    await globalThis.__polyweatherComparisonDbInitPromise__;
}
function parseNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseWinner(input) {
    if (input.raw == null || input.kind == null) {
        return null;
    }
    const raw = String(input.raw);
    const kind = String(input.kind);
    const unitValue = input.unit;
    const unit = unitValue === "C" || unitValue === "F" ? unitValue : undefined;
    const winnerValue = parseNullableNumber(input.value);
    const winnerMin = parseNullableNumber(input.minValue);
    const winnerMax = parseNullableNumber(input.maxValue);
    if (kind === "exact" && unit && winnerValue != null) {
        return { kind, raw, unit, value: winnerValue };
    }
    if (kind === "range" && unit && winnerMin != null && winnerMax != null) {
        return { kind, raw, unit, minValue: winnerMin, maxValue: winnerMax };
    }
    if (kind === "at-most" && unit && winnerValue != null) {
        return { kind, raw, unit, value: winnerValue };
    }
    if (kind === "at-least" && unit && winnerValue != null) {
        return { kind, raw, unit, value: winnerValue };
    }
    if (kind === "unknown") {
        return { kind, raw };
    }
    return raw ? { kind: "unknown", raw } : null;
}
function buildDateRangeQuery(table, params, orderBy) {
    const { filters, args } = buildDateRangeFilter(params);
    return {
        sql: `SELECT * FROM ${table} WHERE ${filters.join(" AND ")} ORDER BY ${orderBy}`,
        args,
    };
}
function buildDateRangeFilter(params, options) {
    const dateColumn = options?.dateColumn ?? "local_date";
    const cityColumn = options?.cityColumn ?? "city_slug";
    const filters = [`${dateColumn} >= ?`, `${dateColumn} <= ?`];
    const args = [params.startDate, params.endDate];
    if (params.citySlugs && params.citySlugs.length > 0) {
        const placeholders = params.citySlugs.map(() => "?");
        filters.push(`${cityColumn} IN (${placeholders.join(", ")})`);
        args.push(...params.citySlugs);
    }
    return { filters, args };
}
async function selectDateRangeRows(table, params, orderBy, mapRow) {
    await ensureComparisonDb();
    const query = buildDateRangeQuery(table, params, orderBy);
    const result = await execute(query.sql, query.args);
    return result.rows.map((row) => mapRow(row));
}
async function selectOneRow(table, params, mapRow) {
    await ensureComparisonDb();
    const result = await execute(`SELECT * FROM ${table} WHERE city_slug = ? AND local_date = ? LIMIT 1`, [params.citySlug, params.localDate]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
}
async function deleteWindowRows(table, params) {
    await ensureComparisonDb();
    await execute(`DELETE FROM ${table} WHERE city_slug = ? AND local_date >= ? AND local_date <= ?`, [params.citySlug, params.startDate, params.endDate]);
}
async function selectDayRows(table, params, orderBy, mapRow) {
    await ensureComparisonDb();
    const result = await execute(`SELECT * FROM ${table} WHERE city_slug = ? AND local_date = ? ORDER BY ${orderBy}`, [params.citySlug, params.localDate]);
    return result.rows.map((row) => mapRow(row));
}
function mapWundergroundObservationRow(row) {
    return {
        citySlug: String(row.city_slug),
        localDate: String(row.local_date),
        stationIcao: String(row.station_icao),
        locationId: String(row.location_id),
        observedAtUtc: String(row.observed_at_utc),
        observedAtLocal: String(row.observed_at_local),
        tempF: parseNullableNumber(row.temp_f),
        tempC: parseNullableNumber(row.temp_c),
        maxTempF: parseNullableNumber(row.max_temp_f),
        maxTempC: parseNullableNumber(row.max_temp_c),
        requestUrlImperial: row.request_url_imperial == null ? null : String(row.request_url_imperial),
        requestUrlMetric: row.request_url_metric == null ? null : String(row.request_url_metric),
        fetchedAt: String(row.fetched_at),
    };
}
function mapAviationObservationRow(row) {
    const tempC = parseNullableNumber(row.temp_c);
    if (tempC == null) {
        throw new Error(`Stored AW observation is missing temp_c for ${String(row.city_slug)} ${String(row.observed_at_utc)}`);
    }
    return {
        citySlug: String(row.city_slug),
        localDate: String(row.local_date),
        stationIcao: String(row.station_icao),
        observedAtUtc: String(row.observed_at_utc),
        observedAtLocal: String(row.observed_at_local),
        reportTimeRaw: row.report_time_raw == null ? null : String(row.report_time_raw),
        tempC,
        fetchedAt: String(row.fetched_at),
    };
}
function mapPolymarketDayRow(row) {
    const status = String(row.status) === "resolved" ? "resolved" : "unresolved";
    return {
        citySlug: String(row.city_slug),
        localDate: String(row.local_date),
        slug: String(row.polymarket_slug),
        status,
        winner: parseWinner({
            raw: row.winner_raw,
            kind: row.winner_kind,
            unit: row.winner_unit,
            value: row.winner_value,
            minValue: row.winner_min_value,
            maxValue: row.winner_max_value,
        }),
        resolutionSource: row.resolution_source == null ? null : String(row.resolution_source),
        fetchedAt: String(row.fetched_at),
    };
}
function mapWundergroundDaySummaryRow(row) {
    const pointCount = parseNullableNumber(row.point_count);
    return {
        citySlug: String(row.city_slug),
        localDate: String(row.local_date),
        maxTempF: parseNullableNumber(row.max_temp_f),
        maxTempC: parseNullableNumber(row.max_temp_c),
        peakLocal: row.peak_local == null ? null : String(row.peak_local),
        pointCount: pointCount == null ? 0 : pointCount,
        requestUrl: row.request_url == null ? null : String(row.request_url),
    };
}
function mapWundergroundFutureHighHourlyStatRow(row) {
    return {
        citySlug: String(row.city_slug),
        hourBucket: Number(row.hour_bucket),
        probability: Number(row.probability),
        sampleCount: Number(row.sample_count),
        futureHigherCount: Number(row.future_higher_count),
        eligibleDayCount: Number(row.eligible_day_count),
        method: String(row.method),
        generatedAt: String(row.generated_at),
    };
}
function mapAviationDaySummaryRow(row) {
    const pointCount = parseNullableNumber(row.point_count);
    return {
        citySlug: String(row.city_slug),
        localDate: String(row.local_date),
        maxTempC: parseNullableNumber(row.max_temp_c),
        peakLocal: row.peak_local == null ? null : String(row.peak_local),
        pointCount: pointCount == null ? 0 : pointCount,
    };
}
async function getWundergroundObservationRows(params) {
    return selectDateRangeRows("wu_observations", params, "city_slug, local_date, observed_at_utc", mapWundergroundObservationRow);
}
async function getAviationObservationRows(params) {
    return selectDateRangeRows("aw_observations", params, "city_slug, local_date, observed_at_utc", mapAviationObservationRow);
}
async function getPolymarketDayRows(params) {
    return selectDateRangeRows("polymarket_days", params, "city_slug, local_date", mapPolymarketDayRow);
}
async function getResolvedPolymarketDayRows(params) {
    await ensureComparisonDb();
    const { filters, args } = buildDateRangeFilter(params);
    const result = await execute(`SELECT * FROM polymarket_days WHERE ${filters.join(" AND ")} AND status = 'resolved' ORDER BY city_slug, local_date`, args);
    return result.rows.map((row) => mapPolymarketDayRow(row));
}
async function getLatestResolvedPolymarketDate(citySlug) {
    await ensureComparisonDb();
    const result = await execute(`SELECT MAX(local_date) AS latest_local_date
     FROM polymarket_days
     WHERE city_slug = ? AND status = 'resolved'`, [citySlug]);
    const latestLocalDate = result.rows[0]?.latest_local_date;
    return typeof latestLocalDate === "string" && latestLocalDate.trim()
        ? latestLocalDate
        : null;
}
async function getEarliestUnresolvedPolymarketDate(citySlug) {
    await ensureComparisonDb();
    const result = await execute(`SELECT MIN(local_date) AS earliest_local_date
     FROM polymarket_days
     WHERE city_slug = ? AND status = 'unresolved'`, [citySlug]);
    const earliestLocalDate = result.rows[0]?.earliest_local_date;
    return typeof earliestLocalDate === "string" && earliestLocalDate.trim()
        ? earliestLocalDate
        : null;
}
async function getLatestStoredComparisonResumeDate(citySlug) {
    await ensureComparisonDb();
    const result = await execute(`
      WITH latest_dates AS (
        SELECT MAX(local_date) AS latest_local_date
        FROM wu_observations
        WHERE city_slug = ?

        UNION ALL

        SELECT MAX(local_date) AS latest_local_date
        FROM aw_observations
        WHERE city_slug = ?

        UNION ALL

        SELECT MAX(local_date) AS latest_local_date
        FROM polymarket_days
        WHERE city_slug = ?
      )
      SELECT
        COUNT(latest_local_date) AS populated_source_count,
        MIN(latest_local_date) AS resume_local_date
      FROM latest_dates
    `, [citySlug, citySlug, citySlug]);
    const populatedSourceCount = Number(result.rows[0]?.populated_source_count ?? 0);
    const resumeLocalDate = result.rows[0]?.resume_local_date;
    if (populatedSourceCount !== 3) {
        return null;
    }
    return typeof resumeLocalDate === "string" && resumeLocalDate.trim()
        ? resumeLocalDate
        : null;
}
async function getWundergroundDaySummariesForResolvedPolymarket(params) {
    await ensureComparisonDb();
    const { filters, args } = buildDateRangeFilter(params, {
        dateColumn: "wu.local_date",
        cityColumn: "wu.city_slug",
    });
    const result = await execute(`
      WITH ranked AS (
        SELECT
          wu.city_slug,
          wu.local_date,
          wu.observed_at_local,
          wu.observed_at_utc,
          wu.request_url_imperial,
          COALESCE(wu.temp_f, (wu.temp_c * 9.0 / 5.0) + 32.0) AS comparable_temp_f,
          COALESCE(wu.temp_c, (wu.temp_f - 32.0) * 5.0 / 9.0) AS comparable_temp_c,
          ROW_NUMBER() OVER (
            PARTITION BY wu.city_slug, wu.local_date
            ORDER BY COALESCE(wu.temp_f, (wu.temp_c * 9.0 / 5.0) + 32.0) DESC, wu.observed_at_utc ASC
          ) AS rn_f,
          ROW_NUMBER() OVER (
            PARTITION BY wu.city_slug, wu.local_date
            ORDER BY COALESCE(wu.temp_c, (wu.temp_f - 32.0) * 5.0 / 9.0) DESC, wu.observed_at_utc ASC
          ) AS rn_c
        FROM wu_observations wu
        INNER JOIN polymarket_days pm
          ON pm.city_slug = wu.city_slug
         AND pm.local_date = wu.local_date
         AND pm.status = 'resolved'
        WHERE ${filters.join(" AND ")}
      )
      SELECT
        city_slug,
        local_date,
        MAX(comparable_temp_f) AS max_temp_f,
        MAX(comparable_temp_c) AS max_temp_c,
        COALESCE(
          MAX(CASE WHEN rn_f = 1 THEN observed_at_local END),
          MAX(CASE WHEN rn_c = 1 THEN observed_at_local END)
        ) AS peak_local,
        COUNT(*) AS point_count,
        MIN(request_url_imperial) AS request_url
      FROM ranked
      GROUP BY city_slug, local_date
      ORDER BY city_slug, local_date
    `, args);
    return result.rows.map((row) => mapWundergroundDaySummaryRow(row));
}
async function getAviationDaySummariesForResolvedPolymarket(params) {
    await ensureComparisonDb();
    const { filters, args } = buildDateRangeFilter(params, {
        dateColumn: "aw.local_date",
        cityColumn: "aw.city_slug",
    });
    const result = await execute(`
      WITH ranked AS (
        SELECT
          aw.city_slug,
          aw.local_date,
          aw.observed_at_local,
          aw.observed_at_utc,
          aw.temp_c,
          ROW_NUMBER() OVER (
            PARTITION BY aw.city_slug, aw.local_date
            ORDER BY aw.temp_c DESC, aw.observed_at_utc ASC
          ) AS rn
        FROM aw_observations aw
        INNER JOIN polymarket_days pm
          ON pm.city_slug = aw.city_slug
         AND pm.local_date = aw.local_date
         AND pm.status = 'resolved'
        WHERE ${filters.join(" AND ")}
      )
      SELECT
        city_slug,
        local_date,
        MAX(temp_c) AS max_temp_c,
        MAX(CASE WHEN rn = 1 THEN observed_at_local END) AS peak_local,
        COUNT(*) AS point_count
      FROM ranked
      GROUP BY city_slug, local_date
      ORDER BY city_slug, local_date
    `, args);
    return result.rows.map((row) => mapAviationDaySummaryRow(row));
}
async function getWundergroundObservationDay(params) {
    return selectDayRows("wu_observations", params, "observed_at_utc", mapWundergroundObservationRow);
}
async function getAviationObservationDay(params) {
    return selectDayRows("aw_observations", params, "observed_at_utc", mapAviationObservationRow);
}
async function getPolymarketDay(params) {
    return selectOneRow("polymarket_days", params, mapPolymarketDayRow);
}
async function getWundergroundFutureHighHourlyStats(citySlug) {
    await ensureComparisonDb();
    const result = await execute(`
      SELECT *
      FROM wu_future_high_hourly_stats
      WHERE city_slug = ?
      ORDER BY hour_bucket
    `, [citySlug]);
    return result.rows.map((row) => mapWundergroundFutureHighHourlyStatRow(row));
}
async function deleteWundergroundObservationWindow(params) {
    return deleteWindowRows("wu_observations", params);
}
async function deleteAviationObservationWindow(params) {
    return deleteWindowRows("aw_observations", params);
}
async function deletePolymarketDayWindow(params) {
    return deleteWindowRows("polymarket_days", params);
}
async function replaceWundergroundFutureHighHourlyStats(citySlug, records) {
    await ensureComparisonDb();
    await execute(`
      DELETE FROM wu_future_high_hourly_stats
      WHERE city_slug = ?
    `, [citySlug]);
    if (records.length === 0) {
        return 0;
    }
    for (const record of records) {
        await execute(`
        INSERT INTO wu_future_high_hourly_stats (
          city_slug,
          hour_bucket,
          probability,
          sample_count,
          future_higher_count,
          eligible_day_count,
          method,
          generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city_slug, hour_bucket) DO UPDATE SET
          probability = excluded.probability,
          sample_count = excluded.sample_count,
          future_higher_count = excluded.future_higher_count,
          eligible_day_count = excluded.eligible_day_count,
          method = excluded.method,
          generated_at = excluded.generated_at
      `, [
            record.citySlug,
            record.hourBucket,
            record.probability,
            record.sampleCount,
            record.futureHigherCount,
            record.eligibleDayCount,
            record.method,
            record.generatedAt,
        ]);
    }
    return records.length;
}
async function upsertWundergroundObservations(records) {
    if (records.length === 0) {
        return 0;
    }
    await ensureComparisonDb();
    for (const record of records) {
        await execute(`
        INSERT INTO wu_observations (
          city_slug,
          local_date,
          station_icao,
          location_id,
          observed_at_utc,
          observed_at_local,
          temp_f,
          temp_c,
          max_temp_f,
          max_temp_c,
          request_url_imperial,
          request_url_metric,
          fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city_slug, observed_at_utc) DO UPDATE SET
          local_date = excluded.local_date,
          station_icao = excluded.station_icao,
          location_id = excluded.location_id,
          observed_at_local = excluded.observed_at_local,
          temp_f = excluded.temp_f,
          temp_c = excluded.temp_c,
          max_temp_f = excluded.max_temp_f,
          max_temp_c = excluded.max_temp_c,
          request_url_imperial = excluded.request_url_imperial,
          request_url_metric = excluded.request_url_metric,
          fetched_at = excluded.fetched_at
      `, [
            record.citySlug,
            record.localDate,
            record.stationIcao,
            record.locationId,
            record.observedAtUtc,
            record.observedAtLocal,
            record.tempF,
            record.tempC,
            record.maxTempF,
            record.maxTempC,
            record.requestUrlImperial,
            record.requestUrlMetric,
            record.fetchedAt,
        ]);
    }
    return records.length;
}
async function upsertAviationObservations(records) {
    if (records.length === 0) {
        return 0;
    }
    await ensureComparisonDb();
    for (const record of records) {
        await execute(`
        INSERT INTO aw_observations (
          city_slug,
          local_date,
          station_icao,
          observed_at_utc,
          observed_at_local,
          report_time_raw,
          temp_c,
          fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city_slug, observed_at_utc) DO UPDATE SET
          local_date = excluded.local_date,
          station_icao = excluded.station_icao,
          observed_at_local = excluded.observed_at_local,
          report_time_raw = excluded.report_time_raw,
          temp_c = excluded.temp_c,
          fetched_at = excluded.fetched_at
      `, [
            record.citySlug,
            record.localDate,
            record.stationIcao,
            record.observedAtUtc,
            record.observedAtLocal,
            record.reportTimeRaw,
            record.tempC,
            record.fetchedAt,
        ]);
    }
    return records.length;
}
async function upsertPolymarketDays(records) {
    if (records.length === 0) {
        return 0;
    }
    await ensureComparisonDb();
    for (const record of records) {
        const winner = record.winner;
        const winnerUnit = winner && "unit" in winner ? winner.unit : null;
        const winnerValue = winner && "value" in winner ? winner.value : null;
        const winnerMinValue = winner && "minValue" in winner ? winner.minValue : null;
        const winnerMaxValue = winner && "maxValue" in winner ? winner.maxValue : null;
        await execute(`
        INSERT INTO polymarket_days (
          city_slug,
          local_date,
          polymarket_slug,
          status,
          winner_raw,
          winner_kind,
          winner_unit,
          winner_value,
          winner_min_value,
          winner_max_value,
          resolution_source,
          fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city_slug, local_date) DO UPDATE SET
          polymarket_slug = excluded.polymarket_slug,
          status = excluded.status,
          winner_raw = excluded.winner_raw,
          winner_kind = excluded.winner_kind,
          winner_unit = excluded.winner_unit,
          winner_value = excluded.winner_value,
          winner_min_value = excluded.winner_min_value,
          winner_max_value = excluded.winner_max_value,
          resolution_source = excluded.resolution_source,
          fetched_at = excluded.fetched_at
      `, [
            record.citySlug,
            record.localDate,
            record.slug,
            record.status,
            winner?.raw ?? null,
            winner?.kind ?? null,
            winnerUnit,
            winnerValue,
            winnerMinValue,
            winnerMaxValue,
            record.resolutionSource,
            record.fetchedAt,
        ]);
    }
    return records.length;
}
//# sourceMappingURL=db.js.map