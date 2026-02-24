import { useState, useEffect, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import "../App.css";
import { useParams } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { routesApi } from "../api/routes";
import {
  RoutingControl,
  ManualRoutes,
  createMarkerIcon,
  getPhotoSrc,
  type RoutePoint,
  type RouteSegment,
} from "./MapPage";
import { RouteStatsPanel } from "../components/RouteStatsPanel";
import { CommentSection } from "../components/CommentSection";
import { LikeRatingBar } from "../components/LikeRatingBar";
import { exportAsGpx, exportAsKml } from "../utils/exportRoute";
import { WeatherPanel } from "../components/WeatherPanel";
import { RoutePlayback } from "../components/RoutePlayback";
import { useAuth } from "../context/AuthContext";

type RouteMode = "auto" | "manual";

const TILE_PROVIDERS = [
  { id: "yandex", name: "Yandex", url: "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU", attribution: "&copy; Yandex" },
  { id: "osm", name: "OpenStreetMap", url: "/api/v1/tile/{z}/{x}/{y}", attribution: "&copy; OpenStreetMap" },
  { id: "2gis", name: "2GIS", url: "https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", attribution: "&copy; 2GIS" },
  { id: "opentopomap", name: "OpenTopoMap", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap" },
];

export function SharedMapPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeName, setRouteName] = useState("");
  const [routeCategoryIds, setRouteCategoryIds] = useState<string[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ id: string; user_id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tileProvider, setTileProvider] = useState(() => localStorage.getItem("tileProvider") || "yandex");
  const [playbackActive, setPlaybackActive] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!token) return;
    loadSharedRoute(token);
  }, [token]);

  const loadBookmarkStatus = useCallback(async (routeId: string) => {
    if (!user) return;
    try {
      const data = await routesApi.getUserBookmarkStatus(routeId);
      setBookmarked(data.bookmarked);
      console.log(`[SharedMapPage] bookmark status for route ${routeId}: ${data.bookmarked}`);
    } catch (err) {
      console.error('[SharedMapPage] failed to load bookmark status:', err);
    }
  }, [user]);

  const handleToggleBookmark = async () => {
    if (!routeInfo) return;
    if (!user) {
      console.log('[SharedMapPage] user not logged in, cannot bookmark');
      return;
    }
    setBookmarkLoading(true);
    try {
      const data = await routesApi.toggleBookmark(routeInfo.id);
      setBookmarked(data.bookmarked);
      console.log(`[SharedMapPage] bookmark toggled: ${data.bookmarked}`);
    } catch (err) {
      console.error('[SharedMapPage] failed to toggle bookmark:', err);
    } finally {
      setBookmarkLoading(false);
    }
  };

  const loadSharedRoute = async (shareToken: string) => {
    setLoading(true);
    setError("");
    try {
      const route = await routesApi.getSharedRoute(shareToken);
      setRouteName(route.name);
      setRouteCategoryIds(route.category_ids);
      setRouteInfo({ id: route.id, user_id: route.user_id });
      loadBookmarkStatus(route.id);

      const loadedPoints: RoutePoint[] = route.points.map((p, index) => ({
        id: index,
        position: [p.lat, p.lng] as [number, number],
        photo: p.photo,
      }));
      setRoutePoints(loadedPoints);

      const segments: RouteSegment[] = [];
      for (let i = 0; i < loadedPoints.length - 1; i++) {
        const destPoint = route.points[i + 1];
        segments.push({
          fromIndex: i,
          toIndex: i + 1,
          mode: (destPoint.segment_mode as RouteMode) || "manual",
        });
      }
      setRouteSegments(segments);
    } catch (err: any) {
      console.error("Failed to load shared route:", err);
      setError(t("shared.notFound"));
    } finally {
      setLoading(false);
    }
  };

  const handleTileProviderChange = (providerId: string) => {
    setTileProvider(providerId);
    localStorage.setItem("tileProvider", providerId);
  };

  const currentProvider = TILE_PROVIDERS.find((p) => p.id === tileProvider) || TILE_PROVIDERS[0];

  const waypoints = routePoints.map((point) =>
    L.latLng(point.position[0], point.position[1])
  );

  if (loading) {
    return (
      <div className="App" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="map-header">
        <div className="shared-route-title">
          <strong>{routeName}</strong>
          {routeCategoryIds.length > 0 && (
            <div className="route-tags">
              {routeCategoryIds.map((id) => (
                <span key={id} className="route-tag">{id}</span>
              ))}
            </div>
          )}
        </div>
        <div className="tile-switcher">
          <select
            value={tileProvider}
            onChange={(e) => handleTileProviderChange(e.target.value)}
          >
            {TILE_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          {routePoints.length >= 2 && (
            <>
              <button
                onClick={() => exportAsGpx(routeName, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.gpx")}
              </button>
              <button
                onClick={() => exportAsKml(routeName, routePoints.map(p => ({ lat: p.position[0], lng: p.position[1] })))}
                className="btn-secondary"
              >
                {t("export.kml")}
              </button>
              <button
                onClick={() => setPlaybackActive(true)}
                className="btn-secondary"
              >
                {t("playback.button")}
              </button>
            </>
          )}
          {user && routeInfo && (
            <button
              onClick={handleToggleBookmark}
              disabled={bookmarkLoading}
              className={`btn-secondary${bookmarked ? ' bookmarked' : ''}`}
              title={bookmarked ? t('bookmarks.bookmarked') : t('bookmarks.bookmark')}
            >
              {bookmarked ? '\u2605' : '\u2606'} {bookmarked ? t('bookmarks.bookmarked') : t('bookmarks.bookmark')}
            </button>
          )}
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t("theme.toggle")}>
            {theme === "light" ? "\u263D" : "\u2600"}
          </button>
        </div>
      </div>

      <MapContainer
        center={routePoints.length > 0 ? routePoints[0].position : [55.7518, 37.6178]}
        zoom={13}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          key={tileProvider}
          url={currentProvider.url}
          attribution={currentProvider.attribution}
        />
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker
            key={`${point.id}-${point.photo ? "photo" : "no-photo"}`}
            position={point.position}
            icon={createMarkerIcon(point.photo)}
          >
            <Popup>
              <div className="point-popup">
                <div className="point-popup-header">
                  <strong>{t("map.point", { index: index + 1 })}</strong>
                </div>
                <div className="point-popup-coords">
                  {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
                  {point.position[1].toFixed(6)}
                </div>
                {getPhotoSrc(point.photo) && (
                  <div className="point-popup-photo">
                    <img src={point.photo?.original || getPhotoSrc(point.photo)} alt={t("map.point", { index: index + 1 })} />
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {playbackActive && routePoints.length >= 2 && (
          <RoutePlayback
            points={routePoints}
            segments={routeSegments}
            onClose={() => setPlaybackActive(false)}
          />
        )}
      </MapContainer>
      {!playbackActive && routePoints.length >= 2 && (
        <RouteStatsPanel
          points={routePoints.map((p) => ({ lat: p.position[0], lng: p.position[1] }))}
        />
      )}
      {!playbackActive && routePoints.length >= 2 && (
        <WeatherPanel
          points={routePoints.map((p) => ({ lat: p.position[0], lng: p.position[1] }))}
        />
      )}
      {routeInfo && (
        <>
          <LikeRatingBar routeId={routeInfo.id} />
          <CommentSection
            routeId={routeInfo.id}
            routeOwnerId={routeInfo.user_id}
          />
        </>
      )}
    </div>
  );
}
