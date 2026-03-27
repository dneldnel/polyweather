import type { WeatherResponse, WeatherSnapshot, RefreshState } from "./types";

type WeatherStore = {
  snapshot: WeatherSnapshot | null;
  refreshState: RefreshState;
  refreshPromise: Promise<WeatherSnapshot> | null;
  cardRefreshPromises: Map<string, Promise<WeatherSnapshot>>;
  lastError: string | null;
};

declare global {
  var __polyweatherWebStore__: WeatherStore | undefined;
}

function createStore(): WeatherStore {
  return {
    snapshot: null,
    refreshState: "idle",
    refreshPromise: null,
    cardRefreshPromises: new Map(),
    lastError: null,
  };
}

export function getWeatherStore() {
  if (!globalThis.__polyweatherWebStore__) {
    globalThis.__polyweatherWebStore__ = createStore();
  }

  return globalThis.__polyweatherWebStore__;
}

export function buildWeatherResponse(): WeatherResponse {
  const store = getWeatherStore();

  return {
    refreshedAt: store.snapshot?.refreshedAt ?? null,
    cards: store.snapshot?.cards ?? null,
    globalError: store.snapshot?.globalError ?? store.lastError,
    refreshState: store.refreshState,
  };
}
