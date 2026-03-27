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
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const api_1 = require("./api");
const PORT = Number(process.env.PORT ?? "3000");
const HOST = process.env.HOST ?? "0.0.0.0";
const PROJECT_ROOT = process.cwd();
const CLIENT_DIST_DIR = node_path_1.default.resolve(PROJECT_ROOT, "dist/client");
const INDEX_HTML_PATH = node_path_1.default.resolve(PROJECT_ROOT, "index.html");
const SPA_PATHS = ["/", "/comparison", "/comparison/"];
async function createApp() {
    const app = (0, express_1.default)();
    app.disable("x-powered-by");
    app.use(express_1.default.json());
    (0, api_1.registerApiRoutes)(app);
    if (process.env.NODE_ENV === "production") {
        app.use(express_1.default.static(CLIENT_DIST_DIR, { index: false }));
        for (const routePath of SPA_PATHS) {
            app.get(routePath, (_req, res) => {
                res.sendFile(node_path_1.default.resolve(CLIENT_DIST_DIR, "index.html"));
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
        for (const routePath of SPA_PATHS) {
            app.get(routePath, async (req, res, next) => {
                try {
                    let html = await (0, promises_1.readFile)(INDEX_HTML_PATH, "utf8");
                    html = await vite.transformIndexHtml(req.originalUrl, html);
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