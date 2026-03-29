import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { ErrorPage } from "./routes/error-page";

const router = createBrowserRouter([
  {
    path: "/",
    ErrorBoundary: ErrorPage,
    lazy: async () => {
      const { HomePage } = await import("./routes/home-page");

      return {
        Component: HomePage,
      };
    },
  },
  {
    path: "/comparison",
    ErrorBoundary: ErrorPage,
    lazy: async () => {
      const { ComparisonPage, comparisonLoader } = await import("./routes/comparison-page");

      return {
        loader: comparisonLoader,
        Component: ComparisonPage,
      };
    },
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
