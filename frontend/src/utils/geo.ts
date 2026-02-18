export interface GeoPoint {
  lat: number;
  lng: number;
}

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

/**
 * Estimate walking time in minutes (Naismith's rule).
 * Base: 5 km/h + 1 hour per 600m elevation gain.
 */
export function estimateWalkingTime(
  distanceKm: number,
  elevationGainM: number
): number {
  const baseMinutes = (distanceKm / 5) * 60;
  const climbMinutes = (elevationGainM / 600) * 60;
  return baseMinutes + climbMinutes;
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

/**
 * Classify route difficulty based on distance and elevation gain.
 * Uses configurable thresholds with sensible defaults.
 */
export function classifyDifficulty(
  distanceKm: number,
  elevationGainM: number,
  thresholds: DifficultyThresholds = DEFAULT_THRESHOLDS
): DifficultyLevel {
  const distScore =
    distanceKm < thresholds.distance_easy_max_km ? 1 :
    distanceKm < thresholds.distance_moderate_max_km ? 2 : 3;
  const elevScore =
    elevationGainM < thresholds.elevation_easy_max_m ? 1 :
    elevationGainM < thresholds.elevation_moderate_max_m ? 2 : 3;
  const total = distScore + elevScore;
  if (total <= thresholds.score_easy_max) return "easy";
  if (total <= thresholds.score_moderate_max) return "moderate";
  return "hard";
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
