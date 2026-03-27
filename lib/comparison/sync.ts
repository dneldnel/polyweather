import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AIRPORTS } from "../airports";
import type { AirportConfig } from "../types";
import {
  deleteAviationObservationWindow,
  deletePolymarketDayWindow,
  deleteWundergroundObservationWindow,
  getComparisonDatabaseUrl,
  upsertAviationObservations,
  upsertPolymarketDays,
  upsertWundergroundObservations,
} from "./db";
import { rebuildWundergroundFutureHighHourlyStatsForCity } from "./future-high-stats";
import type {
  ComparisonBucket,
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
const USER_AGENT = "polyweather/0.1 (+https://github.com/openai/codex)";

const execFileAsync = promisify(execFile);

export type ComparisonSyncSummary = {
  generatedAt: string;
  startDate: string;
  endDate: string;
  cityFilter: string | null;
  databaseUrl: string;
  citiesProcessed: number;
  polymarketDaysUpserted: number;
  wuObservationPointsUpserted: number;
  awObservationPointsUpserted: number;
  futureHighStatBucketsWritten: number;
};

type ComparisonCitySyncResult = {
  wuObservationPointsUpserted: number;
  awObservationPointsUpserted: number;
  polymarketDaysUpserted: number;
  futureHighStatBucketsWritten: number;
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
) {
  const earliestArchiveDate = shiftDate(todayInTimezone("UTC"), -(AVIATION_WEATHER_ARCHIVE_DAYS - 1));
  const effectiveStartDate = startDate < earliestArchiveDate ? earliestArchiveDate : startDate;

  if (effectiveStartDate > endDate) {
    return [];
  }

  const windows = enumerateDateWindows(effectiveStartDate, endDate, AVIATION_WEATHER_WINDOW_DAYS);
  const rowsByObservedAtUtc = new Map<string, StoredAviationObservation>();

  for (const window of windows) {
    const rows = await fetchAviationObservationRowsForWindow(
      config,
      window.startDate,
      window.endDate,
      fetchedAt,
    );

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
) {
  const windows = enumerateDateWindows(startDate, endDate, WUNDERGROUND_HISTORY_WINDOW_DAYS);
  const rowsByObservedAtUtc = new Map<string, StoredWundergroundObservation>();

  for (const window of windows) {
    const rows = await fetchWundergroundObservationRowsForWindow(
      config,
      window.startDate,
      window.endDate,
      fetchedAt,
    );

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
) {
  const days = await Promise.all(
    enumerateDates(startDate, endDate).map((date) => fetchPolymarketDay(config, date)),
  );

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
): Promise<ComparisonCitySyncResult> {
  const fetchedAt = new Date().toISOString();

  logProgress(`${config.city}: fetching WU, AW, and Polymarket history`);
  const [wuRows, awRows, polymarketRows] = await Promise.all([
    fetchWundergroundObservationRowsForCity(config, startDate, endDate, fetchedAt),
    fetchAviationObservationRowsForCity(config, startDate, endDate, fetchedAt),
    fetchPolymarketDayRowsForCity(config, startDate, endDate, fetchedAt),
  ]);

  logProgress(
    `${config.city}: persisting ${wuRows.length} WU points, ${awRows.length} AW points, ${polymarketRows.length} market days`,
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
  const futureHighStatsResult = await rebuildWundergroundFutureHighHourlyStatsForCity(config.slug);
  logProgress(
    `${config.city}: rebuilt ${futureHighStatsResult.recordsWritten} WU future-high hourly buckets`,
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
}) {
  const configs = resolveComparisonCityConfigs(params.cityFilter);
  const summary: ComparisonSyncSummary = {
    generatedAt: new Date().toISOString(),
    startDate: params.startDate,
    endDate: params.endDate,
    cityFilter: params.cityFilter,
    databaseUrl: getComparisonDatabaseUrl(),
    citiesProcessed: configs.length,
    polymarketDaysUpserted: 0,
    wuObservationPointsUpserted: 0,
    awObservationPointsUpserted: 0,
    futureHighStatBucketsWritten: 0,
  };

  for (const config of configs) {
    const result = await syncComparisonCity(config, params.startDate, params.endDate);
    summary.polymarketDaysUpserted += result.polymarketDaysUpserted;
    summary.wuObservationPointsUpserted += result.wuObservationPointsUpserted;
    summary.awObservationPointsUpserted += result.awObservationPointsUpserted;
    summary.futureHighStatBucketsWritten += result.futureHighStatBucketsWritten;
  }

  return summary;
}

export function renderComparisonSyncSummary(summary: ComparisonSyncSummary) {
  const lines: string[] = [];
  lines.push(
    `Saved raw comparison data ${summary.startDate}..${summary.endDate}${summary.cityFilter ? ` city=${summary.cityFilter}` : ""}`,
  );
  lines.push(`Database: ${summary.databaseUrl}`);
  lines.push(`Cities processed: ${summary.citiesProcessed}`);
  lines.push(`Polymarket days upserted: ${summary.polymarketDaysUpserted}`);
  lines.push(`WU observation points upserted: ${summary.wuObservationPointsUpserted}`);
  lines.push(`AW observation points upserted: ${summary.awObservationPointsUpserted}`);
  lines.push(`WU future-high buckets written: ${summary.futureHighStatBucketsWritten}`);

  return `${lines.join("\n")}\n`;
}
