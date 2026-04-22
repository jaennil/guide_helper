import React from "react";
import type { Route as SavedRoute, PhotoData } from "../api/routes";
import type { Category } from "../api/categories";
import { useLanguage } from "../context/LanguageContext";
import { PointDetailsEditor } from "./RoutePointInspector";
import { ROUTE_LINE_COLOR_PRESETS, normalizeRouteLineColor } from "../utils/routeColors";
import { getPhotoSrc } from "../utils/routePointStyles";
import type { PhotoPreviewShape, RoutePoint } from "../types/routeMap";
import { asTranslationKey } from "../i18n";

interface RouteInspectorPanelProps {
  routeName: string;
  onRouteNameChange: (value: string) => void;
  availableCategories: Category[];
  selectedCategoryIds: string[];
  toggleCategory: (categoryId: string) => void;
  allSeasons: readonly string[];
  selectedSeasons: string[];
  toggleSeason: (season: string) => void;
  routeLineColor: string;
  onRouteLineColorChange: (color: string) => void;
  routeStartedAt: string;
  onRouteStartedAtChange: (value: string) => void;
  routePoints: RoutePoint[];
  selectedPointId: number | null;
  onSelectPoint: (pointId: number) => void;
  selectedPoint: RoutePoint | null;
  selectedPointIndex: number;
  onPhotoChange: (pointId: number, photo: PhotoData | undefined) => void;
  onNoteChange: (pointId: number, note: string) => void;
  onMarkerColorChange: (pointId: number, markerColor: string) => void;
  onMarkerSizeChange: (pointId: number, markerSize: number) => void;
  onPreviewSizeChange: (pointId: number, previewSize: number) => void;
  onPreviewShapeChange: (pointId: number, previewShape: PhotoPreviewShape) => void;
  onFocusPoint: (pointId: number) => void;
  onSaveRoute: () => void;
  onPublishDraft: () => void;
  onCreateVersion: () => void;
  onOpenVersion: (routeId: string) => void;
  saveLoading: boolean;
  saveError: string;
  canSaveCurrentRoute: boolean;
  loadedRouteInfo: SavedRoute | null;
  routeVersions: SavedRoute[];
  routeVersionsLoading: boolean;
}

export const RouteInspectorPanel = React.memo(function RouteInspectorPanel({
  routeName,
  onRouteNameChange,
  availableCategories,
  selectedCategoryIds,
  toggleCategory,
  allSeasons,
  selectedSeasons,
  toggleSeason,
  routeLineColor,
  onRouteLineColorChange,
  routeStartedAt,
  onRouteStartedAtChange,
  routePoints,
  selectedPointId,
  onSelectPoint,
  selectedPoint,
  selectedPointIndex,
  onPhotoChange,
  onNoteChange,
  onMarkerColorChange,
  onMarkerSizeChange,
  onPreviewSizeChange,
  onPreviewShapeChange,
  onFocusPoint,
  onSaveRoute,
  onPublishDraft,
  onCreateVersion,
  onOpenVersion,
  saveLoading,
  saveError,
  canSaveCurrentRoute,
  loadedRouteInfo,
  routeVersions,
  routeVersionsLoading,
}: RouteInspectorPanelProps) {
  const { t } = useLanguage();
  const routeStatusLabel = loadedRouteInfo
    ? loadedRouteInfo.is_draft
      ? t("map.routeStatusDraft")
      : loadedRouteInfo.share_token
        ? t("map.routeStatusPublic")
        : t("map.routeStatusPrivate")
    : null;

  return (
    <aside className="route-inspector">
      <div className="route-inspector-header">
        <div className="route-inspector-header-copy">
          <span className="route-inspector-eyebrow">{t("map.routeInspectorTitle")}</span>
          <h3>{routeName.trim() || t("map.routeDraft")}</h3>
          <p>{t("map.routeInspectorSubtitle", { count: routePoints.length })}</p>
          {loadedRouteInfo && routeStatusLabel ? (
            <div className="route-inspector-status-row">
              <span className={`route-inspector-status-badge${loadedRouteInfo.is_draft ? " draft" : loadedRouteInfo.share_token ? " public" : " private"}`}>
                {routeStatusLabel}
              </span>
              <span className="route-inspector-status-meta">
                {t("profile.routeVersionNumber", { version: loadedRouteInfo.version_number })}
              </span>
            </div>
          ) : null}
        </div>
        <div className="route-inspector-header-actions">
          {canSaveCurrentRoute && (
            <button
              type="button"
              className="route-inspector-save-btn"
              onClick={onSaveRoute}
              disabled={saveLoading}
            >
              {saveLoading
                ? t("map.saving")
                : loadedRouteInfo?.is_draft
                  ? t("map.updateDraft")
                  : loadedRouteInfo
                    ? t("map.saveChanges")
                    : t("map.saveRoute")}
            </button>
          )}
          {canSaveCurrentRoute && loadedRouteInfo?.is_draft && (
            <button
              type="button"
              className="route-inspector-quick-action"
              onClick={onPublishDraft}
              disabled={saveLoading}
            >
              {t("map.publishDraft")}
            </button>
          )}
          {canSaveCurrentRoute && loadedRouteInfo && !loadedRouteInfo.is_draft && (
            <button
              type="button"
              className="route-inspector-quick-action"
              onClick={onCreateVersion}
              disabled={saveLoading}
            >
              {t("map.createVersion")}
            </button>
          )}
        </div>
      </div>
      <div className="route-inspector-body">
        <section className="route-inspector-section">
          <label className="route-inspector-label" htmlFor="route-name-input">
            {t("map.routeNameLabel")}
          </label>
          <input
            id="route-name-input"
            type="text"
            className="route-inspector-input"
            placeholder={t("map.enterRouteName")}
            value={routeName}
            onChange={(e) => onRouteNameChange(e.target.value)}
          />
        </section>
        <section className="route-inspector-section">
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
                  {t(asTranslationKey(`tags.${cat.name}`)) || cat.name}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="route-inspector-section">
          <div className="tag-selector">
            <label>{t("seasons.label")}</label>
            <div className="tag-selector-buttons">
              {allSeasons.map((season) => (
                <button
                  key={season}
                  type="button"
                  className={`tag-button${selectedSeasons.includes(season) ? " active" : ""}`}
                  onClick={() => toggleSeason(season)}
                >
                  {t(asTranslationKey(`seasons.${season}`))}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="route-inspector-section">
          <div className="tag-selector">
            <label>{t("map.routeLineColor")}</label>
            <div className="route-color-controls">
              <input
                type="color"
                value={routeLineColor}
                onChange={(e) => onRouteLineColorChange(normalizeRouteLineColor(e.target.value))}
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
                    onClick={() => onRouteLineColorChange(color)}
                    aria-label={`${t("map.routeLineColor")} ${color}`}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="route-inspector-section">
          <label className="route-inspector-label" htmlFor="route-started-at-input">
            {t("map.routeStartedAt")}
          </label>
          <input
            id="route-started-at-input"
            type="datetime-local"
            className="route-inspector-input"
            value={routeStartedAt}
            onChange={(e) => onRouteStartedAtChange(e.target.value)}
            aria-label={t("map.routeStartedAt")}
          />
          <div className="route-inspector-hint">{t("map.routeStartedAtHint")}</div>
        </section>
        {loadedRouteInfo && (
          <section className="route-inspector-section">
            <div className="route-inspector-section-header">
              <h4>{t("profile.routeVersionsShow", { count: routeVersions.length || 1 })}</h4>
            </div>
            {routeVersionsLoading ? (
              <div className="route-inspector-empty">{t("common.loading")}</div>
            ) : (
              <div className="route-version-list">
                {routeVersions.map((routeVersion) => (
                  <button
                    key={routeVersion.id}
                    type="button"
                    className={`route-version-list-item${routeVersion.id === loadedRouteInfo.id ? " active" : ""}`}
                    onClick={() => onOpenVersion(routeVersion.id)}
                  >
                    <span className="route-version-list-title">
                      {t("profile.routeVersionNumber", { version: routeVersion.version_number })}
                    </span>
                    <span className="route-version-list-meta">
                      {routeVersion.is_draft
                        ? t("profile.routeStatusDraft")
                        : routeVersion.share_token
                          ? t("profile.sharedStatusPublic")
                          : t("profile.sharedStatusPrivate")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <section className="route-inspector-section">
          <div className="route-inspector-section-header">
            <h4>{t("map.pointsListTitle")}</h4>
          </div>
          <div className="route-point-list">
            {routePoints.map((point, index) => {
              const pointTitle = point.name?.trim() || t("map.point", { index: index + 1 });
              const isSelected = point.id === selectedPointId;
              const photoSrc = getPhotoSrc(point.photo);
              const note = point.note?.trim();

              return (
                <button
                  key={point.id}
                  type="button"
                  className={`route-point-list-item${isSelected ? " active" : ""}`}
                  onClick={() => onSelectPoint(point.id)}
                >
                  <div className="route-point-list-top">
                    <span className="route-point-list-title">{pointTitle}</span>
                    <span className="route-point-list-index">{index + 1}</span>
                  </div>
                  <div className="route-point-list-meta">
                    {point.position[0].toFixed(5)}, {point.position[1].toFixed(5)}
                  </div>
                  {(note || photoSrc) && (
                    <div className="route-point-list-badges">
                      {note && <span className="route-point-list-badge">{t("map.pointBadgeNote")}</span>}
                      {photoSrc && <span className="route-point-list-badge">{t("map.pointBadgePhoto")}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
        <section className="route-inspector-section route-inspector-section-point">
          <div className="route-inspector-section-header">
            <h4>{t("map.pointInspectorTitle")}</h4>
          </div>
          {selectedPoint ? (
            <PointDetailsEditor
              point={selectedPoint}
              index={selectedPointIndex}
              onPhotoChange={onPhotoChange}
              onNoteChange={onNoteChange}
              onMarkerColorChange={onMarkerColorChange}
              onMarkerSizeChange={onMarkerSizeChange}
              onPreviewSizeChange={onPreviewSizeChange}
              onPreviewShapeChange={onPreviewShapeChange}
              onFocusPoint={onFocusPoint}
            />
          ) : (
            <div className="route-inspector-empty">
              {t("map.selectPointHint")}
            </div>
          )}
        </section>
        {saveError && <div className="route-inspector-error">{saveError}</div>}
      </div>
    </aside>
  );
});
