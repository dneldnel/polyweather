import { AIRPORTS } from "../../lib/airports";

export function PageLoading() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <p className="eyebrow">Polyweather</p>
        <h1>Polyweather</h1>
        <p className="hero-copy">
          Preparing the dashboard shell while the page initializes.
        </p>
      </section>

      <section className="cards-grid" aria-hidden="true">
        {AIRPORTS.map((airport) => (
          <article key={airport.slug} className="weather-card card-skeleton">
            <div className="card-topline" />
            <div className="card-skeleton-line card-skeleton-title" />
            <div className="card-skeleton-line" />
            <div className="card-skeleton-line" />
            <div className="card-skeleton-line" />
          </article>
        ))}
      </section>
    </main>
  );
}
