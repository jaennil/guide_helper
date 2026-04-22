import type { ChatPoint } from "../api/chat";
import type { CreateRouteRequest, Route as SavedRoute, RoutePoint as ApiRoutePoint } from "../api/routes";
import type { OverlayRoute, RouteMode, RoutePoint, RouteSegment } from "../types/routeMap";
import {
  DEFAULT_POINT_MARKER_COLOR,
  DEFAULT_POINT_MARKER_SIZE,
  clampPhotoPreviewSize,
  clampPointMarkerSize,
  normalizePhotoPreviewShape,
  normalizePointMarkerColor,
} from "./routePointStyles";
import { normalizeRouteLineColor } from "./routeColors";

const CHAT_POINT_MATCH_EPSILON = 0.00001;

export function toDatetimeLocalValue(iso?: string) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function apiPointsToEditorPoints(points: ApiRoutePoint[]): RoutePoint[] {
  return points.map((point, index) => ({
    id: index,
    position: [point.lat, point.lng] as [number, number],
    name: point.name,
    note: point.note,
    markerColor: point.marker_color,
    markerSize: point.marker_size,
    previewSize: point.preview_size,
    previewShape: point.preview_shape,
    photo: point.photo,
  }));
}

function apiPointsToSegments(points: ApiRoutePoint[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const destinationPoint = points[index + 1];
    segments.push({
      fromIndex: index,
      toIndex: index + 1,
      mode: destinationPoint.segment_mode ?? "manual",
      durationMinutes: destinationPoint.segment_duration_minutes,
    });
  }
  return segments;
}

export function routeToEditorState(route: SavedRoute) {
  const points = apiPointsToEditorPoints(route.points);

  return {
    routeName: route.name,
    selectedCategoryIds: route.category_ids,
    selectedSeasons: route.seasons,
    routeLineColor: normalizeRouteLineColor(route.line_color),
    routeStartedAt: toDatetimeLocalValue(route.started_at),
    points,
    segments: apiPointsToSegments(route.points),
    nextPointId: points.length,
  };
}

export function routeToOverlayRoute(route: SavedRoute, fallbackColor: string): OverlayRoute {
  return {
    id: route.id,
    name: route.name,
    color: route.line_color ? normalizeRouteLineColor(route.line_color) : fallbackColor,
    points: apiPointsToEditorPoints(route.points),
    segments: apiPointsToSegments(route.points),
  };
}

export function buildRouteSavePayload({
  routeName,
  routePoints,
  routeSegments,
  selectedCategoryIds,
  selectedSeasons,
  routeLineColor,
  routeStartedAt,
}: {
  routeName: string;
  routePoints: RoutePoint[];
  routeSegments: RouteSegment[];
  selectedCategoryIds: string[];
  selectedSeasons: string[];
  routeLineColor: string;
  routeStartedAt: string;
}): CreateRouteRequest {
  return {
    name: routeName.trim(),
    points: routePoints.map((point, index) => {
      const segment = routeSegments.find((item) => item.toIndex === index);
      const normalizedName = point.name?.trim();
      const normalizedNote = point.note?.trim();

      return {
        lat: point.position[0],
        lng: point.position[1],
        name: normalizedName || undefined,
        note: normalizedNote || undefined,
        marker_color: point.markerColor ? normalizePointMarkerColor(point.markerColor) : undefined,
        marker_size: point.markerSize ? clampPointMarkerSize(point.markerSize) : undefined,
        preview_size: point.photo ? clampPhotoPreviewSize(point.previewSize) : undefined,
        preview_shape: point.photo ? normalizePhotoPreviewShape(point.previewShape) : undefined,
        segment_mode: segment?.mode,
        segment_duration_minutes: segment?.durationMinutes,
        photo: point.photo,
      };
    }),
    category_ids: selectedCategoryIds,
    seasons: selectedSeasons,
    line_color: normalizeRouteLineColor(routeLineColor),
    started_at: fromDatetimeLocalValue(routeStartedAt),
  };
}

function routePointsMatch(
  left: Pick<RoutePoint, "position" | "name">,
  right: Pick<RoutePoint, "position" | "name">,
) {
  const [leftLat, leftLng] = left.position;
  const [rightLat, rightLng] = right.position;
  const namesMatch = !left.name || !right.name || left.name === right.name;

  return (
    namesMatch &&
    Math.abs(leftLat - rightLat) <= CHAT_POINT_MATCH_EPSILON &&
    Math.abs(leftLng - rightLng) <= CHAT_POINT_MATCH_EPSILON
  );
}

function overlappingRouteTailLength(existingPoints: RoutePoint[], incomingPoints: RoutePoint[]) {
  const maxOverlap = Math.min(existingPoints.length, incomingPoints.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingTail = existingPoints.slice(existingPoints.length - overlap);
    const incomingHead = incomingPoints.slice(0, overlap);

    if (existingTail.every((point, index) => routePointsMatch(point, incomingHead[index]))) {
      return overlap;
    }
  }

  return 0;
}

export function buildSegmentsForAppendedPoints(existingCount: number, appendedCount: number, routeMode: RouteMode) {
  const segments: RouteSegment[] = [];

  if (existingCount > 0 && appendedCount > 0) {
    segments.push({
      fromIndex: existingCount - 1,
      toIndex: existingCount,
      mode: routeMode,
      durationMinutes: undefined,
    });
  }

  for (let index = 1; index < appendedCount; index += 1) {
    segments.push({
      fromIndex: existingCount + index - 1,
      toIndex: existingCount + index,
      mode: routeMode,
      durationMinutes: undefined,
    });
  }

  return segments;
}

export function buildChatPreviewPoints(points: ChatPoint[], markerColor: string): RoutePoint[] {
  return points.map((point, index) => ({
    id: -1 - index,
    position: [point.lat, point.lng] as [number, number],
    name: point.name,
    markerColor,
    markerSize: DEFAULT_POINT_MARKER_SIZE,
  }));
}

export function appendChatPointsToRoute({
  existingPoints,
  incomingChatPoints,
  nextPointId,
  routeMode,
}: {
  existingPoints: RoutePoint[];
  incomingChatPoints: ChatPoint[];
  nextPointId: number;
  routeMode: RouteMode;
}) {
  const incomingPoints: RoutePoint[] = incomingChatPoints.map((point, index) => ({
    id: nextPointId + index,
    position: [point.lat, point.lng] as [number, number],
    name: point.name,
    markerColor: DEFAULT_POINT_MARKER_COLOR,
    markerSize: DEFAULT_POINT_MARKER_SIZE,
  }));

  if (incomingPoints.length === 0) {
    return {
      previewPoints: existingPoints,
      appendedPoints: [] as RoutePoint[],
      nextPoints: existingPoints,
      newSegments: [] as RouteSegment[],
      nextPointId,
    };
  }

  const overlap = overlappingRouteTailLength(existingPoints, incomingPoints);
  const appendedPoints = incomingPoints.slice(overlap);
  const nextPoints = [...existingPoints, ...appendedPoints];

  return {
    previewPoints: [...existingPoints, ...incomingPoints.slice(overlap)],
    appendedPoints,
    nextPoints,
    newSegments: buildSegmentsForAppendedPoints(existingPoints.length, appendedPoints.length, routeMode),
    nextPointId: nextPointId + incomingPoints.length,
  };
}

export function hasAllChatPointsOnRoute(routePoints: RoutePoint[], chatPreviewPoints: RoutePoint[]) {
  return chatPreviewPoints.every((target) =>
    routePoints.some((routePoint) => routePointsMatch(routePoint, target)),
  );
}
