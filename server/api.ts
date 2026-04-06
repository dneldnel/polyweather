import type { Express, Request, Response } from "express";

import { AIRPORTS } from "../lib/airports";
import { getComparisonPageData } from "../lib/comparison/page-data";
import {
  getComparisonSyncJobSnapshot,
  getLatestComparisonSyncJobSnapshot,
  startComparisonSyncJob,
} from "../lib/comparison/sync-job";
import { getPolymarketLinks } from "../lib/polymarket";
import {
  refreshAndRespond,
  refreshCardAndRespond,
} from "../lib/refresh-weather";
import { buildWeatherCardDetailResponse, buildWeatherResponse } from "../lib/store";

function setNoStore(res: Response) {
  res.set("Cache-Control", "no-store");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error";
}

function getComparisonStatusCode(error: unknown) {
  const message = getErrorMessage(error);

  if (
    message.startsWith("Invalid date:") ||
    message.startsWith("Unknown city filter:") ||
    message.includes("must be <=")
  ) {
    return 400;
  }

  return 500;
}

async function handleComparisonRequest(req: Request, res: Response) {
  try {
    setNoStore(res);
    const payload = await getComparisonPageData(req.query);
    res.json(payload);
  } catch (error) {
    const statusCode = getComparisonStatusCode(error);
    res.status(statusCode).json({ error: getErrorMessage(error) });
  }
}

async function handleComparisonSyncStart(req: Request, res: Response) {
  try {
    setNoStore(res);
    const payload = await startComparisonSyncJob({
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      city: req.body?.city,
      syncMode: req.body?.syncMode,
    });
    res.status(202).json(payload);
  } catch (error) {
    const statusCode = getComparisonStatusCode(error);
    res.status(statusCode).json({ error: getErrorMessage(error) });
  }
}

async function handleComparisonSyncLookup(req: Request, res: Response) {
  setNoStore(res);

  const rawJobId = req.params.jobId;
  const jobId = typeof rawJobId === "string" ? rawJobId.trim() : "";
  const job = jobId ? getComparisonSyncJobSnapshot(jobId) : getLatestComparisonSyncJobSnapshot();

  if (!job && jobId) {
    res.status(404).json({ error: `Unknown comparison sync job: ${jobId}` });
    return;
  }

  res.json({ job });
}

async function handlePolymarketLinks(_req: Request, res: Response) {
  setNoStore(res);
  const links = await getPolymarketLinks();
  res.json({ links });
}

async function handleWeather(_req: Request, res: Response) {
  setNoStore(res);
  res.json(buildWeatherResponse());
}

async function handleWeatherCard(req: Request, res: Response) {
  setNoStore(res);

  const rawSlug = req.query.slug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";

  if (!slug) {
    res.status(400).json({ error: "Missing weather card slug" });
    return;
  }

  const airportExists = AIRPORTS.some((airport) => airport.slug === slug);
  if (!airportExists) {
    res.status(404).json({ error: `Unknown weather card: ${slug}` });
    return;
  }

  res.json(await buildWeatherCardDetailResponse(slug));
}

async function handleWeatherRefresh(req: Request, res: Response) {
  setNoStore(res);

  const rawSlug = req.query.slug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";

  if (slug) {
    const payload = await refreshCardAndRespond(slug);
    res.json(payload);
    return;
  }

  const payload = await refreshAndRespond();
  res.json(payload);
}

export function registerApiRoutes(app: Express) {
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
