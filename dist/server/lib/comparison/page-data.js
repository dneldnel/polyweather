"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComparisonPageData = getComparisonPageData;
const history_coverage_1 = require("./history-coverage");
const query_1 = require("./query");
const read_service_1 = require("./read-service");
function getSingleValue(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const firstValue = value[0];
        return typeof firstValue === "string" ? firstValue : null;
    }
    return null;
}
function parseSelectedDate(value) {
    const candidate = getSingleValue(value);
    if (!candidate) {
        return null;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}
async function getComparisonPageData(input) {
    const defaults = (0, query_1.getDefaultComparisonWindow)();
    const startDate = getSingleValue(input.startDate) ?? defaults.startDate;
    const endDate = getSingleValue(input.endDate) ?? defaults.endDate;
    const city = getSingleValue(input.city) ?? "";
    const requestedSelectedDate = parseSelectedDate(input.selectedDate);
    const includeRows = city.trim().length > 0;
    const report = await (0, read_service_1.getStoredComparisonReport)({
        startDate,
        endDate,
        city,
    }, {
        includeRows,
    });
    const cityDetail = includeRows ? report.cities[0] ?? null : null;
    const earliestResolvedDate = cityDetail
        ? (0, history_coverage_1.getEarliestResolvedComparisonDay)(cityDetail.airport.slug)
        : null;
    const selectedDate = cityDetail && requestedSelectedDate
        ? cityDetail.rows.some((row) => row.localDate === requestedSelectedDate)
            ? requestedSelectedDate
            : null
        : null;
    const dayDetail = cityDetail &&
        selectedDate &&
        selectedDate >= startDate &&
        selectedDate <= endDate
        ? await (0, read_service_1.getStoredComparisonDayDetail)({
            citySlug: cityDetail.airport.slug,
            localDate: selectedDate,
        })
        : null;
    return {
        startDate,
        endDate,
        city,
        selectedDate,
        report,
        cityDetail,
        dayDetail,
        earliestResolvedDate,
        statusLabel: "Loaded directly from persisted SQLite data",
    };
}
//# sourceMappingURL=page-data.js.map