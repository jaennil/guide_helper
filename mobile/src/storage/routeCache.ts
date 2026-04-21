import { readJsonFile, writeJsonFile } from "./jsonStore";
import type { RouteResponse } from "../api/routes";

const ROUTE_CACHE_FILE = "routes-cache.json";

interface RouteCacheSnapshot {
  updatedAt: string;
  routes: RouteResponse[];
}

function buildSnapshot(routes: RouteResponse[]): RouteCacheSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    routes,
  };
}

export async function readRouteCache() {
  return readJsonFile<RouteCacheSnapshot>(ROUTE_CACHE_FILE);
}

export async function writeRouteCache(routes: RouteResponse[]) {
  await writeJsonFile<RouteCacheSnapshot>(ROUTE_CACHE_FILE, buildSnapshot(routes));
}

export async function readCachedRoutes() {
  const snapshot = await readRouteCache();
  if (!snapshot) {
    return null;
  }

  return {
    routes: snapshot.routes,
    updatedAt: snapshot.updatedAt,
  };
}

export async function readCachedRoute(routeId: string) {
  const snapshot = await readRouteCache();
  if (!snapshot) {
    return null;
  }

  const route = snapshot.routes.find((candidate) => candidate.id === routeId);
  if (!route) {
    return null;
  }

  return {
    route,
    updatedAt: snapshot.updatedAt,
  };
}

export async function upsertCachedRoute(route: RouteResponse) {
  const snapshot = await readRouteCache();
  const currentRoutes = snapshot?.routes ?? [];
  const nextRoutes = currentRoutes.some((candidate) => candidate.id === route.id)
    ? currentRoutes.map((candidate) => (candidate.id === route.id ? route : candidate))
    : [route, ...currentRoutes];

  await writeRouteCache(nextRoutes);
}

export async function patchCachedRoute(
  routeId: string,
  patch: Partial<RouteResponse>,
) {
  const snapshot = await readRouteCache();
  if (!snapshot) {
    return;
  }

  const nextRoutes = snapshot.routes.map((route) =>
    route.id === routeId
      ? {
          ...route,
          ...patch,
        }
      : route,
  );

  await writeRouteCache(nextRoutes);
}

export async function removeCachedRoute(routeId: string) {
  const snapshot = await readRouteCache();
  if (!snapshot) {
    return;
  }

  await writeRouteCache(snapshot.routes.filter((route) => route.id !== routeId));
}
