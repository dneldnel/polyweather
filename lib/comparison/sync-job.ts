import { randomUUID } from "node:crypto";

import { normalizeComparisonQuery } from "./query";
import { renderComparisonSyncSummary, runComparisonSync } from "./sync";

import type {
  ComparisonSyncJobSnapshot,
  ComparisonSyncJobStartResponse,
  ComparisonSyncSummary,
} from "./types";

type ComparisonSyncStore = {
  jobs: Map<string, ComparisonSyncJobSnapshot>;
  activeJobId: string | null;
  latestJobId: string | null;
  activePromise: Promise<void> | null;
};

declare global {
  var __polyweatherComparisonSyncStore__: ComparisonSyncStore | undefined;
}

const MAX_STORED_JOBS = 8;
const MAX_RECENT_MESSAGES = 16;

function createStore(): ComparisonSyncStore {
  return {
    jobs: new Map(),
    activeJobId: null,
    latestJobId: null,
    activePromise: null,
  };
}

function getStore() {
  if (!globalThis.__polyweatherComparisonSyncStore__) {
    globalThis.__polyweatherComparisonSyncStore__ = createStore();
  }

  return globalThis.__polyweatherComparisonSyncStore__;
}

function cloneJob(job: ComparisonSyncJobSnapshot): ComparisonSyncJobSnapshot {
  return {
    ...job,
    recentMessages: job.recentMessages.map((entry) => ({ ...entry })),
    summary: job.summary ? { ...job.summary } : null,
  };
}

function readStringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue : null;
  }

  return null;
}

function pushJobMessage(job: ComparisonSyncJobSnapshot, message: string, timestamp: string) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return;
  }

  const lastMessage = job.recentMessages.at(-1);
  if (lastMessage?.message === trimmedMessage) {
    lastMessage.timestamp = timestamp;
    return;
  }

  job.recentMessages = [
    ...job.recentMessages,
    {
      timestamp,
      message: trimmedMessage,
    },
  ].slice(-MAX_RECENT_MESSAGES);
}

function updateJobFromProgress(job: ComparisonSyncJobSnapshot, event: {
  stage: ComparisonSyncJobSnapshot["stage"];
  message: string;
  totalCities: number;
  completedCities: number;
  citySlug: string | null;
  city: string | null;
  progressFraction: number;
}) {
  const updatedAt = new Date().toISOString();

  job.stage = event.stage;
  job.updatedAt = updatedAt;
  job.totalCities = event.totalCities;
  job.completedCities = event.completedCities;
  job.currentCitySlug = event.citySlug;
  job.currentCity = event.city;
  job.progressPercent = Math.max(
    job.progressPercent,
    Math.round(Math.min(Math.max(event.progressFraction, 0), 1) * 100),
  );
  job.stepLabel = event.message;
  pushJobMessage(job, event.message, updatedAt);
}

function summarizeCompletedJob(summary: ComparisonSyncSummary) {
  return renderComparisonSyncSummary(summary).trim().split("\n")[0] ?? "Comparison sync completed";
}

function pruneJobs(store: ComparisonSyncStore) {
  if (store.jobs.size <= MAX_STORED_JOBS) {
    return;
  }

  const removableJobs = [...store.jobs.values()]
    .filter((job) => job.id !== store.activeJobId && job.id !== store.latestJobId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

  while (store.jobs.size > MAX_STORED_JOBS && removableJobs.length > 0) {
    const nextJob = removableJobs.shift();
    if (!nextJob) {
      break;
    }

    store.jobs.delete(nextJob.id);
  }
}

export function getComparisonSyncJobSnapshot(jobId: string) {
  const job = getStore().jobs.get(jobId);
  return job ? cloneJob(job) : null;
}

export function getLatestComparisonSyncJobSnapshot() {
  const store = getStore();
  const latestJob = store.latestJobId ? store.jobs.get(store.latestJobId) : null;
  return latestJob ? cloneJob(latestJob) : null;
}

export function startComparisonSyncJob(input: {
  startDate?: unknown;
  endDate?: unknown;
  city?: unknown;
}): ComparisonSyncJobStartResponse {
  const store = getStore();
  const activeJob = store.activeJobId ? store.jobs.get(store.activeJobId) ?? null : null;

  if (activeJob && activeJob.status === "running") {
    return {
      job: cloneJob(activeJob),
      reusedExistingJob: true,
    };
  }

  const normalized = normalizeComparisonQuery({
    startDate: readStringValue(input.startDate),
    endDate: readStringValue(input.endDate),
    city: readStringValue(input.city),
  });
  const cityFilter = normalized.cityFilter?.trim() || null;
  const now = new Date().toISOString();
  const job: ComparisonSyncJobSnapshot = {
    id: randomUUID(),
    status: "running",
    stage: "starting",
    requestedAt: now,
    startedAt: now,
    finishedAt: null,
    updatedAt: now,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    cityFilter,
    totalCities: normalized.airports.length,
    completedCities: 0,
    currentCitySlug: null,
    currentCity: null,
    progressPercent: 0,
    stepLabel: "Queued comparison sync",
    recentMessages: [],
    summary: null,
    error: null,
  };

  pushJobMessage(job, job.stepLabel, now);
  store.jobs.set(job.id, job);
  store.activeJobId = job.id;
  store.latestJobId = job.id;

  const promise = runComparisonSync(
    {
      startDate: job.startDate,
      endDate: job.endDate,
      cityFilter: job.cityFilter,
    },
    {
      onProgress: (event) => {
        const currentJob = store.jobs.get(job.id);
        if (!currentJob) {
          return;
        }

        updateJobFromProgress(currentJob, event);
      },
    },
  )
    .then((summary) => {
      const currentJob = store.jobs.get(job.id);
      if (!currentJob) {
        return;
      }

      const finishedAt = new Date().toISOString();
      currentJob.status = "completed";
      currentJob.stage = "completed";
      currentJob.finishedAt = finishedAt;
      currentJob.updatedAt = finishedAt;
      currentJob.completedCities = currentJob.totalCities;
      currentJob.currentCitySlug = null;
      currentJob.currentCity = null;
      currentJob.progressPercent = 100;
      currentJob.summary = summary;
      currentJob.error = null;
      currentJob.stepLabel = summarizeCompletedJob(summary);
      pushJobMessage(currentJob, currentJob.stepLabel, finishedAt);
    })
    .catch((error: unknown) => {
      const currentJob = store.jobs.get(job.id);
      if (!currentJob) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unexpected comparison sync failure";
      const finishedAt = new Date().toISOString();
      currentJob.status = "failed";
      currentJob.stage = "failed";
      currentJob.finishedAt = finishedAt;
      currentJob.updatedAt = finishedAt;
      currentJob.error = message;
      currentJob.stepLabel = message;
      pushJobMessage(currentJob, `Failed: ${message}`, finishedAt);
    })
    .finally(() => {
      const currentStore = getStore();
      if (currentStore.activeJobId === job.id) {
        currentStore.activeJobId = null;
      }
      if (currentStore.activePromise === promise) {
        currentStore.activePromise = null;
      }

      pruneJobs(currentStore);
    });

  store.activePromise = promise;

  return {
    job: cloneJob(job),
    reusedExistingJob: false,
  };
}
