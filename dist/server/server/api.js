"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApiRoutes = registerApiRoutes;
const page_data_1 = require("../lib/comparison/page-data");
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
async function handlePolymarketLinks(_req, res) {
    setNoStore(res);
    const links = await (0, polymarket_1.getPolymarketLinks)();
    res.json({ links });
}
async function handleWeather(_req, res) {
    setNoStore(res);
    res.json((0, store_1.buildWeatherResponse)());
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
    app.post("/api/weather/refresh", (req, res, next) => {
        void handleWeatherRefresh(req, res).catch(next);
    });
    app.get("/api/polymarket-links", (req, res, next) => {
        void handlePolymarketLinks(req, res).catch(next);
    });
    app.get("/api/comparison", (req, res) => {
        void handleComparisonRequest(req, res);
    });
}
//# sourceMappingURL=api.js.map