import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import { useParams } from "react-router-dom";
import { routesApi } from "../api/routes";
import {
  RoutingControl,
  ManualRoutes,
  createMarkerIcon,
  getPhotoSrc,
  type RoutePoint,
  type RouteSegment,
} from "./MapPage";

type RouteMode = "auto" | "manual";

export function EmbedMapPage() {
  const { token } = useParams<{ token: string }>();
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeName, setRouteName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    routesApi.getSharedRoute(token).then((route) => {
      setRouteName(route.name);
      const loadedPoints: RoutePoint[] = route.points.map((p, index) => ({
        id: index,
        position: [p.lat, p.lng] as [number, number],
        photo: p.photo,
      }));
      setRoutePoints(loadedPoints);

      const segments: RouteSegment[] = [];
      for (let i = 0; i < loadedPoints.length - 1; i++) {
        const destPoint = route.points[i + 1];
        segments.push({
          fromIndex: i,
          toIndex: i + 1,
          mode: (destPoint.segment_mode as RouteMode) || "manual",
        });
      }
      setRouteSegments(segments);
    }).catch(() => {
      setError("Route not found");
    }).finally(() => {
      setLoading(false);
    });
  }, [token]);

  const waypoints = routePoints.map((p) => L.latLng(p.position[0], p.position[1]));

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a2e", color: "#fff" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a2e", color: "#fff" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div style={{
        position: "absolute", top: 8, left: 8, zIndex: 1000,
        background: "rgba(0,0,0,0.6)", color: "#fff",
        padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 600,
        maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {routeName}
      </div>
      <MapContainer
        center={routePoints.length > 0 ? routePoints[0].position : [55.7518, 37.6178]}
        zoom={13}
        style={{ height: "100vh", width: "100%" }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU" />
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker
            key={point.id}
            position={point.position}
            icon={createMarkerIcon(point.photo)}
          >
            <Popup>
              <div>
                <strong>Point {index + 1}</strong>
                <br />
                {point.position[0].toFixed(6)}, {point.position[1].toFixed(6)}
                {getPhotoSrc(point.photo) && (
                  <div style={{ marginTop: 4 }}>
                    <img src={point.photo?.original || getPhotoSrc(point.photo)} alt="" style={{ maxWidth: 120 }} />
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
