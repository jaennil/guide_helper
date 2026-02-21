import React, { useState, useEffect, useRef, type ChangeEvent } from "react";
import toast from "react-hot-toast";
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
import { useTheme } from "../context/ThemeContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { routesApi, type PhotoData } from "../api/routes";
import { categoriesApi, type Category } from "../api/categories";
import { RouteStatsPanel } from "../components/RouteStatsPanel";
import { MapMenuButton } from "../components/MapMenuButton";
import { GeoSearchControl } from "../components/GeoSearchControl";
import { CommentSection } from "../components/CommentSection";
import { LikeRatingBar } from "../components/LikeRatingBar";
import { usePhotoNotifications } from "../hooks/usePhotoNotifications";
import { exportAsGpx, exportAsKml } from "../utils/exportRoute";
import { HistoricalMapOverlay } from "../components/HistoricalMapOverlay";
import { WeatherPanel } from "../components/WeatherPanel";
import { RoutePlayback } from "../components/RoutePlayback";
import { NotificationBell } from "../components/NotificationBell";
import { ChatPanel } from "../components/ChatPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { ChatPoint } from "../api/chat";

type RouteMode = "auto" | "manual";

const TILE_PROVIDERS = [
  { id: "yandex", name: "Yandex", url: "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU", attribution: "&copy; Yandex" },
  { id: "osm", name: "OpenStreetMap", url: "/api/v1/tile/{z}/{x}/{y}", attribution: "&copy; OpenStreetMap" },
  { id: "2gis", name: "2GIS", url: "https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", attribution: "&copy; 2GIS" },
  { id: "opentopomap", name: "OpenTopoMap", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap" },
];

export interface RoutePoint {
  id: number;
  position: [number, number];
  photo?: PhotoData;
}

export interface RouteSegment {
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
  fromLatLng: L.LatLng;
  toLatLng: L.LatLng;
}

export const RoutingControl = React.memo(function RoutingControl({
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
        const fromPoint = waypoints[segment.fromIndex];
        const toPoint = waypoints[segment.toIndex];

        if (!fromPoint || !toPoint) return;

        const existing = routingControlsRef.current.get(key);
        if (existing) {
          // Update waypoints if positions changed
          const positionsChanged =
            !existing.fromLatLng.equals(fromPoint) ||
            !existing.toLatLng.equals(toPoint);
          if (positionsChanged) {
            console.log(`[routing] updating waypoints for segment ${key}`);
            (existing.control as any).setWaypoints([fromPoint, toPoint]);
            existing.fromLatLng = fromPoint;
            existing.toLatLng = toPoint;
          }
          return;
        }

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
          fromLatLng: fromPoint,
          toLatLng: toPoint,
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
});

export function ManualRoutes({
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

export function getPhotoSrc(photo?: PhotoData): string | undefined {
  if (!photo) return undefined;
  return photo.thumbnail_url || photo.original;
}

export function createMarkerIcon(photo?: PhotoData): L.Icon | L.DivIcon {
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
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid var(--bg-primary);box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

const PointPopup = React.memo(function PointPopup({
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
        toast.error(t("map.selectImageFile"));
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
});

export function MapPage() {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeMode, setRouteMode] = useState<RouteMode>("auto");
  const [tileProvider, setTileProvider] = useState(() => localStorage.getItem("tileProvider") || "yandex");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [overlayRoutes, setOverlayRoutes] = useState<OverlayRoute[]>([]);
  const [loadedRouteInfo, setLoadedRouteInfo] = useState<{ id: string; user_id: string; name: string } | null>(null);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalYear, setHistoricalYear] = useState(1900);
  const [historicalOpacity, setHistoricalOpacity] = useState(0.7);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const pointIdRef = useRef(0);
  const photoImportRef = useRef<HTMLInputElement>(null);

  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  useEffect(() => {
    categoriesApi.getCategories().then(cats => {
      setAvailableCategories(cats);
    }).catch(err => console.error('Failed to load categories:', err));
  }, []);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds(prev =>
      prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : prev.length < 5 ? [...prev, categoryId] : prev
    );
  };

  const { logout, user } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
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

  // Real-time photo processing notifications via WebSocket
  const hasPendingPhotos = routePoints.some(p => p.photo?.status === 'pending');

  usePhotoNotifications({
    routeId: loadedRouteInfo?.id ?? '',
    enabled: !!loadedRouteInfo && hasPendingPhotos,
    onPhotoUpdate: (updatedPoints) => {
      setRoutePoints(prev => prev.map((point, i) => {
        const updated = updatedPoints[i];
        if (updated?.photo && updated.photo.status !== 'pending') {
          return { ...point, photo: updated.photo };
        }
        return point;
      }));
    },
  });

  const loadRoute = async (routeId: string) => {
    try {
      const route = await routesApi.getRoute(routeId);
      setLoadedRouteInfo({ id: route.id, user_id: route.user_id, name: route.name });
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
        category_ids: selectedCategoryIds,
      });
      setShowSaveModal(false);
      setRouteName("");
      setSelectedCategoryIds([]);
      toast.success(t("map.routeSaved"));
    } catch (err: any) {
      setSaveError(err.response?.data || t("map.saveFailed"));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearRoute = () => {
    if (routePoints.length > 0 || overlayRoutes.length > 0) {
      setShowConfirmClear(true);
      return;
    }
    doClearRoute();
  };

  const doClearRoute = () => {
    setRoutePoints([]);
    setRouteSegments([]);
    setOverlayRoutes([]);
    setLoadedRouteInfo(null);
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

  const handlePhotoChange = React.useCallback((pointId: number, photo: PhotoData | undefined) => {
    setRoutePoints((prev) =>
      prev.map((point) => (point.id === pointId ? { ...point, photo } : point))
    );
  }, []);

  const handlePointDrag = (pointId: number, newLat: number, newLng: number) => {
    console.log(`[drag] point ${pointId} moved to ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`);
    setRoutePoints((prev) =>
      prev.map((p) =>
        p.id === pointId ? { ...p, position: [newLat, newLng] as [number, number] } : p
      )
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
          const exifData = await exifr.parse(file, true);

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
      toast.error(t("map.noGpsPhotos"));
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
    toast.success(message);

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

  const handleChatShowPoints = (points: ChatPoint[]) => {
    const newPoints: RoutePoint[] = points.map((p) => ({
      id: pointIdRef.current++,
      position: [p.lat, p.lng] as [number, number],
    }));
    setRoutePoints((prev) => {
      const newSegments: RouteSegment[] = [];
      if (prev.length > 0 && newPoints.length > 0) {
        newSegments.push({
          fromIndex: prev.length - 1,
          toIndex: prev.length,
          mode: routeMode,
        });
      }
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
  };

  const handleChatShowRoutes = (routeIds: string[]) => {
    loadOverlayRoutes(routeIds);
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
          {routePoints.length >= 2 && !loadedRouteInfo && (
            <button onClick={() => setShowSaveModal(true)} className="save-btn">
              {t("map.saveRoute")}
            </button>
          )}
          {loadedRouteInfo && routePoints.length >= 2 && (
            <>
              <button
                onClick={() => exportAsGpx(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.gpx")}
              </button>
              <button
                onClick={() => exportAsKml(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.kml")}
              </button>
            </>
          )}
          {routePoints.length >= 2 && (
            <button
              onClick={() => setPlaybackActive(true)}
              className="btn-secondary"
            >
              {t("playback.button")}
            </button>
          )}
          {(routePoints.length > 0 || overlayRoutes.length > 0) && (
            <button onClick={handleClearRoute} className="clear-btn">
              {t("map.clear")}
            </button>
          )}
          <button
            onClick={() => setHistoricalMode(!historicalMode)}
            className={`btn-secondary explore-nav-btn${historicalMode ? " active-toggle" : ""}`}
          >
            {t("historical.toggle")}
          </button>
          <button onClick={() => navigate("/explore")} className="btn-secondary explore-nav-btn">
            {t("explore.catalog")}
          </button>
          <button onClick={() => setChatOpen(!chatOpen)} className="btn-secondary explore-nav-btn">
            {t("chat.toggle")}
          </button>
          <NotificationBell />
          <button onClick={() => navigate("/profile")} className="profile-btn">
            {user?.name || user?.email || t("map.profile")}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t("theme.toggle")}>
            {theme === "light" ? "\u263D" : "\u2600"}
          </button>
          <button onClick={handleLogout} className="logout-btn">
            {t("map.logout")}
          </button>
        </div>
        <MapMenuButton>
          <button
            onClick={() => photoImportRef.current?.click()}
            className="import-photos-btn"
          >
            {t("map.importPhotos")}
          </button>
          {routePoints.length >= 2 && !loadedRouteInfo && (
            <button onClick={() => setShowSaveModal(true)} className="save-btn">
              {t("map.saveRoute")}
            </button>
          )}
          {loadedRouteInfo && routePoints.length >= 2 && (
            <>
              <button
                onClick={() => exportAsGpx(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.gpx")}
              </button>
              <button
                onClick={() => exportAsKml(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.kml")}
              </button>
            </>
          )}
          {routePoints.length >= 2 && (
            <button
              onClick={() => setPlaybackActive(true)}
              className="btn-secondary"
            >
              {t("playback.button")}
            </button>
          )}
          {(routePoints.length > 0 || overlayRoutes.length > 0) && (
            <button onClick={handleClearRoute} className="clear-btn">
              {t("map.clear")}
            </button>
          )}
          <button
            onClick={() => setHistoricalMode(!historicalMode)}
            className={`btn-secondary explore-nav-btn${historicalMode ? " active-toggle" : ""}`}
          >
            {t("historical.toggle")}
          </button>
          <button onClick={() => navigate("/explore")} className="btn-secondary explore-nav-btn">
            {t("explore.catalog")}
          </button>
          <button onClick={() => setChatOpen(!chatOpen)} className="btn-secondary explore-nav-btn">
            {t("chat.toggle")}
          </button>
          <button onClick={() => navigate("/profile")} className="profile-btn">
            {user?.name || user?.email || t("map.profile")}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t("theme.toggle")}>
            {theme === "light" ? "\u263D" : "\u2600"}
          </button>
          <button onClick={handleLogout} className="logout-btn">
            {t("map.logout")}
          </button>
        </MapMenuButton>
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

      {historicalMode && (
        <div className="historical-controls">
          <div className="historical-year-display">{historicalYear}</div>
          <input
            type="range"
            min={1700}
            max={2025}
            step={1}
            value={historicalYear}
            onChange={(e) => setHistoricalYear(Number(e.target.value))}
            className="historical-slider"
          />
          <div className="historical-year-labels">
            <span>1700</span>
            <span>1800</span>
            <span>1900</span>
            <span>2000</span>
          </div>
          <div className="historical-opacity-row">
            <span>{t("historical.opacity")}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(historicalOpacity * 100)}
              onChange={(e) => setHistoricalOpacity(Number(e.target.value) / 100)}
              className="historical-opacity-slider"
            />
          </div>
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
              <div className="tag-selector">
                <label>{t("map.selectCategories")}</label>
                <div className="tag-selector-buttons">
                  {availableCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`tag-button${selectedCategoryIds.includes(cat.id) ? " active" : ""}`}
                      onClick={() => toggleCategory(cat.id)}
                    >
                      {t(`tags.${cat.name}` as any) || cat.name}
                    </button>
                  ))}
                </div>
              </div>
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
        <GeoSearchControl />
        {historicalMode && (
          <HistoricalMapOverlay year={historicalYear} opacity={historicalOpacity} />
        )}
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker
            key={`${point.id}-${point.photo ? "photo" : "no-photo"}`}
            position={point.position}
            icon={createMarkerIcon(point.photo)}
            draggable={true}
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = e.target.getLatLng();
                handlePointDrag(point.id, lat, lng);
              },
            }}
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
        {playbackActive && routePoints.length >= 2 && (
          <RoutePlayback
            points={routePoints}
            segments={routeSegments}
            onClose={() => setPlaybackActive(false)}
          />
        )}
      </MapContainer>
      {!playbackActive && routePoints.length >= 2 && (
        <RouteStatsPanel
          points={routePoints.map((p) => ({ lat: p.position[0], lng: p.position[1] }))}
        />
      )}
      {!playbackActive && routePoints.length >= 2 && (
        <WeatherPanel
          points={routePoints.map((p) => ({ lat: p.position[0], lng: p.position[1] }))}
        />
      )}
      {loadedRouteInfo && (
        <>
          <LikeRatingBar routeId={loadedRouteInfo.id} />
          <CommentSection
            routeId={loadedRouteInfo.id}
            routeOwnerId={loadedRouteInfo.user_id}
          />
        </>
      )}
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onShowPoints={handleChatShowPoints}
        onShowRoutes={handleChatShowRoutes}
      />
      {showConfirmClear && (
        <ConfirmDialog
          message={t("map.clearAllPoints")}
          confirmLabel={t("map.clear")}
          cancelLabel={t("map.cancel")}
          onConfirm={() => { setShowConfirmClear(false); doClearRoute(); }}
          onCancel={() => setShowConfirmClear(false)}
        />
      )}
    </div>
  );
}
