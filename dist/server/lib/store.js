"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeatherStore = getWeatherStore;
exports.buildWeatherResponse = buildWeatherResponse;
exports.buildWeatherCardDetailResponse = buildWeatherCardDetailResponse;
const later_high_delta_breakdown_1 = require("./later-high-delta-breakdown");
function createStore() {
    return {
        snapshot: null,
        refreshState: "idle",
        refreshPromise: null,
        cardRefreshPromises: new Map(),
        lastError: null,
    };
}
function getWeatherStore() {
    if (!globalThis.__polyweatherWebStore__) {
        globalThis.__polyweatherWebStore__ = createStore();
    }
    return globalThis.__polyweatherWebStore__;
}
function getDefaultWeatherSignals(card) {
    const defaultSignals = card.weatherSignalsBySource?.[card.defaultWeatherSignalsSourceId];
    if (defaultSignals) {
        return defaultSignals;
    }
    const firstSignals = Object.values(card.weatherSignalsBySource ?? {})[0];
    if (firstSignals) {
        return firstSignals;
    }
    const legacySignals = card.weatherSignals;
    return legacySignals ?? null;
}
function buildWeatherSummarySignals(card) {
    const signals = getDefaultWeatherSignals(card);
    return {
        sourceId: signals?.sourceId ?? card.defaultWeatherSignalsSourceId,
        weatherCode: signals?.weatherCode ?? null,
        isDay: signals?.isDay ?? null,
        sunset: signals?.sunset ?? null,
        cloudCover: signals?.cloudCover ?? null,
        precipitationProbability: signals?.precipitationProbability ?? null,
        precipitation: signals?.precipitation ?? null,
        windSpeed: signals?.windSpeed ?? null,
        status: signals?.status ?? "missing",
        error: signals?.error ?? null,
    };
}
function buildWeatherCardSummary(card) {
    return {
        airport: card.airport,
        cardUpdatedAt: card.cardUpdatedAt,
        wuCurrent: card.wuCurrent,
        wuTodayHigh: card.wuTodayHigh,
        aviationWeatherCurrent: card.aviationWeatherCurrent,
        defaultWeatherSignals: buildWeatherSummarySignals(card),
        openMeteoTodayHigh: card.openMeteoTodayHigh,
    };
}
function buildWeatherResponse() {
    const store = getWeatherStore();
    return {
        refreshedAt: store.snapshot?.refreshedAt ?? null,
        cards: store.snapshot?.cards?.map(buildWeatherCardSummary) ?? null,
        globalError: store.snapshot?.globalError ?? store.lastError,
        refreshState: store.refreshState,
        refreshingCardSlugs: [...store.cardRefreshPromises.keys()].sort(),
        responseIssuedAt: new Date().toISOString(),
    };
}
async function buildWeatherCardDetailResponse(slug) {
    const store = getWeatherStore();
    const card = store.snapshot?.cards?.find((entry) => entry.airport.slug === slug) ?? null;
    return {
        card: card
            ? {
                ...card,
                laterHighDeltaBreakdown: await (0, later_high_delta_breakdown_1.buildLaterHighDeltaBreakdown)(card),
            }
            : null,
        error: null,
        responseIssuedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=store.js.map