import React, { useState, useEffect, useRef, type ChangeEvent } from "react";
import toast from "react-hot-toast";
import exifr from "exifr";
import {
  MapContainer,
  Marker,
  Popup,
  useMapEvents,
  Polyline,
  Tooltip,
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
import { LeafletAttributionPrefix } from "../components/LeafletAttributionPrefix";
import { usePhotoNotifications } from "../hooks/usePhotoNotifications";
import { exportAsGpx, exportAsKml } from "../utils/exportRoute";
import { HistoricalMapOverlay } from "../components/HistoricalMapOverlay";
import { WeatherPanel } from "../components/WeatherPanel";
import { RoutePlayback } from "../components/RoutePlayback";
import { NotificationBell } from "../components/NotificationBell";
import { ChatPanel } from "../components/ChatPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { ChatPoint } from "../api/chat";
import { ROUTING_ENGINES, DEFAULT_ENGINE, fetchRoute, type RoutingEngineId } from "../utils/routingEngines";
import { Wrench, Sparkles, Compass, Route, Minus } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { setRoutingEngine as setPathEngine } from "../utils/routePath";
import {
  estimateRouteTime,
  formatDistance,
  formatDuration,
  inferRouteActivity,
  inferRouteSurface,
  totalDistance,
} from "../utils/geo";
import {
  DEFAULT_ROUTE_LINE_COLOR,
  ROUTE_LINE_COLOR_PRESETS,
  normalizeRouteLineColor,
} from "../utils/routeColors";

type RouteMode = "auto" | "manual";
export type PhotoPreviewShape = "square" | "circle";

const TILE_PROVIDERS = [
  { id: "yandex", name: "Yandex", url: "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator", attribution: "&copy; Yandex" },
  { id: "osm", name: "OpenStreetMap", url: "/api/v1/tile/{z}/{x}/{y}", attribution: "&copy; OpenStreetMap" },
  { id: "2gis", name: "2GIS", url: "https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", attribution: "&copy; 2GIS" },
  { id: "opentopomap", name: "OpenTopoMap", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap" },
];

export interface RoutePoint {
  id: number;
  position: [number, number];
  name?: string;
  note?: string;
  markerColor?: string;
  markerSize?: number;
  previewSize?: number;
  previewShape?: PhotoPreviewShape;
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

const CHAT_POINT_MATCH_EPSILON = 0.00001;
const DEFAULT_POINT_MARKER_COLOR = "#3388ff";
const DEFAULT_POINT_MARKER_SIZE = 30;
const MIN_POINT_MARKER_SIZE = 22;
const MAX_POINT_MARKER_SIZE = 46;
const POINT_MARKER_SIZE_STEP = 2;
const DEFAULT_PHOTO_PREVIEW_SIZE = 44;
const MIN_PHOTO_PREVIEW_SIZE = 28;
const MAX_PHOTO_PREVIEW_SIZE = 84;
const PHOTO_PREVIEW_STEP = 4;
const DEFAULT_PHOTO_PREVIEW_SHAPE: PhotoPreviewShape = "square";

function routePointsMatch(
  left: Pick<RoutePoint, "position" | "name">,
  right: Pick<RoutePoint, "position" | "name">,
) {
  const [leftLat, leftLng] = left.position;
  const [rightLat, rightLng] = right.position;
  const namesMatch = !left.name || !right.name || left.name === right.name;

  return (
    namesMatch &&
    Math.abs(leftLat - rightLat) <= CHAT_POINT_MATCH_EPSILON &&
    Math.abs(leftLng - rightLng) <= CHAT_POINT_MATCH_EPSILON
  );
}

function overlappingRouteTailLength(
  existingPoints: RoutePoint[],
  incomingPoints: RoutePoint[],
) {
  const maxOverlap = Math.min(existingPoints.length, incomingPoints.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingTail = existingPoints.slice(existingPoints.length - overlap);
    const incomingHead = incomingPoints.slice(0, overlap);

    if (
      existingTail.every((point, index) =>
        routePointsMatch(point, incomingHead[index])
      )
    ) {
      return overlap;
    }
  }

  return 0;
}

function buildSegmentsForAppendedPoints(
  existingCount: number,
  appendedCount: number,
  routeMode: RouteMode,
) {
  const segments: RouteSegment[] = [];

  if (existingCount > 0 && appendedCount > 0) {
    segments.push({
      fromIndex: existingCount - 1,
      toIndex: existingCount,
      mode: routeMode,
    });
  }

  for (let index = 1; index < appendedCount; index += 1) {
    segments.push({
      fromIndex: existingCount + index - 1,
      toIndex: existingCount + index,
      mode: routeMode,
    });
  }

  return segments;
}

function clampPhotoPreviewSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_PHOTO_PREVIEW_SIZE;
  }
  return Math.max(
    MIN_PHOTO_PREVIEW_SIZE,
    Math.min(MAX_PHOTO_PREVIEW_SIZE, Math.round(size / PHOTO_PREVIEW_STEP) * PHOTO_PREVIEW_STEP),
  );
}

function clampPointMarkerSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_POINT_MARKER_SIZE;
  }
  return Math.max(
    MIN_POINT_MARKER_SIZE,
    Math.min(MAX_POINT_MARKER_SIZE, Math.round(size / POINT_MARKER_SIZE_STEP) * POINT_MARKER_SIZE_STEP),
  );
}

function normalizePointMarkerColor(color?: string) {
  if (!color) {
    return DEFAULT_POINT_MARKER_COLOR;
  }
  const trimmed = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : DEFAULT_POINT_MARKER_COLOR;
}

function normalizePhotoPreviewShape(shape?: string): PhotoPreviewShape {
  return shape === "circle" ? "circle" : DEFAULT_PHOTO_PREVIEW_SHAPE;
}

function buildSegmentTooltipText(
  segment: RouteSegment,
  coords: [number, number][],
  categoryNames: string[] = [],
) {
  const distanceKm = totalDistance(
    coords.map(([lat, lng]) => ({ lat, lng })),
  );
  const segmentModes = [segment.mode];
  const activity = inferRouteActivity(categoryNames, segmentModes);
  const surface = inferRouteSurface(segmentModes);
  const estimatedMinutes = estimateRouteTime(distanceKm, 0, activity, surface);

  return `${segment.fromIndex + 1} → ${segment.toIndex + 1} • ${formatDistance(distanceKm)} • ${formatDuration(estimatedMinutes)}`;
}

function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMapEvents({});
  mapRef.current = map;
  return null;
}

/** Manages base tile layer imperatively via setUrl() to avoid remounting child components */
function BaseTileLayer({ url, attribution }: { url: string; attribution: string }) {
  const map = useMapEvents({});
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!layerRef.current) {
      layerRef.current = L.tileLayer(url, { attribution, zIndex: 0 }).addTo(map);
    } else {
      layerRef.current.setUrl(url);
    }
  }, [url, attribution, map]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
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

/**
 * RoutingControl — fetches route paths from the selected engine and
 * renders them as Polylines. No dependency on leaflet-routing-machine.
 */
export const RoutingControl = React.memo(function RoutingControl({
  waypoints,
  routeSegments,
  color = DEFAULT_ROUTE_LINE_COLOR,
  engineId = DEFAULT_ENGINE,
  categoryNames = [],
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
  engineId?: RoutingEngineId;
  categoryNames?: string[];
}) {
  const map = useMapEvents({});
  const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const categoryKey = categoryNames.join("|").toLowerCase();

  useEffect(() => {
    if (waypoints.length < 2) {
      polylinesRef.current.forEach((pl) => map.removeLayer(pl));
      polylinesRef.current.clear();
      return;
    }

    const activeKeys = new Set<string>();

    routeSegments.forEach((segment) => {
      if (segment.mode !== "auto") return;
      const key = `${segment.fromIndex}-${segment.toIndex}-${engineId}-${categoryKey}`;
      activeKeys.add(key);

      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      if (!fromPoint || !toPoint) return;

      if (polylinesRef.current.has(key)) return;

      const from: [number, number] = [fromPoint.lat, fromPoint.lng];
      const to: [number, number] = [toPoint.lat, toPoint.lng];

      fetchRoute(engineId, from, to).then((coords) => {
        const tooltipText = buildSegmentTooltipText(segment, coords, categoryNames);
        // Remove old polyline for this segment if engine changed
        const latLngs = coords.map((c) => L.latLng(c[0], c[1]));
        const polyline = L.polyline(latLngs, {
          color,
          opacity: 0.7,
          weight: 4,
        })
          .bindTooltip(tooltipText, {
            sticky: true,
            direction: "top",
            offset: [0, -4],
            className: "route-segment-tooltip",
          })
          .addTo(map);
        polylinesRef.current.set(key, polyline);
      });
    });

    // Remove stale polylines
    polylinesRef.current.forEach((pl, key) => {
      if (!activeKeys.has(key)) {
        map.removeLayer(pl);
        polylinesRef.current.delete(key);
      }
    });
  }, [waypoints, routeSegments, map, engineId, color, categoryKey, categoryNames]);

  // Clear all when engine changes
  useEffect(() => {
    polylinesRef.current.forEach((pl) => map.removeLayer(pl));
    polylinesRef.current.clear();
  }, [engineId, map, categoryKey]);

  useEffect(() => {
    return () => {
      polylinesRef.current.forEach((pl) => {
        try { map.removeLayer(pl); } catch (_) {}
      });
      polylinesRef.current.clear();
    };
  }, [map]);

  return null;
});

export function ManualRoutes({
  waypoints,
  routeSegments,
  color = DEFAULT_ROUTE_LINE_COLOR,
  categoryNames = [],
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
  color?: string;
  categoryNames?: string[];
}) {
  const routes: Array<{ segment: RouteSegment; coords: [number, number][] }> = [];
  routeSegments.forEach((segment) => {
    if (segment.mode === "manual") {
      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      if (fromPoint && toPoint) {
        routes.push({
          segment,
          coords: [
            [fromPoint.lat, fromPoint.lng],
            [toPoint.lat, toPoint.lng],
          ],
        });
      }
    }
  });

  return (
    <>
      {routes.map(({ segment, coords }) => (
        <Polyline
          key={`${segment.fromIndex}-${segment.toIndex}`}
          positions={coords}
          color={color}
          weight={4}
          opacity={0.7}
        >
          <Tooltip
            sticky
            direction="top"
            offset={[0, -4]}
            className="route-segment-tooltip"
          >
            {buildSegmentTooltipText(segment, coords, categoryNames)}
          </Tooltip>
        </Polyline>
      ))}
    </>
  );
}

export function getPhotoSrc(photo?: PhotoData): string | undefined {
  if (!photo) return undefined;
  return photo.thumbnail_url || photo.original;
}

function createPhotoMarkerHtml(
  src: string,
  previewSize?: number,
  previewShape?: PhotoPreviewShape,
  borderColor?: string,
) {
  const size = clampPhotoPreviewSize(previewSize);
  const shape = normalizePhotoPreviewShape(previewShape);
  const normalizedBorderColor = borderColor ? normalizePointMarkerColor(borderColor) : "white";
  const borderStyle = `border-color:${normalizedBorderColor};`;
  return `<div class="photo-marker-container" style="--marker-size:${size}px;--marker-radius:${shape === "circle" ? "50%" : "10px"};${borderStyle}"><img src="${src}" alt="Marker" /></div>`;
}

function createPointMarkerHtml(color?: string, markerSize?: number) {
  const normalizedColor = normalizePointMarkerColor(color);
  const size = clampPointMarkerSize(markerSize);
  const centerSize = Math.max(8, Math.round(size * 0.34));

  return `<div class="point-marker-container" style="--marker-color:${normalizedColor};--marker-size:${size}px;--marker-center-size:${centerSize}px"><span class="point-marker-center"></span></div>`;
}

export function createMarkerIcon(
  photo?: PhotoData,
  previewSize?: number,
  previewShape?: PhotoPreviewShape,
  markerColor?: string,
  markerSize?: number,
): L.Icon | L.DivIcon {
  const src = getPhotoSrc(photo);
  if (src) {
    const size = clampPhotoPreviewSize(previewSize);
    return L.divIcon({
      className: "custom-photo-marker",
      html: createPhotoMarkerHtml(src, size, previewShape, markerColor),
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), size],
      popupAnchor: [0, -size],
    });
  } else {
    const size = clampPointMarkerSize(markerSize);
    return L.divIcon({
      className: "custom-point-marker",
      html: createPointMarkerHtml(markerColor, size),
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), size],
      popupAnchor: [0, -size],
    });
  }
}

function createColoredMarkerIcon(
  color: string,
  photo?: PhotoData,
  previewSize?: number,
  previewShape?: PhotoPreviewShape,
  markerColor?: string,
  markerSize?: number,
): L.DivIcon {
  const src = getPhotoSrc(photo);
  if (src) {
    const size = clampPhotoPreviewSize(previewSize);
    return L.divIcon({
      className: "overlay-marker",
      html: createPhotoMarkerHtml(src, size, previewShape, markerColor || color),
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), size],
      popupAnchor: [0, -size],
    });
  }
  const size = clampPointMarkerSize(markerSize);
  return L.divIcon({
    className: "overlay-marker",
    html: createPointMarkerHtml(markerColor || color, size),
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), size],
    popupAnchor: [0, -size],
  });
}

const PointPopup = React.memo(function PointPopup({
  point,
  index,
  onPhotoChange,
  onNoteChange,
  onMarkerColorChange,
  onMarkerSizeChange,
  onPreviewSizeChange,
  onPreviewShapeChange,
}: {
  point: RoutePoint;
  index: number;
  onPhotoChange: (pointId: number, photo: PhotoData | undefined) => void;
  onNoteChange: (pointId: number, note: string) => void;
  onMarkerColorChange: (pointId: number, markerColor: string) => void;
  onMarkerSizeChange: (pointId: number, markerSize: number) => void;
  onPreviewSizeChange: (pointId: number, previewSize: number) => void;
  onPreviewShapeChange: (pointId: number, previewShape: PhotoPreviewShape) => void;
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

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onNoteChange(point.id, e.target.value);
  };

  const handlePreviewSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPreviewSizeChange(point.id, Number(e.target.value));
  };

  const handlePreviewShapeChange = (previewShape: PhotoPreviewShape) => {
    onPreviewShapeChange(point.id, previewShape);
  };

  const handleMarkerColorChange = (markerColor: string) => {
    onMarkerColorChange(point.id, markerColor);
  };

  const handleMarkerSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onMarkerSizeChange(point.id, Number(e.target.value));
  };

  const markerColor = normalizePointMarkerColor(point.markerColor);
  const markerSize = clampPointMarkerSize(point.markerSize);
  const photoSrc = getPhotoSrc(point.photo);
  const previewSize = clampPhotoPreviewSize(point.previewSize);
  const previewShape = normalizePhotoPreviewShape(point.previewShape);

  return (
    <div className="point-popup">
      <div className="point-popup-header">
        <strong>{t("map.point", { index: index + 1 })}</strong>
      </div>
      {point.name && <div className="point-popup-name">{point.name}</div>}
      <div className="point-popup-coords">
        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
        {point.position[1].toFixed(6)}
      </div>
      <div className="point-popup-note">
        <label className="point-popup-note-label" htmlFor={`point-note-${point.id}`}>
          {t("map.pointNoteLabel")}
        </label>
        <textarea
          id={`point-note-${point.id}`}
          className="point-note-textarea"
          rows={4}
          value={point.note ?? ""}
          onChange={handleNoteChange}
          placeholder={t("map.pointNotePlaceholder")}
        />
      </div>
      <div className="point-style-controls">
        <div className="point-style-header">
          <label className="point-popup-note-label" htmlFor={`point-marker-color-${point.id}`}>
            {t("map.pointMarkerColor")}
          </label>
          <input
            id={`point-marker-color-${point.id}`}
            type="color"
            value={markerColor}
            onChange={(e) => handleMarkerColorChange(e.target.value)}
            className="point-marker-color-input"
            aria-label={t("map.pointMarkerColor")}
          />
        </div>
        <div className="point-style-swatches">
          {ROUTE_LINE_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              className={`point-style-swatch${markerColor === color ? " active" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => handleMarkerColorChange(color)}
              aria-label={`${t("map.pointMarkerColor")} ${color}`}
              title={color}
            />
          ))}
        </div>
        {!photoSrc && (
          <>
            <div className="point-style-size-header">
              <label
                className="point-popup-note-label"
                htmlFor={`point-marker-size-${point.id}`}
              >
                {t("map.pointMarkerSize")}
              </label>
              <span className="point-photo-size-value">
                {t("map.pointMarkerSizeValue", { size: markerSize })}
              </span>
            </div>
            <input
              id={`point-marker-size-${point.id}`}
              className="point-style-size-range"
              type="range"
              min={MIN_POINT_MARKER_SIZE}
              max={MAX_POINT_MARKER_SIZE}
              step={POINT_MARKER_SIZE_STEP}
              value={markerSize}
              onChange={handleMarkerSizeChange}
            />
          </>
        )}
      </div>
      {photoSrc && (
        <div className="point-popup-photo">
          <img src={point.photo?.original || photoSrc} alt={t("map.point", { index: index + 1 })} />
          <div className="point-photo-size-control">
            <div className="point-photo-shape-toggle">
              <span className="point-popup-note-label">{t("map.photoPreviewShape")}</span>
              <div className="point-photo-shape-buttons">
                <button
                  type="button"
                  className={`point-photo-shape-btn${previewShape === "square" ? " active" : ""}`}
                  onClick={() => handlePreviewShapeChange("square")}
                >
                  {t("map.photoPreviewShapeSquare")}
                </button>
                <button
                  type="button"
                  className={`point-photo-shape-btn${previewShape === "circle" ? " active" : ""}`}
                  onClick={() => handlePreviewShapeChange("circle")}
                >
                  {t("map.photoPreviewShapeCircle")}
                </button>
              </div>
            </div>
            <div className="point-photo-size-header">
              <label
                className="point-popup-note-label"
                htmlFor={`point-preview-size-${point.id}`}
              >
                {t("map.photoPreviewSize")}
              </label>
              <span className="point-photo-size-value">
                {t("map.photoPreviewSizeValue", { size: previewSize })}
              </span>
            </div>
            <input
              id={`point-preview-size-${point.id}`}
              className="point-photo-size-range"
              type="range"
              min={MIN_PHOTO_PREVIEW_SIZE}
              max={MAX_PHOTO_PREVIEW_SIZE}
              step={PHOTO_PREVIEW_STEP}
              value={previewSize}
              onChange={handlePreviewSizeChange}
            />
          </div>
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
  const [routingEngine, setRoutingEngine] = useState<RoutingEngineId>(DEFAULT_ENGINE);

  const handleEngineChange = (engineId: RoutingEngineId) => {
    setRoutingEngine(engineId);
    setPathEngine(engineId);
  };
  const [tileProvider, setTileProvider] = useState(() => localStorage.getItem("tileProvider") || "yandex");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [routeLineColor, setRouteLineColor] = useState(DEFAULT_ROUTE_LINE_COLOR);
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [overlayRoutes, setOverlayRoutes] = useState<OverlayRoute[]>([]);
  const [loadedRouteInfo, setLoadedRouteInfo] = useState<{ id: string; user_id: string; name: string } | null>(null);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalYear, setHistoricalYear] = useState(new Date().getFullYear());
  const [historicalOpacity, setHistoricalOpacity] = useState(0.7);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
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

  const ALL_SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;

  const toggleSeason = (season: string) => {
    setSelectedSeasons(prev =>
      prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season]
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
      setRouteName(route.name);
      setSelectedCategoryIds(route.category_ids);
      setSelectedSeasons(route.seasons);
      setRouteLineColor(normalizeRouteLineColor(route.line_color));
      const loadedPoints: RoutePoint[] = route.points.map((p, index) => ({
        id: index,
        position: [p.lat, p.lng] as [number, number],
        name: p.name,
        note: p.note,
        markerColor: p.marker_color,
        markerSize: p.marker_size,
        previewSize: p.preview_size,
        previewShape: p.preview_shape as PhotoPreviewShape | undefined,
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
          name: p.name,
          note: p.note,
          markerColor: p.marker_color,
          markerSize: p.marker_size,
          previewSize: p.preview_size,
          previewShape: p.preview_shape as PhotoPreviewShape | undefined,
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
          color: route.line_color
            ? normalizeRouteLineColor(route.line_color)
            : ROUTE_COLORS[idx % ROUTE_COLORS.length],
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

  const handleGenerateAiDescription = async () => {
    if (!loadedRouteInfo) return;
    setAiGenerating(true);
    try {
      const result = await routesApi.generateDescription(loadedRouteInfo.id);
      setAiDescription(result.description);
      setShowAiModal(true);
      console.log("AI description generated for route:", loadedRouteInfo.id);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data || t("ai.unavailable");
      toast.error(msg);
      console.error("Failed to generate AI description:", err);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSaveAiDescription = async () => {
    if (!loadedRouteInfo) return;
    setAiSaving(true);
    try {
      await routesApi.saveDescription(loadedRouteInfo.id, aiDescription);
      setShowAiModal(false);
      toast.success(t("map.routeSaved"));
      console.log("AI description saved for route:", loadedRouteInfo.id);
    } catch (err: any) {
      toast.error(t("map.saveFailed"));
      console.error("Failed to save AI description:", err);
    } finally {
      setAiSaving(false);
    }
  };

  const handleSaveRoute = async () => {
    const targetRouteName = routeName;

    if (!targetRouteName.trim()) {
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
        const normalizedName = p.name?.trim();
        const normalizedNote = p.note?.trim();
        return {
          lat: p.position[0],
          lng: p.position[1],
          name: normalizedName ? normalizedName : undefined,
          note: normalizedNote ? normalizedNote : undefined,
          marker_color: p.markerColor ? normalizePointMarkerColor(p.markerColor) : undefined,
          marker_size: p.markerSize ? clampPointMarkerSize(p.markerSize) : undefined,
          preview_size: p.photo ? clampPhotoPreviewSize(p.previewSize) : undefined,
          preview_shape: p.photo ? normalizePhotoPreviewShape(p.previewShape) : undefined,
          segment_mode: segment?.mode as 'auto' | 'manual' | undefined,
          photo: p.photo,
        };
      });

      const normalizedLineColor = normalizeRouteLineColor(routeLineColor);
      let savedRoute;

      if (loadedRouteInfo) {
        savedRoute = await routesApi.updateRoute(loadedRouteInfo.id, {
          name: targetRouteName.trim(),
          points: pointsToSave,
          category_ids: selectedCategoryIds,
          seasons: selectedSeasons,
          line_color: normalizedLineColor,
        });
      } else {
        savedRoute = await routesApi.createRoute({
          name: targetRouteName.trim(),
          points: pointsToSave,
          category_ids: selectedCategoryIds,
          seasons: selectedSeasons,
          line_color: normalizedLineColor,
        });
      }
      setRouteName(savedRoute.name);
      setRouteLineColor(normalizeRouteLineColor(savedRoute.line_color));
      setLoadedRouteInfo({ id: savedRoute.id, user_id: savedRoute.user_id, name: savedRoute.name });
      setShowSaveModal(false);
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
    setRouteName("");
    setSelectedCategoryIds([]);
    setSelectedSeasons([]);
    setRouteLineColor(DEFAULT_ROUTE_LINE_COLOR);
    pointIdRef.current = 0;
  };

  const handleMapClick = (lat: number, lng: number) => {
    const newPoint: RoutePoint = {
      id: pointIdRef.current++,
      position: [lat, lng],
      markerColor: DEFAULT_POINT_MARKER_COLOR,
      markerSize: DEFAULT_POINT_MARKER_SIZE,
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
      prev.map((point) =>
        point.id === pointId
          ? {
              ...point,
              photo,
              previewSize: photo ? clampPhotoPreviewSize(point.previewSize) : point.previewSize,
              previewShape: photo ? normalizePhotoPreviewShape(point.previewShape) : point.previewShape,
            }
          : point
      )
    );
  }, []);

  const handlePointNoteChange = React.useCallback((pointId: number, note: string) => {
    setRoutePoints((prev) =>
      prev.map((point) => (point.id === pointId ? { ...point, note } : point))
    );
  }, []);

  const handlePointMarkerColorChange = React.useCallback((pointId: number, markerColor: string) => {
    const normalizedColor = normalizePointMarkerColor(markerColor);
    setRoutePoints((prev) =>
      prev.map((point) =>
        point.id === pointId ? { ...point, markerColor: normalizedColor } : point
      )
    );
  }, []);

  const handlePointMarkerSizeChange = React.useCallback((pointId: number, markerSize: number) => {
    const normalizedSize = clampPointMarkerSize(markerSize);
    setRoutePoints((prev) =>
      prev.map((point) =>
        point.id === pointId ? { ...point, markerSize: normalizedSize } : point
      )
    );
  }, []);

  const handlePointPreviewSizeChange = React.useCallback((pointId: number, previewSize: number) => {
    const normalizedSize = clampPhotoPreviewSize(previewSize);
    setRoutePoints((prev) =>
      prev.map((point) =>
        point.id === pointId ? { ...point, previewSize: normalizedSize } : point
      )
    );
  }, []);

  const handlePointPreviewShapeChange = React.useCallback((pointId: number, previewShape: PhotoPreviewShape) => {
    const normalizedShape = normalizePhotoPreviewShape(previewShape);
    setRoutePoints((prev) =>
      prev.map((point) =>
        point.id === pointId ? { ...point, previewShape: normalizedShape } : point
      )
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
      markerColor: DEFAULT_POINT_MARKER_COLOR,
      markerSize: DEFAULT_POINT_MARKER_SIZE,
      previewSize: DEFAULT_PHOTO_PREVIEW_SIZE,
      previewShape: DEFAULT_PHOTO_PREVIEW_SHAPE,
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

  const mapRef = useRef<L.Map | null>(null);
  const handleTileProviderChange = (providerId: string) => {
    setTileProvider(providerId);
    localStorage.setItem("tileProvider", providerId);
  };

  const focusMapOnPoints = (points: RoutePoint[]) => {
    const map = mapRef.current;
    if (!map || points.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      map.invalidateSize();

      if (points.length === 1) {
        map.setView(points[0].position, Math.max(map.getZoom(), 16), {
          animate: true,
        });
        return;
      }

      const bounds = L.latLngBounds(
        points.map((point) => L.latLng(point.position[0], point.position[1]))
      );
      map.fitBounds(bounds.pad(0.2), { animate: true, maxZoom: 16 });
    });
  };

  const appendChatPointsToRoute = (points: ChatPoint[]) => {
    const incomingPoints: RoutePoint[] = points.map((point) => ({
      id: pointIdRef.current++,
      position: [point.lat, point.lng] as [number, number],
      name: point.name,
      markerColor: DEFAULT_POINT_MARKER_COLOR,
      markerSize: DEFAULT_POINT_MARKER_SIZE,
    }));

    if (incomingPoints.length === 0) {
      return [];
    }

    const overlap = overlappingRouteTailLength(routePoints, incomingPoints);
    const previewPoints = [...routePoints, ...incomingPoints.slice(overlap)];

    setRoutePoints((prev) => {
      const prevOverlap = overlappingRouteTailLength(prev, incomingPoints);
      const appendedPoints = incomingPoints.slice(prevOverlap);
      if (appendedPoints.length === 0) {
        return prev;
      }

      const newSegments = buildSegmentsForAppendedPoints(
        prev.length,
        appendedPoints.length,
        routeMode,
      );
      setRouteSegments((prevSegments) => [...prevSegments, ...newSegments]);

      return [...prev, ...appendedPoints];
    });

    return previewPoints;
  };

  const handleChatApplyPoints = (points: ChatPoint[]) => {
    appendChatPointsToRoute(points);
  };

  const handleChatShowPoints = (points: ChatPoint[]) => {
    const focusTargets = points.map((point) => ({
      id: -1,
      position: [point.lat, point.lng] as [number, number],
      name: point.name,
    }));

    const allPointsAlreadyOnRoute =
      focusTargets.length > 0 &&
      focusTargets.every((target) =>
        routePoints.some((routePoint) => routePointsMatch(routePoint, target))
      );

    if (allPointsAlreadyOnRoute) {
      focusMapOnPoints(routePoints.length >= 2 ? routePoints : focusTargets);
      return;
    }

    const previewPoints = appendChatPointsToRoute(points);
    focusMapOnPoints(previewPoints.length > 0 ? previewPoints : focusTargets);
  };

  const handleChatShowRoutes = (routeIds: string[]) => {
    loadOverlayRoutes(routeIds);
  };

  const currentProvider = TILE_PROVIDERS.find((p) => p.id === tileProvider) || TILE_PROVIDERS[0];
  const selectedCategoryNames = selectedCategoryIds
    .map((categoryId) => availableCategories.find((category) => category.id === categoryId)?.name)
    .filter((name): name is string => Boolean(name));
  const canSaveCurrentRoute =
    routePoints.length >= 2 &&
    (!loadedRouteInfo || loadedRouteInfo.user_id === user?.id);

  const waypoints = routePoints.map((point) =>
    L.latLng(point.position[0], point.position[1])
  );

  return (
    <div className="App">
      <div className="map-header">
        {/* ── Left: Route mode pills ── */}
        <div className="header-pills">
          <button
            className={`header-pill${routeMode === "auto" ? " active" : ""}`}
            onClick={() => setRouteMode("auto")}
          >
            <Route size={14} /> {t("map.modeAuto")}
          </button>
          <button
            className={`header-pill${routeMode === "manual" ? " active" : ""}`}
            onClick={() => setRouteMode("manual")}
          >
            <Minus size={14} /> {t("map.modeManual")}
          </button>
          {routeMode === "auto" && (
            <CustomSelect
              options={ROUTING_ENGINES.map(e => ({ value: e.id, label: e.label }))}
              value={routingEngine}
              onChange={(v) => handleEngineChange(v as RoutingEngineId)}
            />
          )}
        </div>

        {/* ── Right: Actions ── */}
        <div className="header-actions">
          <input type="file" ref={photoImportRef} multiple accept="image/*" onChange={handleImportPhotos} style={{ display: "none" }} />

          {/* Tile selector */}
          <CustomSelect
            options={TILE_PROVIDERS.map(p => ({ value: p.id, label: p.name }))}
            value={tileProvider}
            onChange={handleTileProviderChange}
          />

          {/* Save Route — prominent */}
          {canSaveCurrentRoute && (
            <button
              onClick={() => setShowSaveModal(true)}
              className="btn btn-primary btn-sm btn-pill"
            >
              {loadedRouteInfo ? t("map.saveChanges") : t("map.saveRoute")}
            </button>
          )}

          {/* Catalog — standalone button */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => navigate("/explore")}
            title={t("explore.catalog")}
          >
            <Compass size={18} />
          </button>

          {/* Tools dropdown */}
          <div className="header-dropdown-wrap">
            <button
              className="btn btn-secondary btn-sm btn-icon"
              onClick={() => { setToolsOpen(!toolsOpen); setUserMenuOpen(false); }}
              title="Tools"
            >
              <Wrench size={18} />
            </button>
            {toolsOpen && (
              <div className="header-dropdown" onClick={() => setToolsOpen(false)}>
                <button onClick={() => photoImportRef.current?.click()}>{t("map.importPhotos")}</button>
                {loadedRouteInfo && routePoints.length >= 2 && (
                  <>
                    <button onClick={() => exportAsGpx(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1], name: p.name, note: p.note })))}>{t("export.gpx")}</button>
                    <button onClick={() => exportAsKml(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1], name: p.name, note: p.note })))}>{t("export.kml")}</button>
                    <button onClick={handleGenerateAiDescription} disabled={aiGenerating}>{aiGenerating ? t("ai.generating") : t("ai.generateButton")}</button>
                  </>
                )}
                {routePoints.length >= 2 && (
                  <button onClick={() => setPlaybackActive(true)}>{t("playback.button")}</button>
                )}
                <button onClick={() => setHistoricalMode(!historicalMode)}>
                  {historicalMode ? "✓ " : ""}{t("historical.toggle")}
                </button>
                {(routePoints.length > 0 || overlayRoutes.length > 0) && (
                  <button onClick={handleClearRoute} className="dropdown-danger">{t("map.clear")}</button>
                )}
              </div>
            )}
          </div>

          {/* AI Chat */}
          <button
            className={`btn btn-ghost btn-sm btn-icon${chatOpen ? " active-toggle" : ""}`}
            onClick={() => setChatOpen(!chatOpen)}
            title={t("chat.toggle")}
          >
            <Sparkles size={18} />
          </button>

          {/* Notifications */}
          <NotificationBell />

          {/* User menu dropdown */}
          <div className="header-dropdown-wrap">
            <button
              className="btn btn-ghost btn-sm header-user-btn"
              onClick={() => { setUserMenuOpen(!userMenuOpen); setToolsOpen(false); }}
            >
              {(user?.name || user?.email || t("map.profile")).slice(0, 12)}
            </button>
            {userMenuOpen && (
              <div className="header-dropdown header-dropdown-right" onClick={() => setUserMenuOpen(false)}>
                <button onClick={() => navigate("/profile")}>{t("map.profile")}</button>
                <button onClick={() => navigate("/bookmarks")}>{t("bookmarks.title")}</button>
                <button onClick={toggleTheme}>{theme === "light" ? "🌙 " : "☀️ "}{t("theme.toggle")}</button>
                <hr />
                <button onClick={handleLogout} className="dropdown-danger">{t("map.logout")}</button>
              </div>
            )}
          </div>
        </div>
        <MapMenuButton>
          <button
            onClick={() => photoImportRef.current?.click()}
            className="import-photos-btn"
          >
            {t("map.importPhotos")}
          </button>
          {canSaveCurrentRoute && (
            <button
              onClick={() => setShowSaveModal(true)}
              className="save-btn"
            >
              {loadedRouteInfo ? t("map.saveChanges") : t("map.saveRoute")}
            </button>
          )}
          {loadedRouteInfo && routePoints.length >= 2 && (
            <>
              <button
                onClick={() => exportAsGpx(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1], name: p.name, note: p.note })))}
                className="btn-secondary"
              >
                {t("export.gpx")}
              </button>
              <button
                onClick={() => exportAsKml(loadedRouteInfo.name, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1], name: p.name, note: p.note })))}
                className="btn-secondary"
              >
                {t("export.kml")}
              </button>
              <button
                onClick={handleGenerateAiDescription}
                disabled={aiGenerating}
                className="btn-secondary"
              >
                {aiGenerating ? t("ai.generating") : t("ai.generateButton")}
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
          <button onClick={() => navigate("/bookmarks")} className="btn-secondary explore-nav-btn">
            {t("bookmarks.title")}
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
            max={new Date().getFullYear()}
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

      {showAiModal && (
        <div className="modal-overlay" onClick={() => setShowAiModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{t("ai.modalTitle")}</h2>
            <div className="modal-form">
              <p style={{ fontSize: "0.85em", color: "var(--text-secondary)", marginBottom: "8px" }}>{t("ai.hint")}</p>
              <textarea
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                rows={8}
                style={{ width: "100%", resize: "vertical", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-primary)", fontSize: "0.9em" }}
              />
              <div className="modal-actions">
                <button onClick={() => setShowAiModal(false)} className="modal-cancel">{t("ai.cancel")}</button>
                <button onClick={handleSaveAiDescription} disabled={aiSaving} className="modal-save">
                  {aiSaving ? t("map.saving") : t("ai.save")}
                </button>
              </div>
            </div>
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
              <div className="tag-selector">
                <label>{t("seasons.label")}</label>
                <div className="tag-selector-buttons">
                  {ALL_SEASONS.map((season) => (
                    <button
                      key={season}
                      type="button"
                      className={`tag-button${selectedSeasons.includes(season) ? " active" : ""}`}
                      onClick={() => toggleSeason(season)}
                    >
                      {t(`seasons.${season}` as any)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tag-selector">
                <label>{t("map.routeLineColor")}</label>
                <div className="route-color-controls">
                  <input
                    type="color"
                    value={routeLineColor}
                    onChange={(e) => setRouteLineColor(normalizeRouteLineColor(e.target.value))}
                    className="route-color-input"
                    aria-label={t("map.routeLineColor")}
                  />
                  <div className="route-color-swatches">
                    {ROUTE_LINE_COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`route-color-swatch${normalizeRouteLineColor(routeLineColor) === color ? " active" : ""}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setRouteLineColor(color)}
                        aria-label={`${t("map.routeLineColor")} ${color}`}
                        title={color}
                      />
                    ))}
                  </div>
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
        <LeafletAttributionPrefix />
        <BaseTileLayer url={currentProvider.url} attribution={currentProvider.attribution} />
        <MapRefCapture mapRef={mapRef} />
        <MapClickHandler onMapClick={handleMapClick} />
        <GeoSearchControl />
        {historicalMode && (
          <HistoricalMapOverlay year={historicalYear} opacity={historicalOpacity} />
        )}
        <RoutingControl
          waypoints={waypoints}
          routeSegments={routeSegments}
          color={routeLineColor}
          engineId={routingEngine}
          categoryNames={selectedCategoryNames}
        />
        <ManualRoutes
          waypoints={waypoints}
          routeSegments={routeSegments}
          color={routeLineColor}
          categoryNames={selectedCategoryNames}
        />
        {routePoints.map((point, index) => (
          <Marker
            key={`${point.id}-${point.photo ? "photo" : "no-photo"}-${point.previewSize ?? "default"}-${point.previewShape ?? "default"}-${point.markerColor ?? "default"}-${point.markerSize ?? "default"}`}
            position={point.position}
            icon={createMarkerIcon(point.photo, point.previewSize, point.previewShape, point.markerColor, point.markerSize)}
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
                onNoteChange={handlePointNoteChange}
                onMarkerColorChange={handlePointMarkerColorChange}
                onMarkerSizeChange={handlePointMarkerSizeChange}
                onPreviewSizeChange={handlePointPreviewSizeChange}
                onPreviewShapeChange={handlePointPreviewShapeChange}
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
                engineId={routingEngine}
                categoryNames={[]}
              />
              <ManualRoutes
                waypoints={overlayWaypoints}
                routeSegments={overlay.segments}
                color={overlay.color}
                categoryNames={[]}
              />
              {overlay.points.map((point, idx) => (
                <Marker
                  key={`overlay-${overlay.id}-${idx}-${point.previewSize ?? "default"}-${point.previewShape ?? "default"}-${point.markerColor ?? "default"}-${point.markerSize ?? "default"}`}
                  position={point.position}
                  icon={createColoredMarkerIcon(overlay.color, point.photo, point.previewSize, point.previewShape, point.markerColor, point.markerSize)}
                >
                  <Popup>
                    <div className="point-popup">
                      <div className="point-popup-header">
                        <strong>{overlay.name} — {t("map.point", { index: idx + 1 })}</strong>
                      </div>
                      {point.name && <div className="point-popup-name">{point.name}</div>}
                      <div className="point-popup-coords">
                        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
                        {point.position[1].toFixed(6)}
                      </div>
                      {point.note?.trim() && (
                        <div className="point-popup-note-text">{point.note}</div>
                      )}
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
          segments={routeSegments}
          categoryNames={selectedCategoryNames}
          engineId={routingEngine}
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
        onApplyPoints={handleChatApplyPoints}
        onShowRoutes={handleChatShowRoutes}
        mapContext={{
          points: routePoints.slice(-8).map((point) => ({
            lat: point.position[0],
            lng: point.position[1],
            name: point.name,
          })),
        }}
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
