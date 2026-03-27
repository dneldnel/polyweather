import "../lib/load-env";

import { readFile } from "node:fs/promises";
import path from "node:path";

import express from "express";

import { registerApiRoutes } from "./api";

const PORT = Number(process.env.PORT ?? "3000");
const HOST = process.env.HOST ?? "0.0.0.0";
const PROJECT_ROOT = process.cwd();
const CLIENT_DIST_DIR = path.resolve(PROJECT_ROOT, "dist/client");
const INDEX_HTML_PATH = path.resolve(PROJECT_ROOT, "index.html");
const SPA_PATHS = ["/", "/comparison", "/comparison/"];

export async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  registerApiRoutes(app);

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(CLIENT_DIST_DIR, { index: false }));
    for (const routePath of SPA_PATHS) {
      app.get(routePath, (_req, res) => {
        res.sendFile(path.resolve(CLIENT_DIST_DIR, "index.html"));
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
    for (const routePath of SPA_PATHS) {
      app.get(routePath, async (req, res, next) => {
        try {
          let html = await readFile(INDEX_HTML_PATH, "utf8");
          html = await vite.transformIndexHtml(req.originalUrl, html);
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
