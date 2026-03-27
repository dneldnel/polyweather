"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildComparisonReport = buildComparisonReport;
exports.getComparableWundergroundValue = getComparableWundergroundValue;
exports.getComparableAviationValue = getComparableAviationValue;
exports.evaluateAgainstWinner = evaluateAgainstWinner;
function buildComparableValue(winner, values) {
    if (!winner || winner.kind === "unknown") {
        return { value: null, unit: null };
    }
    return winner.unit === "F"
        ? { value: values.fahrenheit, unit: "F" }
        : { value: values.celsius, unit: "C" };
}
function isComparisonMatch(status) {
    return ["match", "match-derived-f", "boundary-match"].includes(status);
}
function isComparisonMismatch(status) {
    return ["mismatch", "boundary-mismatch"].includes(status);
}
function countSourceAgreement(rows, predicate) {
    let count = 0;
    for (const row of rows) {
        const winner = row.polymarket.winner;
        if (!winner || winner.kind === "unknown") {
            continue;
        }
        const wunderground = getComparableWundergroundValue(winner, row.wunderground);
        const aviation = getComparableAviationValue(winner, row.aviationWeather);
        if (wunderground.value != null &&
            aviation.value != null &&
            predicate(wunderground.value, aviation.value)) {
            count += 1;
        }
    }
    return count;
}
function buildCitySummary(airport, rows) {
    const resolvedRows = rows.filter((row) => row.polymarket.status === "resolved");
    const summary = {
        citySlug: airport.slug,
        city: airport.city,
        stationIcao: airport.stationIcao,
        resolvedDays: resolvedRows.length,
        wundergroundMatches: 0,
        wundergroundMismatches: 0,
        aviationMatches: 0,
        aviationMismatches: 0,
        sourceAgreementDays: 0,
        sourceDisagreementDays: 0,
    };
    for (const row of resolvedRows) {
        if (isComparisonMatch(row.comparisons.wunderground)) {
            summary.wundergroundMatches += 1;
        }
        if (isComparisonMismatch(row.comparisons.wunderground)) {
            summary.wundergroundMismatches += 1;
        }
        if (isComparisonMatch(row.comparisons.aviationWeather)) {
            summary.aviationMatches += 1;
        }
        if (isComparisonMismatch(row.comparisons.aviationWeather)) {
            summary.aviationMismatches += 1;
        }
    }
    summary.sourceAgreementDays = countSourceAgreement(resolvedRows, (left, right) => left === right);
    summary.sourceDisagreementDays = countSourceAgreement(resolvedRows, (left, right) => left !== right);
    return summary;
}
function buildComparisonReport(params) {
    const includeRows = params.includeRows ?? true;
    const rowsByCity = new Map();
    for (const airport of params.query.airports) {
        rowsByCity.set(airport.slug, []);
    }
    for (const row of params.rows) {
        rowsByCity.get(row.citySlug)?.push(row);
    }
    const cities = params.query.airports.map((airport) => {
        const rows = rowsByCity.get(airport.slug) ?? [];
        const resolvedRows = rows.filter((row) => row.polymarket.status === "resolved");
        return {
            airport,
            summary: buildCitySummary(airport, rows),
            rows: includeRows ? resolvedRows : [],
        };
    });
    return {
        generatedAt: new Date().toISOString(),
        startDate: params.query.startDate,
        endDate: params.query.endDate,
        cityFilter: params.query.cityFilter,
        mode: "raw-db",
        cities,
    };
}
function getComparableWundergroundValue(winner, row) {
    return buildComparableValue(winner, {
        fahrenheit: row?.maxTempF ?? null,
        celsius: row?.maxTempC ?? null,
    });
}
function getComparableAviationValue(winner, row) {
    const comparable = buildComparableValue(winner, {
        fahrenheit: row?.maxTempFRounded ?? null,
        celsius: row?.maxTempC ?? null,
    });
    return {
        ...comparable,
        derivedFromCelsius: winner && winner.kind !== "unknown" && winner.unit === "F" ? row?.maxTempC ?? null : null,
    };
}
function evaluateAgainstWinner(actualValue, polymarket, options) {
    if (polymarket.status === "missing") {
        return "missing-polymarket";
    }
    if (polymarket.status === "unresolved" || !polymarket.winner) {
        return "unresolved";
    }
    if (actualValue === null || !options.directUnit) {
        return "missing-source-data";
    }
    if (polymarket.winner.kind === "unknown") {
        return "mismatch";
    }
    if (polymarket.winner.unit !== options.directUnit) {
        return "mismatch";
    }
    if (polymarket.winner.kind === "exact") {
        if (actualValue !== polymarket.winner.value) {
            return "mismatch";
        }
        return options.derivedFromCelsius != null ? "match-derived-f" : "match";
    }
    if (polymarket.winner.kind === "range") {
        const inRange = actualValue >= polymarket.winner.minValue && actualValue <= polymarket.winner.maxValue;
        if (!inRange) {
            return "mismatch";
        }
        return options.derivedFromCelsius != null ? "match-derived-f" : "match";
    }
    const boundaryOk = polymarket.winner.kind === "at-most"
        ? actualValue <= polymarket.winner.value
        : actualValue >= polymarket.winner.value;
    return boundaryOk ? "boundary-match" : "boundary-mismatch";
}
//# sourceMappingURL=report.js.map