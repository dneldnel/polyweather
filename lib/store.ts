import type {
  RefreshState,
  WeatherCard,
  WeatherCardDetailResponse,
  WeatherCardSummary,
  WeatherResponse,
  WeatherSignals,
  WeatherSnapshot,
  WeatherSummarySignals,
} from "./types";

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

function getDefaultWeatherSignals(card: WeatherCard): WeatherSignals | null {
  const defaultSignals = card.weatherSignalsBySource?.[card.defaultWeatherSignalsSourceId];
  if (defaultSignals) {
    return defaultSignals;
  }

  const firstSignals = Object.values(card.weatherSignalsBySource ?? {})[0];
  if (firstSignals) {
    return firstSignals;
  }

  const legacySignals = (card as WeatherCard & { weatherSignals?: WeatherSignals }).weatherSignals;
  return legacySignals ?? null;
}

function buildWeatherSummarySignals(card: WeatherCard): WeatherSummarySignals {
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

function buildWeatherCardSummary(card: WeatherCard): WeatherCardSummary {
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

export function buildWeatherResponse(): WeatherResponse {
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

export function buildWeatherCardDetailResponse(slug: string): WeatherCardDetailResponse {
  const store = getWeatherStore();
  const card = store.snapshot?.cards?.find((entry) => entry.airport.slug === slug) ?? null;

  return {
    card,
    error: null,
    responseIssuedAt: new Date().toISOString(),
  };
}
