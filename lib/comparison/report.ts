import type { AirportConfig } from "../types";

import type {
  ComparisonBucket,
  ComparisonBucketUnit,
  ComparisonDayRecord,
  ComparisonCityReport,
  ComparisonCitySummary,
  ComparisonPolymarketDay,
  ComparisonReport,
  ComparisonStatus,
} from "./types";
import type { NormalizedComparisonQuery } from "./query";

type ComparableValue = {
  value: number | null;
  unit: ComparisonBucketUnit | null;
};

type ComparableAviationValue = ComparableValue & {
  derivedFromCelsius: number | null;
};

function buildComparableValue(
  winner: ComparisonBucket | null,
  values: { fahrenheit: number | null; celsius: number | null },
): ComparableValue {
  if (!winner || winner.kind === "unknown") {
    return { value: null, unit: null };
  }

  return winner.unit === "F"
    ? { value: values.fahrenheit, unit: "F" }
    : { value: values.celsius, unit: "C" };
}

function isComparisonMatch(status: ComparisonStatus) {
  return ["match", "match-derived-f", "boundary-match"].includes(status);
}

function isComparisonMismatch(status: ComparisonStatus) {
  return ["mismatch", "boundary-mismatch"].includes(status);
}

function countSourceAgreement(
  rows: ComparisonDayRecord[],
  predicate: (left: number, right: number) => boolean,
) {
  let count = 0;

  for (const row of rows) {
    const winner = row.polymarket.winner;
    if (!winner || winner.kind === "unknown") {
      continue;
    }

    const wunderground = getComparableWundergroundValue(winner, row.wunderground);
    const aviation = getComparableAviationValue(winner, row.aviationWeather);

    if (
      wunderground.value != null &&
      aviation.value != null &&
      predicate(wunderground.value, aviation.value)
    ) {
      count += 1;
    }
  }

  return count;
}

function buildCitySummary(
  airport: AirportConfig,
  rows: ComparisonDayRecord[],
): ComparisonCitySummary {
  const resolvedRows = rows.filter((row) => row.polymarket.status === "resolved");
  const summary: ComparisonCitySummary = {
    citySlug: airport.slug,
    city: airport.city,
    stationIcao: airport.stationIcao,
    resolvedDays: resolvedRows.length,
    wundergroundMatches: 0,
    wundergroundMismatches: 0,
    aviationMatches: 0,
    aviationMismatches: 0,
    sourceAgreementDays: 0,
    sourceDisagreementDays: 0,
  };

  for (const row of resolvedRows) {
    if (isComparisonMatch(row.comparisons.wunderground)) {
      summary.wundergroundMatches += 1;
    }

    if (isComparisonMismatch(row.comparisons.wunderground)) {
      summary.wundergroundMismatches += 1;
    }

    if (isComparisonMatch(row.comparisons.aviationWeather)) {
      summary.aviationMatches += 1;
    }

    if (isComparisonMismatch(row.comparisons.aviationWeather)) {
      summary.aviationMismatches += 1;
    }
  }

  summary.sourceAgreementDays = countSourceAgreement(resolvedRows, (left, right) => left === right);
  summary.sourceDisagreementDays = countSourceAgreement(resolvedRows, (left, right) => left !== right);

  return summary;
}

export function buildComparisonReport(params: {
  rows: ComparisonDayRecord[];
  query: NormalizedComparisonQuery;
  includeRows?: boolean;
}) {
  const includeRows = params.includeRows ?? true;
  const rowsByCity = new Map<string, ComparisonDayRecord[]>();

  for (const airport of params.query.airports) {
    rowsByCity.set(airport.slug, []);
  }

  for (const row of params.rows) {
    rowsByCity.get(row.citySlug)?.push(row);
  }

  const cities: ComparisonCityReport[] = params.query.airports.map((airport) => {
    const rows = rowsByCity.get(airport.slug) ?? [];
    const resolvedRows = rows.filter((row) => row.polymarket.status === "resolved");

    return {
      airport,
      summary: buildCitySummary(airport, rows),
      rows: includeRows ? resolvedRows : [],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    startDate: params.query.startDate,
    endDate: params.query.endDate,
    cityFilter: params.query.cityFilter,
    mode: "raw-db",
    cities,
  } satisfies ComparisonReport;
}

export function getComparableWundergroundValue(
  winner: ComparisonBucket | null,
  row: { maxTempF: number | null; maxTempC: number | null } | null,
): ComparableValue {
  return buildComparableValue(winner, {
    fahrenheit: row?.maxTempF ?? null,
    celsius: row?.maxTempC ?? null,
  });
}

export function getComparableAviationValue(
  winner: ComparisonBucket | null,
  row: { maxTempC: number | null; maxTempFRounded: number | null } | null,
): ComparableAviationValue {
  const comparable = buildComparableValue(winner, {
    fahrenheit: row?.maxTempFRounded ?? null,
    celsius: row?.maxTempC ?? null,
  });

  return {
    ...comparable,
    derivedFromCelsius:
      winner && winner.kind !== "unknown" && winner.unit === "F" ? row?.maxTempC ?? null : null,
  };
}

export function evaluateAgainstWinner(
  actualValue: number | null,
  polymarket: ComparisonPolymarketDay,
  options: {
    sourceName: string;
    directUnit: ComparisonBucketUnit | null;
    derivedFromCelsius?: number | null;
  },
): ComparisonStatus {
  if (polymarket.status === "missing") {
    return "missing-polymarket";
  }

  if (polymarket.status === "unresolved" || !polymarket.winner) {
    return "unresolved";
  }

  if (actualValue === null || !options.directUnit) {
    return "missing-source-data";
  }

  if (polymarket.winner.kind === "unknown") {
    return "mismatch";
  }

  if (polymarket.winner.unit !== options.directUnit) {
    return "mismatch";
  }

  if (polymarket.winner.kind === "exact") {
    if (actualValue !== polymarket.winner.value) {
      return "mismatch";
    }

    return options.derivedFromCelsius != null ? "match-derived-f" : "match";
  }

  if (polymarket.winner.kind === "range") {
    const inRange = actualValue >= polymarket.winner.minValue && actualValue <= polymarket.winner.maxValue;
    if (!inRange) {
      return "mismatch";
    }

    return options.derivedFromCelsius != null ? "match-derived-f" : "match";
  }

  const boundaryOk =
    polymarket.winner.kind === "at-most"
      ? actualValue <= polymarket.winner.value
      : actualValue >= polymarket.winner.value;

  return boundaryOk ? "boundary-match" : "boundary-mismatch";
}
