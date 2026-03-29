"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApiRoutes = registerApiRoutes;
const airports_1 = require("../lib/airports");
const page_data_1 = require("../lib/comparison/page-data");
const sync_job_1 = require("../lib/comparison/sync-job");
const polymarket_1 = require("../lib/polymarket");
const refresh_weather_1 = require("../lib/refresh-weather");
const store_1 = require("../lib/store");
function setNoStore(res) {
    res.set("Cache-Control", "no-store");
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : "Unexpected server error";
}
function getComparisonStatusCode(error) {
    const message = getErrorMessage(error);
    if (message.startsWith("Invalid date:") ||
        message.startsWith("Unknown city filter:") ||
        message.includes("must be <=")) {
        return 400;
    }
    return 500;
}
async function handleComparisonRequest(req, res) {
    try {
        setNoStore(res);
        const payload = await (0, page_data_1.getComparisonPageData)(req.query);
        res.json(payload);
    }
    catch (error) {
        const statusCode = getComparisonStatusCode(error);
        res.status(statusCode).json({ error: getErrorMessage(error) });
    }
}
async function handleComparisonSyncStart(req, res) {
    try {
        setNoStore(res);
        const payload = (0, sync_job_1.startComparisonSyncJob)({
            startDate: req.body?.startDate,
            endDate: req.body?.endDate,
            city: req.body?.city,
        });
        res.status(202).json(payload);
    }
    catch (error) {
        const statusCode = getComparisonStatusCode(error);
        res.status(statusCode).json({ error: getErrorMessage(error) });
    }
}
async function handleComparisonSyncLookup(req, res) {
    setNoStore(res);
    const rawJobId = req.params.jobId;
    const jobId = typeof rawJobId === "string" ? rawJobId.trim() : "";
    const job = jobId ? (0, sync_job_1.getComparisonSyncJobSnapshot)(jobId) : (0, sync_job_1.getLatestComparisonSyncJobSnapshot)();
    if (!job && jobId) {
        res.status(404).json({ error: `Unknown comparison sync job: ${jobId}` });
        return;
    }
    res.json({ job });
}
async function handlePolymarketLinks(_req, res) {
    setNoStore(res);
    const links = await (0, polymarket_1.getPolymarketLinks)();
    res.json({ links });
}
async function handleWeather(_req, res) {
    setNoStore(res);
    res.json((0, store_1.buildWeatherResponse)());
}
async function handleWeatherCard(req, res) {
    setNoStore(res);
    const rawSlug = req.query.slug;
    const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
    if (!slug) {
        res.status(400).json({ error: "Missing weather card slug" });
        return;
    }
    const airportExists = airports_1.AIRPORTS.some((airport) => airport.slug === slug);
    if (!airportExists) {
        res.status(404).json({ error: `Unknown weather card: ${slug}` });
        return;
    }
    res.json((0, store_1.buildWeatherCardDetailResponse)(slug));
}
async function handleWeatherRefresh(req, res) {
    setNoStore(res);
    const rawSlug = req.query.slug;
    const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
    if (slug) {
        const payload = await (0, refresh_weather_1.refreshCardAndRespond)(slug);
        res.json(payload);
        return;
    }
    const payload = await (0, refresh_weather_1.refreshAndRespond)();
    res.json(payload);
}
function registerApiRoutes(app) {
    app.get("/api/weather", (req, res, next) => {
        void handleWeather(req, res).catch(next);
    });
    app.get("/api/weather/card", (req, res, next) => {
        void handleWeatherCard(req, res).catch(next);
    });
    app.post("/api/weather/refresh", (req, res, next) => {
        void handleWeatherRefresh(req, res).catch(next);
    });
    app.get("/api/polymarket-links", (req, res, next) => {
        void handlePolymarketLinks(req, res).catch(next);
    });
    app.post("/api/comparison/sync", (req, res) => {
        void handleComparisonSyncStart(req, res);
    });
    app.get("/api/comparison/sync", (req, res, next) => {
        void handleComparisonSyncLookup(req, res).catch(next);
    });
    app.get("/api/comparison/sync/:jobId", (req, res, next) => {
        void handleComparisonSyncLookup(req, res).catch(next);
    });
    app.get("/api/comparison", (req, res) => {
        void handleComparisonRequest(req, res);
    });
}
//# sourceMappingURL=api.js.map