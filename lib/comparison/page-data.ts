import { getEarliestResolvedComparisonDay } from "./history-coverage";
import { getDefaultComparisonWindow } from "./query";
import {
  getStoredComparisonDayDetail,
  getStoredComparisonReport,
} from "./read-service";

import type {
  ComparisonCityReport,
  ComparisonDayDetail,
  ComparisonReport,
} from "./types";

type ComparisonPageInput = {
  startDate?: unknown;
  endDate?: unknown;
  city?: unknown;
  selectedDate?: unknown;
};

export type ComparisonPageData = {
  startDate: string;
  endDate: string;
  city: string;
  selectedDate: string | null;
  report: ComparisonReport;
  cityDetail: ComparisonCityReport | null;
  dayDetail: ComparisonDayDetail | null;
  earliestResolvedDate: string | null;
  statusLabel: string;
};

function getSingleValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue : null;
  }

  return null;
}

function parseSelectedDate(value: unknown) {
  const candidate = getSingleValue(value);

  if (!candidate) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

export async function getComparisonPageData(
  input: ComparisonPageInput,
): Promise<ComparisonPageData> {
  const defaults = getDefaultComparisonWindow();
  const startDate = getSingleValue(input.startDate) ?? defaults.startDate;
  const endDate = getSingleValue(input.endDate) ?? defaults.endDate;
  const city = getSingleValue(input.city) ?? "";
  const requestedSelectedDate = parseSelectedDate(input.selectedDate);
  const includeRows = city.trim().length > 0;

  const report = await getStoredComparisonReport(
    {
      startDate,
      endDate,
      city,
    },
    {
      includeRows,
    },
  );

  const cityDetail = includeRows ? report.cities[0] ?? null : null;
  const earliestResolvedDate = cityDetail
    ? getEarliestResolvedComparisonDay(cityDetail.airport.slug)
    : null;
  const selectedDate =
    cityDetail && requestedSelectedDate
      ? cityDetail.rows.some((row) => row.localDate === requestedSelectedDate)
        ? requestedSelectedDate
        : null
      : null;
  const dayDetail =
    cityDetail &&
    selectedDate &&
    selectedDate >= startDate &&
    selectedDate <= endDate
      ? await getStoredComparisonDayDetail({
          citySlug: cityDetail.airport.slug,
          localDate: selectedDate,
        })
      : null;

  return {
    startDate,
    endDate,
    city,
    selectedDate,
    report,
    cityDetail,
    dayDetail,
    earliestResolvedDate,
    statusLabel: "Loaded directly from persisted SQLite data",
  };
}
