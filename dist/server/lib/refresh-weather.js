"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWeatherSnapshotRefresh = startWeatherSnapshotRefresh;
exports.startWeatherCardRefresh = startWeatherCardRefresh;
exports.refreshWeatherSnapshot = refreshWeatherSnapshot;
exports.refreshAndRespond = refreshAndRespond;
exports.refreshCardAndRespond = refreshCardAndRespond;
const airports_1 = require("./airports");
const db_1 = require("./comparison/db");
const signal_model_config_1 = require("./signal-model-config");
const store_1 = require("./store");
const temperature_1 = require("./temperature");
const USER_AGENT = "polyweather-web/0.1";
const REQUEST_TIMEOUT_MS = 12_000;
const CITY_CONCURRENCY = 4;
const OPEN_METEO_MODELS = {
    ecmwf: {
        label: "Open-Meteo ECMWF",
        upstreamModel: "ecmwf_ifs",
        sourceId: "open-meteo-ecmwf",
    },
    gfs: {
        label: "Open-Meteo GFS",
        upstreamModel: "gfs_seamless",
        sourceId: "open-meteo-gfs",
    },
};
function createTodayHighModelFromSignalModel(model) {
    return {
        label: model.label,
        upstreamModel: model.forecastModel,
        sourceId: model.forecastModel,
    };
}
function createEmptyReading(sourceId, sourceLabel) {
    return {
        sourceId,
        sourceLabel,
        value: null,
        unit: null,
        observedAt: null,
        forecastDate: null,
        fetchedAt: null,
        status: "missing",
        error: null,
    };
}
function createEmptyTemperatureTrend(sourceId, sourceLabel) {
    return {
        sourceId,
        sourceLabel,
        localDate: null,
        points: [],
        fetchedAt: null,
        status: "missing",
        error: null,
    };
}
function createEmptyWeatherSignals(model) {
    return {
        sourceId: model.forecastModel,
        sourceLabel: model.label,
        modelRunInitialisedAt: null,
        publishedAt: null,
        weatherCode: null,
        isDay: null,
        sunrise: null,
        sunset: null,
        daylightDurationSeconds: null,
        cloudCover: null,
        precipitationProbability: null,
        precipitation: null,
        windSpeed: null,
        observedAt: null,
        fetchedAt: null,
        status: "missing",
        error: null,
        nextHours: [],
    };
}
function createEmptyHistoryBasedLaterHighCurve() {
    return {
        generatedAt: null,
        method: null,
        buckets: [],
        status: "missing",
        error: null,
    };
}
function getDateParts(timezone, offsetDays = 0) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const reference = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    const parts = formatter.formatToParts(reference);
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return {
        iso: `${year}-${month}-${day}`,
        compact: `${year}${month}${day}`,
    };
}
function getLocalDateForTimestamp(value, timezone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
}
async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            accept: "application/json",
            "user-agent": USER_AGENT,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json());
}
async function fetchRawResponse(url) {
    return fetch(url, {
        headers: {
            accept: "application/json",
            "user-agent": USER_AGENT,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}
function withStaleFallback(reading, previous, fallback) {
    if (reading) {
        return reading;
    }
    if (previous && previous.value !== null) {
        return {
            ...previous,
            status: "stale",
            error: fallback.error,
            fetchedAt: fallback.fetchedAt,
        };
    }
    return fallback;
}
function withTemperatureTrendFallback(trend, previous, fallback) {
    if (trend) {
        return trend;
    }
    if (previous && previous.points.length > 0) {
        return {
            ...previous,
            status: "stale",
            error: fallback.error,
            fetchedAt: fallback.fetchedAt,
        };
    }
    return fallback;
}
function formatSourceError(sourceId, sourceLabel, error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return {
        sourceId,
        sourceLabel,
        value: null,
        unit: null,
        observedAt: null,
        forecastDate: null,
        fetchedAt: new Date().toISOString(),
        status: "error",
        error: message,
    };
}
function formatTemperatureTrendError(sourceId, sourceLabel, error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return {
        sourceId,
        sourceLabel,
        localDate: null,
        points: [],
        fetchedAt: new Date().toISOString(),
        status: "error",
        error: message,
    };
}
function formatWeatherSignalsError(model, error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return {
        sourceId: model.forecastModel,
        sourceLabel: model.label,
        modelRunInitialisedAt: null,
        publishedAt: null,
        weatherCode: null,
        isDay: null,
        sunrise: null,
        sunset: null,
        daylightDurationSeconds: null,
        cloudCover: null,
        precipitationProbability: null,
        precipitation: null,
        windSpeed: null,
        observedAt: null,
        fetchedAt: new Date().toISOString(),
        status: "error",
        error: message,
        nextHours: [],
    };
}
function withWeatherSignalsFallback(signals, previous, fallback) {
    if (signals) {
        return signals;
    }
    if (previous && previous.observedAt) {
        return {
            ...previous,
            status: "stale",
            error: fallback.error,
            fetchedAt: fallback.fetchedAt,
        };
    }
    return fallback;
}
function withHistoryBasedLaterHighCurveFallback(curve, previous, fallback) {
    if (curve) {
        return curve;
    }
    if (previous && previous.buckets.length > 0) {
        return {
            ...previous,
            status: "stale",
            error: fallback.error,
        };
    }
    return fallback;
}
function getLegacyWeatherSignals(previousCard) {
    return previousCard?.weatherSignals;
}
function getPreviousWeatherSignalsBySource(previousCard, sourceId) {
    const mappedSignals = previousCard?.weatherSignalsBySource?.[sourceId];
    if (mappedSignals) {
        return mappedSignals;
    }
    if (sourceId === signal_model_config_1.DEFAULT_SIGNAL_MODEL.forecastModel) {
        return getLegacyWeatherSignals(previousCard);
    }
    return undefined;
}
function formatHistoryBasedLaterHighCurveError(error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return {
        generatedAt: null,
        method: null,
        buckets: [],
        status: "error",
        error: message,
    };
}
const cachedSignalModelMetadata = new Map();
const signalModelMetadataPromises = new Map();
async function fetchSignalModelMetadata(model) {
    const now = Date.now();
    const cachedMetadata = cachedSignalModelMetadata.get(model.forecastModel);
    if (cachedMetadata && now - cachedMetadata.fetchedAtMs < 5 * 60 * 1000) {
        return cachedMetadata.value;
    }
    const existingPromise = signalModelMetadataPromises.get(model.forecastModel);
    if (existingPromise) {
        return existingPromise;
    }
    const promise = fetchJson(model.metaUrl)
        .then((value) => {
        cachedSignalModelMetadata.set(model.forecastModel, {
            fetchedAtMs: Date.now(),
            value,
        });
        signalModelMetadataPromises.delete(model.forecastModel);
        return value;
    })
        .catch((error) => {
        signalModelMetadataPromises.delete(model.forecastModel);
        throw error;
    });
    signalModelMetadataPromises.set(model.forecastModel, promise);
    return promise;
}
function getWuApiKey() {
    const apiKey = process.env.WUNDERGROUND_SUN_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("Missing WUNDERGROUND_SUN_API_KEY");
    }
    return apiKey;
}
async function fetchWuObservations(airport, localDateCompact) {
    const apiKey = getWuApiKey();
    const locationId = `${airport.stationIcao}:9:${airport.countryCode}`;
    const unit = (0, temperature_1.getAirportDisplayTemperatureUnit)(airport) === "F" ? "e" : "m";
    const url = `https://api.weather.com/v1/location/${locationId}/observations/historical.json` +
        `?units=${unit}&startDate=${localDateCompact}&endDate=${localDateCompact}&apiKey=${apiKey}`;
    const response = await fetchRawResponse(url);
    if (!response.ok) {
        const body = await response.text();
        if (response.status === 400 && body.includes('"code":"NDF-0001"')) {
            throw new Error("WU_NO_DATA_FOR_LOCAL_DAY");
        }
        throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json());
    return Array.isArray(payload.observations) ? payload.observations : [];
}
function pickLatestWuObservation(observations) {
    return (observations ?? [])
        .filter((row) => typeof row.valid_time_gmt === "number" &&
        typeof row.temp === "number")
        .sort((left, right) => (left.valid_time_gmt ?? 0) - (right.valid_time_gmt ?? 0));
}
function buildWuReading(sourceId, sourceLabel, observation, unit, status, error) {
    return {
        sourceId,
        sourceLabel,
        value: observation.temp ?? null,
        unit,
        observedAt: typeof observation.valid_time_gmt === "number"
            ? new Date(observation.valid_time_gmt * 1000).toISOString()
            : null,
        forecastDate: null,
        fetchedAt: new Date().toISOString(),
        status,
        error,
    };
}
function pickWuTodayHighObservation(observations) {
    const usable = pickLatestWuObservation(observations);
    if (usable.length === 0) {
        return null;
    }
    let highest = usable[0];
    for (const observation of usable) {
        if ((observation.temp ?? Number.NEGATIVE_INFINITY) > (highest.temp ?? Number.NEGATIVE_INFINITY)) {
            highest = observation;
        }
    }
    return highest;
}
async function fetchWuSummary(airport) {
    const localDate = getDateParts(airport.timezone);
    const unit = (0, temperature_1.getAirportDisplayTemperatureUnit)(airport);
    try {
        const observations = await fetchWuObservations(airport, localDate.compact);
        const latest = pickLatestWuObservation(observations).at(-1);
        const todayHigh = pickWuTodayHighObservation(observations);
        if (!latest ||
            !todayHigh ||
            typeof latest.temp !== "number" ||
            typeof latest.valid_time_gmt !== "number" ||
            typeof todayHigh.temp !== "number" ||
            typeof todayHigh.valid_time_gmt !== "number") {
            throw new Error("WU_NO_DATA_FOR_LOCAL_DAY");
        }
        return {
            current: buildWuReading("wu", "Wunderground", latest, unit, "fresh", null),
            todayHigh: buildWuReading("wu-today-high", "WU high", todayHigh, unit, "fresh", null),
        };
    }
    catch (error) {
        if (!(error instanceof Error) || error.message !== "WU_NO_DATA_FOR_LOCAL_DAY") {
            throw error;
        }
        const previousLocalDate = getDateParts(airport.timezone, -1);
        const fallbackObservations = await fetchWuObservations(airport, previousLocalDate.compact);
        const latestFallback = pickLatestWuObservation(fallbackObservations)
            .at(-1);
        if (!latestFallback ||
            typeof latestFallback.temp !== "number" ||
            typeof latestFallback.valid_time_gmt !== "number") {
            throw new Error("No usable WU observations for current or previous local day");
        }
        return {
            current: buildWuReading("wu", "Wunderground", latestFallback, unit, "stale", "No same-day WU observation yet; using previous local-day latest observation."),
            todayHigh: formatSourceError("wu-today-high", "WU high", "No same-day WU observations available yet."),
        };
    }
}
async function fetchHistoryBasedLaterHighCurve(airport) {
    const rows = await (0, db_1.getWundergroundFutureHighHourlyStats)(airport.slug);
    if (rows.length === 0) {
        throw new Error("No WU future-high history stats available yet");
    }
    return {
        generatedAt: rows[0]?.generatedAt ?? null,
        method: rows[0]?.method ?? null,
        buckets: rows.map((row) => ({
            hour: row.hourBucket,
            probability: row.probability,
            sampleCount: row.sampleCount,
            futureHigherCount: row.futureHigherCount,
            eligibleDayCount: row.eligibleDayCount,
        })),
        status: "fresh",
        error: null,
    };
}
function createAviationTrendPoints(rows, airport, localDate) {
    const sameDayRows = rows
        .filter((row) => typeof row.reportTime === "string" &&
        typeof row.temp === "number" &&
        getLocalDateForTimestamp(row.reportTime, airport.timezone) === localDate)
        .sort((left, right) => new Date(left.reportTime ?? 0).getTime() - new Date(right.reportTime ?? 0).getTime());
    const trendPoints = [];
    for (const row of sameDayRows) {
        const point = {
            observedAt: row.reportTime,
            temperature: row.temp,
        };
        const previousPoint = trendPoints.at(-1);
        if (previousPoint?.observedAt === point.observedAt) {
            trendPoints[trendPoints.length - 1] = point;
            continue;
        }
        trendPoints.push(point);
    }
    return trendPoints;
}
async function fetchAviationWeatherData(airport) {
    const url = `https://aviationweather.gov/api/data/metar?ids=${airport.stationIcao}&format=json&hours=24`;
    const payload = await fetchJson(url);
    const usableRows = (Array.isArray(payload) ? payload : [])
        .filter((row) => typeof row.reportTime === "string" &&
        typeof row.temp === "number" &&
        !Number.isNaN(new Date(row.reportTime).getTime()))
        .sort((left, right) => new Date(left.reportTime ?? 0).getTime() - new Date(right.reportTime ?? 0).getTime());
    const latest = usableRows.at(-1);
    const localDate = getDateParts(airport.timezone).iso;
    const trendPoints = createAviationTrendPoints(usableRows, airport, localDate);
    if (!latest || typeof latest.temp !== "number") {
        throw new Error("No usable AviationWeather record");
    }
    const fetchedAt = new Date().toISOString();
    return {
        current: {
            sourceId: "aviationweather",
            sourceLabel: "AW",
            value: latest.temp,
            unit: "C",
            observedAt: latest.reportTime ?? null,
            forecastDate: null,
            fetchedAt,
            status: "fresh",
            error: null,
        },
        trend: {
            sourceId: "aviationweather-trend",
            sourceLabel: "AW observed",
            localDate,
            points: trendPoints,
            fetchedAt,
            status: "fresh",
            error: null,
        },
    };
}
async function fetchOpenMeteoTodayHigh(airport, model) {
    const airportToday = getDateParts(airport.timezone).iso;
    const unit = (0, temperature_1.getAirportDisplayTemperatureUnit)(airport);
    const temperatureUnit = unit === "F" ? "&temperature_unit=fahrenheit" : "";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${airport.latitude}` +
        `&longitude=${airport.longitude}` +
        `&daily=temperature_2m_max` +
        `&timezone=${encodeURIComponent(airport.timezone)}` +
        temperatureUnit +
        `&forecast_days=2` +
        `&models=${model.upstreamModel}`;
    const payload = await fetchJson(url);
    const times = payload.daily?.time ?? [];
    const maxima = payload.daily?.temperature_2m_max ?? [];
    const index = times.findIndex((value) => value === airportToday);
    if (index < 0 || typeof maxima[index] !== "number") {
        throw new Error(`No usable Open-Meteo daily max for ${airportToday}`);
    }
    return {
        sourceId: model.sourceId,
        sourceLabel: model.label,
        value: maxima[index] ?? null,
        unit,
        observedAt: null,
        forecastDate: times[index] ?? airportToday,
        fetchedAt: new Date().toISOString(),
        status: "fresh",
        error: null,
    };
}
async function fetchOpenMeteoSignals(airport, model) {
    const displayUnit = (0, temperature_1.getAirportDisplayTemperatureUnit)(airport);
    const temperatureUnit = displayUnit === "F" ? "&temperature_unit=fahrenheit" : "";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${airport.latitude}` +
        `&longitude=${airport.longitude}` +
        temperatureUnit +
        `&models=${model.forecastModel}` +
        `&current=weather_code,is_day,cloud_cover,wind_speed_10m,precipitation` +
        `&daily=sunrise,sunset,daylight_duration` +
        `&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m` +
        `&forecast_hours=6` +
        `&timezone=${encodeURIComponent(airport.timezone)}`;
    const [payload, metadata] = await Promise.all([
        fetchJson(url),
        fetchSignalModelMetadata(model),
    ]);
    const current = payload.current;
    const sunrise = payload.daily?.sunrise?.[0] ?? null;
    const sunset = payload.daily?.sunset?.[0] ?? null;
    const daylightDurationSeconds = typeof payload.daily?.daylight_duration?.[0] === "number"
        ? payload.daily.daylight_duration[0]
        : null;
    const hourlyTimes = payload.hourly?.time ?? [];
    const temperatures = payload.hourly?.temperature_2m ?? [];
    const precipitationProbabilities = payload.hourly?.precipitation_probability ?? [];
    const cloudCover = payload.hourly?.cloud_cover ?? [];
    const windSpeed = payload.hourly?.wind_speed_10m ?? [];
    if (!current?.time) {
        throw new Error("No usable Open-Meteo current signal timestamp");
    }
    const currentTime = current.time;
    const currentIndex = hourlyTimes.findIndex((value) => value === currentTime);
    const nextHours = [];
    const seenForecastTimes = new Set();
    for (let index = currentIndex + 1; index < hourlyTimes.length && nextHours.length < 3; index += 1) {
        const forecastAt = hourlyTimes[index];
        if (!forecastAt || seenForecastTimes.has(forecastAt)) {
            continue;
        }
        seenForecastTimes.add(forecastAt);
        nextHours.push({
            forecastAt,
            temperature: typeof temperatures[index] === "number" ? temperatures[index] : null,
            precipitationProbability: typeof precipitationProbabilities[index] === "number"
                ? precipitationProbabilities[index]
                : null,
            cloudCover: typeof cloudCover[index] === "number" ? cloudCover[index] : null,
            windSpeed: typeof windSpeed[index] === "number" ? windSpeed[index] : null,
        });
    }
    return {
        sourceId: model.forecastModel,
        sourceLabel: model.label,
        modelRunInitialisedAt: typeof metadata.last_run_initialisation_time === "number"
            ? new Date(metadata.last_run_initialisation_time * 1000).toISOString()
            : null,
        publishedAt: typeof metadata.last_run_availability_time === "number"
            ? new Date(metadata.last_run_availability_time * 1000).toISOString()
            : null,
        weatherCode: typeof current.weather_code === "number" ? current.weather_code : null,
        isDay: typeof current.is_day === "number" ? current.is_day === 1 : null,
        sunrise,
        sunset,
        daylightDurationSeconds,
        cloudCover: typeof current.cloud_cover === "number" ? current.cloud_cover : null,
        precipitationProbability: currentIndex >= 0 && typeof precipitationProbabilities[currentIndex] === "number"
            ? precipitationProbabilities[currentIndex]
            : null,
        precipitation: typeof current.precipitation === "number" ? current.precipitation : null,
        windSpeed: typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null,
        observedAt: currentTime,
        fetchedAt: new Date().toISOString(),
        status: "fresh",
        error: null,
        nextHours,
    };
}
async function refreshCard(airport, previousCard) {
    const signalModels = (0, signal_model_config_1.getSignalModelsForAirport)(airport);
    const highPrecisionTodayHighModel = (0, signal_model_config_1.getTodayHighHighPrecisionSignalModelForAirport)(airport);
    const [wuSummaryResult, historyBasedLaterHighResult, latestResolvedComparisonDateResult, aviationResult, ecmwfResult, gfsResult, highPrecisionTodayHighResult, ...weatherSignalsResults] = await Promise.allSettled([
        fetchWuSummary(airport),
        fetchHistoryBasedLaterHighCurve(airport),
        (0, db_1.getLatestResolvedPolymarketDate)(airport.slug),
        fetchAviationWeatherData(airport),
        fetchOpenMeteoTodayHigh(airport, OPEN_METEO_MODELS.ecmwf),
        fetchOpenMeteoTodayHigh(airport, OPEN_METEO_MODELS.gfs),
        highPrecisionTodayHighModel
            ? fetchOpenMeteoTodayHigh(airport, createTodayHighModelFromSignalModel(highPrecisionTodayHighModel))
            : Promise.resolve(null),
        ...signalModels.map((model) => fetchOpenMeteoSignals(airport, model)),
    ]);
    const wuCurrentReading = withStaleFallback(wuSummaryResult.status === "fulfilled"
        ? wuSummaryResult.value.current
        : null, previousCard?.wuCurrent, wuSummaryResult.status === "rejected"
        ? formatSourceError("wu", "Wunderground", wuSummaryResult.reason)
        : createEmptyReading("wu", "Wunderground"));
    const wuTodayHighReading = withStaleFallback(wuSummaryResult.status === "fulfilled"
        ? wuSummaryResult.value.todayHigh
        : null, previousCard?.wuTodayHigh, wuSummaryResult.status === "rejected"
        ? formatSourceError("wu-today-high", "WU high", wuSummaryResult.reason)
        : createEmptyReading("wu-today-high", "WU high"));
    const historyBasedLaterHighCurve = withHistoryBasedLaterHighCurveFallback(historyBasedLaterHighResult.status === "fulfilled"
        ? historyBasedLaterHighResult.value
        : null, previousCard?.historyBasedLaterHigh, historyBasedLaterHighResult.status === "rejected"
        ? formatHistoryBasedLaterHighCurveError(historyBasedLaterHighResult.reason)
        : createEmptyHistoryBasedLaterHighCurve());
    const latestResolvedComparisonDate = latestResolvedComparisonDateResult.status === "fulfilled"
        ? latestResolvedComparisonDateResult.value
        : previousCard?.latestResolvedComparisonDate ?? null;
    const aviationReading = withStaleFallback(aviationResult.status === "fulfilled"
        ? aviationResult.value.current
        : null, previousCard?.aviationWeatherCurrent, aviationResult.status === "rejected"
        ? formatSourceError("aviationweather", "AW", aviationResult.reason)
        : createEmptyReading("aviationweather", "AW"));
    const aviationTrend = withTemperatureTrendFallback(aviationResult.status === "fulfilled"
        ? aviationResult.value.trend
        : null, previousCard?.aviationWeatherTrend, aviationResult.status === "rejected"
        ? formatTemperatureTrendError("aviationweather-trend", "AW observed", aviationResult.reason)
        : createEmptyTemperatureTrend("aviationweather-trend", "AW observed"));
    const ecmwfReading = withStaleFallback(ecmwfResult.status === "fulfilled"
        ? ecmwfResult.value
        : null, previousCard?.openMeteoTodayHigh.ecmwf, ecmwfResult.status === "rejected"
        ? formatSourceError(OPEN_METEO_MODELS.ecmwf.sourceId, OPEN_METEO_MODELS.ecmwf.label, ecmwfResult.reason)
        : createEmptyReading(OPEN_METEO_MODELS.ecmwf.sourceId, OPEN_METEO_MODELS.ecmwf.label));
    const gfsReading = withStaleFallback(gfsResult.status === "fulfilled"
        ? gfsResult.value
        : null, previousCard?.openMeteoTodayHigh.gfs, gfsResult.status === "rejected"
        ? formatSourceError(OPEN_METEO_MODELS.gfs.sourceId, OPEN_METEO_MODELS.gfs.label, gfsResult.reason)
        : createEmptyReading(OPEN_METEO_MODELS.gfs.sourceId, OPEN_METEO_MODELS.gfs.label));
    const highPrecisionTodayHighReading = !highPrecisionTodayHighModel
        ? null
        : withStaleFallback(highPrecisionTodayHighResult.status === "fulfilled"
            ? highPrecisionTodayHighResult.value
            : null, previousCard?.openMeteoTodayHigh.highPrecision ?? undefined, highPrecisionTodayHighResult.status === "rejected"
            ? formatSourceError(highPrecisionTodayHighModel.forecastModel, highPrecisionTodayHighModel.label, highPrecisionTodayHighResult.reason)
            : createEmptyReading(highPrecisionTodayHighModel.forecastModel, highPrecisionTodayHighModel.label));
    const weatherSignalsBySource = signalModels.reduce((accumulator, model, index) => {
        const result = weatherSignalsResults[index];
        const signals = withWeatherSignalsFallback(result?.status === "fulfilled" ? result.value : null, getPreviousWeatherSignalsBySource(previousCard, model.forecastModel), result?.status === "rejected"
            ? formatWeatherSignalsError(model, result.reason)
            : createEmptyWeatherSignals(model));
        accumulator[signals.sourceId] = signals;
        return accumulator;
    }, {});
    return {
        airport,
        cardUpdatedAt: new Date().toISOString(),
        latestResolvedComparisonDate,
        wuCurrent: wuCurrentReading,
        wuTodayHigh: wuTodayHighReading,
        historyBasedLaterHigh: historyBasedLaterHighCurve,
        aviationWeatherCurrent: aviationReading,
        aviationWeatherTrend: aviationTrend,
        defaultWeatherSignalsSourceId: signal_model_config_1.DEFAULT_SIGNAL_MODEL.forecastModel,
        weatherSignalsBySource,
        openMeteoTodayHigh: {
            ecmwf: ecmwfReading,
            gfs: gfsReading,
            highPrecision: highPrecisionTodayHighReading,
        },
    };
}
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}
function summarizeIssues(cards) {
    let staleCount = 0;
    let errorCount = 0;
    for (const card of cards) {
        const readings = [
            card.wuCurrent,
            card.wuTodayHigh,
            card.historyBasedLaterHigh,
            card.aviationWeatherCurrent,
            card.aviationWeatherTrend,
            ...Object.values(card.weatherSignalsBySource ?? {}),
            card.openMeteoTodayHigh.ecmwf,
            card.openMeteoTodayHigh.gfs,
            card.openMeteoTodayHigh.highPrecision,
        ];
        for (const reading of readings) {
            if (!reading) {
                continue;
            }
            if (reading.status === "stale") {
                staleCount += 1;
            }
            if (reading.status === "error" || reading.status === "missing") {
                errorCount += 1;
            }
        }
    }
    if (staleCount === 0 && errorCount === 0) {
        return null;
    }
    return `Refresh completed with ${staleCount} stale sources and ${errorCount} unavailable sources.`;
}
function upsertCard(cards, card) {
    const nextCards = (cards ?? []).filter((existingCard) => existingCard.airport.slug !== card.airport.slug);
    nextCards.push(card);
    return nextCards.sort((left, right) => airports_1.AIRPORTS.findIndex((airport) => airport.slug === left.airport.slug) -
        airports_1.AIRPORTS.findIndex((airport) => airport.slug === right.airport.slug));
}
function getAirportBySlug(slug) {
    return airports_1.AIRPORTS.find((airport) => airport.slug === slug);
}
function finalizeSnapshot(cards, refreshedAt) {
    return {
        refreshedAt,
        cards,
        globalError: summarizeIssues(cards),
    };
}
function startWeatherSnapshotRefresh() {
    const store = (0, store_1.getWeatherStore)();
    if (store.refreshPromise) {
        return store.refreshPromise;
    }
    store.refreshState = "refreshing";
    store.lastError = null;
    const promise = Promise.all(store.cardRefreshPromises.values())
        .then(async () => {
        const previousSnapshot = store.snapshot;
        store.snapshot = previousSnapshot
            ? {
                ...previousSnapshot,
                globalError: null,
            }
            : {
                refreshedAt: null,
                cards: null,
                globalError: null,
            };
        const previousCards = new Map((previousSnapshot?.cards ?? []).map((card) => [card.airport.slug, card]));
        const cards = await mapWithConcurrency(airports_1.AIRPORTS, CITY_CONCURRENCY, async (airport) => {
            const card = await refreshCard(airport, previousCards.get(airport.slug));
            const currentSnapshot = store.snapshot;
            store.snapshot = {
                refreshedAt: currentSnapshot?.refreshedAt ?? null,
                cards: upsertCard(currentSnapshot?.cards ?? null, card),
                globalError: null,
            };
            return card;
        });
        return finalizeSnapshot(cards, new Date().toISOString());
    })
        .then((snapshot) => {
        store.snapshot = snapshot;
        store.refreshState = "idle";
        store.refreshPromise = null;
        store.lastError = snapshot.globalError;
        return snapshot;
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : "Unexpected refresh failure";
        store.refreshState = "error";
        store.refreshPromise = null;
        store.lastError = message;
        if (store.snapshot) {
            store.snapshot = {
                ...store.snapshot,
                globalError: message,
            };
            return store.snapshot;
        }
        return {
            refreshedAt: null,
            cards: null,
            globalError: message,
        };
    });
    store.refreshPromise = promise;
    return promise;
}
function startWeatherCardRefresh(slug) {
    const store = (0, store_1.getWeatherStore)();
    if (store.refreshPromise) {
        return store.refreshPromise;
    }
    const existingPromise = store.cardRefreshPromises.get(slug);
    if (existingPromise) {
        return existingPromise;
    }
    const airport = getAirportBySlug(slug);
    if (!airport) {
        throw new Error(`Unknown airport slug: ${slug}`);
    }
    store.lastError = null;
    if (store.snapshot) {
        store.snapshot = {
            ...store.snapshot,
            globalError: null,
        };
    }
    const previousSnapshot = store.snapshot;
    const previousCards = new Map((previousSnapshot?.cards ?? []).map((card) => [card.airport.slug, card]));
    const promise = refreshCard(airport, previousCards.get(airport.slug))
        .then((card) => {
        const currentSnapshot = store.snapshot ?? previousSnapshot;
        const cards = upsertCard(currentSnapshot?.cards ?? null, card);
        const snapshot = finalizeSnapshot(cards, currentSnapshot?.refreshedAt ?? null);
        store.snapshot = snapshot;
        store.lastError = snapshot.globalError;
        return snapshot;
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : "Unexpected refresh failure";
        store.lastError = message;
        if (store.snapshot) {
            store.snapshot = {
                ...store.snapshot,
                globalError: message,
            };
            return store.snapshot;
        }
        return {
            refreshedAt: null,
            cards: null,
            globalError: message,
        };
    });
    void promise.finally(() => {
        if (store.cardRefreshPromises.get(slug) === promise) {
            store.cardRefreshPromises.delete(slug);
        }
    });
    store.cardRefreshPromises.set(slug, promise);
    return promise;
}
async function refreshWeatherSnapshot() {
    return startWeatherSnapshotRefresh();
}
async function refreshAndRespond() {
    startWeatherSnapshotRefresh();
    return (0, store_1.buildWeatherResponse)();
}
async function refreshCardAndRespond(slug) {
    await startWeatherCardRefresh(slug);
    return (0, store_1.buildWeatherResponse)();
}
//# sourceMappingURL=refresh-weather.js.map