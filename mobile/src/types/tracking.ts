export type TrackingStatus = "idle" | "recording" | "paused" | "stopped";
export type SampleSource = "foreground" | "background";

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
  pausedAt?: string;
  endedAt?: string;
  pausedDurationMs: number;
  samples: TrackSample[];
  lastSavedRouteId?: string;
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
  segment_mode?: "manual";
  segment_duration_minutes?: number;
}

export interface CreateTrackedRoutePayload {
  name: string;
  points: RoutePointPayload[];
  category_ids: string[];
  seasons: string[];
  line_color?: string;
  started_at?: string;
}
