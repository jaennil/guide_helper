import { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import "../App.css";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { routesApi } from "../api/routes";

type RouteMode = "auto" | "manual";

const TILE_PROVIDERS = [
  { id: "osm", name: "OpenStreetMap", url: "/api/v1/tile/{z}/{x}/{y}", attribution: "&copy; OpenStreetMap" },
  { id: "yandex", name: "Yandex", url: "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU", attribution: "&copy; Yandex" },
  { id: "2gis", name: "2GIS", url: "https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", attribution: "&copy; 2GIS" },
  { id: "opentopomap", name: "OpenTopoMap", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap" },
];

interface RoutePoint {
  id: number;
  position: [number, number];
  photo?: string;
}

interface RouteSegment {
  fromIndex: number;
  toIndex: number;
  mode: RouteMode;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      const { lat, lng } = e.latlng;
      onMapClick(lat, lng);
    },
  });
  return null;
}

interface RoutingControlData {
  control: L.Routing.Control;
  fromIndex: number;
  toIndex: number;
}

function RoutingControl({
  waypoints,
  routeSegments,
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
}) {
  const map = useMapEvents({});
  const routingControlsRef = useRef<Map<string, RoutingControlData>>(new Map());

  useEffect(() => {
    if (waypoints.length < 2) {
      routingControlsRef.current.forEach((data) => {
        map.removeControl(data.control);
      });
      routingControlsRef.current.clear();
      return;
    }

    routeSegments.forEach((segment) => {
      if (segment.mode === "auto") {
        const key = `${segment.fromIndex}-${segment.toIndex}`;

        if (routingControlsRef.current.has(key)) {
          return;
        }

        const fromPoint = waypoints[segment.fromIndex];
        const toPoint = waypoints[segment.toIndex];

        if (fromPoint && toPoint) {
          const plan = new (L.Routing as any).Plan([fromPoint, toPoint], {
            createMarker: () => false,
          });
          const routingControl = L.Routing.control({
            plan,
            routeWhileDragging: false,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: false,
            showAlternatives: false,
            router: L.Routing.osrmv1({
              serviceUrl: "https://router.project-osrm.org/route/v1",
              profile: "foot",
            }),
          } as any).addTo(map);

          routingControlsRef.current.set(key, {
            control: routingControl,
            fromIndex: segment.fromIndex,
            toIndex: segment.toIndex,
          });

          setTimeout(() => {
            const container = map.getContainer();
            const routingContainers = container.querySelectorAll(
              ".leaflet-routing-container"
            );
            routingContainers.forEach((container) => {
              (container as HTMLElement).style.display = "none";
            });
          }, 100);
        }
      }
    });

    routingControlsRef.current.forEach((data, key) => {
      const exists = routeSegments.some(
        (segment) =>
          segment.mode === "auto" &&
          segment.fromIndex === data.fromIndex &&
          segment.toIndex === data.toIndex
      );
      if (!exists) {
        map.removeControl(data.control);
        routingControlsRef.current.delete(key);
      }
    });
  }, [waypoints, routeSegments, map]);

  useEffect(() => {
    const container = map.getContainer();
    const routingContainers = container.querySelectorAll(
      ".leaflet-routing-container"
    );
    routingContainers.forEach((container) => {
      (container as HTMLElement).style.display = "none";
    });
  }, [routeSegments, map]);

  useEffect(() => {
    return () => {
      routingControlsRef.current.forEach((data) => {
        try {
          map.removeControl(data.control);
        } catch (e) {
        }
      });
      routingControlsRef.current.clear();
    };
  }, [map]);

  return null;
}

function ManualRoutes({
  waypoints,
  routeSegments,
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
}) {
  const routes: [number, number][][] = [];
  routeSegments.forEach((segment) => {
    if (segment.mode === "manual") {
      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      if (fromPoint && toPoint) {
        routes.push([
          [fromPoint.lat, fromPoint.lng],
          [toPoint.lat, toPoint.lng],
        ]);
      }
    }
  });

  return (
    <>
      {routes.map((route, index) => (
        <Polyline
          key={index}
          positions={route}
          color="#3388ff"
          weight={4}
          opacity={0.7}
        />
      ))}
    </>
  );
}

function createMarkerIcon(photo?: string): L.Icon | L.DivIcon {
  if (photo) {
    return L.divIcon({
      className: "custom-photo-marker",
      html: `<div class="photo-marker-container"><img src="${photo}" alt="Marker" /></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40],
    });
  } else {
    return L.icon({
      iconUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      iconRetinaUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });
  }
}

function PointPopup({
  point,
  index,
  onPhotoChange,
}: {
  point: RoutePoint;
  index: number;
  onPhotoChange: (pointId: number, photo: string | undefined) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert(t("map.selectImageFile"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === "string") {
          onPhotoChange(point.id, result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = () => {
    onPhotoChange(point.id, undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="point-popup">
      <div className="point-popup-header">
        <strong>{t("map.point", { index: index + 1 })}</strong>
      </div>
      <div className="point-popup-coords">
        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
        {point.position[1].toFixed(6)}
      </div>
      {point.photo && (
        <div className="point-popup-photo">
          <img src={point.photo} alt={t("map.point", { index: index + 1 })} />
          <button
            type="button"
            onClick={handleRemovePhoto}
            className="remove-photo-btn"
          >
            {t("map.removePhoto")}
          </button>
        </div>
      )}
      <div className="point-popup-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: "none" }}
          id={`photo-input-${point.id}`}
        />
        <label htmlFor={`photo-input-${point.id}`} className="upload-photo-btn">
          {point.photo ? t("map.changePhoto") : t("map.attachPhoto")}
        </label>
      </div>
    </div>
  );
}

export function MapPage() {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeMode, setRouteMode] = useState<RouteMode>("auto");
  const [tileProvider, setTileProvider] = useState(() => localStorage.getItem("tileProvider") || "osm");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const pointIdRef = useRef(0);

  const { logout, user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Load route if route ID is in URL
  useEffect(() => {
    const routeId = searchParams.get("route");
    if (routeId) {
      loadRoute(routeId);
    }
  }, [searchParams]);

  const loadRoute = async (routeId: string) => {
    try {
      const route = await routesApi.getRoute(routeId);
      const loadedPoints: RoutePoint[] = route.points.map((p, index) => ({
        id: index,
        position: [p.lat, p.lng] as [number, number],
        photo: p.photo,
      }));
      setRoutePoints(loadedPoints);
      pointIdRef.current = loadedPoints.length;

      // Create segments for loaded points, restoring saved mode
      const segments: RouteSegment[] = [];
      for (let i = 0; i < loadedPoints.length - 1; i++) {
        // segment_mode is stored on the destination point
        const destPoint = route.points[i + 1];
        segments.push({
          fromIndex: i,
          toIndex: i + 1,
          mode: (destPoint.segment_mode as RouteMode) || "manual",
        });
      }
      setRouteSegments(segments);
    } catch (error) {
      console.error("Failed to load route:", error);
    }
  };

  const handleSaveRoute = async () => {
    if (!routeName.trim()) {
      setSaveError(t("map.pleaseEnterRouteName"));
      return;
    }

    if (routePoints.length < 2) {
      setSaveError(t("map.routeMinPoints"));
      return;
    }

    setSaveLoading(true);
    setSaveError("");

    try {
      // Save points with segment mode info and photos
      const pointsToSave = routePoints.map((p, index) => {
        // Find segment that ends at this point
        const segment = routeSegments.find(s => s.toIndex === index);
        return {
          lat: p.position[0],
          lng: p.position[1],
          name: undefined,
          segment_mode: segment?.mode as 'auto' | 'manual' | undefined,
          photo: p.photo,
        };
      });

      await routesApi.createRoute({
        name: routeName.trim(),
        points: pointsToSave,
      });
      setShowSaveModal(false);
      setRouteName("");
      alert(t("map.routeSaved"));
    } catch (err: any) {
      setSaveError(err.response?.data || t("map.saveFailed"));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearRoute = () => {
    if (routePoints.length > 0 && !confirm(t("map.clearAllPoints"))) {
      return;
    }
    setRoutePoints([]);
    setRouteSegments([]);
    pointIdRef.current = 0;
  };

  const handleMapClick = (lat: number, lng: number) => {
    const newPoint: RoutePoint = {
      id: pointIdRef.current++,
      position: [lat, lng],
    };
    setRoutePoints((prev) => {
      const newPoints = [...prev, newPoint];

      if (prev.length > 0) {
        const newSegment: RouteSegment = {
          fromIndex: prev.length - 1,
          toIndex: newPoints.length - 1,
          mode: routeMode,
        };
        setRouteSegments((prevSegments) => [...prevSegments, newSegment]);
      }

      return newPoints;
    });
  };

  const handlePhotoChange = (pointId: number, photo: string | undefined) => {
    setRoutePoints((prev) =>
      prev.map((point) => (point.id === pointId ? { ...point, photo } : point))
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleTileProviderChange = (providerId: string) => {
    setTileProvider(providerId);
    localStorage.setItem("tileProvider", providerId);
  };

  const currentProvider = TILE_PROVIDERS.find((p) => p.id === tileProvider) || TILE_PROVIDERS[0];

  const waypoints = routePoints.map((point) =>
    L.latLng(point.position[0], point.position[1])
  );

  return (
    <div className="App">
      <div className="map-header">
        <div className="mode-switcher">
          <label>
            <input
              type="radio"
              name="routeMode"
              value="auto"
              checked={routeMode === "auto"}
              onChange={(e) => setRouteMode(e.target.value as RouteMode)}
            />
            {t("map.modeAuto")}
          </label>
          <label>
            <input
              type="radio"
              name="routeMode"
              value="manual"
              checked={routeMode === "manual"}
              onChange={(e) => setRouteMode(e.target.value as RouteMode)}
            />
            {t("map.modeManual")}
          </label>
        </div>
        <div className="tile-switcher">
          <select
            value={tileProvider}
            onChange={(e) => handleTileProviderChange(e.target.value)}
          >
            {TILE_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          {routePoints.length >= 2 && (
            <button onClick={() => setShowSaveModal(true)} className="save-btn">
              {t("map.saveRoute")}
            </button>
          )}
          {routePoints.length > 0 && (
            <button onClick={handleClearRoute} className="clear-btn">
              {t("map.clear")}
            </button>
          )}
          <button onClick={() => navigate("/profile")} className="profile-btn">
            {user?.name || user?.email || t("map.profile")}
          </button>
          <button onClick={handleLogout} className="logout-btn">
            {t("map.logout")}
          </button>
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{t("map.saveRouteTitle")}</h2>
            <div className="modal-form">
              <input
                type="text"
                placeholder={t("map.enterRouteName")}
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                autoFocus
              />
              {saveError && <div className="modal-error">{saveError}</div>}
              <div className="modal-actions">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="modal-cancel"
                >
                  {t("map.cancel")}
                </button>
                <button
                  onClick={handleSaveRoute}
                  disabled={saveLoading}
                  className="modal-save"
                >
                  {saveLoading ? t("map.saving") : t("map.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <MapContainer
        center={[55.7518, 37.6178]}
        zoom={15}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          key={tileProvider}
          url={currentProvider.url}
          attribution={currentProvider.attribution}
        />
        <MapClickHandler onMapClick={handleMapClick} />
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker
            key={`${point.id}-${point.photo ? "photo" : "no-photo"}`}
            position={point.position}
            icon={createMarkerIcon(point.photo)}
          >
            <Popup>
              <PointPopup
                point={point}
                index={index}
                onPhotoChange={handlePhotoChange}
              />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
