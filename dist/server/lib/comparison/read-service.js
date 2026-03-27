"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeComparisonQuery = exports.getDefaultComparisonWindow = exports.enumerateDates = void 0;
exports.getStoredComparisonReport = getStoredComparisonReport;
exports.getStoredComparisonDayDetail = getStoredComparisonDayDetail;
const airports_1 = require("../airports");
const db_1 = require("./db");
const report_1 = require("./report");
const query_1 = require("./query");
Object.defineProperty(exports, "enumerateDates", { enumerable: true, get: function () { return query_1.enumerateDates; } });
Object.defineProperty(exports, "getDefaultComparisonWindow", { enumerable: true, get: function () { return query_1.getDefaultComparisonWindow; } });
Object.defineProperty(exports, "normalizeComparisonQuery", { enumerable: true, get: function () { return query_1.normalizeComparisonQuery; } });
const temperature_1 = require("../temperature");
const AIRPORTS_BY_SLUG = new Map(airports_1.AIRPORTS.map((airport) => [airport.slug, airport]));
function buildRowKey(citySlug, localDate) {
    return `${citySlug}:${localDate}`;
}
function createMissingPolymarketDay() {
    return {
        slug: null,
        status: "missing",
        winner: null,
        resolutionSource: null,
    };
}
function createEmptyWundergroundSummary() {
    return {
        maxTempF: null,
        maxTempC: null,
        peakLocal: null,
        pointCount: 0,
        requestUrl: null,
        points: [],
    };
}
function createEmptyAviationSummary() {
    return {
        maxTempC: null,
        maxTempFRounded: null,
        peakLocal: null,
        pointCount: 0,
        points: [],
    };
}
function toTemperaturePoint(observedAt, temperatureC) {
    return {
        observedAt,
        temperatureC,
    };
}
function groupByCityDate(rows) {
    const grouped = new Map();
    for (const row of rows) {
        const key = buildRowKey(row.citySlug, row.localDate);
        grouped.set(key, row);
    }
    return grouped;
}
function buildWundergroundDetail(rows) {
    if (rows.length === 0) {
        return createEmptyWundergroundSummary();
    }
    const sorted = [...rows].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
    const points = [];
    let maxTempF = null;
    let maxTempC = null;
    let peakLocal = null;
    for (const row of sorted) {
        const temperatureC = row.tempC ?? (row.tempF != null ? (0, temperature_1.convertTemperature)(row.tempF, "F", "C") : null);
        const temperatureF = row.tempF ?? (row.tempC != null ? (0, temperature_1.convertTemperature)(row.tempC, "C", "F") : null);
        if (temperatureC != null) {
            points.push(toTemperaturePoint(row.observedAtUtc, temperatureC));
        }
        if (temperatureF != null && (maxTempF === null || temperatureF > maxTempF)) {
            maxTempF = temperatureF;
            peakLocal = row.observedAtLocal;
        }
        if (temperatureC != null && (maxTempC === null || temperatureC > maxTempC)) {
            maxTempC = temperatureC;
            if (maxTempF === null) {
                peakLocal = row.observedAtLocal;
            }
        }
    }
    return {
        maxTempF,
        maxTempC,
        peakLocal,
        pointCount: points.length,
        requestUrl: sorted[0]?.requestUrlImperial ?? null,
        points,
    };
}
function buildAviationDetail(rows) {
    if (rows.length === 0) {
        return createEmptyAviationSummary();
    }
    const sorted = [...rows].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
    const points = sorted.map((row) => toTemperaturePoint(row.observedAtUtc, row.tempC));
    let maxTempC = null;
    let peakLocal = null;
    for (const row of sorted) {
        if (maxTempC === null || row.tempC > maxTempC) {
            maxTempC = row.tempC;
            peakLocal = row.observedAtLocal;
        }
    }
    return {
        maxTempC,
        maxTempFRounded: maxTempC === null ? null : Math.round((0, temperature_1.convertTemperature)(maxTempC, "C", "F")),
        peakLocal,
        pointCount: points.length,
        points,
    };
}
function buildPolymarketDay(row) {
    if (!row) {
        return createMissingPolymarketDay();
    }
    return {
        slug: row.slug,
        status: row.status,
        winner: row.winner,
        resolutionSource: row.resolutionSource,
    };
}
function buildStoredWundergroundSummary(row) {
    if (!row) {
        return createEmptyWundergroundSummary();
    }
    return {
        maxTempF: row.maxTempF,
        maxTempC: row.maxTempC,
        peakLocal: row.peakLocal,
        pointCount: row.pointCount,
        requestUrl: row.requestUrl,
    };
}
function buildStoredAviationSummary(row) {
    if (!row) {
        return createEmptyAviationSummary();
    }
    return {
        maxTempC: row.maxTempC,
        maxTempFRounded: row.maxTempC === null ? null : Math.round((0, temperature_1.convertTemperature)(row.maxTempC, "C", "F")),
        peakLocal: row.peakLocal,
        pointCount: row.pointCount,
    };
}
function buildComparisonDayRecord(params) {
    const airport = AIRPORTS_BY_SLUG.get(params.citySlug);
    if (!airport) {
        throw new Error(`Unknown airport slug in comparison read service: ${params.citySlug}`);
    }
    const comparableWu = (0, report_1.getComparableWundergroundValue)(params.polymarket.winner, params.wunderground);
    const comparableAw = (0, report_1.getComparableAviationValue)(params.polymarket.winner, params.aviationWeather);
    return {
        citySlug: params.citySlug,
        localDate: params.localDate,
        airport,
        polymarket: params.polymarket,
        wunderground: params.wunderground,
        aviationWeather: params.aviationWeather,
        comparisons: {
            wunderground: (0, report_1.evaluateAgainstWinner)(comparableWu.value, params.polymarket, {
                sourceName: "Wunderground",
                directUnit: comparableWu.unit,
            }),
            aviationWeather: (0, report_1.evaluateAgainstWinner)(comparableAw.value, params.polymarket, {
                sourceName: "AviationWeather",
                directUnit: comparableAw.unit,
                derivedFromCelsius: comparableAw.derivedFromCelsius,
            }),
        },
    };
}
function buildComparisonRows(params) {
    const wuByKey = groupByCityDate(params.wundergroundRows);
    const awByKey = groupByCityDate(params.aviationRows);
    return params.polymarketRows.map((row) => {
        const key = buildRowKey(row.citySlug, row.localDate);
        return buildComparisonDayRecord({
            citySlug: row.citySlug,
            localDate: row.localDate,
            polymarket: buildPolymarketDay(row),
            wunderground: buildStoredWundergroundSummary(wuByKey.get(key)),
            aviationWeather: buildStoredAviationSummary(awByKey.get(key)),
        });
    });
}
async function getStoredComparisonReport(input, options) {
    const query = (0, query_1.normalizeComparisonQuery)(input);
    const citySlugs = query.airports.map((airport) => airport.slug);
    const [wundergroundRows, aviationRows, polymarketRows] = await Promise.all([
        (0, db_1.getWundergroundDaySummariesForResolvedPolymarket)({
            startDate: query.startDate,
            endDate: query.endDate,
            citySlugs,
        }),
        (0, db_1.getAviationDaySummariesForResolvedPolymarket)({
            startDate: query.startDate,
            endDate: query.endDate,
            citySlugs,
        }),
        (0, db_1.getResolvedPolymarketDayRows)({
            startDate: query.startDate,
            endDate: query.endDate,
            citySlugs,
        }),
    ]);
    const rows = buildComparisonRows({
        wundergroundRows,
        aviationRows,
        polymarketRows,
    });
    return (0, report_1.buildComparisonReport)({
        rows,
        query,
        includeRows: options?.includeRows,
    });
}
async function getStoredComparisonDayDetail(params) {
    const airport = AIRPORTS_BY_SLUG.get(params.citySlug);
    if (!airport) {
        throw new Error(`Unknown airport slug in comparison detail: ${params.citySlug}`);
    }
    const [wundergroundRows, aviationRows, polymarketRow] = await Promise.all([
        (0, db_1.getWundergroundObservationDay)(params),
        (0, db_1.getAviationObservationDay)(params),
        (0, db_1.getPolymarketDay)(params),
    ]);
    if (wundergroundRows.length === 0 && aviationRows.length === 0 && !polymarketRow) {
        return null;
    }
    return {
        airport,
        localDate: params.localDate,
        displayUnit: (0, temperature_1.getAirportDisplayTemperatureUnit)(airport),
        polymarket: buildPolymarketDay(polymarketRow),
        wunderground: buildWundergroundDetail(wundergroundRows),
        aviationWeather: buildAviationDetail(aviationRows),
    };
}
//# sourceMappingURL=read-service.js.map