import { Link } from "react-router-dom";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { AIRPORTS } from "../../lib/airports";
import { buildComparisonHref } from "../../lib/comparison/query";
import { convertTemperature, getAirportDisplayTemperatureUnit } from "../../lib/temperature";
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
const LOCAL_TIME_SORT_START_MINUTES = 11 * 60;
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

function formatLocalHourLabel(hour: number | null) {
  if (typeof hour !== "number" || Number.isNaN(hour)) {
    return "—";
  }

  return `${String(hour).padStart(2, "0")}:00`;
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

function readingClassName(reading: SourceReading, variant: "card" | "plain") {
  if (variant === "plain") {
    return "reading reading-plain";
  }

  if (reading.status === "fresh") {
    return "reading reading-fresh";
  }
  if (reading.status === "stale") {
    return "reading reading-stale";
  }
  return "reading reading-error";
}

function ReadingRow({
  label,
  reading,
  displayUnit,
  timezone,
  variant = "card",
  noWrapLabel = false,
  noWrapValue = false,
}: {
  label: string;
  reading: SourceReading;
  displayUnit: TemperatureUnit;
  timezone: string;
  variant?: "card" | "plain";
  noWrapLabel?: boolean;
  noWrapValue?: boolean;
}) {
  const readingNote = reading.error?.trim() ?? "";
  const timestampText = reading.observedAt
    ? formatObservedAt(reading.observedAt, timezone)
    : reading.forecastDate
      ? `Forecast ${formatForecastDate(reading.forecastDate)}`
      : "No timestamp";
  const plainMetaText = readingNote ? `${timestampText} · ${readingNote}` : timestampText;
  const showStatusPill =
    variant === "card" && reading.status !== "fresh" && reading.status !== "error";

  return (
    <div className={readingClassName(reading, variant)}>
      <div className="reading-header">
        <span className={noWrapLabel ? "reading-label reading-label-nowrap" : "reading-label"}>
          {label}
        </span>
        {showStatusPill ? (
          <span className={`status-pill status-${reading.status}`}>{reading.status}</span>
        ) : null}
      </div>
      <strong className={noWrapValue ? "reading-value reading-value-nowrap" : "reading-value"}>
        {formatTemperature(reading, displayUnit)}
      </strong>
      <p className="reading-meta">
        {variant === "plain" ? plainMetaText : timestampText}
      </p>
      {variant === "card" && readingNote ? <p className="reading-note">{readingNote}</p> : null}
    </div>
  );
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

        return (
          <div
            key={`${label}-value`}
            className={`forecast-compact-value-cell is-${reading.status}`}
            title={tooltip}
          >
            <strong className="forecast-compact-value">
              {formatTemperature(reading, displayUnit)}
            </strong>
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
  now,
  displayUnit,
}: {
  trend: TemperatureTrend;
  timezone: string;
  now: Date;
  displayUnit: TemperatureUnit;
}) {
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const latestPoint = trend.points.at(-1) ?? null;
  const currentMinutes = Math.max(getLocalClockMinutes(now, timezone), 1);
  const chartPoints = trend.points.map((point) => {
    const rawTemperature = point.temperature;
    const temperature =
      displayUnit === "C"
        ? rawTemperature
        : convertTemperature(rawTemperature, "C", displayUnit);

    return {
      ...point,
      minutes: Math.min(getLocalClockMinutes(point.observedAt, timezone), currentMinutes),
      temperature,
    };
  });
  const temperatures = chartPoints.map((point) => point.temperature);
  const minTemperature = temperatures.length > 0 ? Math.min(...temperatures) : null;
  const maxTemperature = temperatures.length > 0 ? Math.max(...temperatures) : null;
  const temperatureRange =
    minTemperature !== null && maxTemperature !== null ? maxTemperature - minTemperature : 0;
  const chartLeft = 8;
  const chartRight = 312;
  const chartTop = 10;
  const chartBottom = 84;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const yPadding =
    minTemperature === null || maxTemperature === null
      ? 1
      : temperatureRange < 0.8
        ? 0.35
        : temperatureRange * 0.08;
  const yMin = minTemperature === null ? 0 : minTemperature - yPadding;
  const yMax = maxTemperature === null ? 1 : maxTemperature + yPadding;
  const yMid = chartTop + chartHeight / 2;
  const axisTopLabel =
    maxTemperature === null ? "—" : formatRawTemperature(maxTemperature, displayUnit);
  const axisMidLabel =
    minTemperature === null || maxTemperature === null
      ? "—"
      : formatRawTemperature((minTemperature + maxTemperature) / 2, displayUnit);
  const axisBottomLabel =
    minTemperature === null ? "—" : formatRawTemperature(minTemperature, displayUnit);
  const coordinates = chartPoints.map((point) => {
    const x = chartLeft + (point.minutes / currentMinutes) * chartWidth;
    const y =
      chartTop + (1 - (point.temperature - yMin) / Math.max(yMax - yMin, 0.001)) * chartHeight;

    return {
      x,
      y,
    };
  });
  const hoveredCoordinate =
    hoveredPointIndex !== null ? coordinates[hoveredPointIndex] ?? null : null;
  const hoveredPoint =
    hoveredPointIndex !== null ? chartPoints[hoveredPointIndex] ?? null : null;
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coordinates.length > 0
      ? `${linePath} L ${coordinates.at(-1)?.x.toFixed(1)} ${chartBottom} L ${coordinates[0]?.x.toFixed(1)} ${chartBottom} Z`
      : "";
  const latestLabel = latestPoint
    ? `Through ${formatObservedAt(latestPoint.observedAt, timezone)}`
    : "No same-day AW observations yet";
  const statusLabel =
    trend.status === "stale"
      ? "Stale"
      : trend.status === "error" || trend.status === "missing"
        ? "Unavailable"
        : null;

  return (
    <section className="trend-panel" aria-label="Observed temperature trend">
      <div className="trend-header">
        <p>AW observed today</p>
        <span>{statusLabel ? `${statusLabel} · ${latestLabel}` : latestLabel}</span>
      </div>

      {coordinates.length > 0 ? (
        <>
          <div className="trend-chart-frame">
            <div className="trend-y-axis" aria-hidden="true">
              <span>{axisTopLabel}</span>
              <span>{axisMidLabel}</span>
              <span>{axisBottomLabel}</span>
            </div>
            <div className="trend-chart">
              <svg
                className="trend-chart-svg"
                viewBox="0 0 320 104"
                role="img"
                aria-label="Observed temperature curve from local midnight to now"
              >
                <line className="trend-grid-line" x1={chartLeft} x2={chartRight} y1={chartTop} y2={chartTop} />
                <line className="trend-grid-line" x1={chartLeft} x2={chartRight} y1={yMid} y2={yMid} />
                <line
                  className="trend-grid-line trend-grid-line-strong"
                  x1={chartLeft}
                  x2={chartRight}
                  y1={chartBottom}
                  y2={chartBottom}
                />
                {areaPath ? <path className="trend-area" d={areaPath} /> : null}
                {linePath ? <path className="trend-line" d={linePath} /> : null}
                {coordinates.length > 0 ? (
                  <circle
                    className="trend-point"
                    cx={coordinates.at(-1)?.x}
                    cy={coordinates.at(-1)?.y}
                    r="3.5"
                  />
                ) : null}
                {coordinates.map((point, index) => (
                  <circle
                    key={`${chartPoints[index]?.observedAt ?? "trend-point"}-${index}`}
                    className="trend-hitbox"
                    cx={point.x}
                    cy={point.y}
                    r="10"
                    onMouseEnter={() => setHoveredPointIndex(index)}
                    onMouseMove={() => setHoveredPointIndex(index)}
                    onFocus={() => setHoveredPointIndex(index)}
                    onBlur={() => setHoveredPointIndex((currentIndex) => (currentIndex === index ? null : currentIndex))}
                    onMouseLeave={() => setHoveredPointIndex((currentIndex) => (currentIndex === index ? null : currentIndex))}
                    tabIndex={0}
                  />
                ))}
              </svg>
              {hoveredCoordinate && hoveredPoint ? (
                <div
                  className="trend-tooltip"
                  style={{
                    left: `${Math.min(Math.max(hoveredCoordinate.x / 320, 0.08), 0.92) * 100}%`,
                    top: `${Math.min(Math.max((hoveredCoordinate.y - 8) / 104, 0.12), 0.88) * 100}%`,
                  }}
                >
                  <strong>{formatRawTemperature(hoveredPoint.temperature, displayUnit)}</strong>
                  <span>{formatObservedAt(hoveredPoint.observedAt, timezone)}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="trend-axis">
            <span>00:00</span>
            <strong>
              {latestPoint
                ? formatRawTemperature(
                    displayUnit === "C"
                      ? latestPoint.temperature
                      : convertTemperature(latestPoint.temperature, "C", displayUnit),
                    displayUnit,
                  )
                : "—"}
            </strong>
            <span>{formatLocalClockFromDate(now, timezone)}</span>
          </div>
        </>
      ) : (
        <div className="trend-empty">
          {trend.error?.trim() ?? "No same-day AW observations yet."}
        </div>
      )}
    </section>
  );
}

function HistoryBasedLaterHighPanel({
  curve,
  comparisonHref,
  now,
  timezone,
}: {
  curve: WeatherCard["historyBasedLaterHigh"];
  comparisonHref: string | null;
  now: Date;
  timezone: string;
}) {
  const currentHour = Math.floor(getLocalClockMinutes(now, timezone) / 60);
  const currentBucket = curve.buckets.find((bucket) => bucket.hour === currentHour) ?? null;
  const primaryLabel =
    currentBucket && curve.status !== "error" && curve.status !== "missing"
      ? formatProbabilityPercent(currentBucket.probability)
      : "—";
  const coverageLabel = currentBucket
    ? `${currentBucket.sampleCount}/${currentBucket.eligibleDayCount} days`
    : "No current-hour bucket";
  const className =
    curve.status === "error" || curve.status === "missing"
      ? "history-probability-panel is-error"
      : curve.status === "stale"
        ? "history-probability-panel is-stale"
        : "history-probability-panel";
  const content = (
    <div className="history-probability-copy">
      <div className="history-probability-heading">
        <p>Later high odds</p>
        <span>{coverageLabel}</span>
      </div>
      <strong>{primaryLabel}</strong>
    </div>
  );

  if (comparisonHref) {
    return (
      <Link
        className={`${className} is-link`}
        to={comparisonHref}
        target="_blank"
        rel="noreferrer"
        aria-label="Open comparison for recent resolved days"
      >
        {content}
      </Link>
    );
  }

  return (
    <section className={className} aria-label="History-based later high probability">
      {content}
    </section>
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
    startDate: shiftIsoDate(endDate, -6),
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

  return (
    <>
      <ObservedTemperatureChart
        trend={card.aviationWeatherTrend}
        timezone={card.airport.timezone}
        now={now}
        displayUnit={displayUnit}
      />

      <HistoryBasedLaterHighPanel
        curve={historyBasedLaterHigh}
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
            >
              <p className="card-city">{card.airport.city}</p>
            </a>
            <a
              className="card-icao-link card-icao-wrap"
              href={resolvedMarketUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${card.airport.city} Polymarket market`}
            >
              <span className="card-icao-label" aria-label={card.airport.airportName}>
                {card.airport.stationIcao}
              </span>
              <div className="card-icao-tip" role="tooltip">
                {card.airport.airportName}
              </div>
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
              <p>Later high odds</p>
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

function SkeletonCard({ city, stationIcao }: { city: string; stationIcao: string }) {
  return (
    <article className="weather-card card-skeleton">
      <div className="card-topline" />
      <header className="card-header">
        <div className="card-title-row">
          <p className="card-city">{city}</p>
          <h2>{stationIcao}</h2>
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
              stationIcao={airport.stationIcao}
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
