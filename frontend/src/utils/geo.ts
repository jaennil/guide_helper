export interface GeoPoint {
  lat: number;
  lng: number;
}

export type RouteSegmentMode = "auto" | "manual";
export type RouteActivity = "walking" | "hiking" | "cycling";
export type RouteSurface = "roads" | "mixed" | "trail";

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two points in km */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Total route distance in km */
export function totalDistance(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return total;
}

/** Fetch elevations from Open-Meteo API, batching by 100 points */
export async function fetchElevations(points: GeoPoint[]): Promise<number[]> {
  if (points.length === 0) return [];

  const CHUNK_SIZE = 100;
  const elevations: number[] = [];

  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    const chunk = points.slice(i, i + CHUNK_SIZE);
    const lats = chunk.map((p) => p.lat.toFixed(6)).join(",");
    const lngs = chunk.map((p) => p.lng.toFixed(6)).join(",");

    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    console.log(`[geo] fetching elevations for ${chunk.length} points (batch ${Math.floor(i / CHUNK_SIZE) + 1})`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Elevation API error: ${res.status}`);
    }
    const data = await res.json();
    elevations.push(...data.elevation);
  }

  console.log(`[geo] fetched ${elevations.length} elevations`);
  return elevations;
}

/** Sum of positive elevation changes (ascent only) in meters */
export function elevationGain(elevations: number[]): number {
  let gain = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) gain += diff;
  }
  return gain;
}

export type DifficultyLevel = "easy" | "moderate" | "hard";

export interface DifficultyThresholds {
  distance_easy_max_km: number;
  distance_moderate_max_km: number;
  elevation_easy_max_m: number;
  elevation_moderate_max_m: number;
  score_easy_max: number;
  score_moderate_max: number;
}

const DEFAULT_THRESHOLDS: DifficultyThresholds = {
  distance_easy_max_km: 5,
  distance_moderate_max_km: 15,
  elevation_easy_max_m: 300,
  elevation_moderate_max_m: 800,
  score_easy_max: 3,
  score_moderate_max: 4,
};

export interface DifficultyAssessment {
  level: DifficultyLevel;
  activity: RouteActivity;
  surface: RouteSurface;
  score: number;
  metrics: {
    distanceKm: number;
    elevationGainM: number;
    maxPositiveGradePct: number;
    steepSectionShare: number;
    manualShare: number;
  };
}

interface ActivityDifficultyProfile {
  distanceEasyKm: number;
  distanceModerateKm: number;
  elevationEasyM: number;
  elevationModerateM: number;
  gradeEasyPct: number;
  gradeModeratePct: number;
  steepShareEasyMax: number;
  steepShareModerateMax: number;
  manualShareEasyMax: number;
  manualShareModerateMax: number;
  easyScoreMax: number;
  moderateScoreMax: number;
}

interface PositiveGradeSample {
  distanceKm: number;
  gradePct: number;
}

function band(value: number, easyMax: number, moderateMax: number): 0 | 1 | 2 {
  if (value <= easyMax) return 0;
  if (value <= moderateMax) return 1;
  return 2;
}

function buildActivityProfile(
  activity: RouteActivity,
  thresholds: DifficultyThresholds,
): ActivityDifficultyProfile {
  switch (activity) {
    case "cycling":
      return {
        distanceEasyKm: thresholds.distance_easy_max_km * 5,
        distanceModerateKm: thresholds.distance_moderate_max_km * 4.7,
        elevationEasyM: thresholds.elevation_easy_max_m * 0.85,
        elevationModerateM: thresholds.elevation_moderate_max_m,
        gradeEasyPct: 3.5,
        gradeModeratePct: 6.5,
        steepShareEasyMax: 0.03,
        steepShareModerateMax: 0.1,
        manualShareEasyMax: 0.1,
        manualShareModerateMax: 0.35,
        easyScoreMax: Math.max(1, thresholds.score_easy_max - 2),
        moderateScoreMax: thresholds.score_moderate_max + 1,
      };
    case "hiking":
      return {
        distanceEasyKm: thresholds.distance_easy_max_km * 1.6,
        distanceModerateKm: thresholds.distance_moderate_max_km * 1.45,
        elevationEasyM: thresholds.elevation_easy_max_m * 1.35,
        elevationModerateM: thresholds.elevation_moderate_max_m * 1.4,
        gradeEasyPct: 8,
        gradeModeratePct: 14,
        steepShareEasyMax: 0.06,
        steepShareModerateMax: 0.2,
        manualShareEasyMax: 0.55,
        manualShareModerateMax: 0.85,
        easyScoreMax: Math.max(0, thresholds.score_easy_max - 3),
        moderateScoreMax: thresholds.score_moderate_max + 1,
      };
    case "walking":
    default:
      return {
        distanceEasyKm: thresholds.distance_easy_max_km,
        distanceModerateKm: thresholds.distance_moderate_max_km,
        elevationEasyM: thresholds.elevation_easy_max_m,
        elevationModerateM: thresholds.elevation_moderate_max_m,
        gradeEasyPct: 6,
        gradeModeratePct: 10,
        steepShareEasyMax: 0.04,
        steepShareModerateMax: 0.14,
        manualShareEasyMax: 0.25,
        manualShareModerateMax: 0.65,
        easyScoreMax: Math.max(0, thresholds.score_easy_max - 3),
        moderateScoreMax: thresholds.score_moderate_max,
      };
  }
}

function normalizedCategoryNames(categoryNames: string[]): string[] {
  return categoryNames
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function hasCategoryHint(names: string[], hints: string[]): boolean {
  return names.some((name) => hints.some((hint) => name.includes(hint)));
}

export function inferRouteSurface(segmentModes: RouteSegmentMode[] = []): RouteSurface {
  if (segmentModes.length === 0) return "mixed";
  const manualCount = segmentModes.filter((mode) => mode === "manual").length;
  const manualShare = manualCount / segmentModes.length;

  if (manualShare <= 0.2) return "roads";
  if (manualShare <= 0.65) return "mixed";
  return "trail";
}

export function inferRouteActivity(
  categoryNames: string[] = [],
  segmentModes: RouteSegmentMode[] = [],
): RouteActivity {
  const names = normalizedCategoryNames(categoryNames);

  if (hasCategoryHint(names, ["cycling", "bicycle", "bike", "velo", "вел", "вело"])) {
    return "cycling";
  }

  if (hasCategoryHint(names, ["hiking", "trek", "trail", "mount", "поход", "пеш", "трек", "гор"])) {
    return "hiking";
  }

  if (hasCategoryHint(names, ["walking", "urban", "historical", "city", "walk", "прогул", "истор", "экскурс", "город"])) {
    return "walking";
  }

  return inferRouteSurface(segmentModes) === "trail" ? "hiking" : "walking";
}

function positiveGradeSamples(points: GeoPoint[], elevations: number[]): PositiveGradeSample[] {
  const limit = Math.min(points.length, elevations.length);
  const samples: PositiveGradeSample[] = [];

  for (let i = 1; i < limit; i++) {
    const distanceKm = haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    );
    if (distanceKm < 0.03) continue;

    const riseM = elevations[i] - elevations[i - 1];
    if (riseM <= 0) continue;

    samples.push({
      distanceKm,
      gradePct: Math.min((riseM / (distanceKm * 1000)) * 100, 35),
    });
  }

  return samples;
}

export function downsampleRoutePoints(
  points: GeoPoint[],
  maxPoints = 240,
  minSpacingMeters = 30,
): GeoPoint[] {
  if (points.length <= 2) return points;

  const minSpacingKm = minSpacingMeters / 1000;
  const filtered: GeoPoint[] = [points[0]];
  let lastKept = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const distanceKm = haversineDistance(
      lastKept.lat,
      lastKept.lng,
      point.lat,
      point.lng,
    );
    if (distanceKm >= minSpacingKm) {
      filtered.push(point);
      lastKept = point;
    }
  }

  filtered.push(points[points.length - 1]);

  if (filtered.length <= maxPoints) {
    return filtered;
  }

  const result: GeoPoint[] = [filtered[0]];
  const step = (filtered.length - 1) / (maxPoints - 1);
  let lastIndex = 0;

  for (let i = 1; i < maxPoints - 1; i++) {
    const rawIndex = Math.round(i * step);
    const index = Math.min(filtered.length - 2, Math.max(lastIndex + 1, rawIndex));
    result.push(filtered[index]);
    lastIndex = index;
  }

  result.push(filtered[filtered.length - 1]);
  return result;
}

export function estimateRouteTime(
  distanceKm: number,
  elevationGainM: number,
  activity: RouteActivity,
  surface: RouteSurface,
): number {
  let speedKmh = 5;
  let climbMetersPerHour = 600;

  if (activity === "cycling") {
    speedKmh = surface === "roads" ? 18 : surface === "mixed" ? 15 : 12;
    climbMetersPerHour = surface === "roads" ? 900 : surface === "mixed" ? 700 : 550;
  } else if (activity === "hiking") {
    speedKmh = surface === "roads" ? 4.7 : surface === "mixed" ? 4.2 : 3.8;
    climbMetersPerHour = surface === "roads" ? 600 : surface === "mixed" ? 500 : 450;
  } else {
    speedKmh = surface === "roads" ? 5.2 : surface === "mixed" ? 4.8 : 4.3;
    climbMetersPerHour = surface === "roads" ? 700 : surface === "mixed" ? 600 : 500;
  }

  const baseMinutes = (distanceKm / speedKmh) * 60;
  const climbMinutes = (elevationGainM / climbMetersPerHour) * 60;
  return baseMinutes + climbMinutes;
}

export function assessDifficulty(
  points: GeoPoint[],
  elevations: number[],
  thresholds: DifficultyThresholds = DEFAULT_THRESHOLDS,
  segmentModes: RouteSegmentMode[] = [],
  categoryNames: string[] = [],
): DifficultyAssessment {
  const distanceKm = totalDistance(points);
  const elevationGainM = elevationGain(elevations);
  const manualCount = segmentModes.filter((mode) => mode === "manual").length;
  const manualShare = segmentModes.length > 0 ? manualCount / segmentModes.length : 0;
  const activity = inferRouteActivity(categoryNames, segmentModes);
  const surface = inferRouteSurface(segmentModes);
  const profile = buildActivityProfile(activity, thresholds);
  const gradeSamples = positiveGradeSamples(points, elevations);
  const maxPositiveGradePct = gradeSamples.reduce((max, sample) => Math.max(max, sample.gradePct), 0);
  const steepDistanceKm = gradeSamples
    .filter((sample) => sample.gradePct >= profile.gradeModeratePct)
    .reduce((sum, sample) => sum + sample.distanceKm, 0);
  const steepSectionShare = distanceKm > 0 ? steepDistanceKm / distanceKm : 0;

  const distanceBand = band(distanceKm, profile.distanceEasyKm, profile.distanceModerateKm);
  const elevationBand = band(elevationGainM, profile.elevationEasyM, profile.elevationModerateM);
  const gradeBand = band(maxPositiveGradePct, profile.gradeEasyPct, profile.gradeModeratePct);
  const steepShareBand = band(steepSectionShare, profile.steepShareEasyMax, profile.steepShareModerateMax);
  const surfaceBand = band(manualShare, profile.manualShareEasyMax, profile.manualShareModerateMax);

  let score = distanceBand + elevationBand + gradeBand + steepShareBand + surfaceBand;
  if (distanceBand > 0 && elevationBand > 0) score += 1;
  if (gradeBand === 2 && steepShareBand > 0) score += 1;
  if (activity === "cycling" && surfaceBand > 0) score += 1;
  if (activity === "walking" && surface === "trail") score += 1;

  const level =
    score <= profile.easyScoreMax
      ? "easy"
      : score <= profile.moderateScoreMax
        ? "moderate"
        : "hard";

  return {
    level,
    activity,
    surface,
    score,
    metrics: {
      distanceKm,
      elevationGainM,
      maxPositiveGradePct,
      steepSectionShare,
      manualShare,
    },
  };
}

/** Cumulative distances from start for each point, in km */
export function cumulativeDistances(points: GeoPoint[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) {
    result.push(
      result[i - 1] +
        haversineDistance(
          points[i - 1].lat,
          points[i - 1].lng,
          points[i].lat,
          points[i].lng
        )
    );
  }
  return result;
}

/** Format distance: "1.2 km" or "850 m" */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

/** Format duration: "2h 15min" or "45 min" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}
