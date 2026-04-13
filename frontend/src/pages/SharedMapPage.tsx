import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet-routing-machine';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import '../App.css';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import { categoriesApi, type Category } from '../api/categories';
import {
  RoutingControl,
  ManualRoutes,
  SegmentDurationMarkers,
  createMarkerIcon,
  getPhotoSrc,
  type PhotoPreviewShape,
  type RoutePoint,
  type RouteSegment,
} from './MapPage';
import { RouteStatsPanel } from '../components/RouteStatsPanel';
import { CommentSection } from '../components/CommentSection';
import { LikeRatingBar } from '../components/LikeRatingBar';
import { exportAsGpx, exportAsKml } from '../utils/exportRoute';
import { WeatherPanel } from '../components/WeatherPanel';
import { RoutePlayback } from '../components/RoutePlayback';
import { LeafletAttributionPrefix } from '../components/LeafletAttributionPrefix';
import { useAuth } from '../context/AuthContext';
import { QRCodeModal } from '../components/QRCodeModal';
import { getLocalizedCategoryName } from '../utils/categories';
import { DEFAULT_ROUTE_LINE_COLOR, normalizeRouteLineColor } from '../utils/routeColors';

type RouteMode = 'auto' | 'manual';

const TILE_PROVIDERS = [
  {
    id: 'yandex',
    name: 'Yandex',
    url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
    attribution: '&copy; Yandex',
  },
  { id: 'osm', name: 'OpenStreetMap', url: '/api/v1/tile/{z}/{x}/{y}', attribution: '&copy; OpenStreetMap' },
  { id: '2gis', name: '2GIS', url: 'https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', attribution: '&copy; 2GIS' },
  { id: 'opentopomap', name: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenTopoMap' },
];

export function SharedMapPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t, dateLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeName, setRouteName] = useState('');
  const [routeLineColor, setRouteLineColor] = useState(DEFAULT_ROUTE_LINE_COLOR);
  const [routeStartedAt, setRouteStartedAt] = useState<string | undefined>(undefined);
  const [routeCategoryIds, setRouteCategoryIds] = useState<string[]>([]);
  const [routeSeasons, setRouteSeasons] = useState<string[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ id: string; user_id: string } | null>(null);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tileProvider, setTileProvider] = useState(() => localStorage.getItem('tileProvider') || 'yandex');
  const [playbackActive, setPlaybackActive] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  useEffect(() => {
    categoriesApi.getCategories().then(setAvailableCategories).catch((err) => {
      console.error('[SharedMapPage] failed to load categories:', err);
    });
  }, []);

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
    if (!routeInfo || !user) {
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
    setError('');
    try {
      const route = await routesApi.getSharedRoute(shareToken);
      setRouteName(route.name);
      setRouteLineColor(normalizeRouteLineColor(route.line_color));
      setRouteStartedAt(route.started_at);
      setRouteCategoryIds(route.category_ids);
      setRouteSeasons(route.seasons ?? []);
      setRouteInfo({ id: route.id, user_id: route.user_id });
      loadBookmarkStatus(route.id);

      const loadedPoints: RoutePoint[] = route.points.map((point, index) => ({
        id: index,
        position: [point.lat, point.lng] as [number, number],
        name: point.name,
        note: point.note,
        markerColor: point.marker_color,
        markerSize: point.marker_size,
        previewSize: point.preview_size,
        previewShape: point.preview_shape as PhotoPreviewShape | undefined,
        photo: point.photo,
      }));
      setRoutePoints(loadedPoints);

      const segments: RouteSegment[] = [];
      for (let index = 0; index < loadedPoints.length - 1; index += 1) {
        const destinationPoint = route.points[index + 1];
        segments.push({
          fromIndex: index,
          toIndex: index + 1,
          mode: (destinationPoint.segment_mode as RouteMode) || 'manual',
          durationMinutes: destinationPoint.segment_duration_minutes,
        });
      }
      setRouteSegments(segments);
    } catch (err) {
      console.error('Failed to load shared route:', err);
      setError(t('shared.notFound'));
    } finally {
      setLoading(false);
    }
  };

  const handleTileProviderChange = (providerId: string) => {
    setTileProvider(providerId);
    localStorage.setItem('tileProvider', providerId);
  };

  const currentProvider = TILE_PROVIDERS.find((provider) => provider.id === tileProvider) || TILE_PROVIDERS[0];
  const routeCategoryNames = routeCategoryIds
    .map((categoryId) => availableCategories.find((category) => category.id === categoryId)?.name)
    .filter((name): name is string => Boolean(name));
  const localizedCategoryNames = routeCategoryNames.map((name) => getLocalizedCategoryName(name, t) || name);
  const startedAtLabel = routeStartedAt
    ? new Date(routeStartedAt).toLocaleString(dateLocale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const waypoints = routePoints.map((point) => L.latLng(point.position[0], point.position[1]));

  if (loading) {
    return (
      <div className="App shared-state-screen">
        <div className="shared-state-card">
          <span className="shared-route-eyebrow">{t('shared.summary')}</span>
          <h1>{t('shared.loadingRoute')}</h1>
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App shared-state-screen">
        <div className="shared-state-card">
          <span className="shared-route-eyebrow">{t('shared.summary')}</span>
          <h1>{error}</h1>
          <p>{t('shared.notFound')}</p>
          <div className="shared-state-actions">
            <button type="button" className="btn-secondary" onClick={() => navigate('/explore')}>
              {t('explore.catalog')}
            </button>
            <button type="button" className="btn-primary" onClick={() => navigate('/map')}>
              {t('profile.backToMap')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="map-header shared-map-shell">
        <section className="shared-route-panel">
          <div className="shared-route-panel-top">
            <span className="shared-route-eyebrow">{t('shared.summary')}</span>
            <div className="shared-route-nav">
              <button type="button" className="btn-secondary" onClick={() => navigate('/explore')}>
                {t('explore.catalog')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => navigate('/map')}>
                {t('profile.backToMap')}
              </button>
            </div>
          </div>
          <h1 className="shared-route-name">{routeName}</h1>
          <div className="shared-route-stats">
            <span className="shared-route-chip">
              <MapPin size={14} />
              {t('shared.pointsCount', { count: routePoints.length })}
            </span>
            {startedAtLabel && (
              <span className="shared-route-chip">
                <CalendarDays size={14} />
                {startedAtLabel}
              </span>
            )}
          </div>
          {(localizedCategoryNames.length > 0 || routeSeasons.length > 0) && (
            <div className="shared-route-tags-block">
              {localizedCategoryNames.length > 0 && (
                <div className="route-tags">
                  {localizedCategoryNames.map((name) => (
                    <span key={name} className="route-tag">
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {routeSeasons.length > 0 && (
                <div className="route-tags">
                  {routeSeasons.map((season) => (
                    <span key={season} className={`route-tag season-tag season-${season}`}>
                      {t(`seasons.${season}` as never)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="shared-route-controls-card">
          <div className="shared-route-toolbar">
            <select
              className="shared-route-select"
              value={tileProvider}
              onChange={(event) => handleTileProviderChange(event.target.value)}
            >
              {TILE_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            {routePoints.length >= 2 && (
              <>
                <button
                  type="button"
                  onClick={() => exportAsGpx(routeName, routePoints.map((point) => ({ lat: point.position[0], lng: point.position[1], name: point.name, note: point.note })))}
                  className="btn-secondary"
                >
                  {t('export.gpx')}
                </button>
                <button
                  type="button"
                  onClick={() => exportAsKml(routeName, routePoints.map((point) => ({ lat: point.position[0], lng: point.position[1], name: point.name, note: point.note })))}
                  className="btn-secondary"
                >
                  {t('export.kml')}
                </button>
                <button type="button" onClick={() => setPlaybackActive(true)} className="btn-secondary">
                  {t('playback.button')}
                </button>
                <button type="button" onClick={() => setQrOpen(true)} className="btn-secondary">
                  {t('qr.button')}
                </button>
                <button type="button" onClick={() => setEmbedOpen(true)} className="btn-secondary">
                  {t('embed.button')}
                </button>
              </>
            )}
            {user && routeInfo && (
              <button
                type="button"
                onClick={handleToggleBookmark}
                disabled={bookmarkLoading}
                className={`btn-secondary shared-bookmark-btn${bookmarked ? ' bookmarked' : ''}`}
                title={bookmarked ? t('bookmarks.bookmarked') : t('bookmarks.bookmark')}
              >
                {bookmarked ? '★' : '☆'} {bookmarked ? t('bookmarks.bookmarked') : t('bookmarks.bookmark')}
              </button>
            )}
            <button type="button" onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
              {theme === 'light' ? '☽' : '☀'}
            </button>
          </div>
        </section>
      </div>

      <MapContainer
        center={routePoints.length > 0 ? routePoints[0].position : [55.7518, 37.6178]}
        zoom={13}
        style={{ height: '100vh', width: '100%' }}
      >
        <LeafletAttributionPrefix />
        <TileLayer key={tileProvider} url={currentProvider.url} attribution={currentProvider.attribution} />
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} color={routeLineColor} categoryNames={routeCategoryNames} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} color={routeLineColor} categoryNames={routeCategoryNames} />
        <SegmentDurationMarkers waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker
            key={`${point.id}-${point.photo ? 'photo' : 'no-photo'}-${point.previewSize ?? 'default'}-${point.previewShape ?? 'default'}-${point.markerColor ?? 'default'}-${point.markerSize ?? 'default'}`}
            position={point.position}
            icon={createMarkerIcon(point.photo, point.previewSize, point.previewShape, point.markerColor, point.markerSize)}
          >
            <Popup>
              <div className="point-popup">
                <div className="point-popup-header">
                  <strong>{t('map.point', { index: index + 1 })}</strong>
                </div>
                {point.name && <div className="point-popup-name">{point.name}</div>}
                <div className="point-popup-coords">
                  {t('map.coordinates')} {point.position[0].toFixed(6)}, {point.position[1].toFixed(6)}
                </div>
                {point.note?.trim() && <div className="point-popup-note-text">{point.note}</div>}
                {getPhotoSrc(point.photo) && (
                  <div className="point-popup-photo">
                    <img src={point.photo?.original || getPhotoSrc(point.photo)} alt={t('map.point', { index: index + 1 })} />
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {playbackActive && routePoints.length >= 2 && (
          <RoutePlayback points={routePoints} segments={routeSegments} onClose={() => setPlaybackActive(false)} />
        )}
      </MapContainer>

      {!playbackActive && routePoints.length >= 2 && (
        <RouteStatsPanel
          points={routePoints.map((point) => ({ lat: point.position[0], lng: point.position[1] }))}
          segments={routeSegments}
          categoryNames={routeCategoryNames}
        />
      )}
      {!playbackActive && routePoints.length >= 2 && (
        <WeatherPanel
          points={routePoints.map((point) => ({ lat: point.position[0], lng: point.position[1] }))}
          startedAt={routeStartedAt}
        />
      )}
      {routeInfo && (
        <>
          <LikeRatingBar routeId={routeInfo.id} />
          <CommentSection routeId={routeInfo.id} routeOwnerId={routeInfo.user_id} />
        </>
      )}
      {qrOpen && token && (
        <QRCodeModal url={`${window.location.origin}/shared/${token}`} routeName={routeName} onClose={() => setQrOpen(false)} />
      )}
      {embedOpen && token && (
        <div className="modal-overlay" onClick={() => setEmbedOpen(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>{t('embed.title')}</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{t('embed.hint')}</p>
            <textarea
              readOnly
              value={`<iframe src="${window.location.origin}/embed/${token}" width="100%" height="450" style="border:none;border-radius:8px;" allowfullscreen loading="lazy"></iframe>`}
              style={{
                width: '100%',
                height: 80,
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: 12,
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
                boxSizing: 'border-box',
              }}
              onClick={(event) => (event.target as HTMLTextAreaElement).select()}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(`<iframe src="${window.location.origin}/embed/${token}" width="100%" height="450" style="border:none;border-radius:8px;" allowfullscreen loading="lazy"></iframe>`);
                  setEmbedCopied(true);
                  setTimeout(() => setEmbedCopied(false), 2000);
                }}
              >
                {embedCopied ? t('embed.copied') : t('embed.copy')}
              </button>
              <button className="btn-secondary" onClick={() => setEmbedOpen(false)}>
                {t('embed.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
