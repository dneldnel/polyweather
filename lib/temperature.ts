import type { AirportConfig, TemperatureUnit } from "./types";

export function getAirportDisplayTemperatureUnit(airport: AirportConfig): TemperatureUnit {
  return airport.countryCode === "US" ? "F" : "C";
}

export function convertTemperature(
  value: number,
  fromUnit: TemperatureUnit,
  toUnit: TemperatureUnit,
) {
  if (fromUnit === toUnit) {
    return value;
  }

  if (fromUnit === "C") {
    return (value * 9) / 5 + 32;
  }

  return ((value - 32) * 5) / 9;
}
