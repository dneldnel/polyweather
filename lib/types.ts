export type RefreshState = "idle" | "refreshing" | "error";
export type SourceStatus = "fresh" | "stale" | "error" | "missing";
export type TemperatureUnit = "C" | "F";

export type AirportConfig = {
  slug: string;
  city: string;
  airportName: string;
  stationIcao: string;
  countryCode: string;
  timezone: string;
  latitude: number;
  longitude: number;
};

export type SourceReading = {
  sourceId: string;
  sourceLabel: string;
  value: number | null;
  unit: TemperatureUnit | null;
  observedAt: string | null;
  forecastDate: string | null;
  fetchedAt: string | null;
  status: SourceStatus;
  error: string | null;
};

export type TemperatureTrendPoint = {
  observedAt: string;
  temperature: number;
};

export type TemperatureTrend = {
  sourceId: string;
  sourceLabel: string;
  localDate: string | null;
  points: TemperatureTrendPoint[];
  fetchedAt: string | null;
  status: SourceStatus;
  error: string | null;
};

export type WeatherSignalPoint = {
  forecastAt: string;
  temperature: number | null;
  precipitationProbability: number | null;
  cloudCover: number | null;
  windSpeed: number | null;
};

export type WeatherSignals = {
  sourceId: string;
  sourceLabel: string;
  modelRunInitialisedAt: string | null;
  publishedAt: string | null;
  weatherCode: number | null;
  isDay: boolean | null;
  sunrise: string | null;
  sunset: string | null;
  daylightDurationSeconds: number | null;
  cloudCover: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  observedAt: string | null;
  fetchedAt: string | null;
  status: SourceStatus;
  error: string | null;
  nextHours: WeatherSignalPoint[];
};

export type WeatherSignalsBySource = Record<string, WeatherSignals>;

export type WeatherSummarySignals = {
  sourceId: string;
  weatherCode: number | null;
  isDay: boolean | null;
  sunset: string | null;
  cloudCover: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  status: SourceStatus;
  error: string | null;
};

export type OpenMeteoTodayHighReadings = {
  ecmwf: SourceReading;
  gfs: SourceReading;
  highPrecision: SourceReading | null;
};

export type HistoryBasedLaterHighBucket = {
  hour: number;
  probability: number;
  sampleCount: number;
  futureHigherCount: number;
  eligibleDayCount: number;
};

export type HistoryBasedLaterHighCurve = {
  generatedAt: string | null;
  method: string | null;
  buckets: HistoryBasedLaterHighBucket[];
  status: SourceStatus;
  error: string | null;
};

export type WeatherCard = {
  airport: AirportConfig;
  cardUpdatedAt: string | null;
  latestResolvedComparisonDate: string | null;
  wuCurrent: SourceReading;
  wuTodayHigh: SourceReading;
  historyBasedLaterHigh: HistoryBasedLaterHighCurve;
  aviationWeatherCurrent: SourceReading;
  aviationWeatherTrend: TemperatureTrend;
  defaultWeatherSignalsSourceId: string;
  weatherSignalsBySource: WeatherSignalsBySource;
  openMeteoTodayHigh: OpenMeteoTodayHighReadings;
};

export type WeatherCardSummary = {
  airport: AirportConfig;
  cardUpdatedAt: string | null;
  wuCurrent: SourceReading;
  wuTodayHigh: SourceReading;
  aviationWeatherCurrent: SourceReading;
  defaultWeatherSignals: WeatherSummarySignals;
  openMeteoTodayHigh: OpenMeteoTodayHighReadings;
};

export type WeatherSnapshot = {
  refreshedAt: string | null;
  cards: WeatherCard[] | null;
  globalError: string | null;
};

export type WeatherSummarySnapshot = {
  refreshedAt: string | null;
  cards: WeatherCardSummary[] | null;
  globalError: string | null;
};

export type WeatherResponse = WeatherSummarySnapshot & {
  refreshState: RefreshState;
  refreshingCardSlugs: string[];
  responseIssuedAt: string;
};

export type WeatherCardDetailResponse = {
  card: WeatherCard | null;
  error: string | null;
  responseIssuedAt: string;
};
