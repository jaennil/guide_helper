import { readJsonFile, writeJsonFile } from "./jsonStore";
import type { CreateTrackedRoutePayload } from "../types/tracking";

const PENDING_UPLOADS_FILE = "pending-route-uploads.json";

export interface PendingRouteUpload {
  id: string;
  createdAt: string;
  payload: CreateTrackedRoutePayload;
  sampleCount: number;
  lastTriedAt?: string;
  lastError?: string;
}

export async function readPendingRouteUploads() {
  return (await readJsonFile<PendingRouteUpload[]>(PENDING_UPLOADS_FILE)) ?? [];
}

export async function writePendingRouteUploads(uploads: PendingRouteUpload[]) {
  await writeJsonFile(PENDING_UPLOADS_FILE, uploads);
}
