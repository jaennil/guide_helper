export type RoutingEngineId = 'osrm-foot' | 'osrm-car' | 'graphhopper' | 'valhalla';

export interface RoutingEngine {
  id: RoutingEngineId;
  label: string;
  labelKey: string;
  type: 'foot' | 'car';
}

export const ROUTING_ENGINES: RoutingEngine[] = [
  { id: 'graphhopper', label: '🚶 Walking', labelKey: 'routing.walking', type: 'foot' },
  { id: 'osrm-foot', label: '🚶 Walking (OSRM)', labelKey: 'routing.walkingOsrm', type: 'foot' },
  { id: 'valhalla', label: '🚶 Walking (Valhalla)', labelKey: 'routing.walkingValhalla', type: 'foot' },
  { id: 'osrm-car', label: '🚗 Driving', labelKey: 'routing.driving', type: 'car' },
];

export const DEFAULT_ENGINE: RoutingEngineId = 'graphhopper';

/**
 * Fetch a route segment from the selected engine.
 * Returns array of [lat, lng] tuples.
 */
export async function fetchRoute(
  engineId: RoutingEngineId,
  from: [number, number],
  to: [number, number]
): Promise<[number, number][]> {
  try {
    switch (engineId) {
      case 'osrm-foot':
        return await fetchOsrmRoute(
          'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
          from, to
        );
      case 'osrm-car':
        return await fetchOsrmRoute(
          'https://router.project-osrm.org/route/v1/driving',
          from, to
        );
      case 'graphhopper':
        return await fetchGraphHopperRoute(from, to);
      case 'valhalla':
        return await fetchValhallaRoute(from, to);
      default:
        return await fetchOsrmRoute(
          'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
          from, to
        );
    }
  } catch (err) {
    console.error(`[routing] ${engineId} failed:`, err);
    return [from, to];
  }
}

async function fetchOsrmRoute(
  baseUrl: string,
  from: [number, number],
  to: [number, number]
): Promise<[number, number][]> {
  const url = `${baseUrl}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  console.log(`[routing] OSRM fetch: ${url}`);
  const res = await fetch(url);
  if (!res.ok) return [from, to];
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) return [from, to];
  return data.routes[0].geometry.coordinates.map(
    (c: [number, number]) => [c[1], c[0]] as [number, number]
  );
}

async function fetchGraphHopperRoute(
  from: [number, number],
  to: [number, number]
): Promise<[number, number][]> {
  const key = import.meta.env.VITE_GRAPHHOPPER_API_KEY;
  if (!key) {
    console.warn('[routing] GraphHopper API key not set, falling back to OSRM');
    return fetchOsrmRoute(
      'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
      from, to
    );
  }
  const url = `https://graphhopper.com/api/1/route?point=${from[0]},${from[1]}&point=${to[0]},${to[1]}&vehicle=foot&locale=ru&calc_points=true&points_encoded=false&key=${key}`;
  console.log('[routing] GraphHopper fetch');
  const res = await fetch(url);
  if (!res.ok) return [from, to];
  const data = await res.json();
  if (!data.paths?.[0]?.points?.coordinates) return [from, to];
  return data.paths[0].points.coordinates.map(
    (c: [number, number]) => [c[1], c[0]] as [number, number]
  );
}

async function fetchValhallaRoute(
  from: [number, number],
  to: [number, number]
): Promise<[number, number][]> {
  const body = JSON.stringify({
    locations: [
      { lat: from[0], lon: from[1] },
      { lat: to[0], lon: to[1] },
    ],
    costing: 'pedestrian',
    units: 'km',
    shape_match: 'map_snap',
  });
  console.log('[routing] Valhalla fetch');
  const res = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(body)}`);
  if (!res.ok) return [from, to];
  const data = await res.json();
  const shape = data.trip?.legs?.[0]?.shape;
  if (!shape) return [from, to];
  // Valhalla returns encoded polyline, decode it
  return decodePolyline(shape);
}

/** Decode Google-style encoded polyline */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e6, lng / 1e6]);
  }
  return points;
}
