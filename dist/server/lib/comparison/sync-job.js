"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComparisonSyncJobSnapshot = getComparisonSyncJobSnapshot;
exports.getLatestComparisonSyncJobSnapshot = getLatestComparisonSyncJobSnapshot;
exports.startComparisonSyncJob = startComparisonSyncJob;
const node_crypto_1 = require("node:crypto");
const query_1 = require("./query");
const sync_1 = require("./sync");
const MAX_STORED_JOBS = 8;
const MAX_RECENT_MESSAGES = 16;
function createStore() {
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
function cloneJob(job) {
    return {
        ...job,
        recentMessages: job.recentMessages.map((entry) => ({ ...entry })),
        summary: job.summary ? { ...job.summary } : null,
    };
}
function readStringValue(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const firstValue = value[0];
        return typeof firstValue === "string" ? firstValue : null;
    }
    return null;
}
function readSyncMode(value) {
    const candidate = readStringValue(value)?.trim() ?? null;
    if (candidate === "selected-window" || candidate === "coverage-to-current-day") {
        return candidate;
    }
    return null;
}
function pushJobMessage(job, message, timestamp) {
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
function updateJobFromProgress(job, event) {
    const updatedAt = new Date().toISOString();
    job.stage = event.stage;
    job.updatedAt = updatedAt;
    job.totalCities = event.totalCities;
    job.completedCities = event.completedCities;
    job.currentCitySlug = event.citySlug;
    job.currentCity = event.city;
    job.progressPercent = Math.max(job.progressPercent, Math.round(Math.min(Math.max(event.progressFraction, 0), 1) * 100));
    job.stepLabel = event.message;
    pushJobMessage(job, event.message, updatedAt);
}
function summarizeCompletedJob(summary) {
    return (0, sync_1.renderComparisonSyncSummary)(summary).trim().split("\n")[0] ?? "Comparison sync completed";
}
function pruneJobs(store) {
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
function getComparisonSyncJobSnapshot(jobId) {
    const job = getStore().jobs.get(jobId);
    return job ? cloneJob(job) : null;
}
function getLatestComparisonSyncJobSnapshot() {
    const store = getStore();
    const latestJob = store.latestJobId ? store.jobs.get(store.latestJobId) : null;
    return latestJob ? cloneJob(latestJob) : null;
}
async function startComparisonSyncJob(input) {
    const store = getStore();
    const activeJob = store.activeJobId ? store.jobs.get(store.activeJobId) ?? null : null;
    if (activeJob && activeJob.status === "running") {
        return {
            job: cloneJob(activeJob),
            reusedExistingJob: true,
        };
    }
    const syncMode = readSyncMode(input.syncMode) ?? "selected-window";
    const currentDayPlan = syncMode === "coverage-to-current-day"
        ? await (0, sync_1.createComparisonCurrentDaySyncPlan)(readStringValue(input.city)?.trim() ?? null)
        : null;
    const latestActiveJob = store.activeJobId ? store.jobs.get(store.activeJobId) ?? null : null;
    if (latestActiveJob && latestActiveJob.status === "running") {
        return {
            job: cloneJob(latestActiveJob),
            reusedExistingJob: true,
        };
    }
    let startDate;
    let endDate;
    let cityFilter;
    let totalCities;
    let scopeLabel;
    if (currentDayPlan) {
        startDate = currentDayPlan.startDate;
        endDate = currentDayPlan.endDate;
        cityFilter = currentDayPlan.cityFilter;
        totalCities = currentDayPlan.targets.length;
        scopeLabel = currentDayPlan.scopeLabel;
    }
    else {
        const normalized = (0, query_1.normalizeComparisonQuery)({
            startDate: readStringValue(input.startDate),
            endDate: readStringValue(input.endDate),
            city: readStringValue(input.city),
        });
        startDate = normalized.startDate;
        endDate = normalized.endDate;
        cityFilter = normalized.cityFilter?.trim() || null;
        totalCities = normalized.airports.length;
        scopeLabel = null;
    }
    const now = new Date().toISOString();
    const job = {
        id: (0, node_crypto_1.randomUUID)(),
        mode: syncMode,
        status: "running",
        stage: "starting",
        requestedAt: now,
        startedAt: now,
        finishedAt: null,
        updatedAt: now,
        startDate,
        endDate,
        cityFilter,
        scopeLabel,
        totalCities,
        completedCities: 0,
        currentCitySlug: null,
        currentCity: null,
        progressPercent: 0,
        stepLabel: syncMode === "coverage-to-current-day"
            ? "Queued comparison sync to current local day"
            : "Queued comparison sync",
        recentMessages: [],
        summary: null,
        error: null,
    };
    pushJobMessage(job, job.stepLabel, now);
    store.jobs.set(job.id, job);
    store.activeJobId = job.id;
    store.latestJobId = job.id;
    const handleProgress = (event) => {
        const currentJob = store.jobs.get(job.id);
        if (!currentJob) {
            return;
        }
        updateJobFromProgress(currentJob, event);
    };
    const promise = (currentDayPlan
        ? (0, sync_1.runComparisonCurrentDaySync)(currentDayPlan, {
            onProgress: handleProgress,
        })
        : (0, sync_1.runComparisonSync)({
            startDate: job.startDate,
            endDate: job.endDate,
            cityFilter: job.cityFilter,
        }, {
            onProgress: handleProgress,
        }))
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
        currentJob.scopeLabel = summary.scopeLabel;
        currentJob.error = null;
        currentJob.stepLabel = summarizeCompletedJob(summary);
        pushJobMessage(currentJob, currentJob.stepLabel, finishedAt);
    })
        .catch((error) => {
        const currentJob = store.jobs.get(job.id);
        if (!currentJob) {
            return;
        }
        const message = error instanceof Error ? error.message : "Unexpected comparison sync failure";
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
//# sourceMappingURL=sync-job.js.map