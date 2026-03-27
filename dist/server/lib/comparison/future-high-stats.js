"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildWundergroundFutureHighHourlyStatsForCity = rebuildWundergroundFutureHighHourlyStatsForCity;
const db_1 = require("./db");
const MIN_ELIGIBLE_WU_OBSERVATIONS_PER_DAY = 12;
const FUTURE_HIGH_METHOD = "wu-running-max-hourly-v1";
async function rebuildWundergroundFutureHighHourlyStatsForCity(citySlug) {
    await (0, db_1.ensureComparisonDb)();
    const result = await (0, db_1.getComparisonDbClient)().execute({
        sql: `
      WITH eligible_days AS (
        SELECT
          city_slug,
          local_date,
          MAX(temp_c) AS final_max_c
        FROM wu_observations
        WHERE city_slug = ?
          AND temp_c IS NOT NULL
        GROUP BY city_slug, local_date
        HAVING COUNT(*) >= ?
      ),
      hourly_snapshots AS (
        SELECT
          wu.city_slug,
          wu.local_date,
          CAST(substr(wu.observed_at_local, 12, 2) AS INTEGER) AS hour_bucket,
          MAX(wu.temp_c) OVER (
            PARTITION BY wu.city_slug, wu.local_date
            ORDER BY wu.observed_at_utc
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS running_max_c,
          ROW_NUMBER() OVER (
            PARTITION BY wu.city_slug, wu.local_date, CAST(substr(wu.observed_at_local, 12, 2) AS INTEGER)
            ORDER BY wu.observed_at_utc ASC
          ) AS hour_rank
        FROM wu_observations wu
        INNER JOIN eligible_days ed
          ON ed.city_slug = wu.city_slug
         AND ed.local_date = wu.local_date
        WHERE wu.temp_c IS NOT NULL
      )
      SELECT
        hs.city_slug,
        hs.hour_bucket,
        CAST(
          SUM(CASE WHEN ed.final_max_c > hs.running_max_c THEN 1 ELSE 0 END) AS REAL
        ) / COUNT(*) AS probability,
        COUNT(*) AS sample_count,
        SUM(CASE WHEN ed.final_max_c > hs.running_max_c THEN 1 ELSE 0 END) AS future_higher_count,
        (
          SELECT COUNT(*)
          FROM eligible_days
        ) AS eligible_day_count
      FROM hourly_snapshots hs
      INNER JOIN eligible_days ed
        ON ed.city_slug = hs.city_slug
       AND ed.local_date = hs.local_date
      WHERE hs.hour_rank = 1
      GROUP BY hs.city_slug, hs.hour_bucket
      ORDER BY hs.hour_bucket
    `,
        args: [citySlug, MIN_ELIGIBLE_WU_OBSERVATIONS_PER_DAY],
    });
    const generatedAt = new Date().toISOString();
    const records = result.rows.map((row) => {
        const typedRow = row;
        return {
            citySlug: typedRow.city_slug,
            hourBucket: Number(typedRow.hour_bucket),
            probability: Number(typedRow.probability),
            sampleCount: Number(typedRow.sample_count),
            futureHigherCount: Number(typedRow.future_higher_count),
            eligibleDayCount: Number(typedRow.eligible_day_count),
            method: FUTURE_HIGH_METHOD,
            generatedAt,
        };
    });
    await (0, db_1.replaceWundergroundFutureHighHourlyStats)(citySlug, records);
    return {
        citySlug,
        recordsWritten: records.length,
        method: FUTURE_HIGH_METHOD,
        generatedAt,
        minEligibleObservationsPerDay: MIN_ELIGIBLE_WU_OBSERVATIONS_PER_DAY,
    };
}
//# sourceMappingURL=future-high-stats.js.map