import L from "leaflet";
import type { PhotoData } from "../api/routes";
import type { PhotoPreviewShape } from "../types/routeMap";

export const DEFAULT_POINT_MARKER_COLOR = "#3388ff";
export const DEFAULT_POINT_MARKER_SIZE = 30;
export const MIN_POINT_MARKER_SIZE = 22;
export const MAX_POINT_MARKER_SIZE = 46;
export const POINT_MARKER_SIZE_STEP = 2;
export const DEFAULT_PHOTO_PREVIEW_SIZE = 44;
export const MIN_PHOTO_PREVIEW_SIZE = 28;
export const MAX_PHOTO_PREVIEW_SIZE = 84;
export const PHOTO_PREVIEW_STEP = 4;
export const DEFAULT_PHOTO_PREVIEW_SHAPE: PhotoPreviewShape = "square";

export function clampPhotoPreviewSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_PHOTO_PREVIEW_SIZE;
  }
  return Math.max(
    MIN_PHOTO_PREVIEW_SIZE,
    Math.min(MAX_PHOTO_PREVIEW_SIZE, Math.round(size / PHOTO_PREVIEW_STEP) * PHOTO_PREVIEW_STEP),
  );
}

export function clampPointMarkerSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return DEFAULT_POINT_MARKER_SIZE;
  }
  return Math.max(
    MIN_POINT_MARKER_SIZE,
    Math.min(MAX_POINT_MARKER_SIZE, Math.round(size / POINT_MARKER_SIZE_STEP) * POINT_MARKER_SIZE_STEP),
  );
}

export function normalizePointMarkerColor(color?: string) {
  if (!color) {
    return DEFAULT_POINT_MARKER_COLOR;
  }
  const trimmed = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : DEFAULT_POINT_MARKER_COLOR;
}

export function normalizePhotoPreviewShape(shape?: string): PhotoPreviewShape {
  return shape === "circle" ? "circle" : DEFAULT_PHOTO_PREVIEW_SHAPE;
}

export function getPhotoSrc(photo?: PhotoData): string | undefined {
  if (!photo) {
    return undefined;
  }
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
  }

  const size = clampPointMarkerSize(markerSize);
  return L.divIcon({
    className: "custom-point-marker",
    html: createPointMarkerHtml(markerColor, size),
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), size],
    popupAnchor: [0, -size],
  });
}

export function createColoredMarkerIcon(
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
