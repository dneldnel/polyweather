import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AIRPORTS } from "../airports";
import type { AirportConfig } from "../types";
import {
  deleteAviationObservationWindow,
  deletePolymarketDayWindow,
  deleteWundergroundObservationWindow,
  getComparisonDatabaseUrl,
  getEarliestUnresolvedPolymarketDate,
  getLatestStoredComparisonResumeDate,
  upsertAviationObservations,
  upsertPolymarketDays,
  upsertWundergroundObservations,
} from "./db";
import { rebuildWundergroundFutureHighHourlyStatsForCity } from "./future-high-stats";
import { getEarliestResolvedComparisonDay } from "./history-coverage";
import type {
  ComparisonBucket,
  ComparisonSyncProgressEvent,
  ComparisonSyncProgressStage,
  ComparisonSyncSummary,
  StoredAviationObservation,
  StoredPolymarketDay,
  StoredWundergroundObservation,
} from "./types";

const AVIATION_WEATHER_BASE_URL = "https://aviationweather.gov/api/data/metar";
const POLYMARKET_EVENT_BY_SLUG_URL = "https://gamma-api.polymarket.com/events/slug";
const WEATHER_COM_HISTORY_BASE_URL = "https://api.weather.com/v1";
const WEATHER_COM_PUBLIC_API_KEY =
  process.env.WUNDERGROUND_SUN_API_KEY ?? "e1f10a1e78da46f5b10a1e78da96f525";
const AVIATION_WEATHER_ARCHIVE_DAYS = 31;
const AVIATION_WEATHER_WINDOW_DAYS = 7;
const WUNDERGROUND_HISTORY_WINDOW_DAYS = 14;
const COMPARISON_SYNC_REFRESH_LOOKBACK_DAYS = 7;
const USER_AGENT = "polyweather/0.1 (+https://github.com/openai/codex)";

const execFileAsync = promisify(execFile);

type ComparisonCitySyncResult = {
  wuObservationPointsUpserted: number;
  awObservationPointsUpserted: number;
  polymarketDaysUpserted: number;
  futureHighStatBucketsWritten: number;
};

type ComparisonSyncRunOptions = {
  onProgress?: (event: ComparisonSyncProgressEvent) => void;
};

export type ComparisonCurrentDaySyncTarget = {
  config: AirportConfig;
  startDate: string;
  endDate: string;
  startReason:
    | "latest-stored-day"
    | "earliest-resolved-day"
    | "earliest-unresolved-day"
    | "recent-lookback-day";
};

export type ComparisonCurrentDaySyncPlan = {
  cityFilter: string | null;
  targets: ComparisonCurrentDaySyncTarget[];
  startDate: string;
  endDate: string;
  scopeLabel: string;
};

type ComparisonSyncCityProgressContext = {
  totalCities: number;
  cityIndex: number;
  completedCities: number;
  onProgress?: (event: ComparisonSyncProgressEvent) => void;
};

type MarketUnit = "C" | "F";
type AviationWeatherMetar = {
  reportTime?: string;
  obsTime?: number;
  temp?: number;
};
type WundergroundObservation = {
  valid_time_gmt?: number;
  temp?: number;
  max_temp?: number | null;
};
type WundergroundHistoryResponse = {
  observations?: WundergroundObservation[];
};
type PolymarketMarket = {
  groupItemTitle?: string;
  outcomePrices?: string;
};
type PolymarketEvent = {
  slug?: string;
  resolutionSource?: string;
  markets?: PolymarketMarket[];
};
type FetchedPolymarketDay =
  | {
      date: string;
      slug: string;
      winner: ComparisonBucket | null;
      status: "resolved" | "unresolved";
      resolutionSource: string | null;
    }
  | {
      date: string;
      slug: string;
      winner: null;
      status: "missing";
      resolutionSource: null;
    };

function logProgress(message: string) {
  console.error(`[${new Date().toISOString()}] ${message}`);
}

function clampProgressFraction(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

function emitProgress(
  options: ComparisonSyncRunOptions | ComparisonSyncCityProgressContext | undefined,
  event: ComparisonSyncProgressEvent,
) {
  logProgress(event.message);
  options?.onProgress?.({
    ...event,
    progressFraction: clampProgressFraction(event.progressFraction),
  });
}

export function shiftDate(date: string, offsetDays: number) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
  return cursor.toISOString().slice(0, 10);
}

function enumerateDates(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const stop = new Date(`${endDate}T00:00:00Z`);

  while (cursor.getTime() <= stop.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function enumerateDateWindows(startDate: string, endDate: string, windowDays: number) {
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const windowEnd = shiftDate(cursor, windowDays - 1);
    const boundedEnd = windowEnd < endDate ? windowEnd : endDate;
    windows.push({
      startDate: cursor,
      endDate: boundedEnd,
    });
    cursor = shiftDate(boundedEnd, 1);
  }

  return windows;
}

function getAviationObservationWindows(startDate: string, endDate: string) {
  const earliestArchiveDate = shiftDate(todayInTimezone("UTC"), -(AVIATION_WEATHER_ARCHIVE_DAYS - 1));
  const effectiveStartDate = startDate < earliestArchiveDate ? earliestArchiveDate : startDate;

  if (effectiveStartDate > endDate) {
    return [];
  }

  return enumerateDateWindows(effectiveStartDate, endDate, AVIATION_WEATHER_WINDOW_DAYS);
}

function getWundergroundObservationWindows(startDate: string, endDate: string) {
  return enumerateDateWindows(startDate, endDate, WUNDERGROUND_HISTORY_WINDOW_DAYS);
}

export function formatDateInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not format date in timezone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

function formatDateTimeInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const second = parts.find((part) => part.type === "second")?.value;
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;

  if (!year || !month || !day || !hour || !minute || !second || !offset) {
    throw new Error(`Could not format date-time in timezone ${timeZone}`);
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${offset}`;
}

export function todayInTimezone(timeZone: string) {
  return formatDateInTimezone(new Date(), timeZone);
}

function matchesCityFilter(config: AirportConfig, filter: string) {
  return (
    config.city.toLowerCase() === filter ||
    config.slug.toLowerCase() === filter ||
    config.stationIcao.toLowerCase() === filter
  );
}

export function resolveComparisonCityConfigs(cityFilter: string | null) {
  const normalizedCityFilter = cityFilter?.toLowerCase() ?? null;
  const configs = normalizedCityFilter
    ? AIRPORTS.filter((config) => matchesCityFilter(config, normalizedCityFilter))
    : AIRPORTS;

  if (configs.length === 0) {
    throw new Error(`No city matched --city ${cityFilter}`);
  }

  return configs;
}

function describeWindow(startDate: string, endDate: string, cityFilter: string | null) {
  return `${startDate}..${endDate}${cityFilter ? ` city=${cityFilter}` : ""}`;
}

function getMinDate(values: string[]) {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  const earliest = sorted[0];
  if (!earliest) {
    throw new Error("Expected at least one comparison sync date");
  }

  return earliest;
}

function getMaxDate(values: string[]) {
  const sorted = [...values].sort((left, right) => right.localeCompare(left));
  const latest = sorted[0];
  if (!latest) {
    throw new Error("Expected at least one comparison sync date");
  }

  return latest;
}

function getBoundedRecentLookbackStartDate(earliestResolvedDate: string, endDate: string) {
  const recentLookbackStartDate = shiftDate(endDate, -COMPARISON_SYNC_REFRESH_LOOKBACK_DAYS);
  return recentLookbackStartDate < earliestResolvedDate
    ? earliestResolvedDate
    : recentLookbackStartDate;
}

function chooseCurrentDaySyncStart(params: {
  earliestResolvedDate: string;
  earliestUnresolvedPolymarketDate: string | null;
  endDate: string;
  latestStoredResumeDate: string | null;
}): Pick<ComparisonCurrentDaySyncTarget, "startDate" | "startReason"> {
  if (!params.latestStoredResumeDate) {
    return {
      startDate: params.earliestResolvedDate,
      startReason: "earliest-resolved-day",
    };
  }

  const candidates: Array<Pick<ComparisonCurrentDaySyncTarget, "startDate" | "startReason">> = [
    {
      startDate: params.latestStoredResumeDate,
      startReason: "latest-stored-day",
    },
    {
      startDate: getBoundedRecentLookbackStartDate(params.earliestResolvedDate, params.endDate),
      startReason: "recent-lookback-day",
    },
  ];

  if (params.earliestUnresolvedPolymarketDate) {
    candidates.push({
      startDate:
        params.earliestUnresolvedPolymarketDate < params.earliestResolvedDate
          ? params.earliestResolvedDate
          : params.earliestUnresolvedPolymarketDate,
      startReason: "earliest-unresolved-day",
    });
  }

  return candidates.sort((left, right) => left.startDate.localeCompare(right.startDate))[0]!;
}

function describeCurrentDaySyncTarget(target: ComparisonCurrentDaySyncTarget) {
  const reasonLabel =
    target.startReason === "latest-stored-day"
      ? "resume from latest stored day"
      : target.startReason === "earliest-unresolved-day"
        ? "refresh from earliest unresolved Polymarket day"
        : target.startReason === "recent-lookback-day"
          ? `refresh last ${COMPARISON_SYNC_REFRESH_LOOKBACK_DAYS} days`
          : "earliest resolved day -> current local day";

  return `${target.startDate}..${target.endDate} · ${target.config.slug} (${reasonLabel})`;
}

function buildCurrentDaySyncScopeLabel(targets: ComparisonCurrentDaySyncTarget[]) {
  if (targets.length === 1) {
    const [target] = targets;
    return describeCurrentDaySyncTarget(target);
  }

  const earliestResolvedTargetCount = targets.filter(
    (target) => target.startReason === "earliest-resolved-day",
  ).length;

  if (earliestResolvedTargetCount === targets.length) {
    return "Per-city earliest resolved day..current local day · all cities";
  }

  return `Per-city unresolved/recent-${COMPARISON_SYNC_REFRESH_LOOKBACK_DAYS}-day refresh..current local day · all cities`;
}

export async function createComparisonCurrentDaySyncPlan(cityFilter: string | null) {
  const normalizedCityFilter = cityFilter?.trim() || null;
  const configs = resolveComparisonCityConfigs(normalizedCityFilter);
  const targets = await Promise.all(
    configs.map(async (config) => {
      const earliestResolvedDate = getEarliestResolvedComparisonDay(config.slug);
      if (!earliestResolvedDate) {
        throw new Error(`Missing earliest resolved comparison day for city ${config.slug}`);
      }

      const [latestStoredResumeDate, earliestUnresolvedPolymarketDate] = await Promise.all([
        getLatestStoredComparisonResumeDate(config.slug),
        getEarliestUnresolvedPolymarketDate(config.slug),
      ]);
      const endDate = formatDateInTimezone(new Date(), config.timezone);
      const { startDate, startReason } = chooseCurrentDaySyncStart({
        earliestResolvedDate,
        earliestUnresolvedPolymarketDate,
        endDate,
        latestStoredResumeDate,
      });
      if (startDate > endDate) {
        throw new Error(
          `City ${config.slug} has resume date ${startDate} after current local date ${endDate}`,
        );
      }

      return {
        config,
        startDate,
        endDate,
        startReason,
      } satisfies ComparisonCurrentDaySyncTarget;
    }),
  );

  return {
    cityFilter: normalizedCityFilter,
    targets,
    startDate: getMinDate(targets.map((target) => target.startDate)),
    endDate: getMaxDate(targets.map((target) => target.endDate)),
    scopeLabel: buildCurrentDaySyncScopeLabel(targets),
  } satisfies ComparisonCurrentDaySyncPlan;
}

async function fetchJson<T>(url: URL | string): Promise<T> {
  const target = url.toString();
  const args = [
    "-sS",
    "-L",
    "--fail",
    "--retry",
    "2",
    "--retry-all-errors",
    "--retry-delay",
    "1",
    "--max-time",
    "30",
    "--user-agent",
    USER_AGENT,
    "--header",
    "accept: application/json",
    target,
  ];

  const errors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("curl", args, {
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      });
      return JSON.parse(stdout) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`attempt ${attempt}: ${message}`);
    }
  }

  throw new Error(`Request failed for ${target}: ${errors.join(" | ")}`);
}

async function fetchJsonAllow404<T>(url: URL | string): Promise<T | null> {
  const target = url.toString();
  const args = [
    "-sS",
    "-L",
    "--retry",
    "2",
    "--retry-all-errors",
    "--retry-delay",
    "1",
    "--max-time",
    "30",
    "--user-agent",
    USER_AGENT,
    "--header",
    "accept: application/json",
    "--write-out",
    "\\n%{http_code}",
    target,
  ];

  const errors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("curl", args, {
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      });

      const splitAt = stdout.lastIndexOf("\n");
      if (splitAt === -1) {
        throw new Error(`Unexpected curl response without status trailer for ${target}`);
      }

      const body = stdout.slice(0, splitAt);
      const statusCode = Number(stdout.slice(splitAt + 1).trim());
      if (!Number.isFinite(statusCode)) {
        throw new Error(`Could not parse HTTP status for ${target}`);
      }

      if (statusCode === 404) {
        return null;
      }

      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`HTTP ${statusCode} for ${target}`);
      }

      return JSON.parse(body) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`attempt ${attempt}: ${message}`);
    }
  }

  throw new Error(`Request failed for ${target}: ${errors.join(" | ")}`);
}

function formatAviationWeatherAnchor(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}`;
}

function buildAviationWeatherUrl(
  stationIcao: string,
  hoursBack: number,
  options?: { endDateUtc?: Date },
) {
  const url = new URL(AVIATION_WEATHER_BASE_URL);
  url.searchParams.set("ids", stationIcao);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", String(hoursBack));
  if (options?.endDateUtc) {
    url.searchParams.set("date", formatAviationWeatherAnchor(options.endDateUtc));
  }
  return url;
}

function buildEventSlug(slugToken: string, date: string) {
  const utcDate = new Date(`${date}T00:00:00Z`);
  const month = utcDate.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  }).toLowerCase();
  const day = utcDate.getUTCDate();
  const year = utcDate.getUTCFullYear();
  return `highest-temperature-in-${slugToken}-on-${month}-${day}-${year}`;
}

function buildWeatherComUrl(locationId: string, startDate: string, endDate: string, units: "e" | "m") {
  return `${WEATHER_COM_HISTORY_BASE_URL}/location/${locationId}/observations/historical.json?units=${units}&startDate=${startDate.replaceAll("-", "")}&endDate=${endDate.replaceAll("-", "")}&apiKey=${WEATHER_COM_PUBLIC_API_KEY}`;
}

function parseYesOutcomePrice(outcomePrices: string | undefined) {
  if (!outcomePrices) {
    return null;
  }

  try {
    const parsed = JSON.parse(outcomePrices) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return String(parsed[0]);
  } catch {
    return null;
  }
}

function parseBucketResolution(input: string | undefined): ComparisonBucket | null {
  if (!input) {
    return null;
  }

  const range = input.match(/^(-?\d+)\s*-\s*(-?\d+)\s*°([CF])$/i);
  if (range) {
    return {
      kind: "range",
      raw: input,
      minValue: Number(range[1]),
      maxValue: Number(range[2]),
      unit: range[3].toUpperCase() as MarketUnit,
    };
  }

  const exact = input.match(/^(-?\d+)\s*°([CF])$/i);
  if (exact) {
    return {
      kind: "exact",
      raw: input,
      value: Number(exact[1]),
      unit: exact[2].toUpperCase() as MarketUnit,
    };
  }

  const atMost = input.match(/^(-?\d+)\s*°([CF])\s+or\s+(?:below|lower|less)$/i);
  if (atMost) {
    return {
      kind: "at-most",
      raw: input,
      value: Number(atMost[1]),
      unit: atMost[2].toUpperCase() as MarketUnit,
    };
  }

  const atLeast = input.match(/^(-?\d+)\s*°([CF])\s+or\s+(?:above|higher|more)$/i);
  if (atLeast) {
    return {
      kind: "at-least",
      raw: input,
      value: Number(atLeast[1]),
      unit: atLeast[2].toUpperCase() as MarketUnit,
    };
  }

  return {
    kind: "unknown",
    raw: input,
  };
}

async function fetchPolymarketDay(config: AirportConfig, date: string): Promise<FetchedPolymarketDay> {
  const slug = buildEventSlug(config.slug, date);
  const url = `${POLYMARKET_EVENT_BY_SLUG_URL}/${slug}`;
  const event = await fetchJsonAllow404<PolymarketEvent>(url);

  if (!event) {
    return {
      date,
      slug,
      winner: null,
      status: "missing",
      resolutionSource: null,
    };
  }

  const winningMarket = (event.markets ?? []).find(
    (market) => parseYesOutcomePrice(market.outcomePrices) === "1",
  );

  return {
    date,
    slug,
    winner: parseBucketResolution(winningMarket?.groupItemTitle),
    status: winningMarket ? "resolved" : "unresolved",
    resolutionSource: event.resolutionSource ?? null,
  };
}

function getAviationObservationDate(row: AviationWeatherMetar) {
  if (typeof row.obsTime === "number") {
    const observedAt = new Date(row.obsTime * 1000);
    if (!Number.isNaN(observedAt.getTime())) {
      return observedAt;
    }
  }

  if (typeof row.reportTime === "string") {
    const reportedAt = new Date(row.reportTime);
    if (!Number.isNaN(reportedAt.getTime())) {
      return reportedAt;
    }
  }

  return null;
}

async function fetchAviationObservationRowsForWindow(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  fetchedAt: string,
) {
  const startUtc = new Date(`${startDate}T00:00:00Z`);
  const windowEndExclusive = new Date(`${shiftDate(endDate, 1)}T00:00:00Z`);
  const hoursBack = Math.max(
    24,
    Math.ceil((windowEndExclusive.getTime() - startUtc.getTime()) / (60 * 60 * 1000)) + 48,
  );
  const url = buildAviationWeatherUrl(config.stationIcao, hoursBack, {
    endDateUtc: windowEndExclusive,
  });
  const rows = await fetchJson<AviationWeatherMetar[]>(url);
  const uniqueRows = new Map<string, StoredAviationObservation>();

  for (const row of rows) {
    if (typeof row.temp !== "number") {
      continue;
    }

    const observationTime = getAviationObservationDate(row);
    if (!observationTime) {
      continue;
    }

    const localDate = formatDateInTimezone(observationTime, config.timezone);
    if (localDate < startDate || localDate > endDate) {
      continue;
    }

    const observedAtUtc = observationTime.toISOString();
    uniqueRows.set(observedAtUtc, {
      citySlug: config.slug,
      localDate,
      stationIcao: config.stationIcao,
      observedAtUtc,
      observedAtLocal: formatDateTimeInTimezone(observationTime, config.timezone),
      reportTimeRaw: row.reportTime ?? null,
      tempC: row.temp,
      fetchedAt,
    });
  }

  return [...uniqueRows.values()].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
}

async function fetchAviationObservationRowsForCity(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  fetchedAt: string,
  options?: {
    onWindowComplete?: (window: { startDate: string; endDate: string }, index: number, total: number) => void;
  },
) {
  const windows = getAviationObservationWindows(startDate, endDate);
  const rowsByObservedAtUtc = new Map<string, StoredAviationObservation>();

  for (const [index, window] of windows.entries()) {
    const rows = await fetchAviationObservationRowsForWindow(
      config,
      window.startDate,
      window.endDate,
      fetchedAt,
    );
    options?.onWindowComplete?.(window, index + 1, windows.length);

    for (const row of rows) {
      rowsByObservedAtUtc.set(row.observedAtUtc, row);
    }
  }

  return [...rowsByObservedAtUtc.values()].sort((left, right) =>
    left.observedAtUtc.localeCompare(right.observedAtUtc),
  );
}

async function fetchWundergroundObservationRowsForWindow(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  fetchedAt: string,
) {
  const locationId = `${config.stationIcao}:9:${config.countryCode}`;
  const imperialUrl = buildWeatherComUrl(locationId, startDate, endDate, "e");
  const metricUrl = buildWeatherComUrl(locationId, startDate, endDate, "m");
  const [imperialPayload, metricPayload] = await Promise.all([
    fetchJson<WundergroundHistoryResponse>(imperialUrl),
    fetchJson<WundergroundHistoryResponse>(metricUrl),
  ]);

  const byTimestamp = new Map<
    number,
    {
      imperial: WundergroundObservation | null;
      metric: WundergroundObservation | null;
    }
  >();

  for (const row of imperialPayload.observations ?? []) {
    if (typeof row.valid_time_gmt !== "number") {
      continue;
    }

    const existing = byTimestamp.get(row.valid_time_gmt) ?? { imperial: null, metric: null };
    existing.imperial = row;
    byTimestamp.set(row.valid_time_gmt, existing);
  }

  for (const row of metricPayload.observations ?? []) {
    if (typeof row.valid_time_gmt !== "number") {
      continue;
    }

    const existing = byTimestamp.get(row.valid_time_gmt) ?? { imperial: null, metric: null };
    existing.metric = row;
    byTimestamp.set(row.valid_time_gmt, existing);
  }

  const rows: StoredWundergroundObservation[] = [];
  const orderedTimes = [...byTimestamp.keys()].sort((left, right) => left - right);

  for (const validTimeGmt of orderedTimes) {
    const observation = byTimestamp.get(validTimeGmt);
    if (!observation) {
      continue;
    }

    const observedAt = new Date(validTimeGmt * 1000);
    if (Number.isNaN(observedAt.getTime())) {
      continue;
    }

    const localDate = formatDateInTimezone(observedAt, config.timezone);
    if (localDate < startDate || localDate > endDate) {
      continue;
    }

    rows.push({
      citySlug: config.slug,
      localDate,
      stationIcao: config.stationIcao,
      locationId,
      observedAtUtc: observedAt.toISOString(),
      observedAtLocal: formatDateTimeInTimezone(observedAt, config.timezone),
      tempF: typeof observation.imperial?.temp === "number" ? observation.imperial.temp : null,
      tempC: typeof observation.metric?.temp === "number" ? observation.metric.temp : null,
      maxTempF:
        typeof observation.imperial?.max_temp === "number" ? observation.imperial.max_temp : null,
      maxTempC:
        typeof observation.metric?.max_temp === "number" ? observation.metric.max_temp : null,
      requestUrlImperial: imperialUrl,
      requestUrlMetric: metricUrl,
      fetchedAt,
    });
  }

  return rows;
}

async function fetchWundergroundObservationRowsForCity(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  fetchedAt: string,
  options?: {
    onWindowComplete?: (window: { startDate: string; endDate: string }, index: number, total: number) => void;
  },
) {
  const windows = getWundergroundObservationWindows(startDate, endDate);
  const rowsByObservedAtUtc = new Map<string, StoredWundergroundObservation>();

  for (const [index, window] of windows.entries()) {
    const rows = await fetchWundergroundObservationRowsForWindow(
      config,
      window.startDate,
      window.endDate,
      fetchedAt,
    );
    options?.onWindowComplete?.(window, index + 1, windows.length);

    for (const row of rows) {
      rowsByObservedAtUtc.set(row.observedAtUtc, row);
    }
  }

  return [...rowsByObservedAtUtc.values()].sort((left, right) =>
    left.observedAtUtc.localeCompare(right.observedAtUtc),
  );
}

async function fetchPolymarketDayRowsForCity(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  fetchedAt: string,
  options?: {
    onComplete?: (daysFetched: number) => void;
  },
) {
  const days = await Promise.all(
    enumerateDates(startDate, endDate).map((date) => fetchPolymarketDay(config, date)),
  );
  options?.onComplete?.(days.length);

  return days
    .filter((day): day is Exclude<FetchedPolymarketDay, { status: "missing" }> => day.status !== "missing")
    .map(
      (day) =>
        ({
          citySlug: config.slug,
          localDate: day.date,
          slug: day.slug,
          status: day.status,
          winner: day.winner,
          resolutionSource: day.resolutionSource,
          fetchedAt,
        }) satisfies StoredPolymarketDay,
    );
}

async function syncComparisonCity(
  config: AirportConfig,
  startDate: string,
  endDate: string,
  progressContext: ComparisonSyncCityProgressContext,
): Promise<ComparisonCitySyncResult> {
  const fetchedAt = new Date().toISOString();
  const totalFetchUnits =
    getWundergroundObservationWindows(startDate, endDate).length +
    getAviationObservationWindows(startDate, endDate).length +
    1;
  let completedFetchUnits = 0;
  const emitCityProgress = (
    stage: ComparisonSyncProgressStage,
    message: string,
    phaseProgress: number,
  ) => {
    emitProgress(progressContext, {
      stage,
      message,
      totalCities: progressContext.totalCities,
      cityIndex: progressContext.cityIndex,
      completedCities: progressContext.completedCities,
      citySlug: config.slug,
      city: config.city,
      progressFraction:
        (progressContext.completedCities + clampProgressFraction(phaseProgress)) /
        Math.max(progressContext.totalCities, 1),
    });
  };
  const emitFetchProgress = (message: string) => {
    const fetchPhaseProgress =
      totalFetchUnits === 0 ? 0.6 : 0.1 + (completedFetchUnits / totalFetchUnits) * 0.5;
    emitCityProgress("fetching", message, fetchPhaseProgress);
  };

  emitCityProgress("fetching", `${config.city}: fetching WU, AW, and Polymarket history`, 0.05);
  const [wuRows, awRows, polymarketRows] = await Promise.all([
    fetchWundergroundObservationRowsForCity(config, startDate, endDate, fetchedAt, {
      onWindowComplete: (window, index, total) => {
        completedFetchUnits += 1;
        emitFetchProgress(
          `${config.city}: fetched WU window ${window.startDate}..${window.endDate} (${index}/${total})`,
        );
      },
    }),
    fetchAviationObservationRowsForCity(config, startDate, endDate, fetchedAt, {
      onWindowComplete: (window, index, total) => {
        completedFetchUnits += 1;
        emitFetchProgress(
          `${config.city}: fetched AW window ${window.startDate}..${window.endDate} (${index}/${total})`,
        );
      },
    }),
    fetchPolymarketDayRowsForCity(config, startDate, endDate, fetchedAt, {
      onComplete: (daysFetched) => {
        completedFetchUnits += 1;
        emitFetchProgress(
          `${config.city}: fetched Polymarket outcomes for ${daysFetched} day${daysFetched === 1 ? "" : "s"}`,
        );
      },
    }),
  ]);

  emitCityProgress(
    "persisting",
    `${config.city}: persisting ${wuRows.length} WU points, ${awRows.length} AW points, ${polymarketRows.length} market days`,
    0.72,
  );
  await deleteWundergroundObservationWindow({
    citySlug: config.slug,
    startDate,
    endDate,
  });
  await deleteAviationObservationWindow({
    citySlug: config.slug,
    startDate,
    endDate,
  });
  await deletePolymarketDayWindow({
    citySlug: config.slug,
    startDate,
    endDate,
  });
  const wuObservationPointsUpserted = await upsertWundergroundObservations(wuRows);
  const awObservationPointsUpserted = await upsertAviationObservations(awRows);
  const polymarketDaysUpserted = await upsertPolymarketDays(polymarketRows);
  emitCityProgress(
    "rebuilding-future-high-stats",
    `${config.city}: rebuilding WU future-high hourly buckets`,
    0.88,
  );
  const futureHighStatsResult = await rebuildWundergroundFutureHighHourlyStatsForCity(config.slug);
  emitCityProgress(
    "rebuilding-future-high-stats",
    `${config.city}: rebuilt ${futureHighStatsResult.recordsWritten} WU future-high hourly buckets`,
    0.98,
  );

  return {
    wuObservationPointsUpserted,
    awObservationPointsUpserted,
    polymarketDaysUpserted,
    futureHighStatBucketsWritten: futureHighStatsResult.recordsWritten,
  };
}

export async function runComparisonSync(params: {
  startDate: string;
  endDate: string;
  cityFilter: string | null;
}, options: ComparisonSyncRunOptions = {}) {
  const configs = resolveComparisonCityConfigs(params.cityFilter);
  const summary: ComparisonSyncSummary = {
    generatedAt: new Date().toISOString(),
    startDate: params.startDate,
    endDate: params.endDate,
    cityFilter: params.cityFilter,
    scopeLabel: null,
    databaseUrl: getComparisonDatabaseUrl(),
    citiesProcessed: configs.length,
    polymarketDaysUpserted: 0,
    wuObservationPointsUpserted: 0,
    awObservationPointsUpserted: 0,
    futureHighStatBucketsWritten: 0,
  };

  emitProgress(options, {
    stage: "starting",
    message:
      `Starting comparison sync for ${describeWindow(summary.startDate, summary.endDate, summary.cityFilter)}` +
      ` across ${configs.length} ${configs.length === 1 ? "city" : "cities"}`,
    totalCities: configs.length,
    cityIndex: null,
    completedCities: 0,
    citySlug: null,
    city: null,
    progressFraction: 0,
  });

  for (const [index, config] of configs.entries()) {
    const result = await syncComparisonCity(config, params.startDate, params.endDate, {
      totalCities: configs.length,
      cityIndex: index + 1,
      completedCities: index,
      onProgress: options.onProgress,
    });
    summary.polymarketDaysUpserted += result.polymarketDaysUpserted;
    summary.wuObservationPointsUpserted += result.wuObservationPointsUpserted;
    summary.awObservationPointsUpserted += result.awObservationPointsUpserted;
    summary.futureHighStatBucketsWritten += result.futureHighStatBucketsWritten;
  }

  emitProgress(options, {
    stage: "completed",
    message: `Saved raw comparison data ${describeWindow(
      summary.startDate,
      summary.endDate,
      summary.cityFilter,
    )}`,
    totalCities: configs.length,
    cityIndex: null,
    completedCities: configs.length,
    citySlug: null,
    city: null,
    progressFraction: 1,
  });

  return summary;
}

export async function runComparisonCurrentDaySync(
  plan: ComparisonCurrentDaySyncPlan,
  options: ComparisonSyncRunOptions = {},
) {
  const summary: ComparisonSyncSummary = {
    generatedAt: new Date().toISOString(),
    startDate: plan.startDate,
    endDate: plan.endDate,
    cityFilter: plan.cityFilter,
    scopeLabel: plan.scopeLabel,
    databaseUrl: getComparisonDatabaseUrl(),
    citiesProcessed: plan.targets.length,
    polymarketDaysUpserted: 0,
    wuObservationPointsUpserted: 0,
    awObservationPointsUpserted: 0,
    futureHighStatBucketsWritten: 0,
  };

  emitProgress(options, {
    stage: "starting",
    message: `Starting comparison sync for ${plan.scopeLabel}`,
    totalCities: plan.targets.length,
    cityIndex: null,
    completedCities: 0,
    citySlug: null,
    city: null,
    progressFraction: 0,
  });

  for (const [index, target] of plan.targets.entries()) {
    const result = await syncComparisonCity(target.config, target.startDate, target.endDate, {
      totalCities: plan.targets.length,
      cityIndex: index + 1,
      completedCities: index,
      onProgress: options.onProgress,
    });
    summary.polymarketDaysUpserted += result.polymarketDaysUpserted;
    summary.wuObservationPointsUpserted += result.wuObservationPointsUpserted;
    summary.awObservationPointsUpserted += result.awObservationPointsUpserted;
    summary.futureHighStatBucketsWritten += result.futureHighStatBucketsWritten;
  }

  emitProgress(options, {
    stage: "completed",
    message: `Saved raw comparison data ${plan.scopeLabel}`,
    totalCities: plan.targets.length,
    cityIndex: null,
    completedCities: plan.targets.length,
    citySlug: null,
    city: null,
    progressFraction: 1,
  });

  return summary;
}

export function renderComparisonSyncSummary(summary: ComparisonSyncSummary) {
  const lines: string[] = [];
  lines.push(
    `Saved raw comparison data ${summary.scopeLabel ?? describeWindow(summary.startDate, summary.endDate, summary.cityFilter)}`,
  );
  if (summary.scopeLabel) {
    lines.push(`Overall date span: ${describeWindow(summary.startDate, summary.endDate, summary.cityFilter)}`);
  }
  lines.push(`Database: ${summary.databaseUrl}`);
  lines.push(`Cities processed: ${summary.citiesProcessed}`);
  lines.push(`Polymarket days upserted: ${summary.polymarketDaysUpserted}`);
  lines.push(`WU observation points upserted: ${summary.wuObservationPointsUpserted}`);
  lines.push(`AW observation points upserted: ${summary.awObservationPointsUpserted}`);
  lines.push(`WU future-high buckets written: ${summary.futureHighStatBucketsWritten}`);

  return `${lines.join("\n")}\n`;
}
