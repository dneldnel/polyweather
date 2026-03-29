"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
exports.startServer = startServer;
require("../lib/load-env");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const compression_1 = __importDefault(require("compression"));
const express_1 = __importDefault(require("express"));
const page_data_1 = require("../lib/comparison/page-data");
const refresh_weather_1 = require("../lib/refresh-weather");
const store_1 = require("../lib/store");
const api_1 = require("./api");
const PORT = Number(process.env.PORT ?? "3000");
const HOST = process.env.HOST ?? "0.0.0.0";
const PROJECT_ROOT = process.cwd();
const CLIENT_DIST_DIR = node_path_1.default.resolve(PROJECT_ROOT, "dist/client");
const INDEX_HTML_PATH = node_path_1.default.resolve(PROJECT_ROOT, "index.html");
const CLIENT_INDEX_HTML_PATH = node_path_1.default.resolve(CLIENT_DIST_DIR, "index.html");
const HOME_SPA_PATHS = ["/"];
const COMPARISON_SPA_PATHS = ["/comparison", "/comparison/"];
function serializeForInlineScript(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}
function injectBeforeBodyEnd(html, snippet) {
    return html.includes("</body>")
        ? html.replace("</body>", `${snippet}\n  </body>`)
        : `${html}\n${snippet}`;
}
function getBasicAuthConfig() {
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
function parseBasicAuthorizationHeader(value) {
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
    }
    catch {
        return null;
    }
}
function matchesSecret(actual, expected) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return (actualBuffer.length === expectedBuffer.length &&
        (0, node_crypto_1.timingSafeEqual)(actualBuffer, expectedBuffer));
}
function createBasicAuthMiddleware(config) {
    return (req, res, next) => {
        const credentials = parseBasicAuthorizationHeader(req.headers.authorization);
        const isAuthorized = credentials !== null &&
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
async function getComparisonBootstrapPayload(req) {
    try {
        const data = await (0, page_data_1.getComparisonPageData)(req.query);
        return {
            url: req.originalUrl,
            data,
        };
    }
    catch {
        return null;
    }
}
async function injectComparisonBootstrapData(req, html) {
    const payload = await getComparisonBootstrapPayload(req);
    if (!payload) {
        return html;
    }
    const script = `<script>window.__POLYWEATHER_COMPARISON_INITIAL__=${serializeForInlineScript(payload)};</script>`;
    return injectBeforeBodyEnd(html, script);
}
function getHomeBootstrapPayload(req) {
    const current = (0, store_1.buildWeatherResponse)();
    if (!current.cards?.length && current.refreshState !== "refreshing") {
        void (0, refresh_weather_1.startWeatherSnapshotRefresh)();
    }
    return {
        url: req.originalUrl,
        data: (0, store_1.buildWeatherResponse)(),
    };
}
function injectHomeBootstrapData(req, html) {
    const payload = getHomeBootstrapPayload(req);
    const script = `<script>window.__POLYWEATHER_HOME_INITIAL__=${serializeForInlineScript(payload)};</script>`;
    return injectBeforeBodyEnd(html, script);
}
async function createApp() {
    const app = (0, express_1.default)();
    app.disable("x-powered-by");
    app.use((0, compression_1.default)());
    app.use(express_1.default.json());
    const basicAuthConfig = getBasicAuthConfig();
    if (basicAuthConfig) {
        app.use(createBasicAuthMiddleware(basicAuthConfig));
    }
    (0, api_1.registerApiRoutes)(app);
    if (process.env.NODE_ENV === "production") {
        app.use(express_1.default.static(CLIENT_DIST_DIR, { index: false }));
        for (const routePath of HOME_SPA_PATHS) {
            app.get(routePath, async (req, res, next) => {
                try {
                    res.set("Cache-Control", "no-store");
                    const html = await (0, promises_1.readFile)(CLIENT_INDEX_HTML_PATH, "utf8");
                    const hydratedHtml = injectHomeBootstrapData(req, html);
                    res.status(200).type("html").send(hydratedHtml);
                }
                catch (error) {
                    next(error);
                }
            });
        }
        for (const routePath of COMPARISON_SPA_PATHS) {
            app.get(routePath, async (req, res, next) => {
                try {
                    res.set("Cache-Control", "no-store");
                    const html = await (0, promises_1.readFile)(CLIENT_INDEX_HTML_PATH, "utf8");
                    const hydratedHtml = await injectComparisonBootstrapData(req, html);
                    res.status(200).type("html").send(hydratedHtml);
                }
                catch (error) {
                    next(error);
                }
            });
        }
    }
    else {
        const { createServer } = await Promise.resolve().then(() => __importStar(require("vite")));
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
                    let html = await (0, promises_1.readFile)(INDEX_HTML_PATH, "utf8");
                    html = await vite.transformIndexHtml(req.originalUrl, html);
                    html = injectHomeBootstrapData(req, html);
                    res.status(200).type("html").send(html);
                }
                catch (error) {
                    vite.ssrFixStacktrace(error);
                    next(error);
                }
            });
        }
        for (const routePath of COMPARISON_SPA_PATHS) {
            app.get(routePath, async (req, res, next) => {
                try {
                    res.set("Cache-Control", "no-store");
                    let html = await (0, promises_1.readFile)(INDEX_HTML_PATH, "utf8");
                    html = await vite.transformIndexHtml(req.originalUrl, html);
                    html = await injectComparisonBootstrapData(req, html);
                    res.status(200).type("html").send(html);
                }
                catch (error) {
                    vite.ssrFixStacktrace(error);
                    next(error);
                }
            });
        }
    }
    app.use((err, req, res, _next) => {
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
async function startServer() {
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
//# sourceMappingURL=index.js.map