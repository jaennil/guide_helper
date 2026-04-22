import { useCallback, type ChangeEvent, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import toast from "react-hot-toast";
import type { PhotoData } from "../api/routes";
import type { TranslationKey } from "../i18n";
import type { PhotoPreviewShape, RouteMode, RoutePoint, RouteSegment } from "../types/routeMap";
import { buildSegmentsForAppendedPoints } from "../utils/routeEditorData";
import { importPhotosToRoutePoints } from "../utils/routePhotoImport";
import {
  DEFAULT_POINT_MARKER_COLOR,
  DEFAULT_POINT_MARKER_SIZE,
  clampPhotoPreviewSize,
  clampPointMarkerSize,
  normalizePhotoPreviewShape,
  normalizePointMarkerColor,
} from "../utils/routePointStyles";

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

interface UseRoutePointEditingParams {
  routeMode: RouteMode;
  routePointsLength: number;
  setRoutePoints: Dispatch<SetStateAction<RoutePoint[]>>;
  setRouteSegments: Dispatch<SetStateAction<RouteSegment[]>>;
  setSelectedPointId: Dispatch<SetStateAction<number | null>>;
  setChatPreviewPoints: Dispatch<SetStateAction<RoutePoint[]>>;
  pointIdRef: MutableRefObject<number>;
  photoImportRef: RefObject<HTMLInputElement | null>;
  t: Translate;
}

function clearPhotoImportInput(photoImportRef: RefObject<HTMLInputElement | null>) {
  if (photoImportRef.current) {
    photoImportRef.current.value = "";
  }
}

export function useRoutePointEditing({
  routeMode,
  routePointsLength,
  setRoutePoints,
  setRouteSegments,
  setSelectedPointId,
  setChatPreviewPoints,
  pointIdRef,
  photoImportRef,
  t,
}: UseRoutePointEditingParams) {
  const handleMapClick = useCallback((lat: number, lng: number) => {
    const newPoint: RoutePoint = {
      id: pointIdRef.current++,
      position: [lat, lng],
      markerColor: DEFAULT_POINT_MARKER_COLOR,
      markerSize: DEFAULT_POINT_MARKER_SIZE,
    };

    setSelectedPointId(newPoint.id);
    setChatPreviewPoints([]);
    setRoutePoints((previousPoints) => {
      const newSegments = buildSegmentsForAppendedPoints(previousPoints.length, 1, routeMode);
      if (newSegments.length > 0) {
        setRouteSegments((previousSegments) => [...previousSegments, ...newSegments]);
      }
      return [...previousPoints, newPoint];
    });
  }, [pointIdRef, routeMode, setChatPreviewPoints, setRoutePoints, setRouteSegments, setSelectedPointId]);

  const handlePhotoChange = useCallback((pointId: number, photo: PhotoData | undefined) => {
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
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
  }, [setRoutePoints]);

  const handlePointNoteChange = useCallback((pointId: number, note: string) => {
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) => (point.id === pointId ? { ...point, note } : point))
    );
  }, [setRoutePoints]);

  const handlePointMarkerColorChange = useCallback((pointId: number, markerColor: string) => {
    const normalizedColor = normalizePointMarkerColor(markerColor);
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
        point.id === pointId ? { ...point, markerColor: normalizedColor } : point
      )
    );
  }, [setRoutePoints]);

  const handlePointMarkerSizeChange = useCallback((pointId: number, markerSize: number) => {
    const normalizedSize = clampPointMarkerSize(markerSize);
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
        point.id === pointId ? { ...point, markerSize: normalizedSize } : point
      )
    );
  }, [setRoutePoints]);

  const handlePointPreviewSizeChange = useCallback((pointId: number, previewSize: number) => {
    const normalizedSize = clampPhotoPreviewSize(previewSize);
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
        point.id === pointId ? { ...point, previewSize: normalizedSize } : point
      )
    );
  }, [setRoutePoints]);

  const handlePointPreviewShapeChange = useCallback((pointId: number, previewShape: PhotoPreviewShape) => {
    const normalizedShape = normalizePhotoPreviewShape(previewShape);
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
        point.id === pointId ? { ...point, previewShape: normalizedShape } : point
      )
    );
  }, [setRoutePoints]);

  const handleSegmentDurationChange = useCallback((targetSegment: RouteSegment, durationMinutes: number | undefined) => {
    setRouteSegments((previousSegments) =>
      previousSegments.map((segment) =>
        segment.fromIndex === targetSegment.fromIndex && segment.toIndex === targetSegment.toIndex
          ? { ...segment, durationMinutes }
          : segment
      )
    );
  }, [setRouteSegments]);

  const handlePointDrag = useCallback((pointId: number, newLat: number, newLng: number) => {
    console.log(`[drag] point ${pointId} moved to ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`);
    setRoutePoints((previousPoints) =>
      previousPoints.map((point) =>
        point.id === pointId ? { ...point, position: [newLat, newLng] as [number, number] } : point
      )
    );
  }, [setRoutePoints]);

  const handleImportPhotos = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const result = await importPhotosToRoutePoints({
      files: Array.from(files),
      existingPointCount: routePointsLength,
      nextPointId: pointIdRef.current,
      routeMode,
    });

    if (result.newPoints.length === 0) {
      console.log("[photo-import] no photos with GPS data found");
      toast.error(t("map.noGpsPhotos"));
      clearPhotoImportInput(photoImportRef);
      return;
    }

    pointIdRef.current = result.nextPointId;
    setSelectedPointId(result.newPoints[result.newPoints.length - 1]?.id ?? null);
    setChatPreviewPoints([]);
    setRoutePoints((previousPoints) => [...previousPoints, ...result.newPoints]);
    setRouteSegments((previousSegments) => [...previousSegments, ...result.newSegments]);

    let message = t("map.photosImported", { added: result.newPoints.length });
    if (result.skipped > 0) {
      message += "\n" + t("map.photosSkipped", { skipped: result.skipped });
    }
    toast.success(message);

    console.log(
      `[photo-import] import complete: ${result.newPoints.length} added, ${result.skipped} skipped`
    );

    clearPhotoImportInput(photoImportRef);
  }, [
    photoImportRef,
    pointIdRef,
    routeMode,
    routePointsLength,
    setChatPreviewPoints,
    setRoutePoints,
    setRouteSegments,
    setSelectedPointId,
    t,
  ]);

  return {
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
  };
}
