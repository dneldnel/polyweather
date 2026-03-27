"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAirportDisplayTemperatureUnit = getAirportDisplayTemperatureUnit;
exports.convertTemperature = convertTemperature;
function getAirportDisplayTemperatureUnit(airport) {
    return airport.countryCode === "US" ? "F" : "C";
}
function convertTemperature(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) {
        return value;
    }
    if (fromUnit === "C") {
        return (value * 9) / 5 + 32;
    }
    return ((value - 32) * 5) / 9;
}
//# sourceMappingURL=temperature.js.map