import { useState } from "react";
import { Compass, Minus, Route, Sparkles, Wrench } from "lucide-react";
import { MapMenuButton } from "./MapMenuButton";
import { NotificationBell } from "./NotificationBell";
import { CustomSelect } from "./CustomSelect";
import { useLanguage } from "../context/LanguageContext";
import type { RouteMode } from "../types/routeMap";
import type { RoutingEngineId } from "../utils/routingEngines";

interface RouteMapToolbarProps {
  routeMode: RouteMode;
  onRouteModeChange: (mode: RouteMode) => void;
  routingEngine: RoutingEngineId;
  routingEngineOptions: Array<{ value: string; label: string }>;
  onRoutingEngineChange: (engineId: RoutingEngineId) => void;
  tileProvider: string;
  tileProviderOptions: Array<{ value: string; label: string }>;
  onTileProviderChange: (providerId: string) => void;
  canSaveCurrentRoute: boolean;
  saveLabel: string;
  onSaveRoute: () => void;
  onOpenCatalog: () => void;
  onImportPhotos: () => void;
  canExport: boolean;
  onExportGpx: () => void;
  onExportKml: () => void;
  canGenerateAiDescription: boolean;
  aiGenerating: boolean;
  onGenerateAiDescription: () => void;
  canPlayback: boolean;
  onStartPlayback: () => void;
  historicalMode: boolean;
  onToggleHistoricalMode: () => void;
  hasClearableContent: boolean;
  onClearRoute: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  userLabel: string;
  onOpenProfile: () => void;
  onOpenBookmarks: () => void;
  isLightTheme: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function RouteMapToolbar({
  routeMode,
  onRouteModeChange,
  routingEngine,
  routingEngineOptions,
  onRoutingEngineChange,
  tileProvider,
  tileProviderOptions,
  onTileProviderChange,
  canSaveCurrentRoute,
  saveLabel,
  onSaveRoute,
  onOpenCatalog,
  onImportPhotos,
  canExport,
  onExportGpx,
  onExportKml,
  canGenerateAiDescription,
  aiGenerating,
  onGenerateAiDescription,
  canPlayback,
  onStartPlayback,
  historicalMode,
  onToggleHistoricalMode,
  hasClearableContent,
  onClearRoute,
  chatOpen,
  onToggleChat,
  userLabel,
  onOpenProfile,
  onOpenBookmarks,
  isLightTheme,
  onToggleTheme,
  onLogout,
}: RouteMapToolbarProps) {
  const { t } = useLanguage();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="map-header">
      <div className="header-pills">
        <button
          className={`header-pill${routeMode === "auto" ? " active" : ""}`}
          onClick={() => onRouteModeChange("auto")}
        >
          <Route size={14} /> {t("map.modeAuto")}
        </button>
        <button
          className={`header-pill${routeMode === "manual" ? " active" : ""}`}
          onClick={() => onRouteModeChange("manual")}
        >
          <Minus size={14} /> {t("map.modeManual")}
        </button>
        {routeMode === "auto" && (
          <CustomSelect
            options={routingEngineOptions}
            value={routingEngine}
            onChange={(value) => onRoutingEngineChange(value as RoutingEngineId)}
          />
        )}
      </div>

      <div className="header-actions">
        <CustomSelect
          options={tileProviderOptions}
          value={tileProvider}
          onChange={onTileProviderChange}
        />

        {canSaveCurrentRoute && (
          <button
            onClick={onSaveRoute}
            className="btn btn-primary btn-sm btn-pill"
          >
            {saveLabel}
          </button>
        )}

        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onOpenCatalog}
          title={t("explore.catalog")}
        >
          <Compass size={18} />
        </button>

        <div className="header-dropdown-wrap">
          <button
            className="btn btn-secondary btn-sm btn-icon"
            onClick={() => {
              setToolsOpen((previous) => !previous);
              setUserMenuOpen(false);
            }}
            title="Tools"
          >
            <Wrench size={18} />
          </button>
          {toolsOpen && (
            <div className="header-dropdown" onClick={() => setToolsOpen(false)}>
              <button onClick={onImportPhotos}>{t("map.importPhotos")}</button>
              {canExport && (
                <>
                  <button onClick={onExportGpx}>{t("export.gpx")}</button>
                  <button onClick={onExportKml}>{t("export.kml")}</button>
                </>
              )}
              {canGenerateAiDescription && (
                <button onClick={onGenerateAiDescription} disabled={aiGenerating}>
                  {aiGenerating ? t("ai.generating") : t("ai.generateButton")}
                </button>
              )}
              {canPlayback && (
                <button onClick={onStartPlayback}>{t("playback.button")}</button>
              )}
              <button onClick={onToggleHistoricalMode}>
                {historicalMode ? "✓ " : ""}{t("historical.toggle")}
              </button>
              {hasClearableContent && (
                <button onClick={onClearRoute} className="dropdown-danger">{t("map.clear")}</button>
              )}
            </div>
          )}
        </div>

        <button
          className={`btn btn-ghost btn-sm btn-icon${chatOpen ? " active-toggle" : ""}`}
          onClick={onToggleChat}
          title={t("chat.toggle")}
        >
          <Sparkles size={18} />
        </button>

        <NotificationBell />

        <div className="header-dropdown-wrap">
          <button
            className="btn btn-ghost btn-sm header-user-btn"
            onClick={() => {
              setUserMenuOpen((previous) => !previous);
              setToolsOpen(false);
            }}
          >
            {userLabel.slice(0, 12)}
          </button>
          {userMenuOpen && (
            <div className="header-dropdown header-dropdown-right" onClick={() => setUserMenuOpen(false)}>
              <button onClick={onOpenProfile}>{t("map.profile")}</button>
              <button onClick={onOpenBookmarks}>{t("bookmarks.title")}</button>
              <button onClick={onToggleTheme}>{isLightTheme ? "🌙 " : "☀️ "}{t("theme.toggle")}</button>
              <hr />
              <button onClick={onLogout} className="dropdown-danger">{t("map.logout")}</button>
            </div>
          )}
        </div>
      </div>

      <MapMenuButton>
        <button
          onClick={onImportPhotos}
          className="import-photos-btn"
        >
          {t("map.importPhotos")}
        </button>
        {canSaveCurrentRoute && (
          <button
            onClick={onSaveRoute}
            className="save-btn"
          >
            {saveLabel}
          </button>
        )}
        {canExport && (
          <>
            <button
              onClick={onExportGpx}
              className="btn-secondary"
            >
              {t("export.gpx")}
            </button>
            <button
              onClick={onExportKml}
              className="btn-secondary"
            >
              {t("export.kml")}
            </button>
          </>
        )}
        {canGenerateAiDescription && (
          <button
            onClick={onGenerateAiDescription}
            disabled={aiGenerating}
            className="btn-secondary"
          >
            {aiGenerating ? t("ai.generating") : t("ai.generateButton")}
          </button>
        )}
        {canPlayback && (
          <button
            onClick={onStartPlayback}
            className="btn-secondary"
          >
            {t("playback.button")}
          </button>
        )}
        {hasClearableContent && (
          <button onClick={onClearRoute} className="clear-btn">
            {t("map.clear")}
          </button>
        )}
        <button
          onClick={onToggleHistoricalMode}
          className={`btn-secondary explore-nav-btn${historicalMode ? " active-toggle" : ""}`}
        >
          {t("historical.toggle")}
        </button>
        <button onClick={onOpenCatalog} className="btn-secondary explore-nav-btn">
          {t("explore.catalog")}
        </button>
        <button onClick={onOpenBookmarks} className="btn-secondary explore-nav-btn">
          {t("bookmarks.title")}
        </button>
        <button onClick={onToggleChat} className="btn-secondary explore-nav-btn">
          {t("chat.toggle")}
        </button>
        <button onClick={onOpenProfile} className="profile-btn">
          {userLabel}
        </button>
        <button onClick={onToggleTheme} className="theme-toggle-btn" title={t("theme.toggle")}>
          {isLightTheme ? "\u263D" : "\u2600"}
        </button>
        <button onClick={onLogout} className="logout-btn">
          {t("map.logout")}
        </button>
      </MapMenuButton>
    </div>
  );
}
