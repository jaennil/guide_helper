import React, { useEffect, useRef } from "react";
import L from "leaflet";
import { Marker, Polyline, Tooltip, useMapEvents } from "react-leaflet";
import { useLanguage } from "../context/LanguageContext";
import type { RouteSegment } from "../types/routeMap";
import { DEFAULT_ROUTE_LINE_COLOR } from "../utils/routeColors";
import { DEFAULT_ENGINE, fetchRoute, type RoutingEngineId } from "../utils/routingEngines";
import {
  estimateRouteTime,
  formatDistance,
  formatDuration,
  inferRouteActivity,
  inferRouteSurface,
  totalDistance,
} from "../utils/geo";

function buildSegmentTooltipText(
  segment: RouteSegment,
  coords: [number, number][],
  categoryNames: string[] = [],
) {
  const distanceKm = totalDistance(
    coords.map(([lat, lng]) => ({ lat, lng })),
  );
  const segmentModes = [segment.mode];
  const activity = inferRouteActivity(categoryNames, segmentModes);
  const surface = inferRouteSurface(segmentModes);
  const estimatedMinutes = estimateRouteTime(distanceKm, 0, activity, surface);
  const displayMinutes = segment.durationMinutes ?? estimatedMinutes;

  return `${segment.fromIndex + 1} → ${segment.toIndex + 1} • ${formatDistance(distanceKm)} • ${formatDuration(displayMinutes)}`;
}

function getSegmentMidpoint(fromPoint: L.LatLng, toPoint: L.LatLng): [number, number] {
  return [
    (fromPoint.lat + toPoint.lat) / 2,
    (fromPoint.lng + toPoint.lng) / 2,
  ];
}

const SEGMENT_DURATION_ANCHOR_ICON = L.divIcon({
  className: "segment-duration-anchor",
  html: "",
  iconSize: [1, 1],
  iconAnchor: [0, 0],
});

function buildAutoSegmentKey(
  segment: RouteSegment,
  waypoints: L.LatLng[],
  engineId: RoutingEngineId,
) {
  const fromPoint = waypoints[segment.fromIndex];
  const toPoint = waypoints[segment.toIndex];
  if (!fromPoint || !toPoint) {
    return null;
  }

  return [
    segment.fromIndex,
    segment.toIndex,
    engineId,
    fromPoint.lat.toFixed(6),
    fromPoint.lng.toFixed(6),
    toPoint.lat.toFixed(6),
    toPoint.lng.toFixed(6),
  ].join(":");
}

function updatePolylinePresentation(
  polyline: L.Polyline,
  segment: RouteSegment,
  coords: [number, number][],
  color: string,
  categoryNames: string[],
) {
  polyline.setStyle({ color, opacity: 0.7, weight: 4 });
  const tooltipText = buildSegmentTooltipText(segment, coords, categoryNames);
  const tooltip = polyline.getTooltip();
  if (tooltip) {
    tooltip.setContent(tooltipText);
  } else {
    polyline.bindTooltip(tooltipText, {
      sticky: true,
      direction: "top",
      offset: [0, -4],
      className: "route-segment-tooltip",
    });
  }
}

function SegmentDurationBubble({
  segment,
  editable,
  onDurationChange,
}: {
  segment: RouteSegment;
  editable: boolean;
  onDurationChange?: (segment: RouteSegment, durationMinutes: number | undefined) => void;
}) {
  const { t } = useLanguage();

  const stopMapEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  if (!editable && !segment.durationMinutes) {
    return null;
  }

  return (
    <div
      className={`segment-duration-bubble${editable ? " editable" : ""}`}
      onClick={stopMapEvent}
      onDoubleClick={stopMapEvent}
      onMouseDown={stopMapEvent}
      onPointerDown={stopMapEvent}
      onWheel={stopMapEvent}
    >
      {editable ? (
        <>
          <input
            type="number"
            min={1}
            max={10080}
            step={1}
            value={segment.durationMinutes ?? ""}
            placeholder={t("map.segmentDurationPlaceholder")}
            className="segment-duration-input"
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                onDurationChange?.(segment, undefined);
                return;
              }
              const nextValue = Number(raw);
              if (Number.isNaN(nextValue)) {
                return;
              }
              onDurationChange?.(
                segment,
                Math.max(1, Math.min(10080, Math.round(nextValue))),
              );
            }}
          />
          <span className="segment-duration-unit">
            {t("map.segmentDurationUnit")}
          </span>
        </>
      ) : (
        <span className="segment-duration-label">
          {formatDuration(segment.durationMinutes ?? 0)}
        </span>
      )}
    </div>
  );
}

export const RoutingControl = React.memo(function RoutingControl({
  waypoints,
  routeSegments,
  color = DEFAULT_ROUTE_LINE_COLOR,
  engineId = DEFAULT_ENGINE,
  categoryNames = [],
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
  engineId?: RoutingEngineId;
  categoryNames?: string[];
}) {
  const map = useMapEvents({});
  const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const polylineCoordsRef = useRef<Map<string, [number, number][]>>(new Map());
  const categoryKey = categoryNames.join("|").toLowerCase();

  useEffect(() => {
    let disposed = false;

    if (waypoints.length < 2) {
      polylinesRef.current.forEach((polyline) => map.removeLayer(polyline));
      polylinesRef.current.clear();
      polylineCoordsRef.current.clear();
      return;
    }

    const activeKeys = new Set<string>();

    routeSegments.forEach((segment) => {
      if (segment.mode !== "auto") {
        return;
      }

      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      const key = buildAutoSegmentKey(segment, waypoints, engineId);
      if (!fromPoint || !toPoint || !key) {
        return;
      }

      activeKeys.add(key);

      const existingPolyline = polylinesRef.current.get(key);
      const existingCoords = polylineCoordsRef.current.get(key);
      if (existingPolyline && existingCoords) {
        updatePolylinePresentation(existingPolyline, segment, existingCoords, color, categoryNames);
        return;
      }

      fetchRoute(engineId, [fromPoint.lat, fromPoint.lng], [toPoint.lat, toPoint.lng]).then((coords) => {
        if (disposed) {
          return;
        }

        const polyline = L.polyline(
          coords.map((coord) => L.latLng(coord[0], coord[1])),
          {
            color,
            opacity: 0.7,
            weight: 4,
          },
        )
          .bindTooltip(buildSegmentTooltipText(segment, coords, categoryNames), {
            sticky: true,
            direction: "top",
            offset: [0, -4],
            className: "route-segment-tooltip",
          })
          .addTo(map);

        const previousPolyline = polylinesRef.current.get(key);
        if (previousPolyline) {
          map.removeLayer(previousPolyline);
        }
        polylinesRef.current.set(key, polyline);
        polylineCoordsRef.current.set(key, coords);
      });
    });

    polylinesRef.current.forEach((polyline, key) => {
      if (!activeKeys.has(key)) {
        map.removeLayer(polyline);
        polylinesRef.current.delete(key);
        polylineCoordsRef.current.delete(key);
      }
    });

    return () => {
      disposed = true;
    };
  }, [categoryKey, color, engineId, map, routeSegments, waypoints]);

  useEffect(() => {
    const polylines = polylinesRef.current;
    const polylineCoords = polylineCoordsRef.current;
    return () => {
      polylines.forEach((polyline) => {
        try {
          map.removeLayer(polyline);
        } catch {
          // Map teardown may remove the layer first.
        }
      });
      polylines.clear();
      polylineCoords.clear();
    };
  }, [map]);

  return null;
});

export function ManualRoutes({
  waypoints,
  routeSegments,
  color = DEFAULT_ROUTE_LINE_COLOR,
  categoryNames = [],
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
  categoryNames?: string[];
}) {
  const routes: Array<{ segment: RouteSegment; coords: [number, number][] }> = [];
  routeSegments.forEach((segment) => {
    if (segment.mode !== "manual") {
      return;
    }

    const fromPoint = waypoints[segment.fromIndex];
    const toPoint = waypoints[segment.toIndex];
    if (!fromPoint || !toPoint) {
      return;
    }

    routes.push({
      segment,
      coords: [
        [fromPoint.lat, fromPoint.lng],
        [toPoint.lat, toPoint.lng],
      ],
    });
  });

  return (
    <>
      {routes.map(({ segment, coords }) => (
        <Polyline
          key={`${segment.fromIndex}-${segment.toIndex}`}
          positions={coords}
          color={color}
          weight={4}
          opacity={0.7}
        >
          <Tooltip
            sticky
            direction="top"
            offset={[0, -4]}
            className="route-segment-tooltip"
          >
            {buildSegmentTooltipText(segment, coords, categoryNames)}
          </Tooltip>
        </Polyline>
      ))}
    </>
  );
}

export function SegmentDurationMarkers({
  waypoints,
  routeSegments,
  editable = false,
  onDurationChange,
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  editable?: boolean;
  onDurationChange?: (segment: RouteSegment, durationMinutes: number | undefined) => void;
}) {
  const visibleSegments = routeSegments
    .map((segment) => {
      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      if (!fromPoint || !toPoint) {
        return null;
      }
      return {
        segment,
        position: getSegmentMidpoint(fromPoint, toPoint) as [number, number],
      };
    })
    .filter((item): item is { segment: RouteSegment; position: [number, number] } => Boolean(item))
    .filter((item) => editable || item.segment.durationMinutes);

  return (
    <>
      {visibleSegments.map(({ segment, position }) => (
        <Marker
          key={`segment-duration-${segment.fromIndex}-${segment.toIndex}`}
          position={position}
          icon={SEGMENT_DURATION_ANCHOR_ICON}
          keyboard={false}
        >
          <Tooltip
            permanent
            interactive={editable}
            direction="top"
            offset={[0, -8]}
            className={`segment-duration-tooltip${editable ? " editable" : ""}`}
          >
            <SegmentDurationBubble
              segment={segment}
              editable={editable}
              onDurationChange={onDurationChange}
            />
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
