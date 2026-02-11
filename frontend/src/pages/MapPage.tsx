import React, { useState, useEffect, useRef, type ChangeEvent } from "react";
import exifr from "exifr";
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
import { routesApi, type PhotoData } from "../api/routes";

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
  photo?: PhotoData;
}

interface RouteSegment {
  fromIndex: number;
  toIndex: number;
  mode: RouteMode;
}

interface OverlayRoute {
  id: string;
  name: string;
  color: string;
  points: RoutePoint[];
  segments: RouteSegment[];
}

const ROUTE_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
];

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
  color = "#3388ff",
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
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
            lineOptions: {
              styles: [{ color, opacity: 0.7, weight: 4 }],
              extendToWaypoints: true,
              missingRouteTolerance: 0,
            },
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
  color = "#3388ff",
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
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
          color={color}
          weight={4}
          opacity={0.7}
        />
      ))}
    </>
  );
}

function getPhotoSrc(photo?: PhotoData): string | undefined {
  if (!photo) return undefined;
  return photo.thumbnail_url || photo.original;
}

function createMarkerIcon(photo?: PhotoData): L.Icon | L.DivIcon {
  const src = getPhotoSrc(photo);
  if (src) {
    return L.divIcon({
      className: "custom-photo-marker",
      html: `<div class="photo-marker-container"><img src="${src}" alt="Marker" /></div>`,
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

function createColoredMarkerIcon(color: string, photo?: PhotoData): L.DivIcon {
  const src = getPhotoSrc(photo);
  if (src) {
    return L.divIcon({
      className: "overlay-marker",
      html: `<div class="photo-marker-container" style="border-color:${color}"><img src="${src}" alt="Marker" /></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40],
    });
  }
  return L.divIcon({
    className: "overlay-marker",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function PointPopup({
  point,
  index,
  onPhotoChange,
}: {
  point: RoutePoint;
  index: number;
  onPhotoChange: (pointId: number, photo: PhotoData | undefined) => void;
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
          onPhotoChange(point.id, { original: result, status: "pending" });
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

  const photoSrc = getPhotoSrc(point.photo);

  return (
    <div className="point-popup">
      <div className="point-popup-header">
        <strong>{t("map.point", { index: index + 1 })}</strong>
      </div>
      <div className="point-popup-coords">
        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
        {point.position[1].toFixed(6)}
      </div>
      {photoSrc && (
        <div className="point-popup-photo">
          <img src={point.photo?.original || photoSrc} alt={t("map.point", { index: index + 1 })} />
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
  const [overlayRoutes, setOverlayRoutes] = useState<OverlayRoute[]>([]);
  const pointIdRef = useRef(0);
  const photoImportRef = useRef<HTMLInputElement>(null);

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

    const routeIds = searchParams.get("routes");
    if (routeIds) {
      const ids = routeIds.split(",").filter(Boolean);
      if (ids.length > 0) {
        loadOverlayRoutes(ids);
      }
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

  const loadOverlayRoutes = async (ids: string[]) => {
    console.log("Loading overlay routes:", ids);
    const results = await Promise.allSettled(
      ids.map((id) => routesApi.getRoute(id))
    );

    const loaded: OverlayRoute[] = [];
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        const route = result.value;
        const points: RoutePoint[] = route.points.map((p, i) => ({
          id: i,
          position: [p.lat, p.lng] as [number, number],
          photo: p.photo,
        }));
        const segments: RouteSegment[] = [];
        for (let i = 0; i < points.length - 1; i++) {
          const destPoint = route.points[i + 1];
          segments.push({
            fromIndex: i,
            toIndex: i + 1,
            mode: (destPoint.segment_mode as RouteMode) || "manual",
          });
        }
        loaded.push({
          id: route.id,
          name: route.name,
          color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
          points,
          segments,
        });
      } else {
        console.error(`Failed to load overlay route ${ids[idx]}:`, result.reason);
      }
    });

    console.log("Loaded overlay routes:", loaded.length);
    setOverlayRoutes(loaded);
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

  const handlePhotoChange = (pointId: number, photo: PhotoData | undefined) => {
    setRoutePoints((prev) =>
      prev.map((point) => (point.id === pointId ? { ...point, photo } : point))
    );
  };

  const handleImportPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    console.log(`[photo-import] starting import of ${files.length} files`);

    interface ParsedPhoto {
      lat: number;
      lng: number;
      base64: string;
      date: Date | null;
    }

    const results = await Promise.allSettled(
      Array.from(files).map(async (file): Promise<ParsedPhoto | null> => {
        try {
          const exifData = await exifr.parse(file, {
            gps: true,
            pick: ["DateTimeOriginal"],
          });

          if (!exifData?.latitude || !exifData?.longitude) {
            console.log(`[photo-import] no GPS data in: ${file.name}`);
            return null;
          }

          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const result = event.target?.result;
              if (typeof result === "string") resolve(result);
              else reject(new Error("Failed to read file as data URL"));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });

          console.log(
            `[photo-import] parsed ${file.name}: lat=${exifData.latitude}, lng=${exifData.longitude}`
          );

          return {
            lat: exifData.latitude,
            lng: exifData.longitude,
            base64,
            date: exifData.DateTimeOriginal
              ? new Date(exifData.DateTimeOriginal)
              : null,
          };
        } catch (err) {
          console.error(`[photo-import] failed to parse ${file.name}:`, err);
          return null;
        }
      })
    );

    const parsed: ParsedPhoto[] = [];
    let skipped = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value !== null) {
        parsed.push(result.value);
      } else {
        skipped++;
      }
    }

    if (parsed.length === 0) {
      console.log(`[photo-import] no photos with GPS data found`);
      alert(t("map.noGpsPhotos"));
      if (photoImportRef.current) photoImportRef.current.value = "";
      return;
    }

    // Sort by EXIF date if available
    parsed.sort((a, b) => {
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    console.log(
      `[photo-import] sorted ${parsed.length} photos, ${skipped} skipped`
    );

    // Create route points and segments
    const newPoints: RoutePoint[] = parsed.map((photo) => ({
      id: pointIdRef.current++,
      position: [photo.lat, photo.lng] as [number, number],
      photo: { original: photo.base64, status: "pending" } as PhotoData,
    }));

    setRoutePoints((prev) => {
      const newSegments: RouteSegment[] = [];

      // Connect first imported point to last existing point
      if (prev.length > 0) {
        newSegments.push({
          fromIndex: prev.length - 1,
          toIndex: prev.length,
          mode: routeMode,
        });
      }

      // Connect imported points to each other
      for (let i = 1; i < newPoints.length; i++) {
        newSegments.push({
          fromIndex: prev.length + i - 1,
          toIndex: prev.length + i,
          mode: routeMode,
        });
      }

      setRouteSegments((prevSegments) => [...prevSegments, ...newSegments]);

      return [...prev, ...newPoints];
    });

    // Build alert message
    let message = t("map.photosImported", { added: parsed.length });
    if (skipped > 0) {
      message += "\n" + t("map.photosSkipped", { skipped });
    }
    alert(message);

    console.log(
      `[photo-import] import complete: ${parsed.length} added, ${skipped} skipped`
    );

    // Reset file input
    if (photoImportRef.current) photoImportRef.current.value = "";
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
          <button
            onClick={() => photoImportRef.current?.click()}
            className="import-photos-btn"
          >
            {t("map.importPhotos")}
          </button>
          <input
            type="file"
            ref={photoImportRef}
            multiple
            accept="image/*"
            onChange={handleImportPhotos}
            style={{ display: "none" }}
          />
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

      {overlayRoutes.length > 0 && (
        <div className="overlay-legend">
          {overlayRoutes.map((route) => (
            <div key={route.id} className="overlay-legend-item">
              <span
                className="overlay-legend-color"
                style={{ backgroundColor: route.color }}
              />
              <span className="overlay-legend-name">{route.name}</span>
            </div>
          ))}
        </div>
      )}

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
        {overlayRoutes.map((overlay) => {
          const overlayWaypoints = overlay.points.map((p) =>
            L.latLng(p.position[0], p.position[1])
          );
          return (
            <React.Fragment key={overlay.id}>
              <RoutingControl
                waypoints={overlayWaypoints}
                routeSegments={overlay.segments}
                color={overlay.color}
              />
              <ManualRoutes
                waypoints={overlayWaypoints}
                routeSegments={overlay.segments}
                color={overlay.color}
              />
              {overlay.points.map((point, idx) => (
                <Marker
                  key={`overlay-${overlay.id}-${idx}`}
                  position={point.position}
                  icon={createColoredMarkerIcon(overlay.color, point.photo)}
                >
                  <Popup>
                    <div className="point-popup">
                      <div className="point-popup-header">
                        <strong>{overlay.name} — {t("map.point", { index: idx + 1 })}</strong>
                      </div>
                      <div className="point-popup-coords">
                        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
                        {point.position[1].toFixed(6)}
                      </div>
                      {getPhotoSrc(point.photo) && (
                        <div className="point-popup-photo">
                          <img src={point.photo?.original || getPhotoSrc(point.photo)} alt={`${overlay.name} point ${idx + 1}`} />
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
