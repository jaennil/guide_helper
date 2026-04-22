import React, { useRef, type ChangeEvent } from "react";
import toast from "react-hot-toast";
import type { PhotoData } from "../api/routes";
import { useLanguage } from "../context/LanguageContext";
import { ROUTE_LINE_COLOR_PRESETS } from "../utils/routeColors";
import {
  MAX_PHOTO_PREVIEW_SIZE,
  MAX_POINT_MARKER_SIZE,
  MIN_PHOTO_PREVIEW_SIZE,
  MIN_POINT_MARKER_SIZE,
  PHOTO_PREVIEW_STEP,
  POINT_MARKER_SIZE_STEP,
  clampPhotoPreviewSize,
  clampPointMarkerSize,
  getPhotoSrc,
  normalizePhotoPreviewShape,
  normalizePointMarkerColor,
} from "../utils/routePointStyles";
import type { PhotoPreviewShape, RoutePoint } from "../types/routeMap";

export const PointPopup = React.memo(function PointPopup({
  point,
  index,
  onEdit,
}: {
  point: RoutePoint;
  index: number;
  onEdit: (pointId: number) => void;
}) {
  const { t } = useLanguage();
  const photoSrc = getPhotoSrc(point.photo);
  const note = point.note?.trim();

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
      {note && <div className="point-popup-note-text">{note}</div>}
      {photoSrc && (
        <div className="point-popup-photo">
          <img src={point.photo?.original || photoSrc} alt={t("map.point", { index: index + 1 })} />
        </div>
      )}
      <div className="point-popup-actions">
        <button
          type="button"
          className="upload-photo-btn"
          onClick={() => onEdit(point.id)}
        >
          {t("map.editPoint")}
        </button>
      </div>
    </div>
  );
});

export const PointDetailsEditor = React.memo(function PointDetailsEditor({
  point,
  index,
  onPhotoChange,
  onNoteChange,
  onMarkerColorChange,
  onMarkerSizeChange,
  onPreviewSizeChange,
  onPreviewShapeChange,
  onFocusPoint,
}: {
  point: RoutePoint;
  index: number;
  onPhotoChange: (pointId: number, photo: PhotoData | undefined) => void;
  onNoteChange: (pointId: number, note: string) => void;
  onMarkerColorChange: (pointId: number, markerColor: string) => void;
  onMarkerSizeChange: (pointId: number, markerSize: number) => void;
  onPreviewSizeChange: (pointId: number, previewSize: number) => void;
  onPreviewShapeChange: (pointId: number, previewShape: PhotoPreviewShape) => void;
  onFocusPoint: (pointId: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

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
  };

  const handleRemovePhoto = () => {
    onPhotoChange(point.id, undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePreviewSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    onPreviewSizeChange(point.id, Number(e.target.value));
  };

  const handleMarkerSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    onMarkerSizeChange(point.id, Number(e.target.value));
  };

  const markerColor = normalizePointMarkerColor(point.markerColor);
  const markerSize = clampPointMarkerSize(point.markerSize);
  const photoSrc = getPhotoSrc(point.photo);
  const previewSize = clampPhotoPreviewSize(point.previewSize);
  const previewShape = normalizePhotoPreviewShape(point.previewShape);

  return (
    <div className="point-editor">
      <div className="route-inspector-section-header">
        <div>
          <div className="route-inspector-point-title">
            {point.name?.trim() || t("map.point", { index: index + 1 })}
          </div>
          <div className="point-popup-coords">
            {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
            {point.position[1].toFixed(6)}
          </div>
        </div>
        <button
          type="button"
          className="route-inspector-quick-action"
          onClick={() => onFocusPoint(point.id)}
        >
          {t("chat.showOnMap")}
        </button>
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
          onChange={(e) => onNoteChange(point.id, e.target.value)}
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
            onChange={(e) => onMarkerColorChange(point.id, e.target.value)}
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
              onClick={() => onMarkerColorChange(point.id, color)}
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
                  onClick={() => onPreviewShapeChange(point.id, "square")}
                >
                  {t("map.photoPreviewShapeSquare")}
                </button>
                <button
                  type="button"
                  className={`point-photo-shape-btn${previewShape === "circle" ? " active" : ""}`}
                  onClick={() => onPreviewShapeChange(point.id, "circle")}
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
