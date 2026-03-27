import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { ComparisonPage, comparisonLoader } from "./routes/comparison-page";
import { ErrorPage } from "./routes/error-page";
import { HomePage } from "./routes/home-page";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/comparison",
    loader: comparisonLoader,
    element: <ComparisonPage />,
    errorElement: <ErrorPage />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
