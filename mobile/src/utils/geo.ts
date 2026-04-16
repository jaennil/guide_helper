import type {
  CreateTrackedRoutePayload,
  RoutePointPayload,
  TrackSample,
  TrackingMetrics,
  TrackingSession,
} from "../types/tracking";

const EARTH_RADIUS_KM = 6371;
const MAX_ACCEPTED_ACCURACY_METERS = 100;
const MIN_SAMPLE_DISTANCE_METERS = 4;
const MIN_SAMPLE_INTERVAL_MS = 3000;
const MAX_REASONABLE_SPEED_MPS = 50;
const MIN_STALE_FIRST_SAMPLE_JUMP_METERS = 1000;
const ROUTE_LINE_COLOR = "#3388ff";

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sampleTimestamp(sample: TrackSample) {
  return new Date(sample.recordedAt).getTime();
}

function sampleDistanceMeters(left: TrackSample, right: TrackSample) {
  return haversineDistanceKm(
    left.latitude,
    left.longitude,
    right.latitude,
    right.longitude,
  ) * 1000;
}

function sameSample(left: TrackSample, right: TrackSample) {
  return (
    left.recordedAt === right.recordedAt &&
    Math.abs(left.latitude - right.latitude) <= 0.000001 &&
    Math.abs(left.longitude - right.longitude) <= 0.000001
  );
}

function shouldAcceptIncomingSample(previous: TrackSample | undefined, incoming: TrackSample) {
  if (
    typeof incoming.accuracy === "number" &&
    incoming.accuracy > MAX_ACCEPTED_ACCURACY_METERS
  ) {
    return false;
  }

  if (!previous) {
    return true;
  }

  if (sameSample(previous, incoming)) {
    return false;
  }

  const deltaMs = sampleTimestamp(incoming) - sampleTimestamp(previous);
  if (deltaMs <= 0) {
    return false;
  }

  const distanceMeters = sampleDistanceMeters(previous, incoming);
  if (distanceMeters < MIN_SAMPLE_DISTANCE_METERS && deltaMs < MIN_SAMPLE_INTERVAL_MS) {
    return false;
  }

  if (distanceMeters / (deltaMs / 1000) > MAX_REASONABLE_SPEED_MPS) {
    return false;
  }

  return true;
}

function shouldReplaceStaleFirstSample(samples: TrackSample[], incoming: TrackSample) {
  if (samples.length !== 1) {
    return false;
  }

  if (
    typeof incoming.accuracy === "number" &&
    incoming.accuracy > MAX_ACCEPTED_ACCURACY_METERS
  ) {
    return false;
  }

  const previous = samples[0];
  const deltaMs = sampleTimestamp(incoming) - sampleTimestamp(previous);
  if (deltaMs <= 0) {
    return false;
  }

  const distanceMeters = sampleDistanceMeters(previous, incoming);
  if (distanceMeters < MIN_STALE_FIRST_SAMPLE_JUMP_METERS) {
    return false;
  }

  return distanceMeters / (deltaMs / 1000) > MAX_REASONABLE_SPEED_MPS;
}

export function mergeTrackSamples(
  currentSamples: TrackSample[],
  incomingSamples: TrackSample[],
) {
  const sortedIncoming = [...incomingSamples].sort(
    (left, right) => sampleTimestamp(left) - sampleTimestamp(right),
  );
  const nextSamples = [...currentSamples];

  for (const sample of sortedIncoming) {
    const previous = nextSamples[nextSamples.length - 1];
    if (shouldAcceptIncomingSample(previous, sample)) {
      nextSamples.push(sample);
    } else if (shouldReplaceStaleFirstSample(nextSamples, sample)) {
      // Android emulators and some devices can return a stale last-known fix
      // before the fresh GPS stream starts. Keep the route usable instead of
      // locking the session to a wrong first coordinate.
      nextSamples[0] = sample;
    }
  }

  return nextSamples;
}

export function calculateTrackingMetrics(session: TrackingSession): TrackingMetrics {
  const samples = session.samples;
  const finishedAt =
    session.status === "recording" ? Date.now() : new Date(session.endedAt ?? Date.now()).getTime();
  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : finishedAt;
  const pausedAt = session.pausedAt ? new Date(session.pausedAt).getTime() : null;
  const extraPausedMs =
    session.status === "paused" && pausedAt !== null ? finishedAt - pausedAt : 0;
  const durationMs = Math.max(
    0,
    finishedAt - startedAt - session.pausedDurationMs - extraPausedMs,
  );

  let distanceKm = 0;
  let maxSpeedKmh = 0;
  let currentSpeedKmh = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const deltaMs = sampleTimestamp(current) - sampleTimestamp(previous);
    const deltaKm = haversineDistanceKm(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    );
    distanceKm += deltaKm;

    const derivedSpeedKmh = deltaMs > 0 ? deltaKm / (deltaMs / 3_600_000) : 0;
    const reportedSpeedKmh = typeof current.speedMps === "number" ? current.speedMps * 3.6 : 0;
    const peakForSample = Math.max(derivedSpeedKmh, reportedSpeedKmh);
    maxSpeedKmh = Math.max(maxSpeedKmh, peakForSample);
    currentSpeedKmh = peakForSample;
  }

  return {
    durationMs,
    distanceKm,
    averageSpeedKmh: durationMs > 0 ? distanceKm / (durationMs / 3_600_000) : 0,
    maxSpeedKmh,
    currentSpeedKmh,
  };
}

function buildDefaultRouteName(startedAt?: string) {
  const date = startedAt ? new Date(startedAt) : new Date();
  return `Маршрут ${date.toLocaleDateString("ru-RU")} ${date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function compactTrackSamples(samples: TrackSample[], maxPoints = 600) {
  if (samples.length <= maxPoints) {
    return samples;
  }

  let minDistanceMeters = 8;
  let compacted = samples;

  while (compacted.length > maxPoints && minDistanceMeters <= 100) {
    const next: TrackSample[] = [];
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (index === 0 || index === samples.length - 1) {
        next.push(sample);
        continue;
      }

      const previousKept = next[next.length - 1];
      if (sampleDistanceMeters(previousKept, sample) >= minDistanceMeters) {
        next.push(sample);
      }
    }

    compacted = next;
    minDistanceMeters *= 1.5;
  }

  return compacted;
}

function trackSamplesToRoutePoints(samples: TrackSample[]): RoutePointPayload[] {
  const compacted = compactTrackSamples(samples);

  return compacted.map((sample, index) => {
    const previous = compacted[index - 1];
    const durationMinutes =
      previous === undefined
        ? undefined
        : Math.max(
            1,
            Math.round((sampleTimestamp(sample) - sampleTimestamp(previous)) / 60_000),
          );

    return {
      lat: sample.latitude,
      lng: sample.longitude,
      name:
        index === 0
          ? "Старт"
          : index === compacted.length - 1
            ? "Финиш"
            : undefined,
      segment_mode: index === 0 ? undefined : "manual",
      segment_duration_minutes: durationMinutes,
    };
  });
}

export function buildTrackedRoutePayload(session: TrackingSession): CreateTrackedRoutePayload {
  const points = trackSamplesToRoutePoints(session.samples);

  return {
    name: session.name.trim() || buildDefaultRouteName(session.startedAt),
    points,
    category_ids: [],
    seasons: [],
    line_color: ROUTE_LINE_COLOR,
    started_at: session.startedAt,
  };
}

export function formatDistance(distanceKm: number) {
  return `${distanceKm.toFixed(distanceKm >= 10 ? 1 : 2)} км`;
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes.toString().padStart(2, "0")}м`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
