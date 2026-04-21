import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  createTrackedRoute,
  updateTrackedRoute,
} from "../api/routes";
import {
  readPendingRouteUploads,
  writePendingRouteUploads,
  type PendingRouteUpload,
} from "../storage/pendingRouteUploads";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "../storage/jsonStore";
import type { SavedRouteResponse } from "../api/routes";
import type {
  RoutePointPayload,
  TrackSample,
  TrackingMetrics,
  TrackingSession,
} from "../types/tracking";
import {
  buildTrackingSyncFingerprint,
  buildRoutePointsFromSamples,
  calculateTrackingMetrics,
  buildTrackedRoutePayload,
  buildTrackedRouteUpdatePayload,
  DEFAULT_ROUTE_LINE_COLOR,
  mergeTrackSamples,
  normalizeRouteLineColor,
} from "../utils/geo";
import {
  clearBackgroundSamples,
  drainBackgroundSamples,
  isBackgroundTrackingActive,
  normalizeForegroundSample,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "../location/locationTask";
import { FOREGROUND_TRACKING_OPTIONS } from "../location/trackingOptions";
import {
  syncPendingRouteUploadsBatch,
} from "../services/pendingRouteSync";

const SESSION_FILE = "tracking-session.json";

const EMPTY_SESSION: TrackingSession = {
  id: null,
  name: "",
  status: "idle",
  routeStartedAt: undefined,
  pausedDurationMs: 0,
  samples: [],
  routePoints: [],
  categoryIds: [],
  seasons: [],
  lineColor: DEFAULT_ROUTE_LINE_COLOR,
};

function buildClearedSession(previous?: Partial<TrackingSession> | null): TrackingSession {
  return hydrateSession({
    ...EMPTY_SESSION,
    name: previous?.name?.trim() ?? "",
    categoryIds: previous?.categoryIds ?? [],
    seasons: previous?.seasons ?? [],
    lineColor: previous?.lineColor ?? DEFAULT_ROUTE_LINE_COLOR,
    serverRouteId: undefined,
    lastSavedRouteId: undefined,
    lastQueuedUploadId: undefined,
    serverBaselineFingerprint: undefined,
    queuedBaselineFingerprint: undefined,
  });
}

function buildSessionId() {
  return `track-${Date.now()}`;
}

function buildDefaultRouteName() {
  const now = new Date();
  return `Маршрут ${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function buildPendingUploadId() {
  return `pending-${Date.now()}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildSamplesFromPendingUpload(upload: PendingRouteUpload): TrackSample[] {
  const baseStartedAt = upload.payload.started_at ?? upload.createdAt;
  const baseTimestamp = new Date(baseStartedAt).getTime();
  const safeBaseTimestamp = Number.isFinite(baseTimestamp) ? baseTimestamp : Date.now();

  return upload.payload.points.map((point, index) => ({
    latitude: point.lat,
    longitude: point.lng,
    recordedAt: new Date(safeBaseTimestamp + index * 60_000).toISOString(),
    source: "foreground",
  }));
}

function buildSessionFromPendingUpload(upload: PendingRouteUpload): TrackingSession {
  const snapshot = upload.sessionSnapshot;
  const fallbackSamples = buildSamplesFromPendingUpload(upload);
  const samples = snapshot?.samples?.length ? snapshot.samples : fallbackSamples;
  const routePoints = snapshot?.routePoints?.length
    ? snapshot.routePoints
    : upload.payload.points;
  const startedAt =
    snapshot?.startedAt ??
    upload.payload.started_at ??
    upload.createdAt;

  const session = hydrateSession({
    id: buildSessionId(),
    name: upload.payload.name,
    status: "stopped",
    startedAt,
    routeStartedAt: snapshot?.routeStartedAt ?? upload.payload.started_at,
    endedAt: snapshot?.endedAt ?? upload.createdAt,
    pausedDurationMs: snapshot?.pausedDurationMs ?? 0,
    samples,
    routePoints,
    categoryIds: snapshot?.categoryIds ?? upload.payload.category_ids,
    seasons: snapshot?.seasons ?? upload.payload.seasons,
    lineColor: snapshot?.lineColor ?? upload.payload.line_color,
    serverRouteId: snapshot?.serverRouteId,
    lastQueuedUploadId: upload.id,
    lastSavedRouteId: undefined,
    serverBaselineFingerprint: snapshot?.serverBaselineFingerprint,
    queuedBaselineFingerprint: snapshot?.queuedBaselineFingerprint,
    pausedAt: undefined,
  });

  return {
    ...session,
    queuedBaselineFingerprint:
      session.queuedBaselineFingerprint ?? buildTrackingSyncFingerprint(session),
  };
}

function hydrateSession(session?: Partial<TrackingSession> | null): TrackingSession {
  return {
    ...EMPTY_SESSION,
    ...session,
    id: session?.id ?? null,
    name: session?.name ?? "",
    status: session?.status ?? "idle",
    pausedDurationMs: session?.pausedDurationMs ?? 0,
    samples: session?.samples ?? [],
    routePoints:
      session?.routePoints ??
      ((session?.samples?.length ?? 0) >= 2 && session?.status === "stopped"
        ? buildRoutePointsFromSamples(session?.samples ?? [])
        : []),
    categoryIds: session?.categoryIds ?? [],
    seasons: session?.seasons ?? [],
    lineColor: normalizeRouteLineColor(session?.lineColor),
    serverRouteId: session?.serverRouteId,
    serverBaselineFingerprint: session?.serverBaselineFingerprint,
    queuedBaselineFingerprint: session?.queuedBaselineFingerprint,
  };
}

function normalizeStoredSession(session?: Partial<TrackingSession> | null) {
  const hydrated = hydrateSession(session);

  if (
    hydrated.status === "stopped" &&
    hydrated.samples.length < 2 &&
    hydrated.routePoints.length === 0 &&
    !hydrated.lastQueuedUploadId
  ) {
    return buildClearedSession(hydrated);
  }

  return hydrated;
}

export interface SaveRouteResult {
  route: SavedRouteResponse;
}

export interface StopSessionResult {
  state: "stopped" | "cleared";
  sampleCount: number;
}

export function useTrackingSession() {
  const [session, setSession] = useState<TrackingSession>(EMPTY_SESSION);
  const [metrics, setMetrics] = useState<TrackingMetrics>(
    calculateTrackingMetrics(EMPTY_SESSION),
  );
  const [foregroundPermission, setForegroundPermission] = useState("undetermined");
  const [backgroundPermission, setBackgroundPermission] = useState("undetermined");
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [backgroundAvailable, setBackgroundAvailable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingRouteUpload[]>([]);

  const sessionRef = useRef<TrackingSession>(EMPTY_SESSION);
  const pendingUploadsRef = useRef<PendingRouteUpload[]>([]);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  async function persistSession(nextSession: TrackingSession) {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setMetrics(calculateTrackingMetrics(nextSession));

    if (nextSession.status === "idle" && nextSession.samples.length === 0) {
      await deleteJsonFile(SESSION_FILE);
      return;
    }

    await writeJsonFile(SESSION_FILE, nextSession);
  }

  async function persistPendingUploads(nextUploads: PendingRouteUpload[]) {
    pendingUploadsRef.current = nextUploads;
    setPendingUploads(nextUploads);
    await writePendingRouteUploads(nextUploads);
  }

  async function removePendingUpload(uploadId: string | undefined) {
    if (!uploadId) {
      return;
    }

    const nextUploads = pendingUploadsRef.current.filter((upload) => upload.id !== uploadId);
    if (nextUploads.length !== pendingUploadsRef.current.length) {
      await persistPendingUploads(nextUploads);
    }
  }

  async function refreshPermissionState() {
    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);

    setForegroundPermission(foreground.status);
    setBackgroundPermission(background.status);
  }

  async function flushBackgroundSamplesIntoSession() {
    const pendingSamples = await drainBackgroundSamples();
    if (pendingSamples.length === 0) {
      return;
    }

    const currentSession = sessionRef.current;
    if (currentSession.status === "idle") {
      return;
    }

    const mergedSamples = mergeTrackSamples(currentSession.samples, pendingSamples);
    if (mergedSamples.length === currentSession.samples.length) {
      return;
    }

    await persistSession({
      ...currentSession,
      samples: mergedSamples,
    });
  }

  async function stopForegroundWatch() {
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
  }

  async function ingestSamples(samples: TrackSample[]) {
    const currentSession = sessionRef.current;
    if (currentSession.status !== "recording") {
      return;
    }

    const mergedSamples = mergeTrackSamples(currentSession.samples, samples);
    if (mergedSamples.length === currentSession.samples.length) {
      return;
    }

    await persistSession({
      ...currentSession,
      samples: mergedSamples,
    });
    setError(null);
  }

  async function startForegroundWatch() {
    await stopForegroundWatch();

    watchRef.current = await Location.watchPositionAsync(
      FOREGROUND_TRACKING_OPTIONS,
      (location) => {
        void ingestSamples([normalizeForegroundSample(location)]);
      },
    );
  }

  async function startLocationPipelines() {
    await startForegroundWatch();

    const background = await Location.getBackgroundPermissionsAsync();
    setBackgroundPermission(background.status);

    if (background.status === "granted") {
      try {
        await startBackgroundTracking();
      } catch (backgroundError) {
        console.warn("Failed to start background tracking", backgroundError);
      }
    }

    setBackgroundActive(await isBackgroundTrackingActive());
  }

  async function stopLocationPipelines() {
    await stopForegroundWatch();
    await stopBackgroundTracking();
    setBackgroundActive(false);
  }

  async function requestPermissions() {
    const foreground = await Location.requestForegroundPermissionsAsync();
    setForegroundPermission(foreground.status);

    if (foreground.status !== "granted") {
      throw new Error("Доступ к геолокации не выдан.");
    }

    const taskManagerAvailable = await TaskManager.isAvailableAsync();
    setBackgroundAvailable(taskManagerAvailable);

    if (taskManagerAvailable) {
      const background = await Location.requestBackgroundPermissionsAsync();
      setBackgroundPermission(background.status);
    }
  }

  async function ensureInitialLocation() {
    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: 15_000,
      requiredAccuracy: 50,
    });

    if (lastKnown) {
      await ingestSamples([normalizeForegroundSample(lastKnown)]);
      return;
    }

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await ingestSamples([normalizeForegroundSample(current)]);
  }

  async function trySeedInitialLocation() {
    try {
      await ensureInitialLocation();
    } catch (locationError) {
      const message =
        locationError instanceof Error
          ? locationError.message
          : "Первая GPS-точка пока недоступна. Проверь, что геосервисы включены.";
      setError(message);
    }
  }

  async function startSession() {
    setIsBusy(true);
    setError(null);

    try {
      await requestPermissions();
      await clearBackgroundSamples();

      const now = new Date().toISOString();
      const name = sessionRef.current.name.trim() || buildDefaultRouteName();
      const nextSession: TrackingSession = {
        id: buildSessionId(),
        name,
        status: "recording",
        startedAt: now,
        routeStartedAt: now,
        pausedDurationMs: 0,
        samples: [],
        routePoints: [],
        categoryIds: sessionRef.current.categoryIds,
        seasons: sessionRef.current.seasons,
        lineColor: sessionRef.current.lineColor,
        serverRouteId: sessionRef.current.serverRouteId,
      };

      await persistSession(nextSession);
      await startLocationPipelines();
      await trySeedInitialLocation();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Не удалось начать запись.");
    } finally {
      setIsBusy(false);
    }
  }

  async function pauseSession() {
    const currentSession = sessionRef.current;
    if (currentSession.status !== "recording") {
      return;
    }

    await flushBackgroundSamplesIntoSession();
    await stopLocationPipelines();
    await persistSession({
      ...currentSession,
      status: "paused",
      pausedAt: new Date().toISOString(),
    });
  }

  async function resumeSession() {
    const currentSession = sessionRef.current;
    if (currentSession.status !== "paused") {
      return;
    }

    const pausedAt = currentSession.pausedAt
      ? new Date(currentSession.pausedAt).getTime()
      : Date.now();

    await persistSession({
      ...currentSession,
      status: "recording",
      pausedAt: undefined,
      pausedDurationMs: currentSession.pausedDurationMs + (Date.now() - pausedAt),
    });
    await startLocationPipelines();
    await trySeedInitialLocation();
  }

  async function stopSession(): Promise<StopSessionResult> {
    const currentSession = sessionRef.current;
    if (currentSession.status !== "recording" && currentSession.status !== "paused") {
      return {
        state: currentSession.samples.length >= 2 ? "stopped" : "cleared",
        sampleCount: currentSession.samples.length,
      };
    }

    await stopLocationPipelines();
    await flushBackgroundSamplesIntoSession();

    const latestSession = sessionRef.current;
    const pausedAt = latestSession.pausedAt
      ? new Date(latestSession.pausedAt).getTime()
      : null;
    const extraPausedMs = pausedAt ? Date.now() - pausedAt : 0;

    if (latestSession.samples.length < 2) {
      await persistSession(buildClearedSession(latestSession));
      return {
        state: "cleared",
        sampleCount: latestSession.samples.length,
      };
    }

    await persistSession({
      ...latestSession,
      status: "stopped",
      endedAt: new Date().toISOString(),
      pausedAt: undefined,
      pausedDurationMs: latestSession.pausedDurationMs + extraPausedMs,
      routePoints: buildRoutePointsFromSamples(latestSession.samples),
    });

    return {
      state: "stopped",
      sampleCount: latestSession.samples.length,
    };
  }

  async function resetSession() {
    await stopLocationPipelines();
    await clearBackgroundSamples();
    await persistSession(EMPTY_SESSION);
  }

  async function renameSession(name: string) {
    await persistSession({
      ...sessionRef.current,
      name,
    });
  }

  async function updateRoutePoint(index: number, patch: Partial<RoutePointPayload>) {
    const routePoints = sessionRef.current.routePoints.map((point, pointIndex) =>
      pointIndex === index ? { ...point, ...patch } : point,
    );

    await persistSession({
      ...sessionRef.current,
      routePoints,
    });
  }

  async function resetRoutePointsFromSamples() {
    await persistSession({
      ...sessionRef.current,
      routePoints: buildRoutePointsFromSamples(sessionRef.current.samples),
    });
  }

  async function setRouteStartedAt(routeStartedAt?: string) {
    await persistSession({
      ...sessionRef.current,
      routeStartedAt,
    });
  }

  async function toggleCategory(categoryId: string) {
    const current = sessionRef.current.categoryIds;
    const categoryIds = current.includes(categoryId)
      ? current.filter((id) => id !== categoryId)
      : current.length < 5
        ? [...current, categoryId]
        : current;

    await persistSession({
      ...sessionRef.current,
      categoryIds,
    });
  }

  async function toggleSeason(season: string) {
    const current = sessionRef.current.seasons;
    const seasons = current.includes(season)
      ? current.filter((value) => value !== season)
      : [...current, season];

    await persistSession({
      ...sessionRef.current,
      seasons,
    });
  }

  async function setRouteLineColor(lineColor: string) {
    await persistSession({
      ...sessionRef.current,
      lineColor: normalizeRouteLineColor(lineColor),
    });
  }

  async function saveRoute(): Promise<SaveRouteResult> {
    const currentSession = sessionRef.current;
    if (currentSession.samples.length < 2) {
      throw new Error("Для сохранения маршрута нужно минимум две GPS-точки.");
    }

    setIsUploading(true);
    setError(null);

    try {
      await flushBackgroundSamplesIntoSession();
      const latestSession = sessionRef.current;
      const savedRoute = latestSession.serverRouteId
        ? await updateTrackedRoute(
            latestSession.serverRouteId,
            buildTrackedRouteUpdatePayload(latestSession),
          )
        : await createTrackedRoute(buildTrackedRoutePayload(latestSession));
      await removePendingUpload(sessionRef.current.lastQueuedUploadId);

      const nextSession: TrackingSession = {
        ...sessionRef.current,
        serverRouteId: savedRoute.id,
        lastSavedRouteId: savedRoute.id,
        lastQueuedUploadId: undefined,
        queuedBaselineFingerprint: undefined,
      };
      await persistSession({
        ...nextSession,
        serverBaselineFingerprint: buildTrackingSyncFingerprint(nextSession),
      });

      return {
        route: savedRoute,
      };
    } catch (saveError) {
      const message = errorMessage(saveError, "Не удалось сохранить маршрут.");
      setError(message);
      throw saveError;
    } finally {
      setIsUploading(false);
    }
  }

  async function queueRouteForUpload() {
    const currentSession = sessionRef.current;
    if (currentSession.samples.length < 2) {
      throw new Error("Для локального сохранения нужно минимум две GPS-точки.");
    }

    await flushBackgroundSamplesIntoSession();
    const queuedBaselineFingerprint = buildTrackingSyncFingerprint(sessionRef.current);

    const upload: PendingRouteUpload = {
      id: buildPendingUploadId(),
      createdAt: new Date().toISOString(),
      payload: buildTrackedRoutePayload(sessionRef.current),
      sampleCount: sessionRef.current.samples.length,
      sessionSnapshot: {
        startedAt: sessionRef.current.startedAt,
        endedAt: sessionRef.current.endedAt,
        routeStartedAt: sessionRef.current.routeStartedAt,
        pausedDurationMs: sessionRef.current.pausedDurationMs,
        samples: sessionRef.current.samples,
        routePoints: sessionRef.current.routePoints,
        categoryIds: sessionRef.current.categoryIds,
        seasons: sessionRef.current.seasons,
        lineColor: sessionRef.current.lineColor,
        serverRouteId: sessionRef.current.serverRouteId,
        serverBaselineFingerprint: sessionRef.current.serverBaselineFingerprint,
        queuedBaselineFingerprint,
      },
    };

    await persistPendingUploads([
      ...pendingUploadsRef.current.filter(
        (pendingUpload) => pendingUpload.id !== sessionRef.current.lastQueuedUploadId,
      ),
      upload,
    ]);

    await persistSession({
      ...sessionRef.current,
      lastQueuedUploadId: upload.id,
      queuedBaselineFingerprint,
    });

    setError(null);
    return upload;
  }

  async function syncPendingUploads() {
    if (pendingUploadsRef.current.length === 0) {
      return { synced: 0, failed: 0 };
    }

    setIsSyncing(true);
    setError(null);

    try {
      const result = await syncPendingRouteUploadsBatch(pendingUploadsRef.current);
      let savedCurrentSessionRoute: SavedRouteResponse | undefined;

      for (const syncedUpload of result.syncedRoutes) {
        if (sessionRef.current.lastQueuedUploadId === syncedUpload.uploadId) {
          savedCurrentSessionRoute = syncedUpload.route;
        }
      }

      await persistPendingUploads(result.remainingUploads);

      if (savedCurrentSessionRoute) {
        const nextSession: TrackingSession = {
          ...sessionRef.current,
          serverRouteId: savedCurrentSessionRoute.id,
          lastSavedRouteId: savedCurrentSessionRoute.id,
          lastQueuedUploadId: undefined,
          queuedBaselineFingerprint: undefined,
        };
        await persistSession({
          ...nextSession,
          serverBaselineFingerprint: buildTrackingSyncFingerprint(nextSession),
        });
      }

      if (result.failed > 0) {
        const message =
          result.synced > 0
            ? `Синхронизировано: ${result.synced}. Осталось с ошибкой: ${result.failed}.`
            : result.remainingUploads[0]?.lastError ?? "Не удалось синхронизировать маршруты.";
        setError(message);
      }

      return {
        synced: result.synced,
        failed: result.failed,
      };
    } finally {
      setIsSyncing(false);
    }
  }

  async function loadPendingUploadDraft(uploadId: string) {
    const currentSession = sessionRef.current;
    if (
      currentSession.samples.length > 0 &&
      currentSession.lastQueuedUploadId !== uploadId &&
      currentSession.status !== "idle"
    ) {
      throw new Error(
        "На экране записи уже есть другой черновик. Сначала сохрани его, синхронизируй или сбрось.",
      );
    }

    if (
      currentSession.lastQueuedUploadId === uploadId &&
      currentSession.samples.length > 0
    ) {
      return currentSession;
    }

    const upload =
      pendingUploadsRef.current.find((item) => item.id === uploadId) ??
      (await readPendingRouteUploads()).find((item) => item.id === uploadId);

    if (!upload) {
      throw new Error("Локальный черновик не найден. Возможно, он уже был удалён.");
    }

    await stopLocationPipelines();
    await clearBackgroundSamples();

    const nextSession = buildSessionFromPendingUpload(upload);
    await persistSession(nextSession);
    setError(null);
    return nextSession;
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const storedSession = normalizeStoredSession(await readJsonFile<TrackingSession>(SESSION_FILE));
      if (storedSession && mounted) {
        await persistSession(storedSession);
      }

      const storedPendingUploads = await readPendingRouteUploads();
      if (mounted) {
        await persistPendingUploads(storedPendingUploads);
      }

      await refreshPermissionState();
      setBackgroundAvailable(await TaskManager.isAvailableAsync());
      setBackgroundActive(await isBackgroundTrackingActive());

      if (storedSession?.status === "recording") {
        await flushBackgroundSamplesIntoSession();
        await startLocationPipelines();
      }
    }

    void bootstrap();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void flushBackgroundSamplesIntoSession();
        void refreshPermissionState();
        void isBackgroundTrackingActive().then(setBackgroundActive);
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
      void stopForegroundWatch();
    };
  }, []);

  return {
    session,
    metrics,
    foregroundPermission,
    backgroundPermission,
    backgroundActive,
    backgroundAvailable,
    isBusy,
    isUploading,
    isSyncing,
    error,
    pendingUploads,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    resetSession,
    renameSession,
    updateRoutePoint,
    resetRoutePointsFromSamples,
    setRouteStartedAt,
    toggleCategory,
    toggleSeason,
    setRouteLineColor,
    saveRoute,
    queueRouteForUpload,
    syncPendingUploads,
    loadPendingUploadDraft,
  };
}
