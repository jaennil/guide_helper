import type { RouteSegment, RoutePoint } from '../pages/MapPage';

export interface PathResult {
  /** Full detailed path as [lat, lng] tuples */
  fullPath: [number, number][];
  /** For each original RoutePoint, the closest index in fullPath */
  pointIndices: number[];
}

/**
 * Interpolate N evenly-spaced points along a straight line between two coords.
 */
function interpolateLine(
  from: [number, number],
  to: [number, number],
  count: number
): [number, number][] {
  const result: [number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    result.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ]);
  }
  return result;
}

/**
 * Fetch a detailed path from OSRM for a foot routing segment.
 * Returns array of [lat, lng] tuples.
 */
async function fetchOsrmSegment(
  from: [number, number],
  to: [number, number]
): Promise<[number, number][]> {
  const url = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  console.log('[routePath] fetching OSRM segment');

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[routePath] OSRM returned ${res.status}, falling back to straight line`);
      return interpolateLine(from, to, 20);
    }

    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
      console.warn('[routePath] OSRM returned no route, falling back to straight line');
      return interpolateLine(from, to, 20);
    }

    // GeoJSON coordinates are [lng, lat], we need [lat, lng]
    const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]] as [number, number]
    );

    console.log(`[routePath] OSRM returned ${coords.length} points`);
    return coords;
  } catch (err) {
    console.error('[routePath] OSRM fetch failed:', err);
    return interpolateLine(from, to, 20);
  }
}

/**
 * Find the index of the closest point in `path` to the given `target`.
 */
function findClosestIndex(path: [number, number][], target: [number, number]): number {
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < path.length; i++) {
    const dlat = path[i][0] - target[0];
    const dlng = path[i][1] - target[1];
    const dist = dlat * dlat + dlng * dlng;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Build a detailed path for playback from route points and segments.
 * - "auto" segments get detailed paths from OSRM
 * - "manual" segments get interpolated straight lines
 *
 * Returns the full path and a mapping of original point indices to path positions.
 */
export async function fetchDetailedPath(
  points: RoutePoint[],
  segments: RouteSegment[]
): Promise<PathResult> {
  if (points.length === 0) {
    return { fullPath: [], pointIndices: [] };
  }

  if (points.length === 1) {
    return {
      fullPath: [points[0].position],
      pointIndices: [0],
    };
  }

  console.log(`[routePath] building detailed path for ${points.length} points, ${segments.length} segments`);

  const fullPath: [number, number][] = [];

  for (const segment of segments) {
    const from = points[segment.fromIndex];
    const to = points[segment.toIndex];
    if (!from || !to) continue;

    let segmentPath: [number, number][];

    if (segment.mode === 'auto') {
      segmentPath = await fetchOsrmSegment(from.position, to.position);
    } else {
      segmentPath = interpolateLine(from.position, to.position, 20);
    }

    // Avoid duplicating the junction point between segments
    if (fullPath.length > 0 && segmentPath.length > 0) {
      segmentPath = segmentPath.slice(1);
    }

    fullPath.push(...segmentPath);
  }

  // If fullPath is empty (e.g. no segments), build from points directly
  if (fullPath.length === 0) {
    for (const point of points) {
      fullPath.push(point.position);
    }
  }

  // Map each original point to its closest index in the full path
  const pointIndices = points.map((p) => findClosestIndex(fullPath, p.position));

  console.log(`[routePath] detailed path: ${fullPath.length} points, mapped ${pointIndices.length} original points`);

  return { fullPath, pointIndices };
}

/**
 * Compute the cumulative arc-length distances along a path, in km.
 * Uses simple Euclidean approximation for performance (good enough for animation).
 */
export function pathCumulativeDistances(path: [number, number][]): number[] {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const result = [0];
  for (let i = 1; i < path.length; i++) {
    const dLat = toRad(path[i][0] - path[i - 1][0]);
    const dLng = toRad(path[i][1] - path[i - 1][1]);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(path[i - 1][0])) *
        Math.cos(toRad(path[i][0])) *
        Math.sin(dLng / 2) ** 2;
    const d = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    result.push(result[i - 1] + d);
  }
  return result;
}

/**
 * Given a progress value (0-1) and cumulative distances,
 * return the interpolated position and segment index.
 */
export function interpolatePosition(
  path: [number, number][],
  cumDist: number[],
  progress: number
): { position: [number, number]; segIndex: number; heading: number } {
  if (path.length === 0) {
    return { position: [0, 0], segIndex: 0, heading: 0 };
  }

  const totalDist = cumDist[cumDist.length - 1];
  const targetDist = progress * totalDist;

  // Find the segment containing targetDist
  let segIndex = 0;
  for (let i = 1; i < cumDist.length; i++) {
    if (cumDist[i] >= targetDist) {
      segIndex = i - 1;
      break;
    }
    segIndex = i - 1;
  }

  // Clamp to valid range
  if (segIndex >= path.length - 1) {
    const lastIdx = path.length - 1;
    const prevIdx = Math.max(0, lastIdx - 1);
    const heading = Math.atan2(
      path[lastIdx][1] - path[prevIdx][1],
      path[lastIdx][0] - path[prevIdx][0]
    ) * (180 / Math.PI);
    return { position: path[lastIdx], segIndex: lastIdx, heading };
  }

  // Interpolate within the segment
  const segStart = cumDist[segIndex];
  const segEnd = cumDist[segIndex + 1];
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (targetDist - segStart) / segLen : 0;

  const lat = path[segIndex][0] + (path[segIndex + 1][0] - path[segIndex][0]) * t;
  const lng = path[segIndex][1] + (path[segIndex + 1][1] - path[segIndex][1]) * t;

  const heading = Math.atan2(
    path[segIndex + 1][1] - path[segIndex][1],
    path[segIndex + 1][0] - path[segIndex][0]
  ) * (180 / Math.PI);

  return { position: [lat, lng], segIndex, heading };
}
