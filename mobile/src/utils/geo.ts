import type {
  CreateTrackedRoutePayload,
  PhotoPreviewShape,
  RoutePointPayload,
  TrackSample,
  TrackingMetrics,
  TrackingSession,
  UpdateTrackedRoutePayload,
} from "../types/tracking";

const EARTH_RADIUS_KM = 6371;
const MAX_ACCEPTED_ACCURACY_METERS = 100;
const MIN_SAMPLE_DISTANCE_METERS = 4;
const MIN_SAMPLE_INTERVAL_MS = 3000;
const MAX_REASONABLE_SAMPLE_SPEED_MPS = 25;
const MAX_TRUSTED_REPORTED_SPEED_MPS = 20;
const MIN_STALE_FIRST_SAMPLE_JUMP_METERS = 1000;
export const DEFAULT_ROUTE_LINE_COLOR = "#3388ff";
export const DEFAULT_POINT_MARKER_COLOR = "#3388ff";
export const DEFAULT_POINT_MARKER_SIZE = 30;
export const MIN_POINT_MARKER_SIZE = 22;
export const MAX_POINT_MARKER_SIZE = 46;
export const POINT_MARKER_SIZE_STEP = 2;
export const DEFAULT_PHOTO_PREVIEW_SIZE = 44;
export const MIN_PHOTO_PREVIEW_SIZE = 28;
export const MAX_PHOTO_PREVIEW_SIZE = 84;
export const PHOTO_PREVIEW_STEP = 4;
export const DEFAULT_PHOTO_PREVIEW_SHAPE: PhotoPreviewShape = "square";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const BASE_ROUTE_POINT_MAX_COUNT = 40;
const BASE_ROUTE_POINT_INITIAL_MIN_DISTANCE_METERS = 20;
const TURN_DETECTION_MAX_COUNT = 120;
const TURN_DETECTION_MIN_DISTANCE_METERS = 18;
const TURN_MIN_ANGLE_DEGREES = 58;
const TURN_MIN_SEGMENT_DISTANCE_METERS = 35;
const STOP_STEP_DISTANCE_METERS = 16;
const STOP_CLUSTER_RADIUS_METERS = 30;
const STOP_MIN_DURATION_MS = 150_000;
const SEMANTIC_ASSIGN_DISTANCE_METERS = 55;
const SEMANTIC_MERGE_DISTANCE_METERS = 90;

type SemanticPointKind = "stop" | "turn";

type SemanticPointCandidate = {
  kind: SemanticPointKind;
  sampleIndex: number;
  score: number;
};

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

function coordinateDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  return haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) * 1000;
}

function sameSample(left: TrackSample, right: TrackSample) {
  return (
    left.recordedAt === right.recordedAt &&
    Math.abs(left.latitude - right.latitude) <= 0.000001 &&
    Math.abs(left.longitude - right.longitude) <= 0.000001
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

  if (distanceMeters / (deltaMs / 1000) > MAX_REASONABLE_SAMPLE_SPEED_MPS) {
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

  return distanceMeters / (deltaMs / 1000) > MAX_REASONABLE_SAMPLE_SPEED_MPS;
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
    const derivedSpeedMps = deltaMs > 0 ? (deltaKm * 1000) / (deltaMs / 1000) : 0;
    const derivedSpeedKmh =
      derivedSpeedMps > 0 && derivedSpeedMps <= MAX_REASONABLE_SAMPLE_SPEED_MPS
        ? derivedSpeedMps * 3.6
        : 0;
    const reportedSpeedKmh =
      isFiniteNumber(current.speedMps) &&
      current.speedMps >= 0 &&
      current.speedMps <= MAX_TRUSTED_REPORTED_SPEED_MPS &&
      (!isFiniteNumber(current.accuracy) || current.accuracy <= MAX_ACCEPTED_ACCURACY_METERS)
        ? current.speedMps * 3.6
        : 0;
    const peakForSample = Math.max(derivedSpeedKmh, reportedSpeedKmh);

    if (derivedSpeedKmh > 0) {
      distanceKm += deltaKm;
    }

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

export function normalizeRouteLineColor(color?: string | null) {
  if (typeof color !== "string") {
    return DEFAULT_ROUTE_LINE_COLOR;
  }

  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : DEFAULT_ROUTE_LINE_COLOR;
}

export function normalizePointMarkerColor(color?: string | null) {
  if (typeof color !== "string") {
    return DEFAULT_POINT_MARKER_COLOR;
  }

  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : DEFAULT_POINT_MARKER_COLOR;
}

export function clampPointMarkerSize(size?: number | null) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_POINT_MARKER_SIZE;
  }

  return Math.max(
    MIN_POINT_MARKER_SIZE,
    Math.min(
      MAX_POINT_MARKER_SIZE,
      Math.round(size / POINT_MARKER_SIZE_STEP) * POINT_MARKER_SIZE_STEP,
    ),
  );
}

export function clampPhotoPreviewSize(size?: number | null) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_PHOTO_PREVIEW_SIZE;
  }

  return Math.max(
    MIN_PHOTO_PREVIEW_SIZE,
    Math.min(
      MAX_PHOTO_PREVIEW_SIZE,
      Math.round(size / PHOTO_PREVIEW_STEP) * PHOTO_PREVIEW_STEP,
    ),
  );
}

export function normalizePhotoPreviewShape(shape?: string | null): PhotoPreviewShape {
  return shape === "circle" ? "circle" : DEFAULT_PHOTO_PREVIEW_SHAPE;
}

function compactTrackSamples(
  samples: TrackSample[],
  maxPoints = BASE_ROUTE_POINT_MAX_COUNT,
  initialMinDistanceMeters = BASE_ROUTE_POINT_INITIAL_MIN_DISTANCE_METERS,
) {
  const allSampleIndices = samples.map((_, index) => index);

  if (samples.length <= maxPoints) {
    return allSampleIndices;
  }

  let minDistanceMeters = initialMinDistanceMeters;
  let compacted = allSampleIndices;

  while (compacted.length > maxPoints && minDistanceMeters <= 120) {
    const next: number[] = [];
    for (let index = 0; index < samples.length; index += 1) {
      if (index === 0 || index === samples.length - 1) {
        next.push(index);
        continue;
      }

      const previousKept = samples[next[next.length - 1]];
      if (sampleDistanceMeters(previousKept, samples[index]) >= minDistanceMeters) {
        next.push(index);
      }
    }

    compacted = next;
    minDistanceMeters *= 1.5;
  }

  return compacted;
}

function buildCumulativeDistancesMeters(samples: TrackSample[]) {
  const cumulativeDistances = [0];

  for (let index = 1; index < samples.length; index += 1) {
    cumulativeDistances[index] =
      cumulativeDistances[index - 1] + sampleDistanceMeters(samples[index - 1], samples[index]);
  }

  return cumulativeDistances;
}

function distanceAlongRouteMeters(
  cumulativeDistances: number[],
  startIndex: number,
  endIndex: number,
) {
  const left = Math.min(startIndex, endIndex);
  const right = Math.max(startIndex, endIndex);
  return cumulativeDistances[right] - cumulativeDistances[left];
}

function bearingDegrees(from: TrackSample, to: TrackSample) {
  const latitudeA = toRadians(from.latitude);
  const latitudeB = toRadians(to.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  return (angle + 360) % 360;
}

function angleDifferenceDegrees(left: number, right: number) {
  const difference = Math.abs(left - right) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function semanticPriority(kind: SemanticPointKind) {
  return kind === "stop" ? 2 : 1;
}

function clusterRadiusMeters(samples: TrackSample[], startIndex: number, endIndex: number) {
  let latitudeSum = 0;
  let longitudeSum = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    latitudeSum += samples[index].latitude;
    longitudeSum += samples[index].longitude;
  }

  const pointsCount = endIndex - startIndex + 1;
  const centerLatitude = latitudeSum / pointsCount;
  const centerLongitude = longitudeSum / pointsCount;
  let maxRadiusMeters = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    maxRadiusMeters = Math.max(
      maxRadiusMeters,
      coordinateDistanceMeters(
        centerLatitude,
        centerLongitude,
        samples[index].latitude,
        samples[index].longitude,
      ),
    );
  }

  return maxRadiusMeters;
}

function detectStopCandidates(samples: TrackSample[]) {
  const candidates: SemanticPointCandidate[] = [];

  for (let startIndex = 0; startIndex < samples.length - 2; startIndex += 1) {
    let endIndex = startIndex;

    while (
      endIndex + 1 < samples.length &&
      sampleDistanceMeters(samples[endIndex], samples[endIndex + 1]) <= STOP_STEP_DISTANCE_METERS
    ) {
      endIndex += 1;
    }

    if (endIndex <= startIndex) {
      continue;
    }

    const durationMs = sampleTimestamp(samples[endIndex]) - sampleTimestamp(samples[startIndex]);
    const radiusMeters = clusterRadiusMeters(samples, startIndex, endIndex);

    if (
      durationMs >= STOP_MIN_DURATION_MS &&
      radiusMeters <= STOP_CLUSTER_RADIUS_METERS &&
      startIndex > 0 &&
      endIndex < samples.length - 1
    ) {
      candidates.push({
        kind: "stop",
        sampleIndex: Math.round((startIndex + endIndex) / 2),
        score: durationMs,
      });
      startIndex = endIndex;
    }
  }

  return candidates;
}

function detectTurnCandidates(samples: TrackSample[]) {
  const detectionIndices = compactTrackSamples(
    samples,
    TURN_DETECTION_MAX_COUNT,
    TURN_DETECTION_MIN_DISTANCE_METERS,
  );
  const candidates: SemanticPointCandidate[] = [];

  for (let index = 1; index < detectionIndices.length - 1; index += 1) {
    const previousIndex = detectionIndices[index - 1];
    const currentIndex = detectionIndices[index];
    const nextIndex = detectionIndices[index + 1];
    const previous = samples[previousIndex];
    const current = samples[currentIndex];
    const next = samples[nextIndex];
    const approachMeters = sampleDistanceMeters(previous, current);
    const departureMeters = sampleDistanceMeters(current, next);

    if (
      approachMeters < TURN_MIN_SEGMENT_DISTANCE_METERS ||
      departureMeters < TURN_MIN_SEGMENT_DISTANCE_METERS
    ) {
      continue;
    }

    const turnAngleDegrees = angleDifferenceDegrees(
      bearingDegrees(previous, current),
      bearingDegrees(current, next),
    );

    if (turnAngleDegrees >= TURN_MIN_ANGLE_DEGREES) {
      candidates.push({
        kind: "turn",
        sampleIndex: currentIndex,
        score: turnAngleDegrees,
      });
    }
  }

  return candidates;
}

function mergeSemanticCandidates(
  candidates: SemanticPointCandidate[],
  cumulativeDistances: number[],
) {
  const merged: SemanticPointCandidate[] = [];

  for (const candidate of [...candidates].sort((left, right) => left.sampleIndex - right.sampleIndex)) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(candidate);
      continue;
    }

    const routeDistance = distanceAlongRouteMeters(
      cumulativeDistances,
      previous.sampleIndex,
      candidate.sampleIndex,
    );

    if (routeDistance >= SEMANTIC_MERGE_DISTANCE_METERS) {
      merged.push(candidate);
      continue;
    }

    if (
      semanticPriority(candidate.kind) > semanticPriority(previous.kind) ||
      (semanticPriority(candidate.kind) === semanticPriority(previous.kind) &&
        candidate.score > previous.score)
    ) {
      merged[merged.length - 1] = candidate;
    }
  }

  return merged;
}

function assignSemanticCandidatesToIndices(
  baseIndices: number[],
  candidates: SemanticPointCandidate[],
  cumulativeDistances: number[],
) {
  const assignedKinds = new Map<number, SemanticPointCandidate>();
  const selectedIndices = [...baseIndices];

  for (const candidate of candidates) {
    let targetIndex = candidate.sampleIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const selectedIndex of selectedIndices) {
      const routeDistance = distanceAlongRouteMeters(
        cumulativeDistances,
        selectedIndex,
        candidate.sampleIndex,
      );
      if (routeDistance < nearestDistance) {
        nearestDistance = routeDistance;
        targetIndex = selectedIndex;
      }
    }

    if (nearestDistance > SEMANTIC_ASSIGN_DISTANCE_METERS) {
      selectedIndices.push(candidate.sampleIndex);
      targetIndex = candidate.sampleIndex;
    }

    const previous = assignedKinds.get(targetIndex);
    if (
      !previous ||
      semanticPriority(candidate.kind) > semanticPriority(previous.kind) ||
      (semanticPriority(candidate.kind) === semanticPriority(previous.kind) &&
        candidate.score > previous.score)
    ) {
      assignedKinds.set(targetIndex, candidate);
    }
  }

  return {
    selectedIndices: [...new Set(selectedIndices)].sort((left, right) => left - right),
    assignedKinds,
  };
}

export function buildRoutePointsFromSamples(samples: TrackSample[]): RoutePointPayload[] {
  if (samples.length === 0) {
    return [];
  }

  if (samples.length === 1) {
    return [
      {
        lat: samples[0].latitude,
        lng: samples[0].longitude,
        name: "Старт",
      },
    ];
  }

  const cumulativeDistances = buildCumulativeDistancesMeters(samples);
  const baseIndices = compactTrackSamples(samples);
  const semanticCandidates = mergeSemanticCandidates(
    [...detectStopCandidates(samples), ...detectTurnCandidates(samples)],
    cumulativeDistances,
  );
  const { selectedIndices, assignedKinds } = assignSemanticCandidatesToIndices(
    baseIndices,
    semanticCandidates,
    cumulativeDistances,
  );
  let stopCounter = 0;
  let turnCounter = 0;

  return selectedIndices.map((sampleIndex, index) => {
    const sample = samples[sampleIndex];
    const previousSampleIndex = selectedIndices[index - 1];
    const durationMinutes =
      previousSampleIndex === undefined
        ? undefined
        : Math.max(
            1,
            Math.round(
              (sampleTimestamp(sample) - sampleTimestamp(samples[previousSampleIndex])) / 60_000,
            ),
          );
    const semanticCandidate = assignedKinds.get(sampleIndex);
    let name: string | undefined;

    if (index === 0) {
      name = "Старт";
    } else if (index === selectedIndices.length - 1) {
      name = "Финиш";
    } else if (semanticCandidate?.kind === "stop") {
      stopCounter += 1;
      name = `Остановка ${stopCounter}`;
    } else if (semanticCandidate?.kind === "turn") {
      turnCounter += 1;
      name = `Поворот ${turnCounter}`;
    }

    return {
      lat: sample.latitude,
      lng: sample.longitude,
      name,
      semantic_hint: semanticCandidate?.kind,
      segment_mode: index === 0 ? undefined : "manual",
      segment_duration_minutes: durationMinutes,
    };
  });
}

export function buildTrackedRoutePayload(session: TrackingSession): CreateTrackedRoutePayload {
  const points =
    session.routePoints.length > 0
      ? session.routePoints.map((point) => {
          const normalizedName = point.name?.trim();
          const normalizedNote = point.note?.trim();
          const durationMinutes =
            typeof point.segment_duration_minutes === "number" &&
            Number.isFinite(point.segment_duration_minutes) &&
            point.segment_duration_minutes > 0
              ? Math.round(point.segment_duration_minutes)
              : undefined;

          return {
            lat: point.lat,
            lng: point.lng,
            name: normalizedName ? normalizedName : undefined,
            note: normalizedNote ? normalizedNote : undefined,
            marker_color: point.marker_color
              ? normalizePointMarkerColor(point.marker_color)
              : undefined,
            marker_size: point.marker_size
              ? clampPointMarkerSize(point.marker_size)
              : undefined,
            preview_size: point.photo ? clampPhotoPreviewSize(point.preview_size) : undefined,
            preview_shape: point.photo
              ? normalizePhotoPreviewShape(point.preview_shape)
              : undefined,
            photo: point.photo,
            segment_mode: point.segment_mode,
            segment_duration_minutes: durationMinutes,
          };
        })
      : buildRoutePointsFromSamples(session.samples);

  return {
    name: session.name.trim() || buildDefaultRouteName(session.startedAt),
    points,
    category_ids: session.categoryIds,
    seasons: session.seasons,
    line_color: normalizeRouteLineColor(session.lineColor),
    started_at: session.routeStartedAt ?? session.startedAt,
  };
}

export function buildTrackedRouteUpdatePayload(
  session: TrackingSession,
): UpdateTrackedRoutePayload {
  return buildTrackedRoutePayload(session);
}

export function buildTrackingSyncFingerprint(session: TrackingSession) {
  return JSON.stringify({
    payload: buildTrackedRoutePayload(session),
    serverRouteId: session.serverRouteId ?? null,
    samples: session.samples.map((sample) => ({
      latitude: Number(sample.latitude.toFixed(6)),
      longitude: Number(sample.longitude.toFixed(6)),
      recordedAt: sample.recordedAt,
    })),
  });
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
