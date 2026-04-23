import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import toast from "react-hot-toast";
import { routesApi, type Route as SavedRoute } from "../api/routes";
import type { TranslationKey } from "../i18n";
import type { OverlayRoute, RoutePoint, RouteSegment } from "../types/routeMap";
import { getErrorMessage } from "../utils/errors";
import {
  buildRouteSavePayload,
  routeToEditorState,
  routeToOverlayRoute,
  toDatetimeLocalValue,
} from "../utils/routeEditorData";
import { DEFAULT_ROUTE_LINE_COLOR, normalizeRouteLineColor } from "../utils/routeColors";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface UseRoutePersistenceParams {
  routeName: string;
  routePoints: RoutePoint[];
  routeSegments: RouteSegment[];
  selectedCategoryIds: string[];
  selectedSeasons: string[];
  routeLineColor: string;
  routeStartedAt: string;
  chatPreviewPoints: RoutePoint[];
  pointIdRef: MutableRefObject<number>;
  overlayColors: string[];
  t: Translate;
  setRouteName: Dispatch<SetStateAction<string>>;
  setSelectedCategoryIds: Dispatch<SetStateAction<string[]>>;
  setSelectedSeasons: Dispatch<SetStateAction<string[]>>;
  setRouteLineColor: Dispatch<SetStateAction<string>>;
  setRouteStartedAt: Dispatch<SetStateAction<string>>;
  setRoutePoints: Dispatch<SetStateAction<RoutePoint[]>>;
  setRouteSegments: Dispatch<SetStateAction<RouteSegment[]>>;
  setSelectedPointId: Dispatch<SetStateAction<number | null>>;
  setChatPreviewPoints: Dispatch<SetStateAction<RoutePoint[]>>;
}

function applyRouteToEditorState(
  route: SavedRoute,
  pointIdRef: MutableRefObject<number>,
  setRouteName: Dispatch<SetStateAction<string>>,
  setSelectedCategoryIds: Dispatch<SetStateAction<string[]>>,
  setSelectedSeasons: Dispatch<SetStateAction<string[]>>,
  setRouteLineColor: Dispatch<SetStateAction<string>>,
  setRouteStartedAt: Dispatch<SetStateAction<string>>,
  setRoutePoints: Dispatch<SetStateAction<RoutePoint[]>>,
  setRouteSegments: Dispatch<SetStateAction<RouteSegment[]>>,
  setSelectedPointId: Dispatch<SetStateAction<number | null>>,
  setChatPreviewPoints: Dispatch<SetStateAction<RoutePoint[]>>,
) {
  const editorState = routeToEditorState(route);
  setRouteName(editorState.routeName);
  setSelectedCategoryIds(editorState.selectedCategoryIds);
  setSelectedSeasons(editorState.selectedSeasons);
  setRouteLineColor(editorState.routeLineColor);
  setRouteStartedAt(editorState.routeStartedAt);
  setRoutePoints(editorState.points);
  setRouteSegments(editorState.segments);
  setSelectedPointId(editorState.points[0]?.id ?? null);
  setChatPreviewPoints([]);
  pointIdRef.current = editorState.nextPointId;
}

function resetRouteEditor(
  pointIdRef: MutableRefObject<number>,
  setRouteName: Dispatch<SetStateAction<string>>,
  setSelectedCategoryIds: Dispatch<SetStateAction<string[]>>,
  setSelectedSeasons: Dispatch<SetStateAction<string[]>>,
  setRouteLineColor: Dispatch<SetStateAction<string>>,
  setRouteStartedAt: Dispatch<SetStateAction<string>>,
  setRoutePoints: Dispatch<SetStateAction<RoutePoint[]>>,
  setRouteSegments: Dispatch<SetStateAction<RouteSegment[]>>,
  setSelectedPointId: Dispatch<SetStateAction<number | null>>,
  setChatPreviewPoints: Dispatch<SetStateAction<RoutePoint[]>>,
) {
  setRouteName("");
  setSelectedCategoryIds([]);
  setSelectedSeasons([]);
  setRouteLineColor(DEFAULT_ROUTE_LINE_COLOR);
  setRouteStartedAt("");
  setRoutePoints([]);
  setRouteSegments([]);
  setSelectedPointId(null);
  setChatPreviewPoints([]);
  pointIdRef.current = 0;
}

export function useRoutePersistence({
  routeName,
  routePoints,
  routeSegments,
  selectedCategoryIds,
  selectedSeasons,
  routeLineColor,
  routeStartedAt,
  chatPreviewPoints,
  pointIdRef,
  overlayColors,
  t,
  setRouteName,
  setSelectedCategoryIds,
  setSelectedSeasons,
  setRouteLineColor,
  setRouteStartedAt,
  setRoutePoints,
  setRouteSegments,
  setSelectedPointId,
  setChatPreviewPoints,
}: UseRoutePersistenceParams) {
  const [overlayRoutes, setOverlayRoutes] = useState<OverlayRoute[]>([]);
  const [loadedRouteInfo, setLoadedRouteInfo] = useState<SavedRoute | null>(null);
  const [routeVersions, setRouteVersions] = useState<SavedRoute[]>([]);
  const [routeVersionsLoading, setRouteVersionsLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);

  useEffect(() => {
    const routeId = loadedRouteInfo?.id;
    if (!routeId) {
      setRouteVersions([]);
      setRouteVersionsLoading(false);
      return;
    }

    const resolvedRouteId = routeId;
    let cancelled = false;
    setRouteVersionsLoading(true);

    async function loadRouteVersions() {
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

  const loadRoute = useCallback(async (routeId: string) => {
    try {
      const route = await routesApi.getRoute(routeId);
      setLoadedRouteInfo(route);
      applyRouteToEditorState(
        route,
        pointIdRef,
        setRouteName,
        setSelectedCategoryIds,
        setSelectedSeasons,
        setRouteLineColor,
        setRouteStartedAt,
        setRoutePoints,
        setRouteSegments,
        setSelectedPointId,
        setChatPreviewPoints,
      );
      setSaveError("");
    } catch (error) {
      console.error("Failed to load route:", error);
    }
  }, [
    pointIdRef,
    setChatPreviewPoints,
    setRouteLineColor,
    setRouteName,
    setRoutePoints,
    setRouteSegments,
    setRouteStartedAt,
    setSelectedCategoryIds,
    setSelectedPointId,
    setSelectedSeasons,
  ]);

  const loadOverlayRoutes = useCallback(async (ids: string[]) => {
    console.log("Loading overlay routes:", ids);
    const results = await Promise.allSettled(ids.map((id) => routesApi.getRoute(id)));

    const loaded: OverlayRoute[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        loaded.push(routeToOverlayRoute(result.value, overlayColors[index % overlayColors.length]));
      } else {
        console.error(`Failed to load overlay route ${ids[index]}:`, result.reason);
      }
    });

    console.log("Loaded overlay routes:", loaded.length);
    setOverlayRoutes(loaded);
  }, [overlayColors]);

  const handleGenerateAiDescription = useCallback(async () => {
    if (!loadedRouteInfo) {
      return;
    }
    setAiGenerating(true);
    try {
      const result = await routesApi.generateDescription(loadedRouteInfo.id);
      setAiDescription(result.description);
      setShowAiModal(true);
      console.log("AI description generated for route:", loadedRouteInfo.id);
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.unavailable")));
      console.error("Failed to generate AI description:", error);
    } finally {
      setAiGenerating(false);
    }
  }, [loadedRouteInfo, t]);

  const handleSaveAiDescription = useCallback(async () => {
    if (!loadedRouteInfo) {
      return;
    }
    setAiSaving(true);
    try {
      await routesApi.saveDescription(loadedRouteInfo.id, aiDescription);
      setShowAiModal(false);
      toast.success(t("map.routeSaved"));
      console.log("AI description saved for route:", loadedRouteInfo.id);
    } catch (error) {
      toast.error(t("map.saveFailed"));
      console.error("Failed to save AI description:", error);
    } finally {
      setAiSaving(false);
    }
  }, [aiDescription, loadedRouteInfo, t]);

  const validateRouteBeforeSave = useCallback(() => {
    if (!routeName.trim()) {
      setSaveError(t("map.pleaseEnterRouteName"));
      return false;
    }

    if (routePoints.length < 2) {
      setSaveError(t("map.routeMinPoints"));
      return false;
    }

    return true;
  }, [routeName, routePoints.length, t]);

  const handleSaveRoute = useCallback(async () => {
    if (!validateRouteBeforeSave()) {
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

      const savedRoute = loadedRouteInfo
        ? await routesApi.updateRoute(loadedRouteInfo.id, {
            ...payload,
            started_at: payload.started_at ?? null,
          })
        : await routesApi.createRoute(payload);

      setRouteName(savedRoute.name);
      setRouteLineColor(normalizeRouteLineColor(savedRoute.line_color));
      setRouteStartedAt(toDatetimeLocalValue(savedRoute.started_at));
      setLoadedRouteInfo(savedRoute);
      toast.success(t("map.routeSaved"));
    } catch (error) {
      setSaveError(getErrorMessage(error, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  }, [
    loadedRouteInfo,
    routeLineColor,
    routeName,
    routePoints,
    routeSegments,
    routeStartedAt,
    selectedCategoryIds,
    selectedSeasons,
    setRouteLineColor,
    setRouteName,
    setRouteStartedAt,
    t,
    validateRouteBeforeSave,
  ]);

  const handlePublishDraft = useCallback(async () => {
    if (!loadedRouteInfo?.is_draft || !validateRouteBeforeSave()) {
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
    } catch (error) {
      setSaveError(getErrorMessage(error, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  }, [
    loadedRouteInfo,
    routeLineColor,
    routeName,
    routePoints,
    routeSegments,
    routeStartedAt,
    selectedCategoryIds,
    selectedSeasons,
    setRouteLineColor,
    setRouteName,
    setRouteStartedAt,
    t,
    validateRouteBeforeSave,
  ]);

  const handleCreateVersion = useCallback(async () => {
    if (!loadedRouteInfo || loadedRouteInfo.is_draft || !validateRouteBeforeSave()) {
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
    } catch (error) {
      setSaveError(getErrorMessage(error, t("map.saveFailed")));
    } finally {
      setSaveLoading(false);
    }
  }, [
    loadedRouteInfo,
    routeLineColor,
    routeName,
    routePoints,
    routeSegments,
    routeStartedAt,
    selectedCategoryIds,
    selectedSeasons,
    setRouteLineColor,
    setRouteName,
    setRouteStartedAt,
    t,
    validateRouteBeforeSave,
  ]);

  const doClearRoute = useCallback(() => {
    setOverlayRoutes([]);
    setLoadedRouteInfo(null);
    setRouteVersions([]);
    setRouteVersionsLoading(false);
    setSaveError("");
    resetRouteEditor(
      pointIdRef,
      setRouteName,
      setSelectedCategoryIds,
      setSelectedSeasons,
      setRouteLineColor,
      setRouteStartedAt,
      setRoutePoints,
      setRouteSegments,
      setSelectedPointId,
      setChatPreviewPoints,
    );
  }, [
    pointIdRef,
    setChatPreviewPoints,
    setRouteLineColor,
    setRouteName,
    setRoutePoints,
    setRouteSegments,
    setRouteStartedAt,
    setSelectedCategoryIds,
    setSelectedPointId,
    setSelectedSeasons,
  ]);

  const handleClearRoute = useCallback(() => {
    if (routePoints.length > 0 || overlayRoutes.length > 0 || chatPreviewPoints.length > 0) {
      setShowConfirmClear(true);
      return;
    }
    doClearRoute();
  }, [chatPreviewPoints.length, doClearRoute, overlayRoutes.length, routePoints.length]);

  const confirmClearRoute = useCallback(() => {
    setShowConfirmClear(false);
    doClearRoute();
  }, [doClearRoute]);

  const cancelClearRoute = useCallback(() => {
    setShowConfirmClear(false);
  }, []);

  return {
    aiDescription,
    aiGenerating,
    aiSaving,
    handleClearRoute,
    handleCreateVersion,
    handleGenerateAiDescription,
    handlePublishDraft,
    handleSaveAiDescription,
    handleSaveRoute,
    loadOverlayRoutes,
    loadRoute,
    loadedRouteInfo,
    overlayRoutes,
    routeVersions,
    routeVersionsLoading,
    saveError,
    saveLoading,
    setAiDescription,
    setShowAiModal,
    showAiModal,
    showConfirmClear,
    confirmClearRoute,
    cancelClearRoute,
  };
}
