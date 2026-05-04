import exifr from "exifr";
import type { PhotoData } from "../api/routes";
import type { RouteMode, RoutePoint } from "../types/routeMap";
import {
  DEFAULT_PHOTO_PREVIEW_SHAPE,
  DEFAULT_PHOTO_PREVIEW_SIZE,
  DEFAULT_POINT_MARKER_COLOR,
  DEFAULT_POINT_MARKER_SIZE,
} from "./routePointStyles";
import { buildSegmentsForAppendedPoints } from "./routeEditorData";
import { imageFileToRoutePhotoDataUrl } from "./routePhotoResize";

interface ParsedPhoto {
  lat: number;
  lng: number;
  base64: string;
  date: Date | null;
}

export interface ImportRoutePhotosResult {
  newPoints: RoutePoint[];
  newSegments: ReturnType<typeof buildSegmentsForAppendedPoints>;
  skipped: number;
  nextPointId: number;
}

async function parsePhoto(file: File): Promise<ParsedPhoto | null> {
  try {
    const exifData = await exifr.parse(file, true);

    if (!exifData?.latitude || !exifData?.longitude) {
      console.log(`[photo-import] no GPS data in: ${file.name}`);
      return null;
    }

    const base64 = await imageFileToRoutePhotoDataUrl(file);

    console.log(
      `[photo-import] parsed ${file.name}: lat=${exifData.latitude}, lng=${exifData.longitude}`,
    );

    return {
      lat: exifData.latitude,
      lng: exifData.longitude,
      base64,
      date: exifData.DateTimeOriginal ? new Date(exifData.DateTimeOriginal) : null,
    };
  } catch (error) {
    console.error(`[photo-import] failed to parse ${file.name}:`, error);
    return null;
  }
}

export async function importPhotosToRoutePoints({
  files,
  existingPointCount,
  nextPointId,
  routeMode,
}: {
  files: File[];
  existingPointCount: number;
  nextPointId: number;
  routeMode: RouteMode;
}): Promise<ImportRoutePhotosResult> {
  if (files.length === 0) {
    return {
      newPoints: [],
      newSegments: [],
      skipped: 0,
      nextPointId,
    };
  }

  console.log(`[photo-import] starting import of ${files.length} files`);

  const results = await Promise.allSettled(files.map((file) => parsePhoto(file)));
  const parsed: ParsedPhoto[] = [];
  let skipped = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      parsed.push(result.value);
    } else {
      skipped += 1;
    }
  }

  parsed.sort((left, right) => {
    if (left.date && right.date) {
      return left.date.getTime() - right.date.getTime();
    }
    if (left.date) {
      return -1;
    }
    if (right.date) {
      return 1;
    }
    return 0;
  });

  console.log(`[photo-import] sorted ${parsed.length} photos, ${skipped} skipped`);

  const newPoints: RoutePoint[] = parsed.map((photo, index) => ({
    id: nextPointId + index,
    position: [photo.lat, photo.lng] as [number, number],
    markerColor: DEFAULT_POINT_MARKER_COLOR,
    markerSize: DEFAULT_POINT_MARKER_SIZE,
    previewSize: DEFAULT_PHOTO_PREVIEW_SIZE,
    previewShape: DEFAULT_PHOTO_PREVIEW_SHAPE,
    photo: { original: photo.base64, status: "pending" } as PhotoData,
  }));

  return {
    newPoints,
    newSegments: buildSegmentsForAppendedPoints(existingPointCount, newPoints.length, routeMode),
    skipped,
    nextPointId: nextPointId + newPoints.length,
  };
}
