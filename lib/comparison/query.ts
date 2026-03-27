import { AIRPORTS } from "../airports";
import type { AirportConfig } from "../types";

export type ComparisonQueryInput = {
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
};

export type NormalizedComparisonQuery = {
  startDate: string;
  endDate: string;
  cityFilter: string | null;
  airports: AirportConfig[];
};

type ComparisonHrefParams = {
  startDate: string;
  endDate: string;
  city?: string | null;
  selectedDate?: string | null;
};

function shiftDate(date: string, offsetDays: number) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
  return cursor.toISOString().slice(0, 10);
}

function parseDateInput(value: string | null | undefined, fallback: string) {
  const candidate = value?.trim() || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error(`Invalid date: ${candidate}`);
  }

  return candidate;
}

function matchesAirportFilter(airport: AirportConfig, filter: string) {
  return (
    airport.slug.toLowerCase() === filter ||
    airport.city.toLowerCase() === filter ||
    airport.stationIcao.toLowerCase() === filter
  );
}

export function buildComparisonHref({
  startDate,
  endDate,
  city,
  selectedDate,
}: ComparisonHrefParams) {
  const search = new URLSearchParams({
    startDate,
    endDate,
  });
  const cityFilter = city?.trim();

  if (cityFilter) {
    search.set("city", cityFilter);
  }

  const normalizedSelectedDate = selectedDate?.trim();
  if (normalizedSelectedDate) {
    search.set("selectedDate", normalizedSelectedDate);
  }

  return `/comparison?${search.toString()}`;
}

export function getDefaultComparisonWindow() {
  const endDate = shiftDate(new Date().toISOString().slice(0, 10), -1);
  const startDate = shiftDate(endDate, -7);
  return { startDate, endDate };
}

export function enumerateDates(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const stop = new Date(`${endDate}T00:00:00Z`);

  while (cursor.getTime() <= stop.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export function getDateRangeDayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const daySpan = end.getTime() - start.getTime();

  return Math.floor(daySpan / 86_400_000) + 1;
}

export function normalizeComparisonQuery(input: ComparisonQueryInput): NormalizedComparisonQuery {
  const defaults = getDefaultComparisonWindow();
  const startDate = parseDateInput(input.startDate, defaults.startDate);
  const endDate = parseDateInput(input.endDate, defaults.endDate);

  if (startDate > endDate) {
    throw new Error(`startDate ${startDate} must be <= endDate ${endDate}`);
  }

  const city = input.city?.trim().toLowerCase() || null;
  const airports = city
    ? AIRPORTS.filter((airport) => matchesAirportFilter(airport, city))
    : AIRPORTS;

  if (airports.length === 0) {
    throw new Error(`Unknown city filter: ${input.city}`);
  }

  return {
    startDate,
    endDate,
    cityFilter: input.city?.trim() ?? null,
    airports,
  };
}
