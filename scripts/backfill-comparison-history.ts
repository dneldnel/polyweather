import "../lib/load-env";

import { readFile } from "node:fs/promises";

import { AIRPORTS } from "../lib/airports";
import {
  formatDateInTimezone,
  resolveComparisonCityConfigs,
  runComparisonSync,
  type ComparisonSyncSummary,
} from "../lib/comparison/sync";

type CliArgs = {
  city: string | null;
  endDate: string | null;
  format: "pretty" | "json";
};

type EarliestResolvedDaysFile = {
  checkedAt: string;
  cities: Record<string, string>;
};

type ChildSyncSummary = ComparisonSyncSummary;

type CityBackfillResult = {
  citySlug: string;
  city: string;
  stationIcao: string;
  startDate: string;
  endDate: string;
  summary: ChildSyncSummary | null;
  error: string | null;
};

type BackfillSummary = {
  generatedAt: string;
  checkedAt: string;
  requestedCity: string | null;
  explicitEndDate: string | null;
  citiesProcessed: number;
  citiesSucceeded: number;
  citiesFailed: number;
  polymarketDaysUpserted: number;
  wuObservationPointsUpserted: number;
  awObservationPointsUpserted: number;
  results: CityBackfillResult[];
};

const EARLIEST_DAYS_PATH = new URL("../data/comparison-earliest-resolved-days.json", import.meta.url);

function logProgress(message: string) {
  console.error(`[${new Date().toISOString()}] ${message}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  const endDate = args.get("end-date")?.trim() ?? null;
  const format = args.get("format") ?? (args.has("json") ? "json" : "pretty");
  const city = args.get("city")?.trim() ?? null;

  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid --end-date value: ${endDate}`);
  }

  if (!["pretty", "json"].includes(format)) {
    throw new Error(`Invalid --format value: ${format}`);
  }

  return {
    city,
    endDate,
    format: format as CliArgs["format"],
  };
}

async function loadEarliestResolvedDays() {
  const raw = await readFile(EARLIEST_DAYS_PATH, "utf8");
  const parsed = JSON.parse(raw) as EarliestResolvedDaysFile;

  if (!parsed || typeof parsed !== "object" || !parsed.cities || typeof parsed.cities !== "object") {
    throw new Error("Invalid comparison earliest-resolved-days JSON");
  }

  for (const airport of AIRPORTS) {
    const date = parsed.cities[airport.slug];
    if (!date) {
      throw new Error(`Missing earliest resolved date for city ${airport.slug}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid earliest resolved date for city ${airport.slug}: ${date}`);
    }
  }

  return parsed;
}

async function runCityBackfill(params: {
  citySlug: string;
  startDate: string;
  endDate: string;
}) {
  return runComparisonSync({
    cityFilter: params.citySlug,
    startDate: params.startDate,
    endDate: params.endDate,
  });
}

function renderPretty(summary: BackfillSummary) {
  const lines: string[] = [];
  lines.push("Backfilled /comparison history using city-specific earliest resolved dates");
  lines.push(`Cities processed: ${summary.citiesProcessed}`);
  lines.push(`Cities succeeded: ${summary.citiesSucceeded}`);
  lines.push(`Cities failed: ${summary.citiesFailed}`);
  lines.push(`Polymarket days upserted: ${summary.polymarketDaysUpserted}`);
  lines.push(`WU observation points upserted: ${summary.wuObservationPointsUpserted}`);
  lines.push(`AW observation points upserted: ${summary.awObservationPointsUpserted}`);

  if (summary.explicitEndDate) {
    lines.push(`Explicit end date: ${summary.explicitEndDate}`);
  } else {
    lines.push("End date mode: current local date in each city timezone");
  }

  if (summary.results.length > 0) {
    lines.push("");
    lines.push("Per-city results:");
  }

  for (const result of summary.results) {
    if (result.error) {
      lines.push(
        `- ${result.city} (${result.citySlug}) ${result.startDate}..${result.endDate}: FAILED ${result.error}`,
      );
      continue;
    }

    lines.push(
      `- ${result.city} (${result.citySlug}) ${result.startDate}..${result.endDate}: ` +
        `poly=${result.summary?.polymarketDaysUpserted ?? 0}, ` +
        `wu=${result.summary?.wuObservationPointsUpserted ?? 0}, ` +
        `aw=${result.summary?.awObservationPointsUpserted ?? 0}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const earliestResolvedDays = await loadEarliestResolvedDays();
  const airports = resolveComparisonCityConfigs(args.city);

  const summary: BackfillSummary = {
    generatedAt: new Date().toISOString(),
    checkedAt: earliestResolvedDays.checkedAt,
    requestedCity: args.city,
    explicitEndDate: args.endDate,
    citiesProcessed: airports.length,
    citiesSucceeded: 0,
    citiesFailed: 0,
    polymarketDaysUpserted: 0,
    wuObservationPointsUpserted: 0,
    awObservationPointsUpserted: 0,
    results: [],
  };

  for (const airport of airports) {
    const startDate = earliestResolvedDays.cities[airport.slug];
    const endDate = args.endDate ?? formatDateInTimezone(new Date(), airport.timezone);

    if (startDate > endDate) {
      throw new Error(
        `City ${airport.slug} has earliest resolved date ${startDate} after end date ${endDate}`,
      );
    }

    logProgress(`${airport.city}: backfilling ${startDate}..${endDate}`);

    try {
      const childSummary = await runCityBackfill({
        citySlug: airport.slug,
        startDate,
        endDate,
      });

      summary.citiesSucceeded += 1;
      summary.polymarketDaysUpserted += childSummary.polymarketDaysUpserted;
      summary.wuObservationPointsUpserted += childSummary.wuObservationPointsUpserted;
      summary.awObservationPointsUpserted += childSummary.awObservationPointsUpserted;
      summary.results.push({
        citySlug: airport.slug,
        city: airport.city,
        stationIcao: airport.stationIcao,
        startDate,
        endDate,
        summary: childSummary,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.citiesFailed += 1;
      summary.results.push({
        citySlug: airport.slug,
        city: airport.city,
        stationIcao: airport.stationIcao,
        startDate,
        endDate,
        summary: null,
        error: message,
      });
    }
  }

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(renderPretty(summary));
  }

  if (summary.citiesFailed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
