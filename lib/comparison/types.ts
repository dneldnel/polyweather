import type { AirportConfig, TemperatureUnit } from "../types";

export type ComparisonBucketUnit = "C" | "F";

export type ComparisonBucket =
  | { kind: "exact"; raw: string; value: number; unit: ComparisonBucketUnit }
  | { kind: "range"; raw: string; minValue: number; maxValue: number; unit: ComparisonBucketUnit }
  | { kind: "at-most"; raw: string; value: number; unit: ComparisonBucketUnit }
  | { kind: "at-least"; raw: string; value: number; unit: ComparisonBucketUnit }
  | { kind: "unknown"; raw: string };

export type ComparisonStatus =
  | "match"
  | "match-derived-f"
  | "boundary-match"
  | "mismatch"
  | "boundary-mismatch"
  | "missing-source-data"
  | "unresolved"
  | "missing-polymarket";

export type ComparisonPolymarketStatus = "resolved" | "unresolved" | "missing";

export type ComparisonPolymarketDay = {
  slug: string | null;
  status: ComparisonPolymarketStatus;
  winner: ComparisonBucket | null;
  resolutionSource: string | null;
};

export type ComparisonWundergroundSummary = {
  maxTempF: number | null;
  maxTempC: number | null;
  peakLocal: string | null;
  pointCount: number;
  requestUrl: string | null;
};

export type ComparisonAviationSummary = {
  maxTempC: number | null;
  maxTempFRounded: number | null;
  peakLocal: string | null;
  pointCount: number;
};

export type ComparisonDayRecord = {
  citySlug: string;
  localDate: string;
  airport: AirportConfig;
  polymarket: ComparisonPolymarketDay;
  wunderground: ComparisonWundergroundSummary;
  aviationWeather: ComparisonAviationSummary;
  comparisons: {
    wunderground: ComparisonStatus;
    aviationWeather: ComparisonStatus;
  };
};

export type ComparisonTemperaturePoint = {
  observedAt: string;
  temperatureC: number;
};

export type ComparisonDayDetail = {
  airport: AirportConfig;
  localDate: string;
  displayUnit: TemperatureUnit;
  polymarket: ComparisonPolymarketDay;
  wunderground: ComparisonWundergroundSummary & {
    points: ComparisonTemperaturePoint[];
  };
  aviationWeather: ComparisonAviationSummary & {
    points: ComparisonTemperaturePoint[];
  };
};

export type ComparisonCitySummary = {
  citySlug: string;
  city: string;
  stationIcao: string;
  resolvedDays: number;
  wundergroundMatches: number;
  wundergroundMismatches: number;
  aviationMatches: number;
  aviationMismatches: number;
  sourceAgreementDays: number;
  sourceDisagreementDays: number;
};

export type ComparisonCityReport = {
  airport: AirportConfig;
  summary: ComparisonCitySummary;
  rows: ComparisonDayRecord[];
};

export type ComparisonReport = {
  generatedAt: string;
  startDate: string;
  endDate: string;
  cityFilter: string | null;
  mode: "cached" | "raw-db";
  cities: ComparisonCityReport[];
};

export type ComparisonSyncSummary = {
  generatedAt: string;
  startDate: string;
  endDate: string;
  cityFilter: string | null;
  scopeLabel: string | null;
  databaseUrl: string;
  citiesProcessed: number;
  polymarketDaysUpserted: number;
  wuObservationPointsUpserted: number;
  awObservationPointsUpserted: number;
  futureHighStatBucketsWritten: number;
};

export type ComparisonSyncProgressStage =
  | "starting"
  | "fetching"
  | "persisting"
  | "rebuilding-future-high-stats"
  | "completed"
  | "failed";

export type ComparisonSyncMode = "selected-window" | "coverage-to-current-day";

export type ComparisonSyncProgressEvent = {
  stage: ComparisonSyncProgressStage;
  message: string;
  totalCities: number;
  cityIndex: number | null;
  completedCities: number;
  citySlug: string | null;
  city: string | null;
  progressFraction: number;
};

export type ComparisonSyncJobStatus = "running" | "completed" | "failed";

export type ComparisonSyncJobLogEntry = {
  timestamp: string;
  message: string;
};

export type ComparisonSyncJobSnapshot = {
  id: string;
  mode: ComparisonSyncMode;
  status: ComparisonSyncJobStatus;
  stage: ComparisonSyncProgressStage;
  requestedAt: string;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  startDate: string;
  endDate: string;
  cityFilter: string | null;
  scopeLabel: string | null;
  totalCities: number;
  completedCities: number;
  currentCitySlug: string | null;
  currentCity: string | null;
  progressPercent: number;
  stepLabel: string;
  recentMessages: ComparisonSyncJobLogEntry[];
  summary: ComparisonSyncSummary | null;
  error: string | null;
};

export type ComparisonSyncJobStartResponse = {
  job: ComparisonSyncJobSnapshot;
  reusedExistingJob: boolean;
};

export type ComparisonSyncJobLookupResponse = {
  job: ComparisonSyncJobSnapshot | null;
};

export type StoredWundergroundObservation = {
  citySlug: string;
  localDate: string;
  stationIcao: string;
  locationId: string;
  observedAtUtc: string;
  observedAtLocal: string;
  tempF: number | null;
  tempC: number | null;
  maxTempF: number | null;
  maxTempC: number | null;
  requestUrlImperial: string | null;
  requestUrlMetric: string | null;
  fetchedAt: string;
};

export type StoredWundergroundDaySummary = {
  citySlug: string;
  localDate: string;
  maxTempF: number | null;
  maxTempC: number | null;
  peakLocal: string | null;
  pointCount: number;
  requestUrl: string | null;
};

export type StoredAviationObservation = {
  citySlug: string;
  localDate: string;
  stationIcao: string;
  observedAtUtc: string;
  observedAtLocal: string;
  reportTimeRaw: string | null;
  tempC: number;
  fetchedAt: string;
};

export type StoredAviationDaySummary = {
  citySlug: string;
  localDate: string;
  maxTempC: number | null;
  peakLocal: string | null;
  pointCount: number;
};

export type StoredPolymarketDay = {
  citySlug: string;
  localDate: string;
  slug: string;
  status: Exclude<ComparisonPolymarketStatus, "missing">;
  winner: ComparisonBucket | null;
  resolutionSource: string | null;
  fetchedAt: string;
};

export type StoredWundergroundFutureHighHourlyStat = {
  citySlug: string;
  hourBucket: number;
  probability: number;
  sampleCount: number;
  futureHigherCount: number;
  eligibleDayCount: number;
  method: string;
  generatedAt: string;
};
