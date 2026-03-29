import {
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router-dom";

import { ComparisonDashboard } from "../components/comparison-dashboard";

import type { ComparisonPageData } from "../../lib/comparison/page-data";

declare global {
  interface Window {
    __POLYWEATHER_COMPARISON_INITIAL__?:
      | {
          url: string;
          data: ComparisonPageData;
        }
      | undefined;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function getPathWithSearch(value: string) {
  const url = new URL(value, window.location.origin);
  return `${url.pathname}${url.search}`;
}

function readBootstrappedComparisonData(requestUrl: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const payload = window.__POLYWEATHER_COMPARISON_INITIAL__;
  if (!payload) {
    return null;
  }

  if (payload.url !== getPathWithSearch(requestUrl)) {
    return null;
  }

  delete window.__POLYWEATHER_COMPARISON_INITIAL__;
  return payload.data;
}

export async function comparisonLoader({ request }: LoaderFunctionArgs) {
  const bootstrappedData = readBootstrappedComparisonData(request.url);
  if (bootstrappedData) {
    return bootstrappedData;
  }

  const requestUrl = new URL(request.url);
  const apiUrl = new URL("/api/comparison", requestUrl);
  apiUrl.search = requestUrl.search;

  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/json",
    },
    signal: request.signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    const message = payload?.error?.trim() || `Failed to load comparison data (${response.status})`;

    throw new Response(message, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  return readJson<ComparisonPageData>(response);
}

export function ComparisonPage() {
  const data = useLoaderData() as ComparisonPageData;
  const navigation = useNavigation();
  const isLoadingComparison =
    navigation.state === "loading" && navigation.location?.pathname === "/comparison";

  return (
    <ComparisonDashboard
      initialStartDate={data.startDate}
      initialEndDate={data.endDate}
      initialCity={data.city}
      initialSelectedDate={data.selectedDate}
      initialReport={data.report}
      initialCityDetail={data.cityDetail}
      initialDayDetail={data.dayDetail}
      initialEarliestResolvedDate={data.earliestResolvedDate}
      statusLabel={data.statusLabel}
      isLoading={isLoadingComparison}
    />
  );
}
