import { useState, useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext";
import {
  totalDistance,
  fetchElevations,
  elevationGain,
  estimateWalkingTime,
  classifyDifficulty,
  formatDistance,
  formatDuration,
  type GeoPoint,
  type DifficultyLevel,
} from "../utils/geo";
import { ElevationChart } from "./ElevationChart";

interface RouteStatsPanelProps {
  points: GeoPoint[];
}

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  easy: "#4caf50",
  moderate: "#ff9800",
  hard: "#f44336",
};

export function RouteStatsPanel({ points }: RouteStatsPanelProps) {
  const { t } = useLanguage();
  const [elevations, setElevations] = useState<number[] | null>(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const distance = totalDistance(points);

  useEffect(() => {
    setElevations(null);

    if (points.length < 2) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setElevationLoading(true);
      try {
        const elev = await fetchElevations(points);
        setElevations(elev);
        console.log(`[stats] elevation gain: ${elevationGain(elev).toFixed(0)}m`);
      } catch (err) {
        console.error("[stats] failed to fetch elevations:", err);
        setElevations(null);
      } finally {
        setElevationLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [points]);

  if (points.length < 2) return null;

  const gain = elevations !== null ? elevationGain(elevations) : null;
  const walkingTime =
    gain !== null ? estimateWalkingTime(distance, gain) : null;
  const difficulty =
    gain !== null ? classifyDifficulty(distance, gain) : null;

  return (
    <div className="route-stats-panel">
      {difficulty && (
        <div className="route-stat-item">
          <span className="route-stat-label">{t("stats.difficulty")}</span>
          <span
            className="route-difficulty-badge"
            style={{ backgroundColor: DIFFICULTY_COLORS[difficulty] }}
          >
            {t(`stats.difficulty.${difficulty}`)}
          </span>
        </div>
      )}
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.distance")}</span>
        <span className="route-stat-value">{formatDistance(distance)}</span>
      </div>
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.elevation")}</span>
        <span className="route-stat-value">
          {elevationLoading
            ? t("stats.loading")
            : gain !== null
              ? `${Math.round(gain)} m`
              : "—"}
        </span>
      </div>
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.walkingTime")}</span>
        <span className="route-stat-value">
          {elevationLoading
            ? t("stats.loading")
            : walkingTime !== null
              ? formatDuration(walkingTime)
              : "—"}
        </span>
      </div>
      {elevations !== null && elevations.length >= 2 && (
        <ElevationChart points={points} elevations={elevations} />
      )}
    </div>
  );
}
