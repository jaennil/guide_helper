export type TrackingStatus = "idle" | "recording" | "paused" | "stopped";
export type SampleSource = "foreground" | "background";
export type PhotoPreviewShape = "square" | "circle";
export type RoutePointSemanticHint = "stop" | "turn";

export interface TrackSample {
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracy?: number | null;
  altitude?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  source: SampleSource;
}

export interface TrackingSession {
  id: string | null;
  name: string;
  status: TrackingStatus;
  startedAt?: string;
  routeStartedAt?: string;
  pausedAt?: string;
  endedAt?: string;
  pausedDurationMs: number;
  samples: TrackSample[];
  routePoints: RoutePointPayload[];
  categoryIds: string[];
  seasons: string[];
  lineColor: string;
  serverRouteId?: string;
  lastSavedRouteId?: string;
  lastQueuedUploadId?: string;
  serverBaselineFingerprint?: string;
  queuedBaselineFingerprint?: string;
}

export interface TrackingMetrics {
  durationMs: number;
  distanceKm: number;
  averageSpeedKmh: number;
  maxSpeedKmh: number;
  currentSpeedKmh: number;
}

export interface RoutePointPayload {
  lat: number;
  lng: number;
  name?: string;
  note?: string;
  semantic_hint?: RoutePointSemanticHint;
  marker_color?: string;
  marker_size?: number;
  preview_size?: number;
  preview_shape?: PhotoPreviewShape;
  photo?: RoutePhotoPayload;
  segment_mode?: "manual";
  segment_duration_minutes?: number;
}

export type RoutePhotoStatus = "pending" | "processing" | "done" | "failed";

export interface RoutePhotoPayload {
  original: string;
  thumbnail_url?: string;
  status: RoutePhotoStatus;
}

export interface CreateTrackedRoutePayload {
  name: string;
  points: RoutePointPayload[];
  category_ids: string[];
  seasons: string[];
  line_color?: string;
  started_at?: string;
}

export type UpdateTrackedRoutePayload = CreateTrackedRoutePayload;
