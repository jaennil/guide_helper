import { requestJson } from "./client";
import type {
  CreateTrackedRoutePayload,
  UpdateTrackedRoutePayload,
} from "../types/tracking";
import {
  readCachedRoute,
  readCachedRoutes,
  removeCachedRoute,
  upsertCachedRoute,
  writeRouteCache,
} from "../storage/routeCache";

export interface RoutePhotoData {
  original: string;
  thumbnail_url?: string;
  status: string;
}

export interface RoutePointResponse {
  lat: number;
  lng: number;
  name?: string;
  note?: string;
  marker_color?: string;
  marker_size?: number;
  preview_size?: number;
  preview_shape?: "square" | "circle";
  segment_mode?: "manual" | "auto";
  segment_duration_minutes?: number;
  photo?: RoutePhotoData;
}

export interface RouteResponse {
  id: string;
  user_id: string;
  name: string;
  points: RoutePointResponse[];
  created_at: string;
  updated_at: string;
  started_at?: string;
  share_token?: string;
  category_ids: string[];
  start_location?: string;
  end_location?: string;
  seasons: string[];
  line_color?: string;
  description?: string;
  is_draft: boolean;
}

export type SavedRouteResponse = RouteResponse;

export interface RouteQueryResult<T> {
  data: T;
  source: "network" | "cache";
  cachedAt?: string;
}

function shouldUseOfflineFallback(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("load failed") ||
    /status 5\d{2}/.test(message)
  );
}

export async function createTrackedRoute(payload: CreateTrackedRoutePayload) {
  const route = await requestJson<RouteResponse>("/api/v1/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await upsertCachedRoute(route);
  return route;
}

export async function updateTrackedRoute(
  routeId: string,
  payload: UpdateTrackedRoutePayload,
) {
  const route = await requestJson<RouteResponse>(`/api/v1/routes/${routeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  await upsertCachedRoute(route);
  return route;
}

export async function getUserRoutes() {
  const routes = await requestJson<RouteResponse[]>("/api/v1/routes");
  await writeRouteCache(routes);
  return routes;
}

export async function getUserRoutesWithFallback(): Promise<RouteQueryResult<RouteResponse[]>> {
  try {
    const routes = await getUserRoutes();
    return {
      data: routes,
      source: "network",
    };
  } catch (error) {
    const cached = await readCachedRoutes();
    if (cached && shouldUseOfflineFallback(error)) {
      return {
        data: cached.routes,
        source: "cache",
        cachedAt: cached.updatedAt,
      };
    }

    throw error;
  }
}

export async function getUserRoute(routeId: string) {
  const route = await requestJson<RouteResponse>(`/api/v1/routes/${routeId}`);
  await upsertCachedRoute(route);
  return route;
}

export async function getUserRouteWithFallback(
  routeId: string,
): Promise<RouteQueryResult<RouteResponse>> {
  try {
    const route = await getUserRoute(routeId);
    return {
      data: route,
      source: "network",
    };
  } catch (error) {
    const cached = await readCachedRoute(routeId);
    if (cached && shouldUseOfflineFallback(error)) {
      return {
        data: cached.route,
        source: "cache",
        cachedAt: cached.updatedAt,
      };
    }

    throw error;
  }
}

export async function deleteUserRoute(routeId: string) {
  await requestJson<void>(`/api/v1/routes/${routeId}`, {
    method: "DELETE",
  });
  await removeCachedRoute(routeId);
}
