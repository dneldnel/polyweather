"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComparisonCoverageCheckedAt = getComparisonCoverageCheckedAt;
exports.getEarliestResolvedComparisonDay = getEarliestResolvedComparisonDay;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
let cachedCoverage = null;
function readCoverageFile() {
    if (!cachedCoverage) {
        const coveragePath = node_path_1.default.resolve(process.cwd(), "data/comparison-earliest-resolved-days.json");
        cachedCoverage = JSON.parse((0, node_fs_1.readFileSync)(coveragePath, "utf8"));
    }
    return cachedCoverage;
}
function getComparisonCoverageCheckedAt() {
    return readCoverageFile().checkedAt;
}
function getEarliestResolvedComparisonDay(citySlug) {
    return readCoverageFile().cities[citySlug] ?? null;
}
//# sourceMappingURL=history-coverage.js.map