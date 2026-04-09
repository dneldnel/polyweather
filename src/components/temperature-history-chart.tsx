import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { convertTemperature } from "../../lib/temperature";
import type { TemperatureUnit } from "../../lib/types";

export type TemperatureHistoryPoint = {
  observedAt: string;
  temperatureC: number;
};

export type TemperatureHistoryChartSource = {
  points: TemperatureHistoryPoint[];
  pointCount: number;
  peakLocal: string | null;
  maxTempC: number | null;
  maxTempF?: number | null;
  maxTempFRounded?: number | null;
};

type TemperatureHistoryChartProps = {
  label: string;
  timezone: string;
  displayUnit: TemperatureUnit;
  source: TemperatureHistoryChartSource;
  emptyMessage: string;
  metaSuffix?: string | null;
  ariaLabel: string;
  sectionClassName?: string;
};

const HISTORICAL_CHART_VIEWBOX_WIDTH = 320;
const HISTORICAL_CHART_VIEWBOX_HEIGHT = 144;
const HISTORICAL_CHART_DAY_MINUTES = 1440;
const HISTORICAL_CHART_TOP = 10;
const HISTORICAL_CHART_BOTTOM = HISTORICAL_CHART_VIEWBOX_HEIGHT - 20;

type HistoricalChartPoint = {
  observedAt: string;
  minutes: number;
  temperature: number;
};

type HistoricalChartCoordinate = {
  x: number;
  y: number;
};

type HistoricalChartHoverState = {
  x: number;
  y: number;
  minutes: number;
  temperature: number;
  snappedIndex: number | null;
  pointerX: number;
};

function formatNumber(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRawTemperature(value: number | null, unit: TemperatureUnit) {
  if (typeof value !== "number") {
    return "—";
  }

  return `${formatNumber(value)}°${unit}`;
}

function getLocalClockMinutes(value: string, timezone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!hour || !minute) {
    return 0;
  }

  return Number(hour) * 60 + Number(minute);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatClockMinutes(value: number) {
  const roundedMinutes = Math.round(clampNumber(value, 0, HISTORICAL_CHART_DAY_MINUTES));
  const hour = Math.floor(roundedMinutes / 60);
  const minute = roundedMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getHistoricalChartHoverState({
  pointerX,
  chartLeft,
  chartRight,
  chartPoints,
  coordinates,
  previousHoverState,
}: {
  pointerX: number;
  chartLeft: number;
  chartRight: number;
  chartPoints: HistoricalChartPoint[];
  coordinates: HistoricalChartCoordinate[];
  previousHoverState: HistoricalChartHoverState | null;
}): HistoricalChartHoverState | null {
  if (chartPoints.length === 0 || coordinates.length === 0) {
    return null;
  }

  const clampedX = clampNumber(pointerX, chartLeft, chartRight);
  const getNearestPointIndex = () => {
    let nearestPointIndex = 0;
    let nearestPointDistance = Number.POSITIVE_INFINITY;

    coordinates.forEach((coordinate, index) => {
      const distance = Math.abs(coordinate.x - clampedX);

      if (distance < nearestPointDistance) {
        nearestPointDistance = distance;
        nearestPointIndex = index;
      }
    });

    return nearestPointIndex;
  };

  let snappedIndex = getNearestPointIndex();
  const previousIndex = previousHoverState?.snappedIndex;
  const previousPointerX = previousHoverState?.pointerX ?? clampedX;
  const directionDelta = clampedX - previousPointerX;
  const directionalSwitchRatio = 0.4;

  if (
    previousIndex !== null &&
    previousIndex !== undefined &&
    previousIndex >= 0 &&
    previousIndex < coordinates.length
  ) {
    snappedIndex = previousIndex;

    if (directionDelta > 0.25) {
      while (snappedIndex < coordinates.length - 1) {
        const currentX = coordinates[snappedIndex]!.x;
        const nextX = coordinates[snappedIndex + 1]!.x;
        const thresholdX = currentX + (nextX - currentX) * directionalSwitchRatio;

        if (clampedX < thresholdX) {
          break;
        }

        snappedIndex += 1;
      }
    } else if (directionDelta < -0.25) {
      while (snappedIndex > 0) {
        const previousX = coordinates[snappedIndex - 1]!.x;
        const currentX = coordinates[snappedIndex]!.x;
        const thresholdX = currentX - (currentX - previousX) * directionalSwitchRatio;

        if (clampedX > thresholdX) {
          break;
        }

        snappedIndex -= 1;
      }
    }
  }

  const point = chartPoints[snappedIndex]!;
  const coordinate = coordinates[snappedIndex]!;

  return {
    x: coordinate.x,
    y: coordinate.y,
    minutes: point.minutes,
    temperature: point.temperature,
    snappedIndex,
    pointerX: clampedX,
  };
}

export function TemperatureHistoryChart({
  label,
  timezone,
  displayUnit,
  source,
  emptyMessage,
  metaSuffix,
  ariaLabel,
  sectionClassName = "comparison-detail-chart",
}: TemperatureHistoryChartProps) {
  const [hoverState, setHoverState] = useState<HistoricalChartHoverState | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartViewportWidth, setChartViewportWidth] = useState(HISTORICAL_CHART_VIEWBOX_WIDTH);

  useEffect(() => {
    const node = chartContainerRef.current;

    if (!node) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(node.getBoundingClientRect().width);

      if (nextWidth > 24) {
        setChartViewportWidth(nextWidth);
      }
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);

      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  const chartPoints = [...source.points]
    .map((point) => ({
      observedAt: point.observedAt,
      minutes: getLocalClockMinutes(point.observedAt, timezone),
      temperature:
        displayUnit === "C"
          ? point.temperatureC
          : convertTemperature(point.temperatureC, "C", "F"),
    }))
    .sort((left, right) => left.minutes - right.minutes || left.observedAt.localeCompare(right.observedAt));
  const temperatures = chartPoints.map((point) => point.temperature);
  const minTemperature = temperatures.length > 0 ? Math.min(...temperatures) : null;
  const maxTemperature = temperatures.length > 0 ? Math.max(...temperatures) : null;
  const temperatureRange =
    minTemperature !== null && maxTemperature !== null ? maxTemperature - minTemperature : 0;
  const chartLeft = 8;
  const chartRight = Math.max(chartViewportWidth - 8, chartLeft + 1);
  const chartTop = HISTORICAL_CHART_TOP;
  const chartBottom = HISTORICAL_CHART_BOTTOM;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const yPadding =
    minTemperature === null || maxTemperature === null
      ? 1
      : temperatureRange < 0.8
        ? 0.35
        : temperatureRange * 0.08;
  const yMin = minTemperature === null ? 0 : minTemperature - yPadding;
  const yMax = maxTemperature === null ? 1 : maxTemperature + yPadding;
  const yMid = chartTop + chartHeight / 2;
  const axisTopLabel = formatRawTemperature(yMax, displayUnit);
  const axisMidLabel = formatRawTemperature((yMin + yMax) / 2, displayUnit);
  const axisBottomLabel = formatRawTemperature(yMin, displayUnit);
  const coordinates = chartPoints.map((point) => {
    const x = chartLeft + (point.minutes / HISTORICAL_CHART_DAY_MINUTES) * chartWidth;
    const y =
      chartTop + (1 - (point.temperature - yMin) / Math.max(yMax - yMin, 0.001)) * chartHeight;

    return { x, y };
  });
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coordinates.length > 0
      ? `${linePath} L ${coordinates.at(-1)?.x.toFixed(1)} ${chartBottom} L ${coordinates[0]?.x.toFixed(1)} ${chartBottom} Z`
      : "";
  const peakTemperature =
    displayUnit === "C"
      ? source.maxTempC
      : source.maxTempF ?? source.maxTempFRounded ?? (
          typeof source.maxTempC === "number"
            ? convertTemperature(source.maxTempC, "C", "F")
            : null
        );
  const metaLabel = metaSuffix
    ? `${source.pointCount} points · Peak ${source.peakLocal ?? "—"} · ${metaSuffix}`
    : `${source.pointCount} points · Peak ${source.peakLocal ?? "—"}`;
  const xTicks = [0, 360, 720, 1080, 1440].map((minutes) => ({
    minutes,
    label: formatClockMinutes(minutes),
    x: chartLeft + (minutes / HISTORICAL_CHART_DAY_MINUTES) * chartWidth,
  }));
  const yTicks = [
    { label: axisTopLabel, y: chartTop },
    { label: axisMidLabel, y: yMid },
    { label: axisBottomLabel, y: chartBottom },
  ];
  const updateHoverStateFromPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const hitboxRect = event.currentTarget.getBoundingClientRect();

    if (hitboxRect.width <= 0) {
      return;
    }

    const pointerX =
      chartLeft +
      clampNumber((event.clientX - hitboxRect.left) / hitboxRect.width, 0, 1) * chartWidth;

    setHoverState((currentHoverState) =>
      getHistoricalChartHoverState({
        pointerX,
        chartLeft,
        chartRight,
        chartPoints,
        coordinates,
        previousHoverState: currentHoverState,
      }),
    );
  };

  return (
    <section className={sectionClassName}>
      <div className="comparison-detail-chart-header">
        <div>
          <p>{label}</p>
          <span>{metaLabel}</span>
        </div>
        <strong>{formatRawTemperature(peakTemperature, displayUnit)}</strong>
      </div>

      {coordinates.length > 0 ? (
        <>
          <div className="trend-chart-frame comparison-chart-frame">
            <div className="trend-y-axis" aria-hidden="true">
              <span>{axisTopLabel}</span>
              <span>{axisMidLabel}</span>
              <span>{axisBottomLabel}</span>
            </div>
            <div ref={chartContainerRef} className="trend-chart">
              <svg
                className="trend-chart-svg"
                viewBox={`0 0 ${chartViewportWidth} ${HISTORICAL_CHART_VIEWBOX_HEIGHT}`}
                role="img"
                aria-label={ariaLabel}
              >
                <line className="trend-grid-line" x1={chartLeft} x2={chartRight} y1={chartTop} y2={chartTop} />
                <line className="trend-grid-line" x1={chartLeft} x2={chartRight} y1={yMid} y2={yMid} />
                <line
                  className="trend-grid-line trend-grid-line-strong"
                  x1={chartLeft}
                  x2={chartRight}
                  y1={chartBottom}
                  y2={chartBottom}
                />
                {areaPath ? <path className="trend-area" d={areaPath} /> : null}
                <line className="trend-axis-line" x1={chartLeft} x2={chartLeft} y1={chartTop} y2={chartBottom} />
                <line className="trend-axis-line" x1={chartLeft} x2={chartRight} y1={chartBottom} y2={chartBottom} />
                {xTicks.map((tick) => (
                  <g key={`${label}-${tick.minutes}`} aria-hidden="true">
                    <line
                      className="trend-axis-tick"
                      x1={tick.x}
                      x2={tick.x}
                      y1={chartBottom}
                      y2={chartBottom + 4}
                    />
                    <text
                      className="trend-axis-label-svg"
                      x={tick.x}
                      y={chartBottom + 10}
                      textAnchor={
                        tick.minutes === 0 ? "start" : tick.minutes === HISTORICAL_CHART_DAY_MINUTES ? "end" : "middle"
                      }
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                {yTicks.map((tick) => (
                  <line
                    key={`${label}-${tick.label}-${tick.y}`}
                    className="trend-axis-tick"
                    x1={chartLeft - 4}
                    x2={chartLeft}
                    y1={tick.y}
                    y2={tick.y}
                    aria-hidden="true"
                  />
                ))}
                {linePath ? <path className="trend-line" d={linePath} /> : null}
                {coordinates.map((point, index) => (
                  <circle
                    key={`${chartPoints[index]?.observedAt ?? label}-${index}`}
                    className={`trend-point-marker${hoverState?.snappedIndex === index ? " trend-point-marker-active" : ""}`}
                    cx={point.x}
                    cy={point.y}
                    r={hoverState?.snappedIndex === index ? 4.2 : 3}
                  />
                ))}
                {hoverState ? (
                  <>
                    <line
                      className="trend-hover-line"
                      x1={hoverState.x}
                      x2={hoverState.x}
                      y1={chartTop}
                      y2={chartBottom}
                    />
                    <line
                      className="trend-hover-line"
                      x1={chartLeft}
                      x2={chartRight}
                      y1={hoverState.y}
                      y2={hoverState.y}
                    />
                    <circle
                      className="trend-hover-point"
                      cx={hoverState.x}
                      cy={hoverState.y}
                      r={hoverState.snappedIndex !== null ? 4.8 : 3.8}
                    />
                  </>
                ) : null}
                <rect
                  className="trend-hitbox"
                  x={chartLeft}
                  y={chartTop}
                  width={chartWidth}
                  height={chartHeight}
                  pointerEvents="all"
                  onPointerEnter={updateHoverStateFromPointer}
                  onPointerMove={updateHoverStateFromPointer}
                  onPointerLeave={() => {
                    setHoverState(null);
                  }}
                  onPointerCancel={() => {
                    setHoverState(null);
                  }}
                />
              </svg>
              {hoverState ? (
                <>
                  <div
                    className="trend-axis-pill trend-axis-pill-x"
                    style={{
                      left: `${(hoverState.x / chartViewportWidth) * 100}%`,
                    }}
                  >
                    {formatClockMinutes(hoverState.minutes)}
                  </div>
                  <div
                    className="trend-axis-pill trend-axis-pill-y"
                    style={{
                      left: `${(chartLeft / chartViewportWidth) * 100}%`,
                      top: `${(hoverState.y / HISTORICAL_CHART_VIEWBOX_HEIGHT) * 100}%`,
                    }}
                  >
                    {formatRawTemperature(hoverState.temperature, displayUnit)}
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <div className="trend-axis comparison-chart-axis">
            <span>00:00</span>
            <strong>{formatRawTemperature(peakTemperature, displayUnit)}</strong>
            <span>24:00</span>
          </div>
        </>
      ) : (
        <div className="trend-empty">{emptyMessage}</div>
      )}
    </section>
  );
}
