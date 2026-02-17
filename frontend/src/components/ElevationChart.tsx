import { useMemo, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { cumulativeDistances, formatDistance, type GeoPoint } from "../utils/geo";

interface ElevationChartProps {
  points: GeoPoint[];
  elevations: number[];
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 100;
const PADDING = { top: 10, right: 10, bottom: 20, left: 40 };

const innerW = CHART_WIDTH - PADDING.left - PADDING.right;
const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

export function ElevationChart({ points, elevations }: ElevationChartProps) {
  const { t } = useLanguage();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const distances = useMemo(() => cumulativeDistances(points), [points]);

  const maxDist = distances[distances.length - 1] || 1;
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const elevRange = maxElev - minElev || 1;

  const toX = (dist: number) => PADDING.left + (dist / maxDist) * innerW;
  const toY = (elev: number) =>
    PADDING.top + innerH - ((elev - minElev) / elevRange) * innerH;

  // Build SVG path for the area fill and the line
  const linePath = useMemo(() => {
    return distances
      .map((d, i) => `${i === 0 ? "M" : "L"}${toX(d).toFixed(1)},${toY(elevations[i]).toFixed(1)}`)
      .join(" ");
  }, [distances, elevations]);

  const areaPath = useMemo(() => {
    if (distances.length === 0) return "";
    const bottomY = PADDING.top + innerH;
    const start = `M${toX(distances[0]).toFixed(1)},${bottomY}`;
    const line = distances
      .map((d, i) => `L${toX(d).toFixed(1)},${toY(elevations[i]).toFixed(1)}`)
      .join(" ");
    const end = `L${toX(distances[distances.length - 1]).toFixed(1)},${bottomY} Z`;
    return `${start} ${line} ${end}`;
  }, [distances, elevations]);

  // Y-axis ticks (3-4 values)
  const yTicks = useMemo(() => {
    const step = Math.ceil(elevRange / 3 / 10) * 10 || 10;
    const ticks: number[] = [];
    const start = Math.floor(minElev / step) * step;
    for (let v = start; v <= maxElev + step; v += step) {
      if (v >= minElev && v <= maxElev + step * 0.5) ticks.push(v);
    }
    return ticks.length > 0 ? ticks : [Math.round(minElev), Math.round(maxElev)];
  }, [minElev, maxElev, elevRange]);

  // X-axis ticks
  const xTicks = useMemo(() => {
    const count = maxDist < 1 ? 2 : maxDist < 5 ? 3 : 4;
    const step = maxDist / count;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) ticks.push(i * step);
    return ticks;
  }, [maxDist]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const distAtX = ((x - PADDING.left) / innerW) * maxDist;
    // Find closest point
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < distances.length; i++) {
      const diff = Math.abs(distances[i] - distAtX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }
    setHoverIndex(closest);
  };

  return (
    <div className="elevation-chart">
      <div className="elevation-chart-title">{t("stats.elevationProfile")}</div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="elevation-chart-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Grid lines */}
        {yTicks.map((v) => (
          <line
            key={`grid-${v}`}
            x1={PADDING.left}
            y1={toY(v)}
            x2={CHART_WIDTH - PADDING.right}
            y2={toY(v)}
            stroke="var(--border-separator)"
            strokeWidth={0.5}
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="rgba(76, 175, 80, 0.2)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#4caf50" strokeWidth={1.5} />

        {/* Y-axis labels */}
        {yTicks.map((v) => (
          <text
            key={`y-${v}`}
            x={PADDING.left - 3}
            y={toY(v) + 1}
            textAnchor="end"
            className="elevation-chart-label"
          >
            {Math.round(v)}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((d) => (
          <text
            key={`x-${d}`}
            x={toX(d)}
            y={CHART_HEIGHT - 2}
            textAnchor="middle"
            className="elevation-chart-label"
          >
            {formatDistance(d)}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverIndex !== null && (
          <>
            <line
              x1={toX(distances[hoverIndex])}
              y1={PADDING.top}
              x2={toX(distances[hoverIndex])}
              y2={PADDING.top + innerH}
              stroke="var(--text-light)"
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            <circle
              cx={toX(distances[hoverIndex])}
              cy={toY(elevations[hoverIndex])}
              r={3}
              fill="#4caf50"
              stroke="var(--bg-primary)"
              strokeWidth={1}
            />
            <text
              x={toX(distances[hoverIndex])}
              y={PADDING.top - 2}
              textAnchor="middle"
              className="elevation-chart-tooltip"
            >
              {Math.round(elevations[hoverIndex])} m
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
