import "../lib/load-env";

import {
  renderComparisonSyncSummary,
  runComparisonSync,
  shiftDate,
  todayInTimezone,
} from "../lib/comparison/sync";
import type { ComparisonSyncSummary } from "../lib/comparison/types";

type CliArgs = {
  startDate: string;
  endDate: string;
  format: "pretty" | "json";
  city: string | null;
};

type PersistSummary = ComparisonSyncSummary;

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

  const endDate = args.get("end-date") ?? shiftDate(todayInTimezone("UTC"), -1);
  const startDate = args.get("start-date") ?? shiftDate(endDate, -7);
  const format = args.get("format") ?? (args.has("json") ? "json" : "pretty");
  const city = args.get("city")?.trim() ?? null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid --start-date value: ${startDate}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid --end-date value: ${endDate}`);
  }
  if (startDate > endDate) {
    throw new Error(`start-date ${startDate} must be <= end-date ${endDate}`);
  }
  if (!["pretty", "json"].includes(format)) {
    throw new Error(`Invalid --format value: ${format}`);
  }

  return {
    startDate,
    endDate,
    format: format as CliArgs["format"],
    city,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary: PersistSummary = await runComparisonSync({
    startDate: args.startDate,
    endDate: args.endDate,
    cityFilter: args.city,
  });

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderComparisonSyncSummary(summary));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
