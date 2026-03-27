import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

export function ErrorPage() {
  const error = useRouteError();
  let title = "Something went wrong";
  let message = "The page could not be loaded.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText || "Request failed"}`.trim();
    if (typeof error.data === "string" && error.data.trim()) {
      message = error.data;
    }
  } else if (error instanceof Error && error.message.trim()) {
    message = error.message;
  }

  return (
    <main className="page-shell comparison-shell">
      <section className="hero-panel">
        <div>
          <p className="comparison-kicker">Polyweather</p>
          <h1>{title}</h1>
        </div>
        <div className="hero-actions">
          <Link className="secondary-action-link" to="/">
            Back to dashboard
          </Link>
        </div>
      </section>

      <section className="empty-state">
        <h2>Unable to continue</h2>
        <p>{message}</p>
      </section>
    </main>
  );
}
