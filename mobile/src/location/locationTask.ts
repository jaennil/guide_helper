import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { deleteJsonFile, readJsonFile, writeJsonFile } from "../storage/jsonStore";
import { mergeTrackSamples } from "../utils/geo";
import type { TrackSample } from "../types/tracking";
import {
  BACKGROUND_TRACKING_OPTIONS,
  BACKGROUND_TRACKING_TASK,
} from "./trackingOptions";

const BACKGROUND_SAMPLES_FILE = "background-track-samples.json";

function normalizeLocationSample(
  location: Location.LocationObject,
  source: TrackSample["source"],
): TrackSample {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: location.coords.altitude,
    accuracy: location.coords.accuracy,
    heading: location.coords.heading,
    speedMps: location.coords.speed,
    recordedAt: new Date(location.timestamp).toISOString(),
    source,
  };
}

async function appendBackgroundSamples(samples: TrackSample[]) {
  const currentSamples = (await readJsonFile<TrackSample[]>(BACKGROUND_SAMPLES_FILE)) ?? [];
  const mergedSamples = mergeTrackSamples(currentSamples, samples);
  await writeJsonFile(BACKGROUND_SAMPLES_FILE, mergedSamples);
}

export async function drainBackgroundSamples() {
  const samples = (await readJsonFile<TrackSample[]>(BACKGROUND_SAMPLES_FILE)) ?? [];
  await deleteJsonFile(BACKGROUND_SAMPLES_FILE);
  return samples;
}

export async function clearBackgroundSamples() {
  await deleteJsonFile(BACKGROUND_SAMPLES_FILE);
}

if (!TaskManager.isTaskDefined(BACKGROUND_TRACKING_TASK)) {
  TaskManager.defineTask(
    BACKGROUND_TRACKING_TASK,
    async ({ data, error }) => {
      if (error || !data) {
        return;
      }

      const payload = data as { locations?: Location.LocationObject[] };
      const normalizedSamples = (payload.locations ?? []).map((location: Location.LocationObject) =>
        normalizeLocationSample(location, "background"),
      );
      await appendBackgroundSamples(normalizedSamples);
    },
  );
}

export function normalizeForegroundSample(location: Location.LocationObject): TrackSample {
  return normalizeLocationSample(location, "foreground");
}

export async function startBackgroundTracking() {
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_TRACKING_TASK,
  );

  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(
      BACKGROUND_TRACKING_TASK,
      BACKGROUND_TRACKING_OPTIONS,
    );
  }
}

export async function stopBackgroundTracking() {
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_TRACKING_TASK,
  );

  if (alreadyStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_TRACKING_TASK);
  }
}

export async function isBackgroundTrackingActive() {
  return Location.hasStartedLocationUpdatesAsync(BACKGROUND_TRACKING_TASK);
}
