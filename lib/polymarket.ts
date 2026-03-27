import { AIRPORTS } from "./airports";

const POLYMARKET_SEARCH_BASE_URL = "https://gamma-api.polymarket.com/public-search";
const POLYMARKET_EVENT_BASE_URL = "https://polymarket.com/event";
const POLYMARKET_REQUEST_TIMEOUT_MS = 8_000;
const POLYMARKET_CACHE_TTL_MS = 15 * 60 * 1000;

type PolymarketSearchEvent = {
  active?: boolean;
  closed?: boolean;
  slug?: string;
  title?: string;
};

type PolymarketSearchResponse = {
  events?: PolymarketSearchEvent[];
};

let cachedLinks:
  | {
      expiresAt: number;
      links: Record<string, string | null>;
    }
  | null = null;

async function fetchCityPolymarketUrl(city: string) {
  const query = encodeURIComponent(`highest temperature in ${city}`);
  const response = await fetch(`${POLYMARKET_SEARCH_BASE_URL}?q=${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(POLYMARKET_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PolymarketSearchResponse;
  const events = Array.isArray(payload.events) ? payload.events : [];
  const normalizedCity = city.toLowerCase();

  const match =
    events.find(
      (event) =>
        event.active &&
        !event.closed &&
        typeof event.slug === "string" &&
        typeof event.title === "string" &&
        event.title.toLowerCase().includes(`highest temperature in ${normalizedCity}`),
    ) ??
    events.find(
      (event) => event.active && !event.closed && typeof event.slug === "string",
    );

  return match?.slug ? `${POLYMARKET_EVENT_BASE_URL}/${match.slug}` : null;
}

export async function getPolymarketLinks() {
  if (cachedLinks && cachedLinks.expiresAt > Date.now()) {
    return cachedLinks.links;
  }

  const settled = await Promise.allSettled(
    AIRPORTS.map(async (airport) => [
      airport.slug,
      await fetchCityPolymarketUrl(airport.city),
    ] as const),
  );

  const links = Object.fromEntries(
    settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : [AIRPORTS[index].slug, null],
    ),
  );

  cachedLinks = {
    expiresAt: Date.now() + POLYMARKET_CACHE_TTL_MS,
    links,
  };

  return links;
}
