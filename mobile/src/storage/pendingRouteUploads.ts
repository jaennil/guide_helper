import { readJsonFile, writeJsonFile } from "./jsonStore";
import type {
  CreateTrackedRoutePayload,
  RoutePointPayload,
  TrackSample,
} from "../types/tracking";

const PENDING_UPLOADS_FILE = "pending-route-uploads.json";

export interface PendingRouteUploadSessionSnapshot {
  startedAt?: string;
  endedAt?: string;
  routeStartedAt?: string;
  pausedDurationMs: number;
  samples: TrackSample[];
  routePoints: RoutePointPayload[];
  categoryIds: string[];
  seasons: string[];
  lineColor?: string;
  serverRouteId?: string;
  serverBaselineFingerprint?: string;
  queuedBaselineFingerprint?: string;
}

export interface PendingRouteUpload {
  id: string;
  createdAt: string;
  payload: CreateTrackedRoutePayload;
  sampleCount: number;
  sessionSnapshot?: PendingRouteUploadSessionSnapshot;
  lastTriedAt?: string;
  lastError?: string;
}

export async function readPendingRouteUploads() {
  return (await readJsonFile<PendingRouteUpload[]>(PENDING_UPLOADS_FILE)) ?? [];
}

export async function writePendingRouteUploads(uploads: PendingRouteUpload[]) {
  await writeJsonFile(PENDING_UPLOADS_FILE, uploads);
}

export async function removePendingRouteUpload(uploadId: string) {
  const currentUploads = await readPendingRouteUploads();
  const nextUploads = currentUploads.filter((upload) => upload.id !== uploadId);
  await writePendingRouteUploads(nextUploads);
  return nextUploads;
}
