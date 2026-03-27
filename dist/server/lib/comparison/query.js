"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildComparisonHref = buildComparisonHref;
exports.getDefaultComparisonWindow = getDefaultComparisonWindow;
exports.enumerateDates = enumerateDates;
exports.getDateRangeDayCount = getDateRangeDayCount;
exports.normalizeComparisonQuery = normalizeComparisonQuery;
const airports_1 = require("../airports");
function shiftDate(date, offsetDays) {
    const cursor = new Date(`${date}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
    return cursor.toISOString().slice(0, 10);
}
function parseDateInput(value, fallback) {
    const candidate = value?.trim() || fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
        throw new Error(`Invalid date: ${candidate}`);
    }
    return candidate;
}
function matchesAirportFilter(airport, filter) {
    return (airport.slug.toLowerCase() === filter ||
        airport.city.toLowerCase() === filter ||
        airport.stationIcao.toLowerCase() === filter);
}
function buildComparisonHref({ startDate, endDate, city, selectedDate, }) {
    const search = new URLSearchParams({
        startDate,
        endDate,
    });
    const cityFilter = city?.trim();
    if (cityFilter) {
        search.set("city", cityFilter);
    }
    const normalizedSelectedDate = selectedDate?.trim();
    if (normalizedSelectedDate) {
        search.set("selectedDate", normalizedSelectedDate);
    }
    return `/comparison?${search.toString()}`;
}
function getDefaultComparisonWindow() {
    const endDate = shiftDate(new Date().toISOString().slice(0, 10), -1);
    const startDate = shiftDate(endDate, -7);
    return { startDate, endDate };
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
function getDateRangeDayCount(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const daySpan = end.getTime() - start.getTime();
    return Math.floor(daySpan / 86_400_000) + 1;
}
function normalizeComparisonQuery(input) {
    const defaults = getDefaultComparisonWindow();
    const startDate = parseDateInput(input.startDate, defaults.startDate);
    const endDate = parseDateInput(input.endDate, defaults.endDate);
    if (startDate > endDate) {
        throw new Error(`startDate ${startDate} must be <= endDate ${endDate}`);
    }
    const city = input.city?.trim().toLowerCase() || null;
    const airports = city
        ? airports_1.AIRPORTS.filter((airport) => matchesAirportFilter(airport, city))
        : airports_1.AIRPORTS;
    if (airports.length === 0) {
        throw new Error(`Unknown city filter: ${input.city}`);
    }
    return {
        startDate,
        endDate,
        cityFilter: input.city?.trim() ?? null,
        airports,
    };
}
//# sourceMappingURL=query.js.map