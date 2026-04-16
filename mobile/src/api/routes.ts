import { requestJson } from "./client";
import type { CreateTrackedRoutePayload } from "../types/tracking";

export interface SavedRouteResponse {
  id: string;
  name: string;
  created_at: string;
}

export async function createTrackedRoute(payload: CreateTrackedRoutePayload) {
  return requestJson<SavedRouteResponse>("/api/v1/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
