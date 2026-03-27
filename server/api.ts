import type { Express, Request, Response } from "express";

import { getComparisonPageData } from "../lib/comparison/page-data";
import { getPolymarketLinks } from "../lib/polymarket";
import {
  refreshAndRespond,
  refreshCardAndRespond,
} from "../lib/refresh-weather";
import { buildWeatherResponse } from "../lib/store";

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

async function handlePolymarketLinks(_req: Request, res: Response) {
  setNoStore(res);
  const links = await getPolymarketLinks();
  res.json({ links });
}

async function handleWeather(_req: Request, res: Response) {
  setNoStore(res);
  res.json(buildWeatherResponse());
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
