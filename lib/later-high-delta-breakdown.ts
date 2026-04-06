import { getWundergroundObservationRows } from "./comparison/db";
import { convertTemperature, getAirportDisplayTemperatureUnit } from "./temperature";

import type {
  LaterHighDeltaBreakdown,
  LaterHighDeltaBucket,
  LaterHighDeltaSample,
  LaterHighDeltaSeries,
  SourceReading,
  TemperatureUnit,
  WeatherCard,
} from "./types";
import type { StoredWundergroundObservation } from "./comparison/types";

const WU_HISTORY_START_DATE = "1900-01-01";
const WU_HISTORY_END_DATE = "2100-12-31";
const MAX_BASIS_LOOKBACK_MINUTES = 90;
const RECENT_VALID_SAMPLE_LIMIT = 10;
const LATER_HIGH_DELTA_METHOD = "aw-cutoff-time-vs-later-wu-peak-delta-v2";
const TEMPERATURE_EPSILON = 1e-6;

type DayObservation = {
  value: number;
  minutes: number;
};

type DayDeltaResult = {
  localDate: string;
  delta: number;
  peakLocalTime: string;
};

function createEmptyLaterHighDeltaSeries(): LaterHighDeltaSeries {
  return {
    sampleDayCount: 0,
    noHigherPeakDayCount: 0,
    noHigherPeakSamples: [],
    positiveDeltaDayCount: 0,
    maxDelta: null,
    buckets: [],
  };
}

export function createEmptyLaterHighDeltaBreakdown(): LaterHighDeltaBreakdown {
  return {
    generatedAt: null,
    method: null,
    cutoffLocalTime: null,
    displayUnit: null,
    historyDayCount: 0,
    basisDayCount: 0,
    laterObservationDayCount: 0,
    recentValidDayCount: 0,
    allTime: createEmptyLaterHighDeltaSeries(),
    recent10: createEmptyLaterHighDeltaSeries(),
    status: "missing",
    error: null,
  };
}

function formatLocalClock(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function getClockMinutes(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return hour * 60 + minute;
}

function parseObservedAtLocalMinutes(value: string) {
  const match = value.match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getRoundedDisplayTemperature(value: number) {
  return Math.round(value);
}

function formatLocalTimeFromMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getComparableObservationValue(
  row: StoredWundergroundObservation,
  displayUnit: TemperatureUnit,
) {
  if (displayUnit === "C") {
    if (typeof row.tempC === "number") {
      return row.tempC;
    }

    return typeof row.tempF === "number"
      ? convertTemperature(row.tempF, "F", "C")
      : null;
  }

  if (typeof row.tempF === "number") {
    return row.tempF;
  }

  return typeof row.tempC === "number"
    ? convertTemperature(row.tempC, "C", "F")
    : null;
}

function buildMissingBreakdown(
  card: WeatherCard,
  displayUnit: TemperatureUnit,
  error: string,
): LaterHighDeltaBreakdown {
  const status =
    card.aviationWeatherCurrent.status === "error"
      ? "error"
      : card.aviationWeatherCurrent.status === "stale"
        ? "stale"
        : "missing";

  return {
    ...createEmptyLaterHighDeltaBreakdown(),
    generatedAt: new Date().toISOString(),
    method: LATER_HIGH_DELTA_METHOD,
    displayUnit,
    status,
    error,
  };
}

function buildSeries(entries: DayDeltaResult[]): LaterHighDeltaSeries {
  const counts = new Map<number, number>();
  const samplesByDelta = new Map<number, LaterHighDeltaSample[]>();
  let noHigherPeakDayCount = 0;
  const noHigherPeakSamples: LaterHighDeltaSample[] = [];
  let positiveDeltaDayCount = 0;
  let maxDelta: number | null = null;

  for (const entry of entries) {
    const sample = {
      localDate: entry.localDate,
      peakLocalTime: entry.peakLocalTime,
    } satisfies LaterHighDeltaSample;

    if (entry.delta < 1) {
      noHigherPeakDayCount += 1;
      noHigherPeakSamples.push(sample);
      continue;
    }

    positiveDeltaDayCount += 1;
    counts.set(entry.delta, (counts.get(entry.delta) ?? 0) + 1);
    const existingSamples = samplesByDelta.get(entry.delta) ?? [];
    existingSamples.push(sample);
    samplesByDelta.set(entry.delta, existingSamples);
    if (maxDelta === null || entry.delta > maxDelta) {
      maxDelta = entry.delta;
    }
  }

  const buckets: LaterHighDeltaBucket[] = [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([delta, count]) => ({
      delta,
      count,
      probability: entries.length > 0 ? count / entries.length : 0,
      samples: samplesByDelta.get(delta) ?? [],
    }));

  return {
    sampleDayCount: entries.length,
    noHigherPeakDayCount,
    noHigherPeakSamples,
    positiveDeltaDayCount,
    maxDelta,
    buckets,
  };
}

export async function buildLaterHighDeltaBreakdown(
  card: WeatherCard,
): Promise<LaterHighDeltaBreakdown> {
  const displayUnit = getAirportDisplayTemperatureUnit(card.airport);
  const awNowObservedAt = card.aviationWeatherCurrent.observedAt;

  if (!awNowObservedAt) {
    return buildMissingBreakdown(
      card,
      displayUnit,
      card.aviationWeatherCurrent.error?.trim() || "AW now time is unavailable for later-jump history.",
    );
  }

  const cutoffLocalTime = formatLocalClock(awNowObservedAt, card.airport.timezone);
  const cutoffMinutes = getClockMinutes(awNowObservedAt, card.airport.timezone);
  const rows = await getWundergroundObservationRows({
    startDate: WU_HISTORY_START_DATE,
    endDate: WU_HISTORY_END_DATE,
    citySlugs: [card.airport.slug],
  });

  if (rows.length === 0) {
    return {
      ...createEmptyLaterHighDeltaBreakdown(),
      generatedAt: new Date().toISOString(),
      method: LATER_HIGH_DELTA_METHOD,
      cutoffLocalTime,
      displayUnit,
      status: "missing",
      error: "No stored WU history is available yet for this city.",
    };
  }

  const observationsByDate = new Map<string, DayObservation[]>();

  for (const row of rows) {
    const value = getComparableObservationValue(row, displayUnit);
    const minutes = parseObservedAtLocalMinutes(row.observedAtLocal);

    if (typeof value !== "number" || minutes === null) {
      continue;
    }

    const dayRows = observationsByDate.get(row.localDate) ?? [];
    dayRows.push({ value, minutes });
    observationsByDate.set(row.localDate, dayRows);
  }

  const historyDayCount = observationsByDate.size;
  let basisDayCount = 0;
  const validDayResults: DayDeltaResult[] = [];

  for (const [localDate, dayRows] of observationsByDate.entries()) {
    let basisObservation: DayObservation | null = null;
    let laterPeakObservation: DayObservation | null = null;

    for (const observation of dayRows) {
      if (observation.minutes <= cutoffMinutes) {
        if (!basisObservation || observation.minutes > basisObservation.minutes) {
          basisObservation = observation;
        }
        continue;
      }

      if (
        !laterPeakObservation ||
        observation.value > laterPeakObservation.value + TEMPERATURE_EPSILON
      ) {
        laterPeakObservation = observation;
      }
    }

    if (!basisObservation) {
      continue;
    }

    if (cutoffMinutes - basisObservation.minutes > MAX_BASIS_LOOKBACK_MINUTES) {
      continue;
    }

    basisDayCount += 1;

    if (!laterPeakObservation) {
      continue;
    }

    const basisDisplayValue = getRoundedDisplayTemperature(basisObservation.value);
    const peakDisplayValue = getRoundedDisplayTemperature(laterPeakObservation.value);
    validDayResults.push({
      localDate,
      delta: peakDisplayValue - basisDisplayValue,
      peakLocalTime: formatLocalTimeFromMinutes(laterPeakObservation.minutes),
    });
  }

  validDayResults.sort((left, right) => right.localDate.localeCompare(left.localDate));
  const recentValidDayResults = validDayResults.slice(0, RECENT_VALID_SAMPLE_LIMIT);
  const allTime = buildSeries(validDayResults);
  const recent10 = buildSeries(recentValidDayResults);

  return {
    generatedAt: new Date().toISOString(),
    method: LATER_HIGH_DELTA_METHOD,
    cutoffLocalTime,
    displayUnit,
    historyDayCount,
    basisDayCount,
    laterObservationDayCount: allTime.sampleDayCount,
    recentValidDayCount: recent10.sampleDayCount,
    allTime,
    recent10,
    status: card.aviationWeatherCurrent.status === "stale" ? "stale" : "fresh",
    error: card.aviationWeatherCurrent.status === "stale"
      ? card.aviationWeatherCurrent.error
      : null,
  };
}
