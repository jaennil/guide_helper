import React, { useState, useEffect, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import "../App.css";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { routesApi, type Route as SavedRoute } from "../api/routes";
import { categoriesApi, type Category } from "../api/categories";
import { RouteStatsPanel } from "../components/RouteStatsPanel";
import { CommentSection } from "../components/CommentSection";
import { LikeRatingBar } from "../components/LikeRatingBar";
import { usePhotoNotifications } from "../hooks/usePhotoNotifications";
import { useRoutePointEditing } from "../hooks/useRoutePointEditing";
import { exportAsGpx, exportAsKml } from "../utils/exportRoute";
import { WeatherPanel } from "../components/WeatherPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { AiDescriptionModal } from "../components/AiDescriptionModal";
import { RouteInspectorPanel } from "../components/RouteInspectorPanel";
import { RouteMapCanvas } from "../components/RouteMapCanvas";
import { RouteMapToolbar } from "../components/RouteMapToolbar";
import { RouteOverlayLegend } from "../components/RouteOverlayLegend";
import {
  HistoricalCompareIndicator,
  HistoricalTimelinePanel,
} from "../components/HistoricalTimelinePanel";
import type { ChatPoint } from "../api/chat";
import { ROUTING_ENGINES, DEFAULT_ENGINE, type RoutingEngineId } from "../utils/routingEngines";
import { setRoutingEngine as setPathEngine } from "../utils/routePath";
import {
  DEFAULT_ROUTE_LINE_COLOR,
  normalizeRouteLineColor,
} from "../utils/routeColors";
import {
  appendChatPointsToRoute,
  buildChatPreviewPoints,
  buildRouteSavePayload,
  fromDatetimeLocalValue,
  hasAllChatPointsOnRoute,
  routeToEditorState,
  routeToOverlayRoute,
  toDatetimeLocalValue,
} from "../utils/routeEditorData";
import { focusMapOnPoint, focusMapOnPoints } from "../utils/routeMapViewport";
import type { OverlayRoute, RouteMode, RoutePoint, RouteSegment } from "../types/routeMap";
import { getErrorMessage } from "../utils/errors";

const ChatPanel = React.lazy(() =>
  import("../components/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);

const TILE_PROVIDERS = [
  { id: "yandex", name: "Yandex", url: "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator", attribution: "&copy; Yandex" },
  { id: "osm", name: "OpenStreetMap", url: "/api/v1/tile/{z}/{x}/{y}", attribution: "&copy; OpenStreetMap" },
  { id: "2gis", name: "2GIS", url: "https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", attribution: "&copy; 2GIS" },
  { id: "opentopomap", name: "OpenTopoMap", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap" },
];

type LoadedRouteInfo = SavedRoute;

const ROUTE_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
];

const CHAT_PREVIEW_ROUTE_COLOR = "#f59e0b";
const MIN_HISTORICAL_YEAR = 1700;
const HISTORICAL_SPEED_STEPS = [1, 5, 20] as const;
const HISTORICAL_MILESTONE_YEARS = [1703, 1812, 1917, 1945, 1991] as const;

interface HistoricalEraDefinition {
  id: string;
  start: number;
  end: number;
  titleKey: string;
  descriptionKey: string;
}

function clampHistoricalYear(year: number, maxYear: number) {
  return Math.min(maxYear, Math.max(MIN_HISTORICAL_YEAR, Math.round(year)));
}

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
  const [routeName, setRouteName] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [routeLineColor, setRouteLineColor] = useState(DEFAULT_ROUTE_LINE_COLOR);
  const [routeStartedAt, setRouteStartedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [overlayRoutes, setOverlayRoutes] = useState<OverlayRoute[]>([]);
  const [loadedRouteInfo, setLoadedRouteInfo] = useState<LoadedRouteInfo | null>(null);
  const [routeVersions, setRouteVersions] = useState<SavedRoute[]>([]);
  const [routeVersionsLoading, setRouteVersionsLoading] = useState(false);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalYear, setHistoricalYear] = useState(new Date().getFullYear());
  const [historicalOpacity, setHistoricalOpacity] = useState(0.7);
  const [historicalPlaying, setHistoricalPlaying] = useState(false);
  const [historicalSpeedStep, setHistoricalSpeedStep] = useState<(typeof HISTORICAL_SPEED_STEPS)[number]>(5);
  const [historicalCompareMode, setHistoricalCompareMode] = useState(false);
  const [historicalComparePosition, setHistoricalComparePosition] = useState(52);
  const [historicalCompareDragging, setHistoricalCompareDragging] = useState(false);
  const [historicalOverlayBusy, setHistoricalOverlayBusy] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPanelMounted, setChatPanelMounted] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [chatPreviewPoints, setChatPreviewPoints] = useState<RoutePoint[]>([]);
  const pointIdRef = useRef(0);
  const photoImportRef = useRef<HTMLInputElement>(null);
  const currentHistoricalYear = new Date().getFullYear();

  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!routeStartedAt) {
      return;
    }
    const date = new Date(routeStartedAt);
    if (!Number.isNaN(date.getTime())) {
      setHistoricalYear(clampHistoricalYear(date.getFullYear(), currentHistoricalYear));
    }
  }, [currentHistoricalYear, routeStartedAt]);

  useEffect(() => {
    if (!historicalMode) {
      setHistoricalPlaying(false);
      setHistoricalCompareMode(false);
      setHistoricalCompareDragging(false);
    }
  }, [historicalMode]);

  useEffect(() => {
    if (chatOpen) {
      setChatPanelMounted(true);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!historicalMode || !historicalPlaying || historicalOverlayBusy) {
      return;
    }

    const delayMs = historicalSpeedStep === 1 ? 900 : historicalSpeedStep === 5 ? 700 : 550;
    const timeoutId = window.setTimeout(() => {
      setHistoricalYear((previousYear) =>
        clampHistoricalYear(previousYear + historicalSpeedStep, currentHistoricalYear),
      );
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [currentHistoricalYear, historicalMode, historicalOverlayBusy, historicalPlaying, historicalSpeedStep]);

  useEffect(() => {
    if (historicalPlaying && historicalYear >= currentHistoricalYear) {
      setHistoricalPlaying(false);
    }
  }, [currentHistoricalYear, historicalPlaying, historicalYear]);

  useEffect(() => {
    if (!historicalCompareMode || !historicalCompareDragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      updateHistoricalComparePosition(event.clientX);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches[0]) {
        updateHistoricalComparePosition(event.touches[0].clientX);
      }
    };

    const stopDragging = () => {
      setHistoricalCompareDragging(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", stopDragging);
    window.addEventListener("touchcancel", stopDragging);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopDragging);
      window.removeEventListener("touchcancel", stopDragging);
    };
  }, [historicalCompareDragging, historicalCompareMode]);

  useEffect(() => {
    categoriesApi.getCategories().then(cats => {
      setAvailableCategories(cats);
    }).catch(err => console.error('Failed to load categories:', err));
  }, []);

  useEffect(() => {
    if (routePoints.length === 0) {
      if (selectedPointId !== null) {
        setSelectedPointId(null);
      }
      return;
    }

    if (
      selectedPointId === null ||
      !routePoints.some((point) => point.id === selectedPointId)
    ) {
      setSelectedPointId(routePoints[routePoints.length - 1].id);
    }
  }, [routePoints, selectedPointId]);

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

  const handleHistoricalYearChange = (value: number) => {
    setHistoricalYear(clampHistoricalYear(value, currentHistoricalYear));
  };

  const handleHistoricalSpeedCycle = () => {
    const currentIndex = HISTORICAL_SPEED_STEPS.indexOf(historicalSpeedStep);
    const nextIndex = (currentIndex + 1) % HISTORICAL_SPEED_STEPS.length;
    setHistoricalSpeedStep(HISTORICAL_SPEED_STEPS[nextIndex]);
  };

  const handleHistoricalCompareToggle = () => {
    setHistoricalCompareMode((previousMode) => {
      const nextMode = !previousMode;
      if (!nextMode) {
        setHistoricalCompareDragging(false);
      }
      return nextMode;
    });
  };

  const updateHistoricalComparePosition = (clientX: number) => {
    const container = mapRef.current?.getContainer();
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setHistoricalComparePosition(Math.max(0, Math.min(100, Math.round(nextPosition))));
  };

  const startHistoricalCompareDrag = (clientX: number) => {
    updateHistoricalComparePosition(clientX);
    setHistoricalCompareDragging(true);
  };

  const handleHistoricalModeToggle = () => {
    setHistoricalMode((previousMode) => {
      const nextMode = !previousMode;
      if (nextMode && routeHistoricalYear) {
        setHistoricalYear(routeHistoricalYear);
      }
      if (!nextMode) {
        setHistoricalPlaying(false);
      }
      return nextMode;
    });
  };

  const { logout, user } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const normalizedRouteStartedAt = routeStartedAt ? fromDatetimeLocalValue(routeStartedAt) : undefined;
  const routeGeoPoints = useMemo(
    () => routePoints.map((point) => ({ lat: point.position[0], lng: point.position[1] })),
    [routePoints],
  );
  const routeHistoricalYear = normalizedRouteStartedAt
    ? clampHistoricalYear(new Date(normalizedRouteStartedAt).getFullYear(), currentHistoricalYear)
    : null;
  const historicalMilestones = useMemo(
    () => [
      ...HISTORICAL_MILESTONE_YEARS.map((year) => ({ year, label: String(year) })),
      { year: currentHistoricalYear, label: t("historical.now") },
    ],
    [currentHistoricalYear, t],
  );
  const historicalEraDefinitions = useMemo<HistoricalEraDefinition[]>(
    () => [
      {
        id: "earlyEmpire",
        start: MIN_HISTORICAL_YEAR,
        end: 1811,
        titleKey: "historical.era.earlyEmpire.title",
        descriptionKey: "historical.era.earlyEmpire.description",
      },
      {
        id: "imperialCity",
        start: 1812,
        end: 1916,
        titleKey: "historical.era.imperialCity.title",
        descriptionKey: "historical.era.imperialCity.description",
      },
      {
        id: "revolution",
        start: 1917,
        end: 1944,
        titleKey: "historical.era.revolution.title",
        descriptionKey: "historical.era.revolution.description",
      },
      {
        id: "postwar",
        start: 1945,
        end: 1990,
        titleKey: "historical.era.postwar.title",
        descriptionKey: "historical.era.postwar.description",
      },
      {
        id: "postSoviet",
        start: 1991,
        end: Math.max(1991, currentHistoricalYear - 1),
        titleKey: "historical.era.postSoviet.title",
        descriptionKey: "historical.era.postSoviet.description",
      },
      {
        id: "contemporary",
        start: currentHistoricalYear,
        end: currentHistoricalYear,
        titleKey: "historical.era.contemporary.title",
        descriptionKey: "historical.era.contemporary.description",
      },
    ],
    [currentHistoricalYear],
  );
  const historicalContext = useMemo(() => {
    const matchedEra =
      historicalEraDefinitions.find(
        (era) => historicalYear >= era.start && historicalYear <= era.end,
      ) ?? historicalEraDefinitions[historicalEraDefinitions.length - 1];

    const includesRouteYear =
      routeHistoricalYear !== null &&
      routeHistoricalYear >= matchedEra.start &&
      routeHistoricalYear <= matchedEra.end;

    return {
      ...matchedEra,
      title: t(matchedEra.titleKey as never),
      description: t(matchedEra.descriptionKey as never),
      periodLabel:
        matchedEra.end >= currentHistoricalYear
          ? t("historical.periodToNow", { from: matchedEra.start })
          : t("historical.periodRange", { from: matchedEra.start, to: matchedEra.end }),
      includesRouteYear,
    };
  }, [currentHistoricalYear, historicalEraDefinitions, historicalYear, routeHistoricalYear, t]);
  const historicalProgress = Math.max(
    0,
    Math.min(100, ((historicalYear - MIN_HISTORICAL_YEAR) / (currentHistoricalYear - MIN_HISTORICAL_YEAR)) * 100),
  );
  const selectedHistoricalSpeedLabel = `x${historicalSpeedStep}`;

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

  useEffect(() => {
    const routeId = loadedRouteInfo?.id;

    if (!routeId) {
      setRouteVersions([]);
      setRouteVersionsLoading(false);
      return;
    }

    const resolvedRouteId: string = routeId;
    let cancelled = false;

    async function loadRouteVersions() {
      setRouteVersionsLoading(true);
      try {
        const versions = await routesApi.getRouteVersions(resolvedRouteId);
        if (!cancelled) {
          setRouteVersions(versions);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load route versions:", error);
          setRouteVersions([]);
        }
      } finally {
        if (!cancelled) {
          setRouteVersionsLoading(false);
        }
      }
    }

    void loadRouteVersions();

    return () => {
      cancelled = true;
    };
  }, [loadedRouteInfo?.id]);

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
      const editorState = routeToEditorState(route);
      setLoadedRouteInfo(route);
      setRouteName(editorState.routeName);
      setSelectedCategoryIds(editorState.selectedCategoryIds);
      setSelectedSeasons(editorState.selectedSeasons);
      setRouteLineColor(editorState.routeLineColor);
      setRouteStartedAt(editorState.routeStartedAt);
      setRoutePoints(editorState.points);
      setSelectedPointId(editorState.points[0]?.id ?? null);
      setChatPreviewPoints([]);
      setSaveError("");
      pointIdRef.current = editorState.nextPointId;
      setRouteSegments(editorState.segments);
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
        loaded.push(routeToOverlayRoute(result.value, ROUTE_COLORS[idx % ROUTE_COLORS.length]));
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
    } catch (err) {
      const msg = getErrorMessage(err, t("ai.unavailable"));
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
    } catch (err) {
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
      const payload = buildRouteSavePayload({
        routeName,
        routePoints,
        routeSegments,
        selectedCategoryIds,
        selectedSeasons,
        routeLineColor,
        routeStartedAt,
      });
      let savedRoute;

      if (loadedRouteInfo) {
        savedRoute = await routesApi.updateRoute(loadedRouteInfo.id, {
          ...payload,
          started_at: payload.started_at ?? null,
        });
      } else {
        savedRoute = await routesApi.createRoute({
          ...payload,
        });
      }
      setRouteName(savedRoute.name);
      setRouteLineColor(normalizeRouteLineColor(savedRoute.line_color));
      setRouteStartedAt(toDatetimeLocalValue(savedRoute.started_at));
      setLoadedRouteInfo(savedRoute);
      toast.success(t("map.routeSaved"));
    } catch (err) {
      setSaveError(getErrorMessage(err, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  };

  const handlePublishDraft = async () => {
    if (!loadedRouteInfo?.is_draft) {
      return;
    }

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
      const payload = buildRouteSavePayload({
        routeName,
        routePoints,
        routeSegments,
        selectedCategoryIds,
        selectedSeasons,
        routeLineColor,
        routeStartedAt,
      });
      const savedRoute = await routesApi.updateRoute(loadedRouteInfo.id, {
        ...payload,
        started_at: payload.started_at ?? null,
        is_draft: false,
      });
      setLoadedRouteInfo(savedRoute);
      setRouteName(savedRoute.name);
      setRouteLineColor(normalizeRouteLineColor(savedRoute.line_color));
      setRouteStartedAt(toDatetimeLocalValue(savedRoute.started_at));
      toast.success(t("map.draftPublished"));
    } catch (err) {
      setSaveError(getErrorMessage(err, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCreateVersion = async () => {
    if (!loadedRouteInfo || loadedRouteInfo.is_draft) {
      return;
    }

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
      const payload = buildRouteSavePayload({
        routeName,
        routePoints,
        routeSegments,
        selectedCategoryIds,
        selectedSeasons,
        routeLineColor,
        routeStartedAt,
      });
      const createdRoute = await routesApi.createRoute({
        ...payload,
        is_draft: true,
        source_route_id: loadedRouteInfo.id,
      });
      setLoadedRouteInfo(createdRoute);
      setRouteName(createdRoute.name);
      setRouteLineColor(normalizeRouteLineColor(createdRoute.line_color));
      setRouteStartedAt(toDatetimeLocalValue(createdRoute.started_at));
      toast.success(t("map.versionCreated"));
      window.history.replaceState({}, "", `/map?route=${createdRoute.id}`);
    } catch (err) {
      setSaveError(getErrorMessage(err, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearRoute = () => {
    if (routePoints.length > 0 || overlayRoutes.length > 0 || chatPreviewPoints.length > 0) {
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
    setRouteStartedAt("");
    setSaveError("");
    setSelectedPointId(null);
    setChatPreviewPoints([]);
    pointIdRef.current = 0;
  };

  const {
    handleImportPhotos,
    handleMapClick,
    handlePhotoChange,
    handlePointDrag,
    handlePointMarkerColorChange,
    handlePointMarkerSizeChange,
    handlePointNoteChange,
    handlePointPreviewShapeChange,
    handlePointPreviewSizeChange,
    handleSegmentDurationChange,
  } = useRoutePointEditing({
    routeMode,
    routePointsLength: routePoints.length,
    setRoutePoints,
    setRouteSegments,
    setSelectedPointId,
    setChatPreviewPoints,
    pointIdRef,
    photoImportRef,
    t,
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const mapRef = useRef<L.Map | null>(null);
  const handleTileProviderChange = (providerId: string) => {
    setTileProvider(providerId);
    localStorage.setItem("tileProvider", providerId);
  };

  const focusCurrentPoints = (points: RoutePoint[]) => {
    focusMapOnPoints(mapRef.current, points);
  };

  const focusCurrentPoint = (pointId: number) => {
    focusMapOnPoint(mapRef.current, routePoints, pointId);
  };

  const handleChatPreviewPoints = (points: ChatPoint[]) => {
    const previewPoints = buildChatPreviewPoints(points, CHAT_PREVIEW_ROUTE_COLOR);

    if (previewPoints.length === 0) {
      setChatPreviewPoints([]);
      return;
    }

    setChatPreviewPoints(hasAllChatPointsOnRoute(routePoints, previewPoints) ? [] : previewPoints);
  };

  const handleChatFocusPoints = (points: ChatPoint[]) => {
    const focusTargets = buildChatPreviewPoints(points, CHAT_PREVIEW_ROUTE_COLOR);

    if (focusTargets.length === 0) {
      return;
    }

    if (hasAllChatPointsOnRoute(routePoints, focusTargets)) {
      focusCurrentPoints(routePoints.length >= 2 ? routePoints : focusTargets);
      return;
    }

    setChatPreviewPoints(focusTargets);
    focusCurrentPoints(focusTargets);
  };

  const handleChatApplyPoints = (points: ChatPoint[]) => {
    const result = appendChatPointsToRoute({
      existingPoints: routePoints,
      incomingChatPoints: points,
      nextPointId: pointIdRef.current,
      routeMode,
    });
    pointIdRef.current = result.nextPointId;
    setRoutePoints(result.nextPoints);
    setRouteSegments((prevSegments) => [...prevSegments, ...result.newSegments]);
    setChatPreviewPoints([]);
    if (result.appendedPoints.length > 0) {
      setSelectedPointId(result.appendedPoints[result.appendedPoints.length - 1].id);
    }
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
  const selectedPointIndex =
    selectedPointId === null
      ? -1
      : routePoints.findIndex((point) => point.id === selectedPointId);
  const selectedPoint =
    selectedPointIndex >= 0 ? routePoints[selectedPointIndex] : null;

  return (
    <div className="App">
      <RouteMapToolbar
        routeMode={routeMode}
        onRouteModeChange={setRouteMode}
        routingEngine={routingEngine}
        routingEngineOptions={ROUTING_ENGINES.map((engine) => ({ value: engine.id, label: engine.label }))}
        onRoutingEngineChange={handleEngineChange}
        tileProvider={tileProvider}
        tileProviderOptions={TILE_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name }))}
        onTileProviderChange={handleTileProviderChange}
        canSaveCurrentRoute={canSaveCurrentRoute}
        saveLabel={loadedRouteInfo ? t("map.saveChanges") : t("map.saveRoute")}
        onSaveRoute={handleSaveRoute}
        onOpenCatalog={() => navigate("/explore")}
        onImportPhotos={() => photoImportRef.current?.click()}
        canExport={Boolean(loadedRouteInfo && routePoints.length >= 2)}
        onExportGpx={() => {
          if (!loadedRouteInfo) {
            return;
          }
          exportAsGpx(loadedRouteInfo.name, routePoints.map((point) => ({
            lat: point.position[0],
            lng: point.position[1],
            name: point.name,
            note: point.note,
          })));
        }}
        onExportKml={() => {
          if (!loadedRouteInfo) {
            return;
          }
          exportAsKml(loadedRouteInfo.name, routePoints.map((point) => ({
            lat: point.position[0],
            lng: point.position[1],
            name: point.name,
            note: point.note,
          })));
        }}
        canGenerateAiDescription={Boolean(loadedRouteInfo && routePoints.length >= 2)}
        aiGenerating={aiGenerating}
        onGenerateAiDescription={handleGenerateAiDescription}
        canPlayback={routePoints.length >= 2}
        onStartPlayback={() => setPlaybackActive(true)}
        historicalMode={historicalMode}
        onToggleHistoricalMode={handleHistoricalModeToggle}
        hasClearableContent={routePoints.length > 0 || overlayRoutes.length > 0 || chatPreviewPoints.length > 0}
        onClearRoute={handleClearRoute}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((previous) => !previous)}
        userLabel={user?.name || user?.email || t("map.profile")}
        onOpenProfile={() => navigate("/profile")}
        onOpenBookmarks={() => navigate("/bookmarks")}
        isLightTheme={theme === "light"}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      />
      <input
        type="file"
        ref={photoImportRef}
        multiple
        accept="image/*"
        onChange={handleImportPhotos}
        style={{ display: "none" }}
      />

      <RouteOverlayLegend routes={overlayRoutes} />

      {historicalMode && (
        <HistoricalTimelinePanel
          historicalPlaying={historicalPlaying}
          historicalProgress={historicalProgress}
          historicalYear={historicalYear}
          currentHistoricalYear={currentHistoricalYear}
          routeHistoricalYear={routeHistoricalYear}
          historicalContext={historicalContext}
          historicalMilestones={historicalMilestones}
          historicalSpeedLabel={selectedHistoricalSpeedLabel}
          historicalCompareMode={historicalCompareMode}
          historicalComparePosition={historicalComparePosition}
          historicalOpacity={historicalOpacity}
          onTogglePlay={() => {
            if (historicalYear >= currentHistoricalYear) {
              handleHistoricalYearChange(routeHistoricalYear ?? MIN_HISTORICAL_YEAR);
            }
            setHistoricalPlaying((previous) => !previous);
          }}
          onCycleSpeed={handleHistoricalSpeedCycle}
          onToggleCompare={handleHistoricalCompareToggle}
          onHistoricalYearChange={handleHistoricalYearChange}
          onComparePositionChange={setHistoricalComparePosition}
          onHistoricalOpacityChange={setHistoricalOpacity}
        />
      )}

      {historicalMode && historicalCompareMode && (
        <HistoricalCompareIndicator
          historicalComparePosition={historicalComparePosition}
          onStartDrag={startHistoricalCompareDrag}
          ariaLabel={t("historical.comparePosition")}
        />
      )}

      <AiDescriptionModal
        isOpen={showAiModal}
        value={aiDescription}
        saving={aiSaving}
        onChange={setAiDescription}
        onClose={() => setShowAiModal(false)}
        onSave={handleSaveAiDescription}
      />

      {routePoints.length > 0 && !chatOpen && (
        <RouteInspectorPanel
          routeName={routeName}
          onRouteNameChange={setRouteName}
          availableCategories={availableCategories}
          selectedCategoryIds={selectedCategoryIds}
          toggleCategory={toggleCategory}
          allSeasons={ALL_SEASONS}
          selectedSeasons={selectedSeasons}
          toggleSeason={toggleSeason}
          routeLineColor={routeLineColor}
          onRouteLineColorChange={setRouteLineColor}
          routeStartedAt={routeStartedAt}
          onRouteStartedAtChange={setRouteStartedAt}
          routePoints={routePoints}
          selectedPointId={selectedPointId}
          onSelectPoint={(pointId) => setSelectedPointId(pointId)}
          selectedPoint={selectedPoint}
          selectedPointIndex={selectedPointIndex}
          onPhotoChange={handlePhotoChange}
          onNoteChange={handlePointNoteChange}
          onMarkerColorChange={handlePointMarkerColorChange}
          onMarkerSizeChange={handlePointMarkerSizeChange}
          onPreviewSizeChange={handlePointPreviewSizeChange}
          onPreviewShapeChange={handlePointPreviewShapeChange}
          onFocusPoint={focusCurrentPoint}
          onSaveRoute={handleSaveRoute}
          onPublishDraft={handlePublishDraft}
          onCreateVersion={handleCreateVersion}
          onOpenVersion={loadRoute}
          saveLoading={saveLoading}
          saveError={saveError}
          canSaveCurrentRoute={canSaveCurrentRoute}
          loadedRouteInfo={loadedRouteInfo}
          routeVersions={routeVersions}
          routeVersionsLoading={routeVersionsLoading}
        />
      )}
      <RouteMapCanvas
        mapRef={mapRef}
        tileUrl={currentProvider.url}
        tileAttribution={currentProvider.attribution}
        onMapClick={handleMapClick}
        historicalMode={historicalMode}
        historicalYear={historicalYear}
        historicalOpacity={historicalOpacity}
        historicalCompareMode={historicalCompareMode}
        historicalComparePosition={historicalComparePosition}
        onHistoricalOverlayBusyChange={setHistoricalOverlayBusy}
        routePoints={routePoints}
        routeSegments={routeSegments}
        routeMode={routeMode}
        routeLineColor={routeLineColor}
        routingEngine={routingEngine}
        selectedCategoryNames={selectedCategoryNames}
        onSegmentDurationChange={handleSegmentDurationChange}
        chatPreviewPoints={chatPreviewPoints}
        chatPreviewColor={CHAT_PREVIEW_ROUTE_COLOR}
        onSelectPoint={setSelectedPointId}
        onPointDrag={handlePointDrag}
        overlayRoutes={overlayRoutes}
        playbackActive={playbackActive}
        onClosePlayback={() => setPlaybackActive(false)}
        t={t}
      />
      {!playbackActive && routePoints.length >= 2 && (
        <RouteStatsPanel
          points={routeGeoPoints}
          segments={routeSegments}
          categoryNames={selectedCategoryNames}
          engineId={routingEngine}
        />
      )}
      {!playbackActive && routePoints.length >= 2 && (
        <WeatherPanel
          points={routeGeoPoints}
          startedAt={normalizedRouteStartedAt}
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
      {chatPanelMounted && (
        <React.Suspense fallback={null}>
          <ChatPanel
            isOpen={chatOpen}
            onClose={() => setChatOpen(false)}
            onPreviewPoints={handleChatPreviewPoints}
            onFocusPoints={handleChatFocusPoints}
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
        </React.Suspense>
      )}
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
