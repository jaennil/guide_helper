import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { createTrackedRoute } from "../api/routes";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "../storage/jsonStore";
import type {
  SavedRouteResponse,
} from "../api/routes";
import type {
  TrackSample,
  TrackingMetrics,
  TrackingSession,
} from "../types/tracking";
import {
  calculateTrackingMetrics,
  buildTrackedRoutePayload,
  mergeTrackSamples,
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

const SESSION_FILE = "tracking-session.json";

const EMPTY_SESSION: TrackingSession = {
  id: null,
  name: "",
  status: "idle",
  pausedDurationMs: 0,
  samples: [],
};

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
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<TrackingSession>(EMPTY_SESSION);
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
        pausedDurationMs: 0,
        samples: [],
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

  async function stopSession() {
    const currentSession = sessionRef.current;
    if (currentSession.status !== "recording" && currentSession.status !== "paused") {
      return;
    }

    await stopLocationPipelines();
    await flushBackgroundSamplesIntoSession();

    const latestSession = sessionRef.current;
    const pausedAt = latestSession.pausedAt
      ? new Date(latestSession.pausedAt).getTime()
      : null;
    const extraPausedMs = pausedAt ? Date.now() - pausedAt : 0;

    await persistSession({
      ...latestSession,
      status: "stopped",
      endedAt: new Date().toISOString(),
      pausedAt: undefined,
      pausedDurationMs: latestSession.pausedDurationMs + extraPausedMs,
    });
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

  async function saveRoute(): Promise<SavedRouteResponse> {
    const currentSession = sessionRef.current;
    if (currentSession.samples.length < 2) {
      throw new Error("Для сохранения маршрута нужно минимум две GPS-точки.");
    }

    setIsUploading(true);
    setError(null);

    try {
      await flushBackgroundSamplesIntoSession();
      const payload = buildTrackedRoutePayload(sessionRef.current);
      const savedRoute = await createTrackedRoute(payload);

      await persistSession({
        ...sessionRef.current,
        lastSavedRouteId: savedRoute.id,
      });

      return savedRoute;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Не удалось сохранить маршрут.";
      setError(message);
      throw saveError;
    } finally {
      setIsUploading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const storedSession = await readJsonFile<TrackingSession>(SESSION_FILE);
      if (storedSession && mounted) {
        await persistSession(storedSession);
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
    error,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    resetSession,
    renameSession,
    saveRoute,
  };
}
