import { AIRPORTS } from "../airports";
import {
  getAviationDaySummariesForResolvedPolymarket,
  getAviationObservationDay,
  getPolymarketDay,
  getResolvedPolymarketDayRows,
  getWundergroundDaySummariesForResolvedPolymarket,
  getWundergroundObservationDay,
} from "./db";
import {
  buildComparisonReport,
  evaluateAgainstWinner,
  getComparableAviationValue,
  getComparableWundergroundValue,
} from "./report";
import {
  enumerateDates,
  getDefaultComparisonWindow,
  normalizeComparisonQuery,
  type ComparisonQueryInput,
} from "./query";
import { convertTemperature, getAirportDisplayTemperatureUnit } from "../temperature";

import type {
  ComparisonAviationSummary,
  ComparisonDayDetail,
  ComparisonDayRecord,
  ComparisonPolymarketDay,
  ComparisonTemperaturePoint,
  ComparisonWundergroundSummary,
  StoredAviationDaySummary,
  StoredAviationObservation,
  StoredPolymarketDay,
  StoredWundergroundDaySummary,
  StoredWundergroundObservation,
} from "./types";

const AIRPORTS_BY_SLUG = new Map(AIRPORTS.map((airport) => [airport.slug, airport]));

type WundergroundDetail = ComparisonWundergroundSummary & {
  points: ComparisonTemperaturePoint[];
};
type AviationDetail = ComparisonAviationSummary & {
  points: ComparisonTemperaturePoint[];
};

export { enumerateDates, getDefaultComparisonWindow, normalizeComparisonQuery };

function buildRowKey(citySlug: string, localDate: string) {
  return `${citySlug}:${localDate}`;
}

function createMissingPolymarketDay(): ComparisonPolymarketDay {
  return {
    slug: null,
    status: "missing",
    winner: null,
    resolutionSource: null,
  };
}

function createEmptyWundergroundSummary(): WundergroundDetail {
  return {
    maxTempF: null,
    maxTempC: null,
    peakLocal: null,
    pointCount: 0,
    requestUrl: null,
    points: [],
  };
}

function createEmptyAviationSummary(): AviationDetail {
  return {
    maxTempC: null,
    maxTempFRounded: null,
    peakLocal: null,
    pointCount: 0,
    points: [],
  };
}

function toTemperaturePoint(observedAt: string, temperatureC: number): ComparisonTemperaturePoint {
  return {
    observedAt,
    temperatureC,
  };
}

function groupByCityDate<T extends { citySlug: string; localDate: string }>(rows: T[]) {
  const grouped = new Map<string, T>();

  for (const row of rows) {
    const key = buildRowKey(row.citySlug, row.localDate);
    grouped.set(key, row);
  }

  return grouped;
}

function buildWundergroundDetail(rows: StoredWundergroundObservation[]): WundergroundDetail {
  if (rows.length === 0) {
    return createEmptyWundergroundSummary();
  }

  const sorted = [...rows].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
  const points: ComparisonTemperaturePoint[] = [];
  let maxTempF: number | null = null;
  let maxTempC: number | null = null;
  let peakLocal: string | null = null;

  for (const row of sorted) {
    const temperatureC =
      row.tempC ?? (row.tempF != null ? convertTemperature(row.tempF, "F", "C") : null);
    const temperatureF =
      row.tempF ?? (row.tempC != null ? convertTemperature(row.tempC, "C", "F") : null);

    if (temperatureC != null) {
      points.push(toTemperaturePoint(row.observedAtUtc, temperatureC));
    }

    if (temperatureF != null && (maxTempF === null || temperatureF > maxTempF)) {
      maxTempF = temperatureF;
      peakLocal = row.observedAtLocal;
    }

    if (temperatureC != null && (maxTempC === null || temperatureC > maxTempC)) {
      maxTempC = temperatureC;
      if (maxTempF === null) {
        peakLocal = row.observedAtLocal;
      }
    }
  }

  return {
    maxTempF,
    maxTempC,
    peakLocal,
    pointCount: points.length,
    requestUrl: sorted[0]?.requestUrlImperial ?? null,
    points,
  };
}

function buildAviationDetail(rows: StoredAviationObservation[]): AviationDetail {
  if (rows.length === 0) {
    return createEmptyAviationSummary();
  }

  const sorted = [...rows].sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc));
  const points = sorted.map((row) => toTemperaturePoint(row.observedAtUtc, row.tempC));
  let maxTempC: number | null = null;
  let peakLocal: string | null = null;

  for (const row of sorted) {
    if (maxTempC === null || row.tempC > maxTempC) {
      maxTempC = row.tempC;
      peakLocal = row.observedAtLocal;
    }
  }

  return {
    maxTempC,
    maxTempFRounded: maxTempC === null ? null : Math.round(convertTemperature(maxTempC, "C", "F")),
    peakLocal,
    pointCount: points.length,
    points,
  };
}

function buildPolymarketDay(row: StoredPolymarketDay | null): ComparisonPolymarketDay {
  if (!row) {
    return createMissingPolymarketDay();
  }

  return {
    slug: row.slug,
    status: row.status,
    winner: row.winner,
    resolutionSource: row.resolutionSource,
  };
}

function buildStoredWundergroundSummary(
  row: StoredWundergroundDaySummary | null | undefined,
): ComparisonWundergroundSummary {
  if (!row) {
    return createEmptyWundergroundSummary();
  }

  return {
    maxTempF: row.maxTempF,
    maxTempC: row.maxTempC,
    peakLocal: row.peakLocal,
    pointCount: row.pointCount,
    requestUrl: row.requestUrl,
  };
}

function buildStoredAviationSummary(
  row: StoredAviationDaySummary | null | undefined,
): ComparisonAviationSummary {
  if (!row) {
    return createEmptyAviationSummary();
  }

  return {
    maxTempC: row.maxTempC,
    maxTempFRounded:
      row.maxTempC === null ? null : Math.round(convertTemperature(row.maxTempC, "C", "F")),
    peakLocal: row.peakLocal,
    pointCount: row.pointCount,
  };
}

function buildComparisonDayRecord(params: {
  citySlug: string;
  localDate: string;
  polymarket: ComparisonPolymarketDay;
  wunderground: ComparisonWundergroundSummary;
  aviationWeather: ComparisonAviationSummary;
}): ComparisonDayRecord {
  const airport = AIRPORTS_BY_SLUG.get(params.citySlug);
  if (!airport) {
    throw new Error(`Unknown airport slug in comparison read service: ${params.citySlug}`);
  }

  const comparableWu = getComparableWundergroundValue(params.polymarket.winner, params.wunderground);
  const comparableAw = getComparableAviationValue(params.polymarket.winner, params.aviationWeather);

  return {
    citySlug: params.citySlug,
    localDate: params.localDate,
    airport,
    polymarket: params.polymarket,
    wunderground: params.wunderground,
    aviationWeather: params.aviationWeather,
    comparisons: {
      wunderground: evaluateAgainstWinner(comparableWu.value, params.polymarket, {
        sourceName: "Wunderground",
        directUnit: comparableWu.unit,
      }),
      aviationWeather: evaluateAgainstWinner(comparableAw.value, params.polymarket, {
        sourceName: "AviationWeather",
        directUnit: comparableAw.unit,
        derivedFromCelsius: comparableAw.derivedFromCelsius,
      }),
    },
  };
}

function buildComparisonRows(params: {
  polymarketRows: StoredPolymarketDay[];
  wundergroundRows: StoredWundergroundDaySummary[];
  aviationRows: StoredAviationDaySummary[];
}) {
  const wuByKey = groupByCityDate(params.wundergroundRows);
  const awByKey = groupByCityDate(params.aviationRows);

  return params.polymarketRows.map((row) => {
    const key = buildRowKey(row.citySlug, row.localDate);

    return buildComparisonDayRecord({
      citySlug: row.citySlug,
      localDate: row.localDate,
      polymarket: buildPolymarketDay(row),
      wunderground: buildStoredWundergroundSummary(wuByKey.get(key)),
      aviationWeather: buildStoredAviationSummary(awByKey.get(key)),
    });
  });
}

export async function getStoredComparisonReport(
  input: ComparisonQueryInput,
  options?: { includeRows?: boolean },
) {
  const query = normalizeComparisonQuery(input);
  const citySlugs = query.airports.map((airport) => airport.slug);
  const [wundergroundRows, aviationRows, polymarketRows] = await Promise.all([
    getWundergroundDaySummariesForResolvedPolymarket({
      startDate: query.startDate,
      endDate: query.endDate,
      citySlugs,
    }),
    getAviationDaySummariesForResolvedPolymarket({
      startDate: query.startDate,
      endDate: query.endDate,
      citySlugs,
    }),
    getResolvedPolymarketDayRows({
      startDate: query.startDate,
      endDate: query.endDate,
      citySlugs,
    }),
  ]);
  const rows = buildComparisonRows({
    wundergroundRows,
    aviationRows,
    polymarketRows,
  });

  return buildComparisonReport({
    rows,
    query,
    includeRows: options?.includeRows,
  });
}

export async function getStoredComparisonDayDetail(params: {
  citySlug: string;
  localDate: string;
}): Promise<ComparisonDayDetail | null> {
  const airport = AIRPORTS_BY_SLUG.get(params.citySlug);
  if (!airport) {
    throw new Error(`Unknown airport slug in comparison detail: ${params.citySlug}`);
  }

  const [wundergroundRows, aviationRows, polymarketRow] = await Promise.all([
    getWundergroundObservationDay(params),
    getAviationObservationDay(params),
    getPolymarketDay(params),
  ]);

  if (wundergroundRows.length === 0 && aviationRows.length === 0 && !polymarketRow) {
    return null;
  }

  return {
    airport,
    localDate: params.localDate,
    displayUnit: getAirportDisplayTemperatureUnit(airport),
    polymarket: buildPolymarketDay(polymarketRow),
    wunderground: buildWundergroundDetail(wundergroundRows),
    aviationWeather: buildAviationDetail(aviationRows),
  };
}
