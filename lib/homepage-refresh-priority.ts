import { AIRPORTS } from "./airports";
import type { AirportConfig } from "./types";

const LOCAL_TIME_SORT_START_MINUTES = 11 * 60;
const HOMEPAGE_PRIORITY_BATCH_SIZE = 6;

function getLocalTimeSortKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const totalMinutes = hour * 60 + minute;
  return (totalMinutes - LOCAL_TIME_SORT_START_MINUTES + 24 * 60) % (24 * 60);
}

function compareHomepagePriorityAirports(
  left: AirportConfig,
  right: AirportConfig,
  now: Date,
) {
  const timeDifference =
    getLocalTimeSortKey(now, left.timezone) - getLocalTimeSortKey(now, right.timezone);

  if (timeDifference !== 0) {
    return timeDifference;
  }

  const cityDifference = left.city.localeCompare(right.city);
  if (cityDifference !== 0) {
    return cityDifference;
  }

  return left.slug.localeCompare(right.slug);
}

export function splitHomepageRefreshAirports(
  airports: AirportConfig[] = AIRPORTS,
  batchSize = HOMEPAGE_PRIORITY_BATCH_SIZE,
  now = new Date(),
) {
  const orderedAirports = [...airports].sort((left, right) =>
    compareHomepagePriorityAirports(left, right, now),
  );

  return {
    priorityAirports: orderedAirports.slice(0, batchSize),
    remainingAirports: orderedAirports.slice(batchSize),
  };
}
