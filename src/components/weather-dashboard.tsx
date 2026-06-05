import { Link } from "react-router-dom";
import { startTransition, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, RefObject } from "react";

import { AIRPORTS } from "../../lib/airports";
import { buildComparisonHref } from "../../lib/comparison/query";
import { convertTemperature, getAirportDisplayTemperatureUnit } from "../../lib/temperature";
import { TemperatureHistoryChart } from "./temperature-history-chart";
import type {
  SourceReading,
  TemperatureTrend,
  TemperatureUnit,
  WeatherCard,
  WeatherCardDetailResponse,
  WeatherCardSummary,
  WeatherResponse,
  WeatherSignals,
  WeatherSummarySignals,
} from "../../lib/types";

const SNAPSHOT_POLL_INTERVAL_MS = 750;
const AUTO_REFRESH_MAX_AGE_MS = 5 * 60_000;
const LOCAL_TIME_REFRESH_INTERVAL_MS = 60_000;
const LOCAL_TIME_SORT_START_MINUTES = 8 * 60;
const FORECAST_COMPACT_COLUMN_COUNT = 3;

declare global {
  interface Window {
    __POLYWEATHER_HOME_INITIAL__?:
      | {
          url: string;
          data: WeatherResponse;
        }
      | undefined;
  }
}

let cachedBootstrappedHomeResponse: WeatherResponse | null | undefined;

function getCurrentPathWithSearch(value: string) {
  const url = new URL(value, window.location.origin);
  return `${url.pathname}${url.search}`;
}

function readBootstrappedHomeResponse() {
  if (cachedBootstrappedHomeResponse !== undefined) {
    return cachedBootstrappedHomeResponse;
  }

  if (typeof window === "undefined") {
    cachedBootstrappedHomeResponse = null;
    return cachedBootstrappedHomeResponse;
  }

  const payload = window.__POLYWEATHER_HOME_INITIAL__;
  if (!payload || payload.url !== getCurrentPathWithSearch(window.location.href)) {
    cachedBootstrappedHomeResponse = null;
    return cachedBootstrappedHomeResponse;
  }

  delete window.__POLYWEATHER_HOME_INITIAL__;
  cachedBootstrappedHomeResponse = payload.data;
  return cachedBootstrappedHomeResponse;
}

function isWeatherSnapshotFreshEnough(payload: WeatherResponse | null) {
  if (!payload?.cards?.length || !payload.refreshedAt) {
    return false;
  }

  const refreshedAtMs = new Date(payload.refreshedAt).getTime();
  if (!Number.isFinite(refreshedAtMs)) {
    return false;
  }

  return Date.now() - refreshedAtMs <= AUTO_REFRESH_MAX_AGE_MS;
}

async function fetchWeatherCardDetail(slug: string, signal?: AbortSignal) {
  const response = await fetch(`/api/weather/card?slug=${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const payload = (await response.json()) as WeatherCardDetailResponse | { error?: string };

  if (!response.ok) {
    throw new Error(payload.error?.trim() || `Failed to load weather card (${response.status})`);
  }

  return payload as WeatherCardDetailResponse;
}

const EMPTY_WEATHER_SIGNALS: WeatherSignals = {
  sourceId: "unknown",
  sourceLabel: "Weather signals",
  modelRunInitialisedAt: null,
  publishedAt: null,
  weatherCode: null,
  isDay: null,
  sunrise: null,
  sunset: null,
  daylightDurationSeconds: null,
  cloudCover: null,
  precipitationProbability: null,
  precipitation: null,
  windSpeed: null,
  observedAt: null,
  fetchedAt: null,
  status: "missing",
  error: null,
  nextHours: [],
};

const EMPTY_WEATHER_SUMMARY_SIGNALS: WeatherSummarySignals = {
  sourceId: "unknown",
  weatherCode: null,
  isDay: null,
  sunset: null,
  cloudCover: null,
  precipitationProbability: null,
  precipitation: null,
  windSpeed: null,
  status: "missing",
  error: null,
};

type LaterHighDeltaDetailPopoverState = {
  key: string;
  rowLabel: string;
  seriesLabel: string;
  samples: Array<{
    localDate: string;
    peakLocalTime: string;
  }>;
  anchorElement: HTMLElement;
};

function formatTemperature(reading: SourceReading, displayUnit: TemperatureUnit) {
  if (typeof reading.value !== "number" || !reading.unit) {
    return "—";
  }

  const displayValue =
    reading.unit === displayUnit
      ? reading.value
      : convertTemperature(reading.value, reading.unit, displayUnit);

  if (displayUnit === "F") {
    return `${displayValue.toFixed(1)}°F`;
  }

  const hasFraction = Math.abs(displayValue % 1) > Number.EPSILON;
  return `${hasFraction ? displayValue.toFixed(1) : displayValue.toFixed(0)}°C`;
}

function formatRawTemperature(value: number | null, unit: TemperatureUnit) {
  if (typeof value !== "number") {
    return "—";
  }

  if (unit === "F") {
    return `${value.toFixed(1)}°F`;
  }

  const hasFraction = Math.abs(value % 1) > Number.EPSILON;
  return `${hasFraction ? value.toFixed(1) : value.toFixed(0)}°C`;
}

function formatDeltaTemperature(delta: number, unit: TemperatureUnit | null) {
  if (!unit) {
    return `+${delta}`;
  }

  return `+${delta}°${unit}`;
}

function formatDayCount(value: number) {
  return `${value} day${value === 1 ? "" : "s"}`;
}

function formatCompactDayCount(value: number) {
  return `${value}d`;
}

function formatObservedAt(value: string | null, timezone: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatForecastDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatMonthDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatSnapshotTime(value: string | null) {
  if (!value) {
    return "No snapshot yet";
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatFetchedClockLabel(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function shiftIsoDate(value: string, offsetDays: number) {
  const cursor = new Date(`${value}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
  return cursor.toISOString().slice(0, 10);
}

function formatLocalTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function formatLocalClockLabel(value: string | null) {
  if (!value) {
    return "—";
  }

  const [, timePart = "00:00"] = value.split("T");
  return timePart.slice(0, 5);
}

function formatLocalClockFromDate(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function getLocalClockMinutes(value: string | Date, timezone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return hour * 60 + minute;
}

function formatPercent(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return `${Math.round(value)}%`;
}

function formatProbabilityPercent(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
}

function formatWindSpeed(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return `${Math.round(value)} km/h`;
}

type WeatherVisual = {
  accentClass: string;
  kind:
    | "clear"
    | "partly-cloudy"
    | "cloudy"
    | "fog"
    | "rain"
    | "snow"
    | "storm";
  label: string;
};

function getWeatherVisual(signals: WeatherSummarySignals): WeatherVisual {
  const code = signals.weatherCode;

  if (code === 0) {
    return {
      kind: "clear",
      label: signals.isDay ? "Clear sky" : "Clear",
      accentClass: "signals-clear",
    };
  }

  if (code === 1 || code === 2) {
    return {
      kind: "partly-cloudy",
      label: "Partly cloudy",
      accentClass: "signals-partly-cloudy",
    };
  }

  if (code === 3) {
    return {
      kind: "cloudy",
      label: "Overcast",
      accentClass: "signals-cloudy",
    };
  }

  if (code === 45 || code === 48) {
    return {
      kind: "fog",
      label: "Fog",
      accentClass: "signals-fog",
    };
  }

  if (
    code === 51 ||
    code === 53 ||
    code === 55 ||
    code === 56 ||
    code === 57 ||
    code === 61 ||
    code === 63 ||
    code === 65 ||
    code === 66 ||
    code === 67 ||
    code === 80 ||
    code === 81 ||
    code === 82
  ) {
    return {
      kind: "rain",
      label: "Rain",
      accentClass: "signals-rain",
    };
  }

  if (
    code === 71 ||
    code === 73 ||
    code === 75 ||
    code === 77 ||
    code === 85 ||
    code === 86
  ) {
    return {
      kind: "snow",
      label: "Snow",
      accentClass: "signals-snow",
    };
  }

  if (code === 95 || code === 96 || code === 99) {
    return {
      kind: "storm",
      label: "Storm risk",
      accentClass: "signals-storm",
    };
  }

  return {
    kind: "cloudy",
    label: "Mixed conditions",
    accentClass: "signals-cloudy",
  };
}

function buildWeatherSummary(signals: WeatherSummarySignals) {
  if (signals.status === "error") {
    return "Signals unavailable";
  }

  if (signals.status === "missing") {
    return "Waiting for signals";
  }

  const visual = getWeatherVisual(signals);

  if (
    typeof signals.precipitation === "number" &&
    signals.precipitation > 0.2
  ) {
    return `${visual.label}, rain now`;
  }

  if (
    typeof signals.precipitationProbability === "number" &&
    signals.precipitationProbability >= 55
  ) {
    return `${visual.label}, rain risk`;
  }

  if (typeof signals.cloudCover === "number" && signals.cloudCover >= 75) {
    return `${visual.label}, thick cloud`;
  }

  if (typeof signals.windSpeed === "number" && signals.windSpeed >= 28) {
    return `${visual.label}, windy`;
  }

  if (
    signals.isDay &&
    typeof signals.cloudCover === "number" &&
    signals.cloudCover <= 25
  ) {
    return `${visual.label}, strong sun`;
  }

  if (typeof signals.windSpeed === "number" && signals.windSpeed >= 18) {
    return `${visual.label}, breezy`;
  }

  return visual.label;
}

function getCardWeatherSignals(card: WeatherCard, preferredSourceId?: string) {
  if (preferredSourceId) {
    const preferredSignals = card.weatherSignalsBySource?.[preferredSourceId];
    if (preferredSignals) {
      return preferredSignals;
    }
  }

  const defaultSignals =
    card.weatherSignalsBySource?.[card.defaultWeatherSignalsSourceId];
  if (defaultSignals) {
    return defaultSignals;
  }

  const firstSignals = Object.values(card.weatherSignalsBySource ?? {})[0];
  if (firstSignals) {
    return firstSignals;
  }

  // Compatibility with any in-memory snapshot created before the source map existed.
  return (
    (card as WeatherCard & { weatherSignals?: WeatherSignals }).weatherSignals ??
    EMPTY_WEATHER_SIGNALS
  );
}

function getSourceShortLabel(sourceId: string, sourceLabel: string) {
  if (sourceId === "open-meteo-gfs" || sourceId === "ncep_gfs013") {
    return "GFS";
  }

  if (sourceId === "open-meteo-ecmwf" || sourceId === "ecmwf_ifs") {
    return "ECMWF";
  }

  if (sourceId === "ncep_nbm_conus") {
    return "NBM";
  }

  if (sourceId === "dwd_icon_eu") {
    return "ICON EU";
  }

  if (sourceId === "dwd_icon_d2") {
    return "ICON D2";
  }

  if (sourceId === "meteofrance_arpege_europe") {
    return "ARPEGE";
  }

  if (sourceId === "gem_hrdps_continental") {
    return "HRDPS";
  }

  if (sourceId === "kma_ldps") {
    return "KMA LDPS";
  }

  if (sourceId === "jma_msm") {
    return "JMA MSM";
  }

  return sourceLabel.replace(/^Open-Meteo\s+/u, "");
}

function WeatherGlyph({ kind }: { kind: WeatherVisual["kind"] }) {
  if (kind === "clear") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <path
          d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (kind === "partly-cloudy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="3.6" fill="currentColor" opacity="0.9" />
        <path
          d="M8.5 20h8.8a3.7 3.7 0 0 0 .3-7.4 4.9 4.9 0 0 0-9.4-1.2A3.9 3.9 0 0 0 8.5 20Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "cloudy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.2 19.5h10.7a4.3 4.3 0 0 0 .4-8.6A5.9 5.9 0 0 0 6 9.7a4.9 4.9 0 0 0 .2 9.8Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "fog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 10.5h12M4.5 14h15M6 17.5h12"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M7.5 8.5h9a3.2 3.2 0 0 0 .3-6.4 4.3 4.3 0 0 0-8.1 1.1A2.9 2.9 0 0 0 7.5 8.5Z"
          fill="currentColor"
          opacity="0.9"
        />
      </svg>
    );
  }

  if (kind === "rain") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.2 12.8h10.7a4.3 4.3 0 0 0 .4-8.6A5.9 5.9 0 0 0 6 3a4.9 4.9 0 0 0 .2 9.8Z"
          fill="currentColor"
        />
        <path
          d="M8.5 15.5 7.3 19M12.5 15.5 11.3 19M16.5 15.5 15.3 19"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.2 12.6h10.7a4.3 4.3 0 0 0 .4-8.6A5.9 5.9 0 0 0 6 2.8a4.9 4.9 0 0 0 .2 9.8Z"
          fill="currentColor"
        />
        <path
          d="M9 16v4M7.4 17l3.2 2M10.6 17l-3.2 2M15 16v4M13.4 17l3.2 2M16.6 17l-3.2 2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.2 12.3h10.7a4.3 4.3 0 0 0 .4-8.6A5.9 5.9 0 0 0 6 2.5a4.9 4.9 0 0 0 .2 9.8Z"
        fill="currentColor"
      />
      <path
        d="m10 14.5-1.3 3.1h2.2l-1 2.9 4.1-5.3h-2l1.2-2.7"
        fill="currentColor"
      />
    </svg>
  );
}

function buildPolymarketEventUrl(city: string, value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(value);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const citySlug = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const monthSlug = month.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const daySlug = day.replace(/\D+/g, "");
  const yearSlug = year.replace(/\D+/g, "");

  return `https://polymarket.com/event/highest-temperature-in-${citySlug}-on-${monthSlug}-${daySlug}-${yearSlug}`;
}

function getLocalTimeSortKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const totalMinutes = hour * 60 + minute;
  return (totalMinutes - LOCAL_TIME_SORT_START_MINUTES + 24 * 60) % (24 * 60);
}

function formatCompactReadingMetaText(reading: SourceReading, timezone: string) {
  if (reading.observedAt) {
    return formatLocalClockFromDate(new Date(reading.observedAt), timezone);
  }

  if (reading.forecastDate) {
    return formatForecastDate(reading.forecastDate);
  }

  return "—";
}

function buildCompactReadingTooltip(reading: SourceReading, timezone: string) {
  const parts: string[] = [];

  if (reading.observedAt) {
    parts.push(formatObservedAt(reading.observedAt, timezone));
  } else if (reading.forecastDate) {
    parts.push(`Forecast ${formatForecastDate(reading.forecastDate)}`);
  }

  if (reading.status !== "fresh") {
    parts.push(reading.status);
  }

  if (reading.error?.trim()) {
    parts.push(reading.error.trim());
  }

  return parts.join(" · ") || undefined;
}

function CompactCurrentReadings({
  readings,
  displayUnit,
  timezone,
}: {
  readings: Array<{ label: string; reading: SourceReading }>;
  displayUnit: TemperatureUnit;
  timezone: string;
}) {
  return (
    <section className="current-grid" aria-label="Current source readings">
      {readings.map(({ label }) => (
        <div key={`${label}-label`} className="current-grid-label-cell">
          <span className="current-grid-label">{label}</span>
        </div>
      ))}

      {readings.map(({ label, reading }) => {
        const tooltip = buildCompactReadingTooltip(reading, timezone);
        const showStatusDot = reading.status !== "fresh";

        return (
          <div
            key={`${label}-value`}
            className={`current-grid-value-cell is-${reading.status}`}
            title={tooltip}
          >
            <strong className="current-grid-value">
              {formatTemperature(reading, displayUnit)}
            </strong>
            <span className="current-grid-meta">
              {showStatusDot ? (
                <>
                  <span
                    className={`current-grid-status-dot is-${reading.status}`}
                    aria-hidden="true"
                  />
                  <span className="visually-hidden">{reading.status}</span>
                </>
              ) : null}
              <span>{formatCompactReadingMetaText(reading, timezone)}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function buildCompactForecastTooltip(reading: SourceReading) {
  const parts: string[] = [];

  if (reading.forecastDate) {
    parts.push(`Forecast ${formatForecastDate(reading.forecastDate)}`);
  }

  if (reading.fetchedAt) {
    parts.push(`Fetched ${formatSnapshotTime(reading.fetchedAt)}`);
  }

  if (reading.status !== "fresh") {
    parts.push(reading.status);
  }

  if (reading.error?.trim()) {
    parts.push(reading.error.trim());
  }

  return parts.join(" · ") || undefined;
}

function CompactTodayHighReadings({
  readings,
  displayUnit,
}: {
  readings: Array<{ label: string; reading: SourceReading }>;
  displayUnit: TemperatureUnit;
}) {
  const paddedReadings = Array.from({ length: FORECAST_COMPACT_COLUMN_COUNT }, (_, index) => {
    return readings[index] ?? null;
  });

  return (
    <section className="forecast-grid forecast-compact-grid" aria-label="Open-Meteo today high readings">
      {paddedReadings.map((entry, index) => (
        <div
          key={entry ? `${entry.label}-label` : `forecast-placeholder-label-${index}`}
          className="forecast-compact-label-cell"
          aria-hidden={entry ? undefined : true}
        >
          {entry ? <span className="forecast-compact-label">{entry.label}</span> : null}
        </div>
      ))}

      {paddedReadings.map((entry, index) => {
        if (!entry) {
          return (
            <div
              key={`forecast-placeholder-value-${index}`}
              className="forecast-compact-value-cell is-placeholder"
              aria-hidden="true"
            />
          );
        }

        const { label, reading } = entry;
        const tooltip = buildCompactForecastTooltip(reading);
        const showStatusDot = reading.status !== "fresh";
        const fetchedClockLabel = formatFetchedClockLabel(reading.fetchedAt);

        return (
          <div
            key={`${label}-value`}
            className={`forecast-compact-value-cell is-${reading.status}`}
            title={tooltip}
          >
            <strong className="forecast-compact-value">
              {formatTemperature(reading, displayUnit)}
            </strong>
            {fetchedClockLabel ? (
              <span className="forecast-compact-fetched-time">
                {fetchedClockLabel}
              </span>
            ) : null}
            {showStatusDot ? (
              <>
                <span
                  className={`current-grid-status-dot is-${reading.status}`}
                  aria-hidden="true"
                />
                <span className="visually-hidden">{reading.status}</span>
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function ObservedTemperatureChart({
  trend,
  timezone,
  displayUnit,
}: {
  trend: TemperatureTrend;
  timezone: string;
  displayUnit: TemperatureUnit;
}) {
  const peakPoint = trend.points.reduce<TemperatureTrend["points"][number] | null>((currentPeak, point) => {
    if (!currentPeak || point.temperature > currentPeak.temperature) {
      return point;
    }

    if (
      point.temperature === currentPeak.temperature &&
      point.observedAt.localeCompare(currentPeak.observedAt) > 0
    ) {
      return point;
    }

    return currentPeak;
  }, null);
  const peakLocal = peakPoint
    ? formatLocalClockFromDate(new Date(peakPoint.observedAt), timezone)
    : null;
  const metaSuffix =
    trend.status === "stale"
      ? "Stale"
      : trend.status === "error" || trend.status === "missing"
        ? "Unavailable"
        : null;

  return (
    <TemperatureHistoryChart
      ariaLabel="AW observed temperature curve for today"
      displayUnit={displayUnit}
      emptyMessage={trend.error?.trim() ?? "No same-day AW observations yet."}
      label="AW observed today"
      metaSuffix={metaSuffix}
      sectionClassName="comparison-detail-chart"
      source={{
        points: trend.points.map((point) => ({
          observedAt: point.observedAt,
          temperatureC: point.temperature,
        })),
        pointCount: trend.points.length,
        peakLocal,
        maxTempC: peakPoint?.temperature ?? null,
      }}
      timezone={timezone}
    />
  );
}

function LaterHighDeltaPopover({
  breakdown,
  popoverId,
  popoverRef,
  style,
}: {
  breakdown: WeatherCard["laterHighDeltaBreakdown"];
  popoverId?: string;
  popoverRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
}) {
  const detailPopoverRef = useRef<HTMLDivElement | null>(null);
  const [detailPopover, setDetailPopover] = useState<LaterHighDeltaDetailPopoverState | null>(null);
  const [detailPopoverPosition, setDetailPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const unit = breakdown.displayUnit;
  const basisLabel =
    breakdown.cutoffLocalTime
      ? `Cutoff ${breakdown.cutoffLocalTime} from AW now`
      : "AW now context unavailable";
  const toggleDetailPopover = useEffectEvent(
    (
      nextKey: string,
      rowLabel: string,
      seriesLabel: string,
      samples: LaterHighDeltaDetailPopoverState["samples"],
      anchorElement: HTMLElement,
    ) => {
      setDetailPopover((currentValue) => {
        if (currentValue?.key === nextKey) {
          setDetailPopoverPosition(null);
          return null;
        }

        setDetailPopoverPosition(null);
        return {
          key: nextKey,
          rowLabel,
          seriesLabel,
          samples,
          anchorElement,
        };
      });
    },
  );

  useEffect(() => {
    setShowAllHistory(false);
    setDetailPopover(null);
    setDetailPopoverPosition(null);
  }, [breakdown.generatedAt, breakdown.cutoffLocalTime]);

  useEffect(() => {
    setDetailPopover(null);
    setDetailPopoverPosition(null);
  }, [showAllHistory]);

  useEffect(() => {
    if (!detailPopover || !detailPopoverRef.current) {
      return;
    }

    const currentDetailPopover = detailPopover;

    function updateDetailPopoverPosition() {
      if (!currentDetailPopover.anchorElement.isConnected || !detailPopoverRef.current) {
        setDetailPopover(null);
        setDetailPopoverPosition(null);
        return;
      }

      const anchorRect = currentDetailPopover.anchorElement.getBoundingClientRect();
      const popoverRect = detailPopoverRef.current.getBoundingClientRect();
      const viewportPadding = 12;
      const desiredGap = 8;
      let top = anchorRect.bottom + desiredGap;

      if (top + popoverRect.height > window.innerHeight - viewportPadding) {
        top = anchorRect.top - popoverRect.height - desiredGap;
      }

      let left = anchorRect.right - popoverRect.width;

      if (left + popoverRect.width > window.innerWidth - viewportPadding) {
        left = window.innerWidth - popoverRect.width - viewportPadding;
      }

      if (left < viewportPadding) {
        left = viewportPadding;
      }

      if (top < viewportPadding) {
        top = viewportPadding;
      }

      if (top + popoverRect.height > window.innerHeight - viewportPadding) {
        top = Math.max(
          viewportPadding,
          window.innerHeight - popoverRect.height - viewportPadding,
        );
      }

      setDetailPopoverPosition({ top, left });
    }

    updateDetailPopoverPosition();
    window.addEventListener("resize", updateDetailPopoverPosition);
    window.addEventListener("scroll", updateDetailPopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updateDetailPopoverPosition);
      window.removeEventListener("scroll", updateDetailPopoverPosition, true);
    };
  }, [detailPopover]);
  useEffect(() => {
    if (!detailPopover) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef?.current?.contains(target) || detailPopoverRef.current?.contains(target)) {
        return;
      }

      setDetailPopover(null);
      setDetailPopoverPosition(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDetailPopover(null);
        setDetailPopoverPosition(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailPopover, popoverRef]);

  let emptyMessage =
    breakdown.status === "error" ||
    (breakdown.status === "missing" && breakdown.cutoffLocalTime === null)
      ? breakdown.error?.trim() ?? null
      : null;
  if (!emptyMessage) {
    if (breakdown.historyDayCount === 0) {
      emptyMessage = "No stored WU history is available yet for this city.";
    } else if (breakdown.basisDayCount === 0) {
      emptyMessage = breakdown.cutoffLocalTime
        ? `No stored WU observation close enough to ${breakdown.cutoffLocalTime} to use as a basis.`
        : "No stored WU observation is available near the AW now cutoff time.";
    } else if (breakdown.laterObservationDayCount === 0) {
      emptyMessage = breakdown.cutoffLocalTime
        ? `No stored WU observations occur after ${breakdown.cutoffLocalTime}.`
        : "No stored WU observations occur after the current AW now cutoff time.";
    }
  }

  const allTimeBucketMap = new Map(
    breakdown.allTime.buckets.map((bucket) => [bucket.delta, bucket]),
  );
  const recent10BucketMap = new Map(
    breakdown.recent10.buckets.map((bucket) => [bucket.delta, bucket]),
  );
  const deltaSet = new Set<number>([0]);
  for (const bucket of breakdown.recent10.buckets) {
    deltaSet.add(bucket.delta);
  }
  if (showAllHistory) {
    for (const bucket of breakdown.allTime.buckets) {
      deltaSet.add(bucket.delta);
    }
  }

  const rows = breakdown.laterObservationDayCount > 0
    ? [...deltaSet]
        .sort((left, right) => left - right)
        .map((delta) => {
          const allTimeBucket = delta > 0 ? allTimeBucketMap.get(delta) ?? null : null;
          const recent10Bucket = delta > 0 ? recent10BucketMap.get(delta) ?? null : null;
          const allTimeCount =
            delta === 0
              ? breakdown.allTime.noHigherPeakDayCount
              : allTimeBucket?.count ?? 0;
          const recent10Count =
            delta === 0
              ? breakdown.recent10.noHigherPeakDayCount
              : recent10Bucket?.count ?? 0;

          return {
            key: delta === 0 ? "no-lift" : String(delta),
            label: delta === 0 ? "No lift" : formatDeltaTemperature(delta, unit),
            allTime: {
              count: allTimeCount,
              probability:
                breakdown.allTime.sampleDayCount > 0
                  ? allTimeCount / breakdown.allTime.sampleDayCount
                  : 0,
              sampleDayCount: breakdown.allTime.sampleDayCount,
              samples:
                delta === 0
                  ? breakdown.allTime.noHigherPeakSamples
                  : allTimeBucket?.samples ?? [],
            },
            recent10: {
              count: recent10Count,
              probability:
                breakdown.recent10.sampleDayCount > 0
                  ? recent10Count / breakdown.recent10.sampleDayCount
                  : 0,
              sampleDayCount: breakdown.recent10.sampleDayCount,
              samples:
                delta === 0
                  ? breakdown.recent10.noHigherPeakSamples
                  : recent10Bucket?.samples ?? [],
            },
          };
        })
    : [];

  return (
    <div
      className="later-high-delta-popover"
      id={popoverId}
      role="dialog"
      aria-label="Later WU peak delta breakdown"
      ref={popoverRef}
      style={style}
    >
      <div className="later-high-delta-header">
        <p>WU Jumps After Cutoff</p>
        <span>{basisLabel}</span>
      </div>
      <div className="later-high-delta-meta">
        <span>Stored days {breakdown.historyDayCount}</span>
        <span>WU basis days {breakdown.basisDayCount}</span>
        <span>Later WU obs {breakdown.laterObservationDayCount}</span>
      </div>
      <div className="later-high-delta-legend">
        <span className="later-high-delta-legend-item is-recent">
          <span className="later-high-delta-legend-swatch" />
          Recent 10 valid
        </span>
        <label className="later-high-delta-legend-item later-high-delta-history-toggle is-all">
          <span className="later-high-delta-legend-swatch" />
          <span>All history</span>
          <input
            aria-label="Show all history"
            checked={showAllHistory}
            className="later-high-delta-history-checkbox"
            onChange={(event) => {
              setShowAllHistory(event.currentTarget.checked);
            }}
            type="checkbox"
          />
        </label>
      </div>

      {emptyMessage ? (
        <p className="later-high-delta-empty">{emptyMessage}</p>
      ) : (
        <div className="later-high-delta-list" role="list">
          {rows.map((row) => {
            const seriesItems = [
              {
                key: "recent" as const,
                label: "Recent 10 valid",
                className: "is-recent",
                value: row.recent10,
              },
              ...(showAllHistory
                ? [
                    {
                      key: "all" as const,
                      label: "All history",
                      className: "is-all",
                      value: row.allTime,
                    },
                  ]
                : []),
            ];

            return (
              <div className="later-high-delta-row" role="listitem" key={row.key}>
                <span className="later-high-delta-label">{row.label}</span>
                <div
                  className={`later-high-delta-bar-stack ${showAllHistory ? "is-dual" : "is-single"}`}
                  aria-hidden="true"
                >
                  <div className="later-high-delta-bar-track is-recent">
                    <div
                      className="later-high-delta-bar-fill is-recent"
                      style={{ width: `${row.recent10.probability * 100}%` }}
                    />
                  </div>
                  {showAllHistory ? (
                    <div className="later-high-delta-bar-track is-all">
                      <div
                        className="later-high-delta-bar-fill is-all"
                        style={{ width: `${row.allTime.probability * 100}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className={`later-high-delta-series-stats ${showAllHistory ? "is-dual" : "is-single"}`}>
                  {seriesItems.map((series) => {
                    const detailKey = `${row.key}:${series.key}`;

                    return (
                      <div className="later-high-delta-series-slot" key={series.key}>
                        <button
                          aria-expanded={detailPopover?.key === detailKey}
                          aria-label={`Show ${series.label.toLowerCase()} dates for ${row.label}`}
                          className={`later-high-delta-series-button ${series.className}`}
                          onClick={(event) => {
                            toggleDetailPopover(
                              detailKey,
                              row.label,
                              series.label,
                              series.value.samples,
                              event.currentTarget,
                            );
                          }}
                          title={`${series.label}: ${formatDayCount(series.value.count)}`}
                          type="button"
                        >
                          <span className={`later-high-delta-series-count ${series.className}`}>
                            {formatCompactDayCount(series.value.count)}
                          </span>
                          <strong className={`later-high-delta-series-probability ${series.className}`}>
                            {series.value.sampleDayCount > 0
                              ? formatProbabilityPercent(series.value.probability)
                              : "—"}
                          </strong>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {breakdown.status === "stale" && breakdown.error ? (
        <p className="later-high-delta-note">{breakdown.error}</p>
      ) : null}
      {detailPopover && typeof document !== "undefined"
        ? createPortal(
            <div
              className="later-high-delta-detail-popover"
              role="tooltip"
              aria-label={`${detailPopover.seriesLabel} dates for ${detailPopover.rowLabel}`}
              ref={detailPopoverRef}
              style={
                detailPopoverPosition
                  ? {
                      top: `${detailPopoverPosition.top}px`,
                      left: `${detailPopoverPosition.left}px`,
                    }
                  : {
                      top: "-9999px",
                      left: "-9999px",
                      visibility: "hidden",
                    }
              }
            >
              <div className="later-high-delta-detail-header">
                <strong>{detailPopover.rowLabel}</strong>
                <span>{detailPopover.seriesLabel}</span>
              </div>
              {detailPopover.samples.length > 0 ? (
                <div className="later-high-delta-detail-list" role="list">
                  {detailPopover.samples.map((sample) => (
                    <div
                      className="later-high-delta-detail-item"
                      role="listitem"
                      key={`${detailPopover.key}:${sample.localDate}:${sample.peakLocalTime}`}
                    >
                      <span>{formatMonthDay(sample.localDate)}</span>
                      <strong>{sample.peakLocalTime}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="later-high-delta-detail-empty">
                  No matching valid days.
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function HistoryBasedLaterHighPanel({
  curve,
  breakdown,
  comparisonHref,
  now,
  timezone,
}: {
  curve: WeatherCard["historyBasedLaterHigh"];
  breakdown: WeatherCard["laterHighDeltaBreakdown"];
  comparisonHref: string | null;
  now: Date;
  timezone: string;
}) {
  const currentHour = Math.floor(getLocalClockMinutes(now, timezone) / 60);
  const popoverId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const breakdownPopoverRef = useRef<HTMLDivElement | null>(null);
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  const [breakdownPopoverPosition, setBreakdownPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const currentBucket = curve.buckets.find((bucket) => bucket.hour === currentHour) ?? null;
  const primaryLabel =
    currentBucket && curve.status !== "error" && curve.status !== "missing"
      ? formatProbabilityPercent(currentBucket.probability)
      : "—";
  const coverageLabel = currentBucket
    ? `${currentBucket.futureHigherCount}/${currentBucket.sampleCount} days`
    : "No current-hour bucket";
  const className =
    curve.status === "error" || curve.status === "missing"
      ? "history-probability-panel is-error"
      : curve.status === "stale"
        ? "history-probability-panel is-stale"
        : "history-probability-panel";
  const closeBreakdown = useEffectEvent(() => {
    setIsBreakdownOpen(false);
    setBreakdownPopoverPosition(null);
  });
  const toggleBreakdown = useEffectEvent(() => {
    setIsBreakdownOpen((currentValue) => !currentValue);
  });
  useEffect(() => {
    setIsBreakdownOpen(false);
  }, [breakdown.generatedAt, breakdown.cutoffLocalTime]);
  useEffect(() => {
    if (!isBreakdownOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        panelRef.current?.contains(target) ||
        breakdownPopoverRef.current?.contains(target) ||
        (target instanceof Element && target.closest(".later-high-delta-detail-popover"))
      ) {
        return;
      }

      closeBreakdown();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeBreakdown();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeBreakdown, isBreakdownOpen]);
  useEffect(() => {
    if (!isBreakdownOpen || !triggerRef.current || !breakdownPopoverRef.current) {
      return;
    }

    function updateBreakdownPopoverPosition() {
      if (!triggerRef.current || !breakdownPopoverRef.current) {
        return;
      }

      const anchorRect = triggerRef.current.getBoundingClientRect();
      const popoverRect = breakdownPopoverRef.current.getBoundingClientRect();
      const viewportPadding = 12;
      const desiredGap = 10;
      let top = anchorRect.bottom + desiredGap;

      if (top + popoverRect.height > window.innerHeight - viewportPadding) {
        top = anchorRect.top - popoverRect.height - desiredGap;
      }

      let left = anchorRect.right - popoverRect.width;

      if (left + popoverRect.width > window.innerWidth - viewportPadding) {
        left = window.innerWidth - popoverRect.width - viewportPadding;
      }

      if (left < viewportPadding) {
        left = viewportPadding;
      }

      if (top < viewportPadding) {
        top = viewportPadding;
      }

      if (top + popoverRect.height > window.innerHeight - viewportPadding) {
        top = Math.max(
          viewportPadding,
          window.innerHeight - popoverRect.height - viewportPadding,
        );
      }

      setBreakdownPopoverPosition({ top, left });
    }

    updateBreakdownPopoverPosition();
    window.addEventListener("resize", updateBreakdownPopoverPosition);
    window.addEventListener("scroll", updateBreakdownPopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updateBreakdownPopoverPosition);
      window.removeEventListener("scroll", updateBreakdownPopoverPosition, true);
    };
  }, [breakdown.cutoffLocalTime, breakdown.generatedAt, isBreakdownOpen]);

  const content = (
    <div className="history-probability-copy">
      <div className="history-probability-heading">
        <p>Later High</p>
        <span>{coverageLabel}</span>
      </div>
      <strong>{primaryLabel}</strong>
    </div>
  );

  return (
    <>
      <section
        className={`${className} has-breakdown${isBreakdownOpen ? " is-breakdown-open" : ""}`}
        aria-label="History-based later high probability"
        ref={panelRef}
      >
        <div className="history-probability-shell">
          {comparisonHref ? (
            <Link
              className="history-probability-main-link"
              to={comparisonHref}
              target="_blank"
              rel="noreferrer"
              aria-label="Open comparison for recent resolved days"
            >
              {content}
            </Link>
          ) : (
            <div className="history-probability-main">
              {content}
            </div>
          )}
          <button
            aria-controls={popoverId}
            aria-expanded={isBreakdownOpen}
            aria-label="Open WU jump breakdown"
            className={`history-probability-breakdown-trigger is-${breakdown.status}`}
            onClick={() => toggleBreakdown()}
            ref={triggerRef}
            type="button"
          >
            <span className="visually-hidden">Open WU jump breakdown</span>
            <svg
              aria-hidden="true"
              className="history-probability-breakdown-icon"
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                d="M3 16.25H17"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
              <path
                d="M5.25 14V10.75"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.75"
              />
              <path
                d="M10 14V7.75"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.75"
              />
              <path
                d="M14.75 14V5.25"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.75"
              />
              <path
                d="M4.5 7.5L8.4 5.15L11.2 6.55L15.5 3.75"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.35"
              />
            </svg>
          </button>
        </div>
      </section>

      {isBreakdownOpen && typeof document !== "undefined"
        ? createPortal(
            <LaterHighDeltaPopover
              breakdown={breakdown}
              popoverId={popoverId}
              popoverRef={breakdownPopoverRef}
              style={
                breakdownPopoverPosition
                  ? {
                      top: `${breakdownPopoverPosition.top}px`,
                      left: `${breakdownPopoverPosition.left}px`,
                    }
                  : {
                      top: "-9999px",
                      left: "-9999px",
                      visibility: "hidden",
                    }
              }
            />,
            document.body,
          )
        : null}
    </>
  );
}

function formatSignalClock(value: string | null, timezone: string) {
  if (!value) {
    return null;
  }

  return formatLocalClockFromDate(new Date(value), timezone);
}

function buildNextHoursMeta(signals: WeatherSignals, timezone: string) {
  const parts = [getSourceShortLabel(signals.sourceId, signals.sourceLabel)];
  const publishedLabel = formatSignalClock(signals.publishedAt, timezone);
  const runLabel = formatSignalClock(signals.modelRunInitialisedAt, timezone);

  if (publishedLabel) {
    parts.push(`pub ${publishedLabel}`);
  } else if (runLabel) {
    parts.push(`run ${runLabel}`);
  }

  if (signals.status !== "fresh") {
    parts.push(signals.status);
  }

  return parts.join(" · ");
}

function weatherSignalsPanelClassName(baseClassName: string, status: WeatherSignals["status"]) {
  if (status === "stale") {
    return `${baseClassName} is-stale`;
  }

  if (status === "error" || status === "missing") {
    return `${baseClassName} is-error`;
  }

  return baseClassName;
}

function buildCardComparisonHref(card: WeatherCard) {
  const endDate = card.latestResolvedComparisonDate;

  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }

  return buildComparisonHref({
    city: card.airport.slug,
    startDate: shiftIsoDate(endDate, -8),
    endDate,
    selectedDate: endDate,
  });
}

function WeatherSummaryStrip({
  signals,
  visual,
  summary,
}: {
  signals: WeatherSummarySignals;
  visual: WeatherVisual;
  summary: string;
}) {
  const note = signals.error?.trim() ?? null;

  return (
    <section
      className={weatherSignalsPanelClassName("weather-summary-strip", signals.status)}
      aria-label="Weather signals summary"
    >
      <div className="weather-summary-line">
        <div className="weather-summary-main">
          <span className={`signals-icon weather-summary-icon ${visual.accentClass}`}>
            <WeatherGlyph kind={visual.kind} />
          </span>
          <div className="weather-summary-copy">
            <strong>{summary}</strong>
          </div>
        </div>
        <span className="weather-summary-sunset">
          Sunset {formatLocalClockLabel(signals.sunset)}
        </span>
      </div>

      <div className="signals-chip-row">
        <span className="signals-chip">Rain {formatPercent(signals.precipitationProbability)}</span>
        <span className="signals-chip">Cloud {formatPercent(signals.cloudCover)}</span>
        <span className="signals-chip">Wind {formatWindSpeed(signals.windSpeed)}</span>
      </div>

      {note ? <p className="weather-summary-note">{note}</p> : null}
    </section>
  );
}

function NextHoursStrip({
  availableSignals,
  activeSourceId,
  onSelectSource,
  signals,
  displayUnit,
  timezone,
}: {
  availableSignals: WeatherSignals[];
  activeSourceId: string;
  onSelectSource: (sourceId: string) => void;
  signals: WeatherSignals;
  displayUnit: TemperatureUnit;
  timezone: string;
}) {
  const metaLabel = buildNextHoursMeta(signals, timezone);
  const note = signals.error?.trim() ?? null;

  return (
    <section
      className={weatherSignalsPanelClassName("next-hours-panel", signals.status)}
      aria-label="Next few hours forecast"
    >
      <div className="next-hours-header">
        <p className="signals-section-label">Next few hours</p>
        <span>{metaLabel}</span>
      </div>

      {availableSignals.length > 1 ? (
        <div className="next-hours-tabs" role="tablist" aria-label="Forecast source">
          {availableSignals.map((sourceSignals) => {
            const isActive = sourceSignals.sourceId === activeSourceId;

            return (
              <button
                key={sourceSignals.sourceId}
                className={isActive ? "next-hours-tab is-active" : "next-hours-tab"}
                onClick={() => onSelectSource(sourceSignals.sourceId)}
                role="tab"
                aria-selected={isActive}
                type="button"
              >
                {getSourceShortLabel(sourceSignals.sourceId, sourceSignals.sourceLabel)}
              </button>
            );
          })}
        </div>
      ) : null}

      {signals.nextHours.length > 0 ? (
        <div className="next-hours-grid">
          {signals.nextHours.map((point, index) => (
            <div className="next-hour-card" key={`${point.forecastAt}-${index}`}>
              <p>{formatLocalClockLabel(point.forecastAt)}</p>
              <strong>{formatRawTemperature(point.temperature, displayUnit)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="next-hours-empty">No hourly signal data yet.</p>
      )}

      {note ? <p className="next-hours-note">{note}</p> : null}
    </section>
  );
}

function WeatherCardTrendDetails({
  card,
  now,
}: {
  card: WeatherCard;
  now: Date;
}) {
  const displayUnit = getAirportDisplayTemperatureUnit(card.airport);
  const comparisonHref = buildCardComparisonHref(card);
  const historyBasedLaterHigh = card.historyBasedLaterHigh ?? {
    generatedAt: null,
    method: null,
    buckets: [],
    status: "missing" as const,
    error: null,
  };
  const laterHighDeltaBreakdown = card.laterHighDeltaBreakdown ?? {
    generatedAt: null,
    method: null,
    cutoffLocalTime: null,
    displayUnit: null,
    historyDayCount: 0,
    basisDayCount: 0,
    laterObservationDayCount: 0,
    recentValidDayCount: 0,
    allTime: {
      sampleDayCount: 0,
      noHigherPeakDayCount: 0,
      noHigherPeakSamples: [],
      positiveDeltaDayCount: 0,
      maxDelta: null,
      buckets: [],
    },
    recent10: {
      sampleDayCount: 0,
      noHigherPeakDayCount: 0,
      noHigherPeakSamples: [],
      positiveDeltaDayCount: 0,
      maxDelta: null,
      buckets: [],
    },
    status: "missing" as const,
    error: null,
  };

  return (
    <>
      <ObservedTemperatureChart
        trend={card.aviationWeatherTrend}
        timezone={card.airport.timezone}
        displayUnit={displayUnit}
      />

      <HistoryBasedLaterHighPanel
        curve={historyBasedLaterHigh}
        breakdown={laterHighDeltaBreakdown}
        comparisonHref={comparisonHref}
        now={now}
        timezone={card.airport.timezone}
      />
    </>
  );
}

function WeatherCardNextHoursDetails({
  card,
}: {
  card: WeatherCard;
}) {
  const displayUnit = getAirportDisplayTemperatureUnit(card.airport);
  const availableSignals = Object.values(card.weatherSignalsBySource ?? {});
  const [activeNextHoursSourceId, setActiveNextHoursSourceId] = useState(
    card.defaultWeatherSignalsSourceId,
  );
  const nextHoursSignals = getCardWeatherSignals(card, activeNextHoursSourceId);

  useEffect(() => {
    if (
      availableSignals.length > 0 &&
      !availableSignals.some((entry) => entry.sourceId === activeNextHoursSourceId)
    ) {
      setActiveNextHoursSourceId(card.defaultWeatherSignalsSourceId);
    }
  }, [activeNextHoursSourceId, availableSignals, card.defaultWeatherSignalsSourceId]);

  return (
    <NextHoursStrip
      availableSignals={availableSignals}
      activeSourceId={nextHoursSignals.sourceId}
      onSelectSource={setActiveNextHoursSourceId}
      signals={nextHoursSignals}
      displayUnit={displayUnit}
      timezone={card.airport.timezone}
    />
  );
}

function WeatherCardView({
  card,
  now,
  isRefreshing,
  disableRefresh,
  onRefresh,
}: {
  card: WeatherCardSummary;
  now: Date;
  isRefreshing: boolean;
  disableRefresh: boolean;
  onRefresh: (slug: string) => void;
}) {
  const resolvedMarketUrl = buildPolymarketEventUrl(
    card.airport.city,
    now,
    card.airport.timezone,
  );
  const displayUnit = getAirportDisplayTemperatureUnit(card.airport);
  const signals = card.defaultWeatherSignals ?? EMPTY_WEATHER_SUMMARY_SIGNALS;
  const signalVisual = getWeatherVisual(signals);
  const signalSummary = buildWeatherSummary(signals);
  const [detailCard, setDetailCard] = useState<WeatherCard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [shouldLoadDetails, setShouldLoadDetails] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef(0);
  const detailIsCurrent =
    detailCard?.airport.slug === card.airport.slug &&
    detailCard.cardUpdatedAt === card.cardUpdatedAt;
  const currentReadings = [
    {
      label: "WU now",
      reading: card.wuCurrent,
    },
    {
      label: "WU high",
      reading: card.wuTodayHigh,
    },
    {
      label: "AW now",
      reading: card.aviationWeatherCurrent,
    },
  ];
  const todayHighReadings = [
    {
      label: getSourceShortLabel(
        card.openMeteoTodayHigh.ecmwf.sourceId,
        card.openMeteoTodayHigh.ecmwf.sourceLabel,
      ),
      reading: card.openMeteoTodayHigh.ecmwf,
    },
    {
      label: getSourceShortLabel(
        card.openMeteoTodayHigh.gfs.sourceId,
        card.openMeteoTodayHigh.gfs.sourceLabel,
      ),
      reading: card.openMeteoTodayHigh.gfs,
    },
    ...(card.openMeteoTodayHigh.highPrecision
      ? [
          {
            label: getSourceShortLabel(
              card.openMeteoTodayHigh.highPrecision.sourceId,
              card.openMeteoTodayHigh.highPrecision.sourceLabel,
            ),
            reading: card.openMeteoTodayHigh.highPrecision,
          },
        ]
      : []),
  ];

  const requestDetails = useEffectEvent(async () => {
    if (detailLoading) {
      return;
    }

    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;

    setDetailLoading(true);
    setDetailError(null);

    try {
      const payload = await fetchWeatherCardDetail(card.airport.slug, controller.signal);
      if (detailRequestRef.current !== requestId) {
        return;
      }

      if (!payload.card) {
        setDetailError("Details are still loading. Try again in a moment.");
        return;
      }

      setDetailCard(payload.card);
    } catch (error) {
      if (controller.signal.aborted || detailRequestRef.current !== requestId) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unexpected detail load failure";
      setDetailError(message);
    } finally {
      if (detailRequestRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  });

  useEffect(() => {
    const node = cardRef.current;
    if (!node) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoadDetails(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setShouldLoadDetails(true);
        observer.disconnect();
      },
      {
        rootMargin: "360px 0px",
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      detailAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!shouldLoadDetails || detailIsCurrent || detailLoading) {
      return;
    }

    void requestDetails();
  }, [card.cardUpdatedAt, detailIsCurrent, detailLoading, requestDetails, shouldLoadDetails]);

  const detailStatus = detailError ?? (detailLoading ? "Loading details…" : null);

  return (
    <article className="weather-card" ref={cardRef}>
      <div className="card-topline" />
      <header className="card-header">
        <div className="card-title-row">
          <div className="card-title-main">
            <a
              className="card-city-link"
              href={resolvedMarketUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${card.airport.city} market (${card.airport.stationIcao})`}
            >
              <p className="card-city">{card.airport.city}</p>
            </a>
          </div>
          <div className="card-title-actions">
            <div className="card-local-time">
              <span className="card-local-time-value">
                {formatLocalTime(now, card.airport.timezone)}
              </span>
            </div>
            <button
              className="refresh-button card-refresh-button"
              onClick={() => onRefresh(card.airport.slug)}
              disabled={disableRefresh}
              type="button"
              aria-label={`Refresh ${card.airport.city}`}
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <WeatherSummaryStrip
          signals={signals}
          visual={signalVisual}
          summary={signalSummary}
        />
      </header>

      <CompactCurrentReadings
        readings={currentReadings}
        displayUnit={displayUnit}
        timezone={card.airport.timezone}
      />

      {detailCard ? (
        <WeatherCardTrendDetails card={detailCard} now={now} />
      ) : (
        <section className="trend-panel" aria-label="Observed temperature trend">
          <div className="trend-header">
            <p>AW observed today</p>
            <span>{detailStatus ?? "Loading details…"}</span>
          </div>
          <div className="trend-empty">{detailStatus ?? "Loading details…"}</div>
        </section>
      )}

      {!detailCard ? (
        <section className="history-probability-panel" aria-label="History-based later high probability">
          <div className="history-probability-copy">
            <div className="history-probability-heading">
              <p>Later High</p>
              <span>{detailStatus ?? "Loading details…"}</span>
            </div>
            <strong>—</strong>
          </div>
        </section>
      ) : null}

      <section className="forecast-panel">
        <div className="forecast-header">
          <p>Open-Meteo today high</p>
        </div>

        <CompactTodayHighReadings
          readings={todayHighReadings}
          displayUnit={displayUnit}
        />
      </section>

      {detailCard ? (
        <WeatherCardNextHoursDetails card={detailCard} />
      ) : (
        <section className="next-hours-panel" aria-label="Next few hours forecast">
          <div className="next-hours-header">
            <p className="signals-section-label">Next few hours</p>
            <span>{detailStatus ?? "Loading details…"}</span>
          </div>
          <p className="next-hours-empty">{detailStatus ?? "Loading details…"}</p>
        </section>
      )}
    </article>
  );
}

function SkeletonCard({ city }: { city: string }) {
  return (
    <article className="weather-card card-skeleton">
      <div className="card-topline" />
      <header className="card-header">
        <div className="card-title-row">
          <p className="card-city">{city}</p>
        </div>
      </header>
      <div className="card-skeleton-line card-skeleton-wide" />
      <div className="card-skeleton-line" />
      <div className="card-skeleton-line" />
      <div className="card-skeleton-line" />
      <div className="card-skeleton-line" />
    </article>
  );
}

export function WeatherDashboard() {
  const initialResponse = readBootstrappedHomeResponse();
  const [response, setResponse] = useState<WeatherResponse | null>(initialResponse);
  const [initialLoading, setInitialLoading] = useState(
    () => initialResponse === null,
  );
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pendingCardRefreshes, setPendingCardRefreshes] = useState<Record<string, boolean>>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const stoppedRef = useRef(false);
  const latestAcceptedResponseRef = useRef<WeatherResponse | null>(initialResponse);

  function acceptSnapshot(payload: WeatherResponse) {
    const currentPayload = latestAcceptedResponseRef.current;
    if (
      currentPayload &&
      currentPayload.responseIssuedAt > payload.responseIssuedAt
    ) {
      return currentPayload;
    }

    latestAcceptedResponseRef.current = payload;
    startTransition(() => {
      setResponse(payload);
      setRequestError(null);
    });

    return payload;
  }

  async function fetchSnapshot(url: string, init?: RequestInit) {
    const result = await fetch(url, {
      cache: "no-store",
      ...init,
    });

    const payload = (await result.json()) as WeatherResponse;
    if (!result.ok) {
      throw new Error(payload.globalError ?? `HTTP ${result.status}`);
    }

    return acceptSnapshot(payload);
  }

  async function pollUntilSettled(
    shouldStop: () => boolean,
    isSettled: (payload: WeatherResponse) => boolean,
  ) {
    while (!shouldStop()) {
      await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_POLL_INTERVAL_MS));
      if (shouldStop()) {
        return;
      }

      const payload = await fetchSnapshot("/api/weather");
      if (isSettled(payload)) {
        return;
      }
    }
  }

  async function performRefresh(mode: "initial" | "manual", shouldStop: () => boolean) {
    if (mode === "manual") {
      setManualRefreshing(true);
    }

    try {
      const payload = await fetchSnapshot("/api/weather/refresh", {
        method: "POST",
      });

      if (
        payload.refreshState === "refreshing" ||
        payload.refreshingCardSlugs.length > 0
      ) {
        await pollUntilSettled(
          shouldStop,
          (nextPayload) =>
            nextPayload.refreshState !== "refreshing" &&
            nextPayload.refreshingCardSlugs.length === 0,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected refresh failure";
      if (!shouldStop()) {
        setRequestError(message);
      }
    } finally {
      if (!shouldStop()) {
        setInitialLoading(false);
        setManualRefreshing(false);
      }
    }
  }

  async function performCardRefresh(slug: string, shouldStop: () => boolean) {
    setPendingCardRefreshes((current) => ({
      ...current,
      [slug]: true,
    }));

    try {
      const payload = await fetchSnapshot(`/api/weather/refresh?slug=${encodeURIComponent(slug)}`, {
        method: "POST",
      });

      if (payload.refreshingCardSlugs.includes(slug)) {
        await pollUntilSettled(
          shouldStop,
          (nextPayload) => !nextPayload.refreshingCardSlugs.includes(slug),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected refresh failure";
      if (!shouldStop()) {
        setRequestError(message);
      }
    } finally {
      if (!shouldStop()) {
        setPendingCardRefreshes((current) => {
          if (!current[slug]) {
            return current;
          }

          const next = { ...current };
          delete next[slug];
          return next;
        });
        setInitialLoading(false);
      }
    }
  }

  const refreshOnMount = useEffectEvent(async (shouldStop: () => boolean) => {
    const currentPayload = latestAcceptedResponseRef.current;
    if (currentPayload) {
      if (
        currentPayload.refreshState === "refreshing" ||
        currentPayload.refreshingCardSlugs.length > 0
      ) {
        await pollUntilSettled(
          shouldStop,
          (nextPayload) =>
            nextPayload.refreshState !== "refreshing" &&
            nextPayload.refreshingCardSlugs.length === 0,
        );
        return;
      }

      if (isWeatherSnapshotFreshEnough(currentPayload)) {
        if (!shouldStop()) {
          setInitialLoading(false);
        }
        return;
      }
    }

    await performRefresh("initial", shouldStop);
  });

  useEffect(() => {
    stoppedRef.current = false;

    void refreshOnMount(() => stoppedRef.current);

    return () => {
      stoppedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, LOCAL_TIME_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const cards = response?.cards ?? null;
  const cardMap = new Map((cards ?? []).map((card) => [card.airport.slug, card]));
  const issueSummary = requestError ?? response?.globalError ?? null;
  const refreshingCardSlugs = response?.refreshingCardSlugs ?? [];
  const hasRefreshingCards =
    refreshingCardSlugs.length > 0 || Object.keys(pendingCardRefreshes).length > 0;
  const isCardRefreshing = (slug: string) =>
    Boolean(pendingCardRefreshes[slug]) || refreshingCardSlugs.includes(slug);
  const sortedAirports = [...AIRPORTS].sort((left, right) => {
    const timeDifference =
      getLocalTimeSortKey(now, left.timezone) - getLocalTimeSortKey(now, right.timezone);

    if (timeDifference !== 0) {
      return timeDifference;
    }

    return left.city.localeCompare(right.city);
  });

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <h1>Polyweather</h1>
        <div className="hero-actions">
          <Link className="secondary-action-link" to="/comparison">
            Settlement comparison
          </Link>
          <button
            className="refresh-button"
            onClick={() => void performRefresh("manual", () => stoppedRef.current)}
            disabled={initialLoading || manualRefreshing || hasRefreshingCards}
            type="button"
          >
            {manualRefreshing ? "Refreshing all…" : "Refresh all"}
          </button>
          <p className="snapshot-time">
            Updated {formatSnapshotTime(response?.refreshedAt ?? null)}
          </p>
        </div>
      </section>

      {issueSummary ? (
        <section className="alert-banner" role="status">
          {issueSummary}
        </section>
      ) : null}

      <section className="cards-grid">
        {sortedAirports.map((airport) => {
          const card = cardMap.get(airport.slug);

          if (card) {
            return (
              <WeatherCardView
                key={card.airport.slug}
                card={card}
                now={now}
                isRefreshing={isCardRefreshing(card.airport.slug)}
                disableRefresh={
                  initialLoading ||
                  manualRefreshing ||
                  response?.refreshState === "refreshing" ||
                  isCardRefreshing(card.airport.slug)
                }
                onRefresh={(slug) =>
                  void performCardRefresh(slug, () => stoppedRef.current)
                }
              />
            );
          }

          return (
            <SkeletonCard
              key={airport.slug}
              city={airport.city}
            />
          );
        })}
      </section>

      {!initialLoading &&
      response?.refreshState !== "refreshing" &&
      (!cards || cards.length === 0) ? (
        <section className="empty-state">
          <h2>No snapshot available yet.</h2>
          <p>
            The server could not assemble a full response. Fix the upstream issue or
            set `WUNDERGROUND_SUN_API_KEY`, then use the refresh button again.
          </p>
        </section>
      ) : null}
    </main>
  );
}
