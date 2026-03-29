import "../lib/load-env";

import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import compression from "compression";
import express from "express";

import { getComparisonPageData } from "../lib/comparison/page-data";
import { startWeatherSnapshotRefresh } from "../lib/refresh-weather";
import { buildWeatherResponse } from "../lib/store";
import { registerApiRoutes } from "./api";

const PORT = Number(process.env.PORT ?? "3000");
const HOST = process.env.HOST ?? "0.0.0.0";
const PROJECT_ROOT = process.cwd();
const CLIENT_DIST_DIR = path.resolve(PROJECT_ROOT, "dist/client");
const INDEX_HTML_PATH = path.resolve(PROJECT_ROOT, "index.html");
const CLIENT_INDEX_HTML_PATH = path.resolve(CLIENT_DIST_DIR, "index.html");
const HOME_SPA_PATHS = ["/"];
const COMPARISON_SPA_PATHS = ["/comparison", "/comparison/"];

type BasicAuthConfig = {
  username: string;
  password: string;
};

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function injectBeforeBodyEnd(html: string, snippet: string) {
  return html.includes("</body>")
    ? html.replace("</body>", `${snippet}\n  </body>`)
    : `${html}\n${snippet}`;
}

function getBasicAuthConfig(): BasicAuthConfig | null {
  const username = process.env.BASIC_AUTH_USERNAME?.trim() ?? "";
  const password = process.env.BASIC_AUTH_PASSWORD?.trim() ?? "";

  if (!username && !password) {
    return null;
  }

  if (!username || !password) {
    throw new Error("BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD must both be set");
  }

  return {
    username,
    password,
  };
}

function parseBasicAuthorizationHeader(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [scheme, encodedCredentials] = value.split(" ");
  if (scheme !== "Basic" || !encodedCredentials) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedCredentials, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function matchesSecret(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function createBasicAuthMiddleware(config: BasicAuthConfig): express.RequestHandler {
  return (req, res, next) => {
    const credentials = parseBasicAuthorizationHeader(req.headers.authorization);
    const isAuthorized =
      credentials !== null &&
      matchesSecret(credentials.username, config.username) &&
      matchesSecret(credentials.password, config.password);

    if (isAuthorized) {
      next();
      return;
    }

    res.set("WWW-Authenticate", 'Basic realm="Polyweather", charset="UTF-8"');
    res.status(401).type("text/plain").send("Authentication required");
  };
}

async function getComparisonBootstrapPayload(req: express.Request) {
  try {
    const data = await getComparisonPageData(req.query);

    return {
      url: req.originalUrl,
      data,
    };
  } catch {
    return null;
  }
}

async function injectComparisonBootstrapData(req: express.Request, html: string) {
  const payload = await getComparisonBootstrapPayload(req);
  if (!payload) {
    return html;
  }

  const script = `<script>window.__POLYWEATHER_COMPARISON_INITIAL__=${serializeForInlineScript(payload)};</script>`;
  return injectBeforeBodyEnd(html, script);
}

function getHomeBootstrapPayload(req: express.Request) {
  const current = buildWeatherResponse();

  if (!current.cards?.length && current.refreshState !== "refreshing") {
    void startWeatherSnapshotRefresh();
  }

  return {
    url: req.originalUrl,
    data: buildWeatherResponse(),
  };
}

function injectHomeBootstrapData(req: express.Request, html: string) {
  const payload = getHomeBootstrapPayload(req);
  const script = `<script>window.__POLYWEATHER_HOME_INITIAL__=${serializeForInlineScript(payload)};</script>`;
  return injectBeforeBodyEnd(html, script);
}

export async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use(express.json());
  const basicAuthConfig = getBasicAuthConfig();

  if (basicAuthConfig) {
    app.use(createBasicAuthMiddleware(basicAuthConfig));
  }

  registerApiRoutes(app);

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(CLIENT_DIST_DIR, { index: false }));
    for (const routePath of HOME_SPA_PATHS) {
      app.get(routePath, async (req, res, next) => {
        try {
          res.set("Cache-Control", "no-store");
          const html = await readFile(CLIENT_INDEX_HTML_PATH, "utf8");
          const hydratedHtml = injectHomeBootstrapData(req, html);
          res.status(200).type("html").send(hydratedHtml);
        } catch (error) {
          next(error);
        }
      });
    }

    for (const routePath of COMPARISON_SPA_PATHS) {
      app.get(routePath, async (req, res, next) => {
        try {
          res.set("Cache-Control", "no-store");
          const html = await readFile(CLIENT_INDEX_HTML_PATH, "utf8");
          const hydratedHtml = await injectComparisonBootstrapData(req, html);
          res.status(200).type("html").send(hydratedHtml);
        } catch (error) {
          next(error);
        }
      });
    }
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      appType: "custom",
      server: {
        middlewareMode: true,
      },
    });

    app.use(vite.middlewares);
    for (const routePath of HOME_SPA_PATHS) {
      app.get(routePath, async (req, res, next) => {
        try {
          res.set("Cache-Control", "no-store");
          let html = await readFile(INDEX_HTML_PATH, "utf8");
          html = await vite.transformIndexHtml(req.originalUrl, html);
          html = injectHomeBootstrapData(req, html);
          res.status(200).type("html").send(html);
        } catch (error) {
          vite.ssrFixStacktrace(error as Error);
          next(error);
        }
      });
    }

    for (const routePath of COMPARISON_SPA_PATHS) {
      app.get(routePath, async (req, res, next) => {
        try {
          res.set("Cache-Control", "no-store");
          let html = await readFile(INDEX_HTML_PATH, "utf8");
          html = await vite.transformIndexHtml(req.originalUrl, html);
          html = await injectComparisonBootstrapData(req, html);
          res.status(200).type("html").send(html);
        } catch (error) {
          vite.ssrFixStacktrace(error as Error);
          next(error);
        }
      });
    }
  }

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    const isApiRequest = req.path.startsWith("/api/");

    if (isApiRequest) {
      res.status(500).json({ error: message });
      return;
    }

    res.status(500).type("text/plain").send(message);
  });

  return app;
}

export async function startServer() {
  const app = await createApp();

  return app.listen(PORT, HOST, () => {
    console.log(`Polyweather server listening at http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  void startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
