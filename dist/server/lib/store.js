"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeatherStore = getWeatherStore;
exports.buildWeatherResponse = buildWeatherResponse;
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
function buildWeatherResponse() {
    const store = getWeatherStore();
    return {
        refreshedAt: store.snapshot?.refreshedAt ?? null,
        cards: store.snapshot?.cards ?? null,
        globalError: store.snapshot?.globalError ?? store.lastError,
        refreshState: store.refreshState,
    };
}
//# sourceMappingURL=store.js.map