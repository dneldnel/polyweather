import {
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router-dom";

import { ComparisonDashboard } from "../components/comparison-dashboard";

import type { ComparisonPageData } from "../../lib/comparison/page-data";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function comparisonLoader({ request }: LoaderFunctionArgs) {
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
