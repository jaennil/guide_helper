import { useState, useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext";
import {
  totalDistance,
  downsampleRoutePoints,
  fetchElevations,
  elevationGain,
  estimateRouteTime,
  assessDifficulty,
  formatDistance,
  formatDuration,
  type GeoPoint,
  type DifficultyLevel,
  type DifficultyThresholds,
} from "../utils/geo";
import { ElevationChart } from "./ElevationChart";
import { settingsApi, DEFAULT_DIFFICULTY_THRESHOLDS } from "../api/settings";
import { fetchDetailedPath, type PathPoint, type PathSegment } from "../utils/routePath";
import type { RoutingEngineId } from "../utils/routingEngines";

interface RouteStatsPanelProps {
  points: GeoPoint[];
  segments?: PathSegment[];
  categoryNames?: string[];
  engineId?: RoutingEngineId;
}

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  easy: "#4caf50",
  moderate: "#ff9800",
  hard: "#f44336",
};

let cachedThresholds: DifficultyThresholds | null = null;

function buildFallbackSegments(points: GeoPoint[]): PathSegment[] {
  const segments: PathSegment[] = [];

  for (let index = 1; index < points.length; index++) {
    segments.push({
      fromIndex: index - 1,
      toIndex: index,
      mode: "manual",
    });
  }

  return segments;
}

export function RouteStatsPanel({
  points,
  segments,
  categoryNames = [],
  engineId,
}: RouteStatsPanelProps) {
  const { t } = useLanguage();
  const [analysisPoints, setAnalysisPoints] = useState<GeoPoint[]>(() => downsampleRoutePoints(points));
  const [elevations, setElevations] = useState<number[] | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [thresholds, setThresholds] = useState<DifficultyThresholds>(
    cachedThresholds ?? DEFAULT_DIFFICULTY_THRESHOLDS
  );
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elevationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSegments = segments?.length ? segments : buildFallbackSegments(points);

  useEffect(() => {
    if (cachedThresholds) return;
    settingsApi.getDifficultyThresholds()
      .then((data) => {
        cachedThresholds = data;
        setThresholds(data);
        console.log("[stats] difficulty thresholds loaded from server");
      })
      .catch((err) => {
        console.warn("[stats] failed to load difficulty thresholds, using defaults:", err);
      });
  }, []);

  useEffect(() => {
    const fallbackPoints = downsampleRoutePoints(points);
    const nextSegments = segments?.length ? segments : buildFallbackSegments(points);
    setAnalysisPoints(fallbackPoints);
    setElevations(null);

    if (points.length < 2) return;

    if (pathDebounceRef.current) {
      clearTimeout(pathDebounceRef.current);
    }

    const hasAutoSegments = nextSegments.some((segment) => segment.mode === "auto");
    if (!hasAutoSegments) {
      setPathLoading(false);
      return;
    }

    let cancelled = false;
    pathDebounceRef.current = setTimeout(async () => {
      setPathLoading(true);
      try {
        const pathPoints: PathPoint[] = points.map((point) => ({
          position: [point.lat, point.lng],
        }));
        const result = await fetchDetailedPath(pathPoints, nextSegments, engineId);
        if (cancelled) return;

        const detailedPoints = downsampleRoutePoints(
          result.fullPath.map(([lat, lng]) => ({ lat, lng })),
        );
        setAnalysisPoints(detailedPoints);
        console.log(`[stats] detailed path loaded: ${detailedPoints.length} points`);
      } catch (err) {
        console.error("[stats] failed to build detailed path:", err);
        if (!cancelled) {
          setAnalysisPoints(fallbackPoints);
        }
      } finally {
        if (!cancelled) {
          setPathLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      if (pathDebounceRef.current) {
        clearTimeout(pathDebounceRef.current);
      }
    };
  }, [points, segments, engineId]);

  const distance = totalDistance(analysisPoints);

  useEffect(() => {
    setElevations(null);

    if (analysisPoints.length < 2) return;

    if (elevationDebounceRef.current) {
      clearTimeout(elevationDebounceRef.current);
    }

    let cancelled = false;
    elevationDebounceRef.current = setTimeout(async () => {
      setElevationLoading(true);
      try {
        const elev = await fetchElevations(analysisPoints);
        if (cancelled) return;
        setElevations(elev);
        console.log(`[stats] elevation gain: ${elevationGain(elev).toFixed(0)}m`);
      } catch (err) {
        console.error("[stats] failed to fetch elevations:", err);
        if (!cancelled) {
          setElevations(null);
        }
      } finally {
        if (!cancelled) {
          setElevationLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      if (elevationDebounceRef.current) {
        clearTimeout(elevationDebounceRef.current);
      }
    };
  }, [analysisPoints]);

  if (points.length < 2) return null;

  const gain = elevations !== null ? elevationGain(elevations) : null;
  const difficulty =
    elevations !== null
      ? assessDifficulty(
          analysisPoints,
          elevations,
          thresholds,
          activeSegments.map((segment) => segment.mode),
          categoryNames,
        )
      : null;
  const estimatedTime =
    difficulty && gain !== null
      ? estimateRouteTime(distance, gain, difficulty.activity, difficulty.surface)
      : null;

  return (
    <div className="route-stats-panel">
      {difficulty && (
        <div className="route-stat-item">
          <span className="route-stat-label">{t("stats.difficulty")}</span>
          <span
            className="route-difficulty-badge"
            style={{ backgroundColor: DIFFICULTY_COLORS[difficulty.level] }}
          >
            {t(`stats.difficulty.${difficulty.level}`)}
          </span>
        </div>
      )}
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.distance")}</span>
        <span className="route-stat-value">
          {pathLoading ? t("stats.loading") : formatDistance(distance)}
        </span>
      </div>
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.elevation")}</span>
        <span className="route-stat-value">
          {pathLoading || elevationLoading
            ? t("stats.loading")
            : gain !== null
              ? `${Math.round(gain)} m`
              : "—"}
        </span>
      </div>
      <div className="route-stat-item">
        <span className="route-stat-label">{t("stats.walkingTime")}</span>
        <span className="route-stat-value">
          {pathLoading || elevationLoading
            ? t("stats.loading")
            : estimatedTime !== null
              ? formatDuration(estimatedTime)
              : "—"}
        </span>
      </div>
      {elevations !== null && elevations.length >= 2 && (
        <ElevationChart points={analysisPoints} elevations={elevations} />
      )}
    </div>
  );
}
