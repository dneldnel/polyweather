import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Form, Link, useRevalidator } from "react-router-dom";

import { AIRPORTS } from "../../lib/airports";
import { buildComparisonHref } from "../../lib/comparison/query";
import { TemperatureHistoryChart } from "./temperature-history-chart";

import type {
  ComparisonCityReport,
  ComparisonDayDetail,
  ComparisonDayRecord,
  ComparisonSyncJobLookupResponse,
  ComparisonSyncMode,
  ComparisonSyncJobSnapshot,
  ComparisonSyncJobStartResponse,
  ComparisonPolymarketDay,
  ComparisonReport,
} from "../../lib/comparison/types";

type ComparisonDashboardProps = {
  initialStartDate: string;
  initialEndDate: string;
  initialCity: string;
  initialSelectedDate: string | null;
  initialReport: ComparisonReport;
  initialCityDetail: ComparisonCityReport | null;
  initialDayDetail: ComparisonDayDetail | null;
  initialEarliestResolvedDate: string | null;
  statusLabel?: string;
  isLoading?: boolean;
};

const CITY_PICKER_OPTIONS = AIRPORTS.map((airport) => ({
  value: airport.slug,
  label: airport.city,
}));
const COMPARISON_SYNC_POLL_INTERVAL_MS = 2_000;

function formatComparisonSyncStatus(status: ComparisonSyncJobSnapshot["status"]) {
  if (status === "completed") {
    return "Completed";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Running";
}

function formatComparisonSyncScope(job: ComparisonSyncJobSnapshot) {
  return (
    job.scopeLabel ??
    `${job.startDate}..${job.endDate}${job.cityFilter ? ` · ${job.cityFilter}` : " · all cities"}`
  );
}

function formatComparisonSyncTimestamp(value: string | null) {
  if (!value) {
    return "—";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatComparisonSyncLogTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function normalizeCityFilter(value: string | null | undefined) {
  return value?.trim() || null;
}

function doesSyncJobAffectReport(job: ComparisonSyncJobSnapshot, report: ComparisonReport) {
  const normalizedJobCity = normalizeCityFilter(job.cityFilter);
  const normalizedReportCity = normalizeCityFilter(report.cityFilter);
  const citiesOverlap =
    !normalizedJobCity || !normalizedReportCity || normalizedJobCity === normalizedReportCity;
  const windowsOverlap = job.startDate <= report.endDate && report.startDate <= job.endDate;

  return citiesOverlap && windowsOverlap;
}

function formatNumber(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatComparableValue(
  winner: ComparisonDayRecord["polymarket"]["winner"],
  values: { fahrenheit: number | null; celsius: number | null },
) {
  if (!winner || winner.kind === "unknown") {
    return "—";
  }

  return winner.unit === "F"
    ? `${formatNumber(values.fahrenheit)}°F`
    : `${formatNumber(values.celsius)}°C`;
}

function formatPolymarketWinner(polymarket: ComparisonPolymarketDay) {
  if (polymarket.status === "missing") {
    return "—";
  }

  if (polymarket.status === "unresolved") {
    return "Pending";
  }

  return polymarket.winner?.raw ?? "—";
}

function formatPolymarketStatus(status: ComparisonPolymarketDay["status"]) {
  if (status === "resolved") {
    return "Resolved";
  }

  if (status === "unresolved") {
    return "Unresolved";
  }

  return "Missing";
}

function isMatchedStatus(status: ComparisonDayRecord["comparisons"]["wunderground"]) {
  return status === "match" || status === "match-derived-f" || status === "boundary-match";
}

function ComparisonDayDetailPanel({
  detail,
  selectedDate,
}: {
  detail: ComparisonDayDetail | null;
  selectedDate: string | null;
}) {
  if (!selectedDate) {
    return (
      <aside className="comparison-day-panel">
        <div className="comparison-panel-heading">
          <div>
            <h2>Daily Curves</h2>
            <p>Select a row on the left to inspect that day&apos;s WU and AW temperature traces.</p>
          </div>
        </div>
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside className="comparison-day-panel">
        <div className="comparison-panel-heading">
          <div>
            <h2>{selectedDate}</h2>
            <p>No stored WU, AW, or Polymarket data was found for this date.</p>
          </div>
        </div>
      </aside>
    );
  }

  const marketLabel =
    detail.polymarket.status === "resolved"
      ? detail.polymarket.winner?.raw ?? "Resolved"
      : formatPolymarketStatus(detail.polymarket.status);

  return (
    <aside className="comparison-day-panel">
      <div className="comparison-panel-heading">
        <div>
          <h2>
            {detail.airport.city} · {detail.localDate}
          </h2>
          <p>
            {detail.airport.stationIcao} · {detail.airport.airportName}
          </p>
        </div>
        <p className="comparison-city-meta">{detail.airport.timezone}</p>
      </div>

      <div className="comparison-job-grid comparison-detail-stat-grid">
        <div className="comparison-job-stat">
          <span>Polymarket</span>
          <strong>{marketLabel}</strong>
        </div>
        <div className="comparison-job-stat">
          <span>WU points</span>
          <strong>{detail.wunderground.pointCount}</strong>
        </div>
        <div className="comparison-job-stat">
          <span>AW points</span>
          <strong>{detail.aviationWeather.pointCount}</strong>
        </div>
        <div className="comparison-job-stat">
          <span>Display unit</span>
          <strong>{detail.displayUnit}</strong>
        </div>
      </div>

      <div className="comparison-detail-chart-grid">
        <TemperatureHistoryChart
          ariaLabel="WU observed temperature curve for the selected local day"
          emptyMessage="No stored temperature points for this source."
          label="WU observed"
          timezone={detail.airport.timezone}
          displayUnit={detail.displayUnit}
          source={detail.wunderground}
        />
        <TemperatureHistoryChart
          ariaLabel="AW observed temperature curve for the selected local day"
          emptyMessage="No stored temperature points for this source."
          label="AW observed"
          timezone={detail.airport.timezone}
          displayUnit={detail.displayUnit}
          source={detail.aviationWeather}
        />
      </div>
    </aside>
  );
}

function ComparisonSyncPanel({
  job,
  requestError,
  startingSyncAction,
  isPageLoading,
  activeCityLabel,
  activeCitySlug,
  onRunSync,
  onRunSyncAll,
  statusLabel,
}: {
  job: ComparisonSyncJobSnapshot | null;
  requestError: string | null;
  startingSyncAction: "city" | "all" | null;
  isPageLoading: boolean;
  activeCityLabel: string | null;
  activeCitySlug: string | null;
  onRunSync: () => void;
  onRunSyncAll: () => void;
  statusLabel?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(() => !job || job.status === "running");
  const previousJobStateRef = useRef<{
    id: string | null;
    status: ComparisonSyncJobSnapshot["status"] | null;
  }>({
    id: job?.id ?? null,
    status: job?.status ?? null,
  });
  const isSyncRunning = job?.status === "running";
  const isStartingSync = startingSyncAction !== null;
  const normalizedActiveCitySlug = normalizeCityFilter(activeCitySlug);
  const normalizedJobCityFilter = normalizeCityFilter(job?.cityFilter);
  const isCitySyncRunning =
    isSyncRunning &&
    Boolean(normalizedActiveCitySlug) &&
    normalizedJobCityFilter === normalizedActiveCitySlug;
  const isSyncAllRunning = isSyncRunning && !normalizedJobCityFilter;
  const canRunCitySync = Boolean(activeCitySlug);
  const cityButtonLabel =
    startingSyncAction === "city" ? "Starting…" : isCitySyncRunning ? "Syncing…" : "Run sync";
  const syncAllButtonLabel =
    startingSyncAction === "all" ? "Starting…" : isSyncAllRunning ? "Syncing…" : "Sync all";
  const recentMessages = job ? [...job.recentMessages].reverse().slice(0, 6) : [];
  const cityProgressLabel =
    job?.status === "running" && job.currentCity
      ? `${job.currentCity} · ${job.completedCities}/${job.totalCities} cities finished`
      : job
        ? `${job.completedCities}/${job.totalCities} cities finished`
        : "No comparison sync has run in this server process yet.";
  const compactSummary = job
    ? `${formatComparisonSyncStatus(job.status)} · ${job.progressPercent}% · ${formatComparisonSyncScope(job)}`
    : "No comparison sync has run in this server process yet.";

  useEffect(() => {
    const previousJob = previousJobStateRef.current;

    if (job && job.id !== previousJob.id && job.status === "running") {
      setIsExpanded(true);
    } else if (
      job &&
      job.id === previousJob.id &&
      previousJob.status === "running" &&
      job.status !== "running"
    ) {
      setIsExpanded(false);
    } else if (!job && previousJob.id !== null) {
      setIsExpanded(true);
    }

    previousJobStateRef.current = {
      id: job?.id ?? null,
      status: job?.status ?? null,
    };
  }, [job]);

  return (
    <section className="comparison-summary-panel comparison-sync-panel">
      <div className="comparison-panel-heading">
        <div>
          <h2>Raw Comparison Sync</h2>
          <p>
            {statusLabel ??
              (activeCityLabel
                ? `Run sync resumes ${activeCityLabel} from its latest stored day through its current local day, and falls back to its earliest resolved day if no history exists. Sync all does the same for every city.`
                : "Sync all resumes every city from its latest stored day through its current local day, and falls back to each city's earliest resolved day if needed. Select a city to enable Run sync for a single city.")}
          </p>
        </div>
        <div className="comparison-sync-actions">
          <button
            className="refresh-button comparison-sync-button"
            type="button"
            onClick={() => void onRunSync()}
            disabled={isPageLoading || isStartingSync || isSyncRunning || !canRunCitySync}
            title={
              canRunCitySync
                ? undefined
                : "Select a city above to sync a single city through its current local day."
            }
          >
            {cityButtonLabel}
          </button>
          <button
            className="refresh-button comparison-sync-button"
            type="button"
            onClick={() => void onRunSyncAll()}
            disabled={isPageLoading || isStartingSync || isSyncRunning}
          >
            {syncAllButtonLabel}
          </button>
          <button
            className="comparison-sync-toggle"
            type="button"
            onClick={() => {
              setIsExpanded((current) => !current);
            }}
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="comparison-meta-bar comparison-sync-compact-bar">
        <p>{compactSummary}</p>
        <p>
          {job
            ? job.stepLabel
            : activeCityLabel
              ? `Run sync refreshes ${activeCityLabel} through its current local day, or use Sync all to refresh every city.`
              : "Select a city to enable Run sync, or use Sync all to refresh every city through its current local day."}
        </p>
      </div>

      {requestError ? (
        <section className="alert-banner comparison-sync-alert" role="status">
          {requestError}
        </section>
      ) : null}

      {job && isExpanded ? (
        <>
          <div className="comparison-job-grid comparison-sync-grid">
            <div className="comparison-job-stat">
              <span>Status</span>
              <strong className={`comparison-sync-status is-${job.status}`}>
                {formatComparisonSyncStatus(job.status)}
              </strong>
            </div>
            <div className="comparison-job-stat">
              <span>Window</span>
              <strong>{formatComparisonSyncScope(job)}</strong>
            </div>
            <div className="comparison-job-stat">
              <span>Progress</span>
              <strong>{job.progressPercent}%</strong>
            </div>
            <div className="comparison-job-stat">
              <span>Updated</span>
              <strong>{formatComparisonSyncTimestamp(job.updatedAt)}</strong>
            </div>
          </div>

          <div className="comparison-meta-bar">
            <p>{job.stepLabel}</p>
            <p>{cityProgressLabel}</p>
          </div>

          {job.summary ? (
            <div className="comparison-job-grid comparison-sync-grid">
              <div className="comparison-job-stat">
                <span>Cities</span>
                <strong>{job.summary.citiesProcessed}</strong>
              </div>
              <div className="comparison-job-stat">
                <span>PM days</span>
                <strong>{job.summary.polymarketDaysUpserted}</strong>
              </div>
              <div className="comparison-job-stat">
                <span>WU points</span>
                <strong>{job.summary.wuObservationPointsUpserted}</strong>
              </div>
              <div className="comparison-job-stat">
                <span>AW points</span>
                <strong>{job.summary.awObservationPointsUpserted}</strong>
              </div>
            </div>
          ) : null}

          {recentMessages.length > 0 ? (
            <ul className="comparison-sync-log">
              {recentMessages.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`} className="comparison-sync-log-item">
                  <span>{formatComparisonSyncLogTimestamp(entry.timestamp)}</span>
                  <strong>{entry.message}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : !job && isExpanded ? (
        <div className="comparison-meta-bar">
          <p>
            {activeCityLabel
              ? `Run sync resumes ${activeCityLabel} from its latest stored day through its current local day, with fallback to its earliest resolved day if needed.`
              : "Sync all resumes every city from its latest stored day through its current local day, with fallback to each city's earliest resolved day if needed."}
          </p>
          <p>The page stays interactive while the background job reports progress.</p>
        </div>
      ) : null}
    </section>
  );
}

function ComparisonCitySection({
  city,
  startDate,
  endDate,
  selectedDate,
  dayDetail,
  earliestResolvedDate,
}: {
  city: ComparisonCityReport;
  startDate: string;
  endDate: string;
  selectedDate: string | null;
  dayDetail: ComparisonDayDetail | null;
  earliestResolvedDate: string | null;
}) {
  const windowBeforeCoverage = earliestResolvedDate !== null && endDate < earliestResolvedDate;

  return (
    <section className="comparison-city-workspace">
      <div className="comparison-city-panel comparison-city-table-panel">
        <div className="comparison-city-header">
          <div>
            <h2>{city.airport.city}</h2>
            <p>
              {city.airport.stationIcao} · {city.airport.airportName}
            </p>
          </div>
          <p className="comparison-city-meta">
            Resolved days {city.rows.length} · WU {city.summary.wundergroundMatches}/
            {city.summary.wundergroundMismatches} · AW {city.summary.aviationMatches}/
            {city.summary.aviationMismatches}
          </p>
        </div>

        {earliestResolvedDate ? (
          <div className="comparison-meta-bar">
            <p>Showing resolved Polymarket dates only.</p>
            <p>Earliest known resolved day for {city.airport.city}: {earliestResolvedDate}</p>
          </div>
        ) : null}

        {city.rows.length > 0 ? (
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>PM</th>
                  <th>Winner</th>
                  <th>WU</th>
                  <th>AW</th>
                  <th>Peak</th>
                </tr>
              </thead>
              <tbody>
                {city.rows.map((row, index) => {
                  const rowHref = buildComparisonHref({
                    startDate,
                    endDate,
                    city: city.airport.slug,
                    selectedDate: row.localDate,
                  });
                  const isSelected = row.localDate === selectedDate;
                  const hasAnyMismatch =
                    !isMatchedStatus(row.comparisons.wunderground) ||
                    !isMatchedStatus(row.comparisons.aviationWeather);
                  const rowClassName = [
                    isSelected ? "comparison-row-selected" : null,
                    hasAnyMismatch ? "comparison-row-attention" : null,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <tr
                      key={`${row.citySlug}-${row.localDate}`}
                      className={rowClassName || undefined}
                    >
                      <td className="comparison-index-cell">
                        <Link className="comparison-row-link" to={rowHref}>
                          {index + 1}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {row.localDate}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {formatPolymarketStatus(row.polymarket.status)}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {formatPolymarketWinner(row.polymarket)}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {formatComparableValue(row.polymarket.winner, {
                            fahrenheit: row.wunderground.maxTempF,
                            celsius: row.wunderground.maxTempC,
                          })}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {formatComparableValue(row.polymarket.winner, {
                            fahrenheit: row.aviationWeather.maxTempFRounded,
                            celsius: row.aviationWeather.maxTempC,
                          })}
                        </Link>
                      </td>
                      <td>
                        <Link className="comparison-row-link" to={rowHref}>
                          {row.wunderground.peakLocal ?? "—"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h2>No resolved rows</h2>
            <p>
              {windowBeforeCoverage && earliestResolvedDate
                ? `This window ends before the earliest known resolved Polymarket day for ${city.airport.city} (${earliestResolvedDate}).`
                : "No resolved Polymarket rows were found for this city in the selected window."}
            </p>
          </div>
        )}
      </div>

      <ComparisonDayDetailPanel detail={dayDetail} selectedDate={selectedDate} />
    </section>
  );
}

export function ComparisonDashboard({
  initialStartDate,
  initialEndDate,
  initialCity,
  initialSelectedDate,
  initialReport,
  initialCityDetail,
  initialDayDetail,
  initialEarliestResolvedDate,
  statusLabel,
  isLoading = false,
}: ComparisonDashboardProps) {
  const report = initialReport;
  const activeCity = initialCityDetail;
  const activeCitySlug = activeCity?.airport.slug ?? null;
  const activeCityLabel = activeCity?.airport.city ?? null;
  const syncPanelDescription = activeCityLabel
    ? `Run sync resumes ${activeCityLabel} from its latest stored day through its current local day, and falls back to its earliest resolved day if no history exists. Sync all does the same for every city.`
    : "Sync all resumes every city from its latest stored day through its current local day, and falls back to each city's earliest resolved day if needed. Select a city to enable Run sync for a single city.";
  const syncPanelStatusLabel = statusLabel
    ? `${statusLabel}${/[.!?]$/u.test(statusLabel) ? "" : "."} ${syncPanelDescription}`
    : syncPanelDescription;
  const selectedCityValue =
    activeCitySlug ??
    normalizeCityFilter(report.cityFilter) ??
    normalizeCityFilter(initialCity) ??
    "";
  const revalidator = useRevalidator();
  const stoppedRef = useRef(false);
  const pollingJobIdRef = useRef<string | null>(null);
  const previousSyncJobRef = useRef<ComparisonSyncJobSnapshot | null>(null);
  const latestAcceptedJobRef = useRef<ComparisonSyncJobSnapshot | null>(null);
  const [syncJob, setSyncJob] = useState<ComparisonSyncJobSnapshot | null>(null);
  const [syncRequestError, setSyncRequestError] = useState<string | null>(null);
  const [startingSyncAction, setStartingSyncAction] = useState<"city" | "all" | null>(null);

  function acceptSyncJob(job: ComparisonSyncJobSnapshot | null) {
    const currentJob = latestAcceptedJobRef.current;
    if (
      job &&
      currentJob &&
      currentJob.id === job.id &&
      currentJob.updatedAt > job.updatedAt
    ) {
      return currentJob;
    }

    latestAcceptedJobRef.current = job;
    startTransition(() => {
      setSyncJob(job);
      setSyncRequestError(null);
    });

    return job;
  }

  async function fetchComparisonSyncLookup(url: string) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });
    const payload = (await response.json().catch(() => null)) as
      | ComparisonSyncJobLookupResponse
      | { error?: string }
      | null;

    if (!response.ok) {
      const errorMessage = payload && "error" in payload ? payload.error?.trim() : null;
      throw new Error(
        errorMessage || `Failed to load comparison sync status (${response.status})`,
      );
    }

    return payload as ComparisonSyncJobLookupResponse;
  }

  async function startComparisonSyncRequest(params: {
    city: string | null;
    syncMode: ComparisonSyncMode;
  }) {
    const response = await fetch("/api/comparison/sync", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        city: normalizeCityFilter(params.city),
        syncMode: params.syncMode,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | ComparisonSyncJobStartResponse
      | { error?: string }
      | null;

    if (!response.ok) {
      const errorMessage = payload && "error" in payload ? payload.error?.trim() : null;
      throw new Error(
        errorMessage || `Failed to start comparison sync (${response.status})`,
      );
    }

    return payload as ComparisonSyncJobStartResponse;
  }

  const pollComparisonSyncJob = useEffectEvent(async (jobId: string, shouldStop: () => boolean) => {
    if (pollingJobIdRef.current === jobId) {
      return;
    }

    pollingJobIdRef.current = jobId;

    try {
      while (!shouldStop()) {
        await new Promise((resolve) => setTimeout(resolve, COMPARISON_SYNC_POLL_INTERVAL_MS));
        if (shouldStop()) {
          return;
        }

        const payload = await fetchComparisonSyncLookup(
          `/api/comparison/sync/${encodeURIComponent(jobId)}`,
        );
        const nextJob = acceptSyncJob(payload.job);
        if (!nextJob || nextJob.status !== "running") {
          return;
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected comparison sync failure";
      if (!shouldStop()) {
        setSyncRequestError(message);
      }
    } finally {
      if (pollingJobIdRef.current === jobId) {
        pollingJobIdRef.current = null;
      }
    }
  });

  const loadLatestComparisonSyncJob = useEffectEvent(async (shouldStop: () => boolean) => {
    try {
      const payload = await fetchComparisonSyncLookup("/api/comparison/sync");
      if (shouldStop()) {
        return;
      }

      const latestJob = acceptSyncJob(payload.job);
      if (latestJob?.status === "running") {
        await pollComparisonSyncJob(latestJob.id, shouldStop);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected comparison sync failure";
      if (!shouldStop()) {
        setSyncRequestError(message);
      }
    }
  });

  const runComparisonSync = useEffectEvent(async (action: "city" | "all", city: string | null) => {
    setStartingSyncAction(action);
    setSyncRequestError(null);

    try {
      const payload = await startComparisonSyncRequest({
        city,
        syncMode: "coverage-to-current-day",
      });
      const job = acceptSyncJob(payload.job);
      if (job && job.status === "running") {
        await pollComparisonSyncJob(job.id, () => stoppedRef.current);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected comparison sync failure";
      if (!stoppedRef.current) {
        setSyncRequestError(message);
      }
    } finally {
      if (!stoppedRef.current) {
        setStartingSyncAction(null);
      }
    }
  });

  const runCurrentCityComparisonSync = useEffectEvent(async () => {
    if (!activeCitySlug) {
      return;
    }

    await runComparisonSync("city", activeCitySlug);
  });

  const runAllCitiesComparisonSync = useEffectEvent(async () => {
    await runComparisonSync("all", null);
  });

  useEffect(() => {
    stoppedRef.current = false;

    void loadLatestComparisonSyncJob(() => stoppedRef.current);

    return () => {
      stoppedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const previousJob = previousSyncJobRef.current;
    const currentJob = syncJob;

    if (
      previousJob &&
      currentJob &&
      previousJob.id === currentJob.id &&
      previousJob.status === "running" &&
      currentJob.status === "completed" &&
      doesSyncJobAffectReport(currentJob, report)
    ) {
      revalidator.revalidate();
    }

    previousSyncJobRef.current = currentJob;
  }, [revalidator, report.cityFilter, report.endDate, report.startDate, syncJob]);

  return (
    <main className="page-shell comparison-shell">
      <section className="hero-panel">
        <div>
          <p className="comparison-kicker">Resolved Settlement Audit</p>
          <h1>WU / AW vs Polymarket</h1>
        </div>
        <div className="hero-actions">
          <Link className="secondary-action-link" to="/">
            Back to dashboard
          </Link>
        </div>
      </section>

      <section className="comparison-summary-panel comparison-filter-panel">
        <Form
          aria-label="Comparison filters"
          action="/comparison"
          className="comparison-filter-bar comparison-filter-bar-embedded comparison-filter-bar-panel"
          method="get"
        >
          <label className="comparison-filter-field">
            <span>Start</span>
            <input defaultValue={initialStartDate} name="startDate" type="date" />
          </label>
          <label className="comparison-filter-field">
            <span>End</span>
            <input defaultValue={initialEndDate} name="endDate" type="date" />
          </label>
          <label className="comparison-filter-field comparison-filter-city">
            <span>City</span>
            <select
              defaultValue={selectedCityValue}
              name="city"
            >
              <option value="">All cities</option>
              {CITY_PICKER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="comparison-apply-button" type="submit" disabled={isLoading}>
            {isLoading ? "…" : "Go"}
          </button>
        </Form>
      </section>

      {activeCity ? (
        <ComparisonCitySection
          city={activeCity}
          startDate={report.startDate}
          endDate={report.endDate}
          selectedDate={initialSelectedDate}
          dayDetail={initialDayDetail}
          earliestResolvedDate={initialEarliestResolvedDate}
        />
      ) : (
        <section className="comparison-meta-bar">
          <p>Select a city to load resolved dates and inspect daily curves.</p>
        </section>
      )}

      <ComparisonSyncPanel
        job={syncJob}
        requestError={syncRequestError}
        startingSyncAction={startingSyncAction}
        isPageLoading={isLoading}
        activeCityLabel={activeCityLabel}
        activeCitySlug={activeCitySlug}
        onRunSync={runCurrentCityComparisonSync}
        onRunSyncAll={runAllCitiesComparisonSync}
        statusLabel={syncPanelStatusLabel}
      />
    </main>
  );
}
