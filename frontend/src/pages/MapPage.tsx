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
import { useNavigate, useSearchParams } from "react-router-dom";
import { routesApi } from "../api/routes";

type RouteMode = "auto" | "manual";

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
          const routingControl = L.Routing.control({
            waypoints: [fromPoint, toPoint],
            routeWhileDragging: false,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: false,
            showAlternatives: false,
            router: L.Routing.osrmv1({
              serviceUrl: "https://router.project-osrm.org/route/v1",
              profile: "foot",
            }),
          }).addTo(map);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Пожалуйста, выберите файл изображения");
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
        <strong>Точка {index + 1}</strong>
      </div>
      <div className="point-popup-coords">
        Координаты: {point.position[0].toFixed(6)},{" "}
        {point.position[1].toFixed(6)}
      </div>
      {point.photo && (
        <div className="point-popup-photo">
          <img src={point.photo} alt={`Точка ${index + 1}`} />
          <button
            type="button"
            onClick={handleRemovePhoto}
            className="remove-photo-btn"
          >
            Удалить фото
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
          {point.photo ? "Изменить фото" : "Прикрепить фото"}
        </label>
      </div>
    </div>
  );
}

export function MapPage() {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeMode, setRouteMode] = useState<RouteMode>("auto");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const pointIdRef = useRef(0);

  const { logout, user } = useAuth();
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
      setSaveError("Please enter a route name");
      return;
    }

    if (routePoints.length < 2) {
      setSaveError("Route must have at least 2 points");
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
      alert("Route saved successfully!");
    } catch (err: any) {
      setSaveError(err.response?.data || "Failed to save route");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearRoute = () => {
    if (routePoints.length > 0 && !confirm("Clear all points?")) {
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
            Auto (маршрут по дорогам)
          </label>
          <label>
            <input
              type="radio"
              name="routeMode"
              value="manual"
              checked={routeMode === "manual"}
              onChange={(e) => setRouteMode(e.target.value as RouteMode)}
            />
            Manual (прямая линия)
          </label>
        </div>
        <div className="header-actions">
          {routePoints.length >= 2 && (
            <button onClick={() => setShowSaveModal(true)} className="save-btn">
              Save Route
            </button>
          )}
          {routePoints.length > 0 && (
            <button onClick={handleClearRoute} className="clear-btn">
              Clear
            </button>
          )}
          <button onClick={() => navigate("/profile")} className="profile-btn">
            {user?.name || user?.email || "Profile"}
          </button>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Save Route</h2>
            <div className="modal-form">
              <input
                type="text"
                placeholder="Enter route name"
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
                  Cancel
                </button>
                <button
                  onClick={handleSaveRoute}
                  disabled={saveLoading}
                  className="modal-save"
                >
                  {saveLoading ? "Saving..." : "Save"}
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
          url="/api/v1/tile/{z}/{x}/{y}"
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
