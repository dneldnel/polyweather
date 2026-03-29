"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftDate = shiftDate;
exports.formatDateInTimezone = formatDateInTimezone;
exports.todayInTimezone = todayInTimezone;
exports.resolveComparisonCityConfigs = resolveComparisonCityConfigs;
exports.runComparisonSync = runComparisonSync;
exports.renderComparisonSyncSummary = renderComparisonSyncSummary;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const airports_1 = require("../airports");
const db_1 = require("./db");
const future_high_stats_1 = require("./future-high-stats");
const AVIATION_WEATHER_BASE_URL = "https://aviationweather.gov/api/data/metar";
const POLYMARKET_EVENT_BY_SLUG_URL = "https://gamma-api.polymarket.com/events/slug";
const WEATHER_COM_HISTORY_BASE_URL = "https://api.weather.com/v1";
const WEATHER_COM_PUBLIC_API_KEY = process.env.WUNDERGROUND_SUN_API_KEY ?? "e1f10a1e78da46f5b10a1e78da96f525";
const AVIATION_WEATHER_ARCHIVE_DAYS = 31;
const AVIATION_WEATHER_WINDOW_DAYS = 7;
const WUNDERGROUND_HISTORY_WINDOW_DAYS = 14;
const USER_AGENT = "polyweather/0.1 (+https://github.com/openai/codex)";
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function logProgress(message) {
    console.error(`[${new Date().toISOString()}] ${message}`);
}
function clampProgressFraction(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(Math.max(value, 0), 1);
}
function emitProgress(options, event) {
    logProgress(event.message);
    options?.onProgress?.({
        ...event,
        progressFraction: clampProgressFraction(event.progressFraction),
    });
}
function shiftDate(date, offsetDays) {
    const cursor = new Date(`${date}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
    return cursor.toISOString().slice(0, 10);
}
function enumerateDates(startDate, endDate) {
    const days = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const stop = new Date(`${endDate}T00:00:00Z`);
    while (cursor.getTime() <= stop.getTime()) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}
function enumerateDateWindows(startDate, endDate, windowDays) {
    const windows = [];
    let cursor = startDate;
    while (cursor <= endDate) {
        const windowEnd = shiftDate(cursor, windowDays - 1);
        const boundedEnd = windowEnd < endDate ? windowEnd : endDate;
        windows.push({
            startDate: cursor,
            endDate: boundedEnd,
        });
        cursor = shiftDate(boundedEnd, 1);
    }
    return windows;
}
function getAviationObservationWindows(startDate, endDate) {
    const earliestArchiveDate = shiftDate(todayInTimezone("UTC"), -(AVIATION_WEATHER_ARCHIVE_DAYS - 1));
    const effectiveStartDate = startDate < earliestArchiveDate ? earliestArchiveDate : startDate;
    if (effectiveStartDate > endDate) {
        return [];
    }
    return enumerateDateWindows(effectiveStartDate, endDate, AVIATION_WEATHER_WINDOW_DAYS);
}
function getWundergroundObservationWindows(startDate, endDate) {
    return enumerateDateWindows(startDate, endDate, WUNDERGROUND_HISTORY_WINDOW_DAYS);
}
function formatDateInTimezone(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) {
        throw new Error(`Could not format date in timezone ${timeZone}`);
    }
    return `${year}-${month}-${day}`;
}
function formatDateTimeInTimezone(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "shortOffset",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    const second = parts.find((part) => part.type === "second")?.value;
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!year || !month || !day || !hour || !minute || !second || !offset) {
        throw new Error(`Could not format date-time in timezone ${timeZone}`);
    }
    return `${year}-${month}-${day} ${hour}:${minute}:${second} ${offset}`;
}
function todayInTimezone(timeZone) {
    return formatDateInTimezone(new Date(), timeZone);
}
function matchesCityFilter(config, filter) {
    return (config.city.toLowerCase() === filter ||
        config.slug.toLowerCase() === filter ||
        config.stationIcao.toLowerCase() === filter);
}
function resolveComparisonCityConfigs(cityFilter) {
    const normalizedCityFilter = cityFilter?.toLowerCase() ?? null;
    const configs = normalizedCityFilter
        ? airports_1.AIRPORTS.filter((config) => matchesCityFilter(config, normalizedCityFilter))
        : airports_1.AIRPORTS;
    if (configs.length === 0) {
        throw new Error(`No city matched --city ${cityFilter}`);
    }
    return configs;
}
async function fetchJson(url) {
    const target = url.toString();
    const args = [
        "-sS",
        "-L",
        "--fail",
        "--retry",
        "2",
        "--retry-all-errors",
        "--retry-delay",
        "1",
        "--max-time",
        "30",
        "--user-agent",
        USER_AGENT,
        "--header",
        "accept: application/json",
        target,
    ];
    const errors = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const { stdout } = await execFileAsync("curl", args, {
                env: process.env,
                maxBuffer: 16 * 1024 * 1024,
            });
            return JSON.parse(stdout);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`attempt ${attempt}: ${message}`);
        }
    }
    throw new Error(`Request failed for ${target}: ${errors.join(" | ")}`);
}
async function fetchJsonAllow404(url) {
    const target = url.toString();
    const args = [
        "-sS",
        "-L",
        "--retry",
        "2",
        "--retry-all-errors",
        "--retry-delay",
        "1",
        "--max-time",
        "30",
        "--user-agent",
        USER_AGENT,
        "--header",
        "accept: application/json",
        "--write-out",
        "\\n%{http_code}",
        target,
    ];
    const errors = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const { stdout } = await execFileAsync("curl", args, {
                env: process.env,
                maxBuffer: 16 * 1024 * 1024,
            });
            const splitAt = stdout.lastIndexOf("\n");
            if (splitAt === -1) {
                throw new Error(`Unexpected curl response without status trailer for ${target}`);
            }
            const body = stdout.slice(0, splitAt);
            const statusCode = Number(stdout.slice(splitAt + 1).trim());
            if (!Number.isFinite(statusCode)) {
                throw new Error(`Could not parse HTTP status for ${target}`);
            }
            if (statusCode === 404) {
                return null;
            }
            if (statusCode < 200 || statusCode >= 300) {
                throw new Error(`HTTP ${statusCode} for ${target}`);
            }
            return JSON.parse(body);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`attempt ${attempt}: ${message}`);
        }
    }
    throw new Error(`Request failed for ${target}: ${errors.join(" | ")}`);
}
function formatAviationWeatherAnchor(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    return `${year}${month}${day}_${hour}${minute}`;
}
function buildAviationWeatherUrl(stationIcao, hoursBack, options) {
    const url = new URL(AVIATION_WEATHER_BASE_URL);
    url.searchParams.set("ids", stationIcao);
    url.searchParams.set("format", "json");
    url.searchParams.set("hours", String(hoursBack));
    if (options?.endDateUtc) {
        url.searchParams.set("date", formatAviationWeatherAnchor(options.endDateUtc));
    }
    return url;
}
function buildEventSlug(slugToken, date) {
    const utcDate = new Date(`${date}T00:00:00Z`);
    const month = utcDate.toLocaleString("en-US", {
        month: "long",
        timeZone: "UTC",
    }).toLowerCase();
    const day = utcDate.getUTCDate();
    const year = utcDate.getUTCFullYear();
    return `highest-temperature-in-${slugToken}-on-${month}-${day}-${year}`;
}
function buildWeatherComUrl(locationId, startDate, endDate, units) {
    return `${WEATHER_COM_HISTORY_BASE_URL}/location/${locationId}/observations/historical.json?units=${units}&startDate=${startDate.replaceAll("-", "")}&endDate=${endDate.replaceAll("-", "")}&apiKey=${WEATHER_COM_PUBLIC_API_KEY}`;
}
function parseYesOutcomePrice(outcomePrices) {
    if (!outcomePrices) {
        return null;
    }
    try {
        const parsed = JSON.parse(outcomePrices);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return null;
        }
        return String(parsed[0]);
    }
    catch {
        return null;
    }
}
function parseBucketResolution(input) {
    if (!input) {
        return null;
    }
    const range = input.match(/^(-?\d+)\s*-\s*(-?\d+)\s*°([CF])$/i);
    if (range) {
        return {
            kind: "range",
            raw: input,
            minValue: Number(range[1]),
            maxValue: Number(range[2]),
            unit: range[3].toUpperCase(),
        };
    }
    const exact = input.match(/^(-?\d+)\s*°([CF])$/i);
    if (exact) {
        return {
            kind: "exact",
            raw: input,
            value: Number(exact[1]),
            unit: exact[2].toUpperCase(),
        };
    }
    const atMost = input.match(/^(-?\d+)\s*°([CF])\s+or\s+(?:below|lower|less)$/i);
    if (atMost) {
        return {
            kind: "at-most",
            raw: input,
            value: Number(atMost[1]),
            unit: atMost[2].toUpperCase(),
        };
    }
    const atLeast = input.match(/^(-?\d+)\s*°([CF])\s+or\s+(?:above|higher|more)$/i);
    if (atLeast) {
        return {
            kind: "at-least",
            raw: input,
            value: Number(atLeast[1]),
            unit: atLeast[2].toUpperCase(),
        };
    }
    return {
        kind: "unknown",
        raw: input,
    };
}
async function fetchPolymarketDay(config, date) {
    const slug = buildEventSlug(config.slug, date);
    const url = `${POLYMARKET_EVENT_BY_SLUG_URL}/${slug}`;
    const event = await fetchJsonAllow404(url);
    if (!event) {
        return {
            date,
            slug,
            winner: null,
            status: "missing",
            resolutionSource: null,
        };
    }
    const winningMarket = (event.markets ?? []).find((market) => parseYesOutcomePrice(market.outcomePrices) === "1");
    return {
        date,
        slug,
        winner: parseBucketResolution(winningMarket?.groupItemTitle),
        status: winningMarket ? "resolved" : "unresolved",
        resolutionSource: event.resolutionSource ?? null,
    };
}
function getAviationObservationDate(row) {
    if (typeof row.obsTime === "number") {
        const observedAt = new Date(row.obsTime * 1000);
        if (!Number.isNaN(observedAt.getTime())) {
            return observedAt;
        }
    }
    if (typeof row.reportTime === "string") {
        const reportedAt = new Date(row.reportTime);
        if (!Number.isNaN(reportedAt.getTime())) {
            return reportedAt;
        }
    }
    return null;
}
async function fetchAviationObservationRowsForWindow(config, startDate, endDate, fetchedAt) {
    const startUtc = new Date(`${startDate}T00:00:00Z`);
    const windowEndExclusive = new Date(`${shiftDate(endDate, 1)}T00:00:00Z`);
    const hoursBack = Math.max(24, Math.ceil((windowEndExclusive.getTime() - startUtc.getTime()) / (60 * 60 * 1000)) + 48);
    const url = buildAviationWeatherUrl(config.stationIcao, hoursBack, {
        endDateUtc: windowEndExclusive,
    });
    const rows = await fetchJson(url);
    const uniqueRows = new Map();
    for (const row of rows) {
        if (typeof row.temp !== "number") {
            continue;
        }
        const observationTime = getAviationObservationDate(row);
        if (!observationTime) {
            continue;
        }
        const localDate = formatDateInTimezone(observationTime, config.timezone);
        if (localDate < startDate || localDate > endDate) {
            continue;
        }
        const observedAtUtc = observationTime.toISOString();
        uniqueRows.set(observedAtUtc, {
            citySlug: config.slug,
            localDate,
            stationIcao: config.stationIcao,
            observedAtUtc,
            observedAtLocal: formatDateTimeInTimezone(observationTime, config.timezone),
            reportTimeRaw: row.reportTime ?? null,
            tempC: row.temp,
            fetchedAt,
        });
    }
    return [...uniqueRows.values()].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
}
async function fetchAviationObservationRowsForCity(config, startDate, endDate, fetchedAt, options) {
    const windows = getAviationObservationWindows(startDate, endDate);
    const rowsByObservedAtUtc = new Map();
    for (const [index, window] of windows.entries()) {
        const rows = await fetchAviationObservationRowsForWindow(config, window.startDate, window.endDate, fetchedAt);
        options?.onWindowComplete?.(window, index + 1, windows.length);
        for (const row of rows) {
            rowsByObservedAtUtc.set(row.observedAtUtc, row);
        }
    }
    return [...rowsByObservedAtUtc.values()].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
}
async function fetchWundergroundObservationRowsForWindow(config, startDate, endDate, fetchedAt) {
    const locationId = `${config.stationIcao}:9:${config.countryCode}`;
    const imperialUrl = buildWeatherComUrl(locationId, startDate, endDate, "e");
    const metricUrl = buildWeatherComUrl(locationId, startDate, endDate, "m");
    const [imperialPayload, metricPayload] = await Promise.all([
        fetchJson(imperialUrl),
        fetchJson(metricUrl),
    ]);
    const byTimestamp = new Map();
    for (const row of imperialPayload.observations ?? []) {
        if (typeof row.valid_time_gmt !== "number") {
            continue;
        }
        const existing = byTimestamp.get(row.valid_time_gmt) ?? { imperial: null, metric: null };
        existing.imperial = row;
        byTimestamp.set(row.valid_time_gmt, existing);
    }
    for (const row of metricPayload.observations ?? []) {
        if (typeof row.valid_time_gmt !== "number") {
            continue;
        }
        const existing = byTimestamp.get(row.valid_time_gmt) ?? { imperial: null, metric: null };
        existing.metric = row;
        byTimestamp.set(row.valid_time_gmt, existing);
    }
    const rows = [];
    const orderedTimes = [...byTimestamp.keys()].sort((left, right) => left - right);
    for (const validTimeGmt of orderedTimes) {
        const observation = byTimestamp.get(validTimeGmt);
        if (!observation) {
            continue;
        }
        const observedAt = new Date(validTimeGmt * 1000);
        if (Number.isNaN(observedAt.getTime())) {
            continue;
        }
        const localDate = formatDateInTimezone(observedAt, config.timezone);
        if (localDate < startDate || localDate > endDate) {
            continue;
        }
        rows.push({
            citySlug: config.slug,
            localDate,
            stationIcao: config.stationIcao,
            locationId,
            observedAtUtc: observedAt.toISOString(),
            observedAtLocal: formatDateTimeInTimezone(observedAt, config.timezone),
            tempF: typeof observation.imperial?.temp === "number" ? observation.imperial.temp : null,
            tempC: typeof observation.metric?.temp === "number" ? observation.metric.temp : null,
            maxTempF: typeof observation.imperial?.max_temp === "number" ? observation.imperial.max_temp : null,
            maxTempC: typeof observation.metric?.max_temp === "number" ? observation.metric.max_temp : null,
            requestUrlImperial: imperialUrl,
            requestUrlMetric: metricUrl,
            fetchedAt,
        });
    }
    return rows;
}
async function fetchWundergroundObservationRowsForCity(config, startDate, endDate, fetchedAt, options) {
    const windows = getWundergroundObservationWindows(startDate, endDate);
    const rowsByObservedAtUtc = new Map();
    for (const [index, window] of windows.entries()) {
        const rows = await fetchWundergroundObservationRowsForWindow(config, window.startDate, window.endDate, fetchedAt);
        options?.onWindowComplete?.(window, index + 1, windows.length);
        for (const row of rows) {
            rowsByObservedAtUtc.set(row.observedAtUtc, row);
        }
    }
    return [...rowsByObservedAtUtc.values()].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
}
async function fetchPolymarketDayRowsForCity(config, startDate, endDate, fetchedAt, options) {
    const days = await Promise.all(enumerateDates(startDate, endDate).map((date) => fetchPolymarketDay(config, date)));
    options?.onComplete?.(days.length);
    return days
        .filter((day) => day.status !== "missing")
        .map((day) => ({
        citySlug: config.slug,
        localDate: day.date,
        slug: day.slug,
        status: day.status,
        winner: day.winner,
        resolutionSource: day.resolutionSource,
        fetchedAt,
    }));
}
async function syncComparisonCity(config, startDate, endDate, progressContext) {
    const fetchedAt = new Date().toISOString();
    const totalFetchUnits = getWundergroundObservationWindows(startDate, endDate).length +
        getAviationObservationWindows(startDate, endDate).length +
        1;
    let completedFetchUnits = 0;
    const emitCityProgress = (stage, message, phaseProgress) => {
        emitProgress(progressContext, {
            stage,
            message,
            totalCities: progressContext.totalCities,
            cityIndex: progressContext.cityIndex,
            completedCities: progressContext.completedCities,
            citySlug: config.slug,
            city: config.city,
            progressFraction: (progressContext.completedCities + clampProgressFraction(phaseProgress)) /
                Math.max(progressContext.totalCities, 1),
        });
    };
    const emitFetchProgress = (message) => {
        const fetchPhaseProgress = totalFetchUnits === 0 ? 0.6 : 0.1 + (completedFetchUnits / totalFetchUnits) * 0.5;
        emitCityProgress("fetching", message, fetchPhaseProgress);
    };
    emitCityProgress("fetching", `${config.city}: fetching WU, AW, and Polymarket history`, 0.05);
    const [wuRows, awRows, polymarketRows] = await Promise.all([
        fetchWundergroundObservationRowsForCity(config, startDate, endDate, fetchedAt, {
            onWindowComplete: (window, index, total) => {
                completedFetchUnits += 1;
                emitFetchProgress(`${config.city}: fetched WU window ${window.startDate}..${window.endDate} (${index}/${total})`);
            },
        }),
        fetchAviationObservationRowsForCity(config, startDate, endDate, fetchedAt, {
            onWindowComplete: (window, index, total) => {
                completedFetchUnits += 1;
                emitFetchProgress(`${config.city}: fetched AW window ${window.startDate}..${window.endDate} (${index}/${total})`);
            },
        }),
        fetchPolymarketDayRowsForCity(config, startDate, endDate, fetchedAt, {
            onComplete: (daysFetched) => {
                completedFetchUnits += 1;
                emitFetchProgress(`${config.city}: fetched Polymarket outcomes for ${daysFetched} day${daysFetched === 1 ? "" : "s"}`);
            },
        }),
    ]);
    emitCityProgress("persisting", `${config.city}: persisting ${wuRows.length} WU points, ${awRows.length} AW points, ${polymarketRows.length} market days`, 0.72);
    await (0, db_1.deleteWundergroundObservationWindow)({
        citySlug: config.slug,
        startDate,
        endDate,
    });
    await (0, db_1.deleteAviationObservationWindow)({
        citySlug: config.slug,
        startDate,
        endDate,
    });
    await (0, db_1.deletePolymarketDayWindow)({
        citySlug: config.slug,
        startDate,
        endDate,
    });
    const wuObservationPointsUpserted = await (0, db_1.upsertWundergroundObservations)(wuRows);
    const awObservationPointsUpserted = await (0, db_1.upsertAviationObservations)(awRows);
    const polymarketDaysUpserted = await (0, db_1.upsertPolymarketDays)(polymarketRows);
    emitCityProgress("rebuilding-future-high-stats", `${config.city}: rebuilding WU future-high hourly buckets`, 0.88);
    const futureHighStatsResult = await (0, future_high_stats_1.rebuildWundergroundFutureHighHourlyStatsForCity)(config.slug);
    emitCityProgress("rebuilding-future-high-stats", `${config.city}: rebuilt ${futureHighStatsResult.recordsWritten} WU future-high hourly buckets`, 0.98);
    return {
        wuObservationPointsUpserted,
        awObservationPointsUpserted,
        polymarketDaysUpserted,
        futureHighStatBucketsWritten: futureHighStatsResult.recordsWritten,
    };
}
async function runComparisonSync(params, options = {}) {
    const configs = resolveComparisonCityConfigs(params.cityFilter);
    const summary = {
        generatedAt: new Date().toISOString(),
        startDate: params.startDate,
        endDate: params.endDate,
        cityFilter: params.cityFilter,
        databaseUrl: (0, db_1.getComparisonDatabaseUrl)(),
        citiesProcessed: configs.length,
        polymarketDaysUpserted: 0,
        wuObservationPointsUpserted: 0,
        awObservationPointsUpserted: 0,
        futureHighStatBucketsWritten: 0,
    };
    emitProgress(options, {
        stage: "starting",
        message: `Starting comparison sync for ${summary.startDate}..${summary.endDate}` +
            `${summary.cityFilter ? ` city=${summary.cityFilter}` : ""}` +
            ` across ${configs.length} ${configs.length === 1 ? "city" : "cities"}`,
        totalCities: configs.length,
        cityIndex: null,
        completedCities: 0,
        citySlug: null,
        city: null,
        progressFraction: 0,
    });
    for (const [index, config] of configs.entries()) {
        const result = await syncComparisonCity(config, params.startDate, params.endDate, {
            totalCities: configs.length,
            cityIndex: index + 1,
            completedCities: index,
            onProgress: options.onProgress,
        });
        summary.polymarketDaysUpserted += result.polymarketDaysUpserted;
        summary.wuObservationPointsUpserted += result.wuObservationPointsUpserted;
        summary.awObservationPointsUpserted += result.awObservationPointsUpserted;
        summary.futureHighStatBucketsWritten += result.futureHighStatBucketsWritten;
    }
    emitProgress(options, {
        stage: "completed",
        message: `Saved raw comparison data ${summary.startDate}..${summary.endDate}` +
            `${summary.cityFilter ? ` city=${summary.cityFilter}` : ""}`,
        totalCities: configs.length,
        cityIndex: null,
        completedCities: configs.length,
        citySlug: null,
        city: null,
        progressFraction: 1,
    });
    return summary;
}
function renderComparisonSyncSummary(summary) {
    const lines = [];
    lines.push(`Saved raw comparison data ${summary.startDate}..${summary.endDate}${summary.cityFilter ? ` city=${summary.cityFilter}` : ""}`);
    lines.push(`Database: ${summary.databaseUrl}`);
    lines.push(`Cities processed: ${summary.citiesProcessed}`);
    lines.push(`Polymarket days upserted: ${summary.polymarketDaysUpserted}`);
    lines.push(`WU observation points upserted: ${summary.wuObservationPointsUpserted}`);
    lines.push(`AW observation points upserted: ${summary.awObservationPointsUpserted}`);
    lines.push(`WU future-high buckets written: ${summary.futureHighStatBucketsWritten}`);
    return `${lines.join("\n")}\n`;
}
//# sourceMappingURL=sync.js.map