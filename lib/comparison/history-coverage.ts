import { readFileSync } from "node:fs";
import path from "node:path";

type EarliestResolvedDaysFile = {
  checkedAt: string;
  cities: Record<string, string>;
};

let cachedCoverage: EarliestResolvedDaysFile | null = null;

function readCoverageFile() {
  if (!cachedCoverage) {
    const coveragePath = path.resolve(
      process.cwd(),
      "data/comparison-earliest-resolved-days.json",
    );
    cachedCoverage = JSON.parse(
      readFileSync(coveragePath, "utf8"),
    ) as EarliestResolvedDaysFile;
  }

  return cachedCoverage;
}

export function getComparisonCoverageCheckedAt() {
  return readCoverageFile().checkedAt;
}

export function getEarliestResolvedComparisonDay(citySlug: string) {
  return readCoverageFile().cities[citySlug] ?? null;
}
