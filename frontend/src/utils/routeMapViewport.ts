import L from "leaflet";
import type { RoutePoint } from "../types/routeMap";

export function focusMapOnPoints(map: L.Map | null, points: RoutePoint[]) {
  if (!map || points.length === 0) {
    return;
  }

  requestAnimationFrame(() => {
    map.invalidateSize();

    if (points.length === 1) {
      map.setView(points[0].position, Math.max(map.getZoom(), 16), {
        animate: true,
      });
      return;
    }

    const bounds = L.latLngBounds(
      points.map((point) => L.latLng(point.position[0], point.position[1])),
    );
    map.fitBounds(bounds.pad(0.2), { animate: true, maxZoom: 16 });
  });
}

export function focusMapOnPoint(
  map: L.Map | null,
  routePoints: RoutePoint[],
  pointId: number,
) {
  const targetPoint = routePoints.find((point) => point.id === pointId);
  if (!targetPoint) {
    return;
  }
  focusMapOnPoints(map, [targetPoint]);
}
