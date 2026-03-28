"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SIGNAL_MODEL = exports.SIGNAL_MODELS = void 0;
exports.getSignalModelsForAirport = getSignalModelsForAirport;
exports.hasConfiguredHighPrecisionSignals = hasConfiguredHighPrecisionSignals;
exports.getTodayHighHighPrecisionSignalModelForAirport = getTodayHighHighPrecisionSignalModelForAirport;
exports.SIGNAL_MODELS = {
    gfs: {
        forecastModel: "ncep_gfs013",
        label: "Open-Meteo GFS Global",
        shortLabel: "GFS",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/ncep_gfs013/static/meta.json",
    },
    ecmwf: {
        forecastModel: "ecmwf_ifs",
        label: "Open-Meteo ECMWF IFS",
        shortLabel: "ECMWF",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs/static/meta.json",
    },
    nbmConus: {
        forecastModel: "ncep_nbm_conus",
        label: "Open-Meteo NBM CONUS",
        shortLabel: "NBM",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/ncep_nbm_conus/static/meta.json",
    },
    iconEu: {
        forecastModel: "dwd_icon_eu",
        label: "Open-Meteo DWD ICON EU",
        shortLabel: "ICON EU",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/dwd_icon_eu/static/meta.json",
    },
    iconD2: {
        forecastModel: "dwd_icon_d2",
        label: "Open-Meteo DWD ICON D2",
        shortLabel: "ICON D2",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/dwd_icon_d2/static/meta.json",
    },
    arpegeEurope: {
        forecastModel: "meteofrance_arpege_europe",
        label: "Open-Meteo Météo-France ARPEGE Europe",
        shortLabel: "ARPEGE",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/meteofrance_arpege_europe/static/meta.json",
    },
    gemHrdps: {
        forecastModel: "gem_hrdps_continental",
        label: "Open-Meteo GEM HRDPS",
        shortLabel: "HRDPS",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/cmc_gem_hrdps/static/meta.json",
    },
    kmaLdps: {
        forecastModel: "kma_ldps",
        label: "Open-Meteo KMA LDPS",
        shortLabel: "KMA LDPS",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/kma_ldps/static/meta.json",
    },
    jmaMsm: {
        forecastModel: "jma_msm",
        label: "Open-Meteo JMA MSM",
        shortLabel: "JMA MSM",
        metaUrl: "https://openmeteo.s3.amazonaws.com/data/jma_msm/static/meta.json",
    },
};
exports.DEFAULT_SIGNAL_MODEL = exports.SIGNAL_MODELS.gfs;
const COUNTRY_SIGNAL_MODEL_KEYS = {
    US: ["nbmConus"],
    GB: ["iconEu"],
    ES: ["iconEu"],
    IT: ["iconEu"],
    DE: ["iconEu"],
    FR: ["iconEu"],
    PL: ["iconEu"],
};
const COUNTRY_TODAY_HIGH_HIGH_PRECISION_MODEL_KEYS = {
    US: "nbmConus",
};
// Verified against the current airport coordinates on 2026-03-23.
const AIRPORT_SIGNAL_MODEL_KEYS = {
    ankara: ["arpegeEurope"],
    london: ["iconD2"],
    madrid: ["arpegeEurope"],
    milan: ["iconD2"],
    munich: ["iconD2"],
    paris: ["iconD2"],
    toronto: ["gemHrdps"],
    "tel-aviv": ["iconEu"],
    tokyo: ["jmaMsm"],
    warsaw: ["arpegeEurope"],
};
const AIRPORT_TODAY_HIGH_HIGH_PRECISION_MODEL_KEYS = {
    ankara: "arpegeEurope",
    london: "iconD2",
    madrid: "arpegeEurope",
    milan: "iconD2",
    munich: "iconD2",
    paris: "iconD2",
    toronto: "gemHrdps",
    "tel-aviv": "iconEu",
    tokyo: "jmaMsm",
    warsaw: "arpegeEurope",
};
function getSignalModelsForAirport(airport) {
    const models = [exports.SIGNAL_MODELS.gfs, exports.SIGNAL_MODELS.ecmwf];
    const seenForecastModels = new Set(models.map((model) => model.forecastModel));
    const configuredKeys = [
        ...(COUNTRY_SIGNAL_MODEL_KEYS[airport.countryCode] ?? []),
        ...(AIRPORT_SIGNAL_MODEL_KEYS[airport.slug] ?? []),
    ];
    for (const key of configuredKeys) {
        const model = exports.SIGNAL_MODELS[key];
        if (seenForecastModels.has(model.forecastModel)) {
            continue;
        }
        models.push(model);
        seenForecastModels.add(model.forecastModel);
    }
    return models;
}
function hasConfiguredHighPrecisionSignals(airport) {
    return ((COUNTRY_SIGNAL_MODEL_KEYS[airport.countryCode]?.length ?? 0) > 0 ||
        (AIRPORT_SIGNAL_MODEL_KEYS[airport.slug]?.length ?? 0) > 0);
}
function getTodayHighHighPrecisionSignalModelForAirport(airport) {
    const airportKey = AIRPORT_TODAY_HIGH_HIGH_PRECISION_MODEL_KEYS[airport.slug];
    if (airportKey) {
        return exports.SIGNAL_MODELS[airportKey];
    }
    const countryKey = COUNTRY_TODAY_HIGH_HIGH_PRECISION_MODEL_KEYS[airport.countryCode];
    return countryKey ? exports.SIGNAL_MODELS[countryKey] : null;
}
//# sourceMappingURL=signal-model-config.js.map