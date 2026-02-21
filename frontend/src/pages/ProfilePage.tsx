import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import type { Locale } from '../i18n';
import { profileApi } from '../api/profile';
import { routesApi } from '../api/routes';
import type { Route, RoutePoint } from '../api/routes';
import { totalDistance, formatDistance } from '../utils/geo';
import { exportAsGpx, exportAsKml } from '../utils/exportRoute';
import { NotificationBell } from '../components/NotificationBell';
import { categoriesApi } from '../api/categories';
import type { Category } from '../api/categories';
import L from 'leaflet';
import { MapPin, ArrowLeftRight, ArrowRight, MessageCircle, Heart, Star } from 'lucide-react';
import './ProfilePage.css';

type TabType = 'profile' | 'security' | 'routes';

const CATEGORY_COLORS: Record<string, string> = {
  cycling: '#3b82f6',
  hiking: '#22c55e',
  historical: '#f59e0b',
  nature: '#14b8a6',
  urban: '#a855f7',
  running: '#ef4444',
  walking: '#84cc16',
};

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? '#4CAF50';
}

const geocodeCache = new Map<string, string>();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// zoom 14 = suburb, 16 = street, 18 = building
async function reverseGeocodeAtZoom(lat: number, lng: number, zoom: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)},z${zoom}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru&zoom=${zoom}`,
      { headers: { 'User-Agent': 'GuideHelper/1.0' } },
    );
    const data = await res.json();
    const addr = data.address || {};
    let name = '';
    if (zoom >= 16) {
      name = addr.road || addr.suburb || addr.neighbourhood || addr.city_district || addr.city || '';
    } else {
      name = addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || '';
    }
    if (!name) name = data.display_name?.split(',')[0] || '';
    geocodeCache.set(key, name);
    return name;
  } catch {
    return '';
  }
}

function RouteMapPreview({ points, color }: { points: RoutePoint[]; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length < 1) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });

    L.tileLayer(
      'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
      { maxZoom: 18 },
    ).addTo(map);

    const latlngs = points.map(p => [p.lat, p.lng] as [number, number]);
    const polyline = L.polyline(latlngs, { color, weight: 3, opacity: 0.9 }).addTo(map);

    L.circleMarker(latlngs[0], {
      radius: 4, color: '#4CAF50', fillColor: '#4CAF50', fillOpacity: 1, weight: 0,
    }).addTo(map);
    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 4, color: '#f44336', fillColor: '#f44336', fillOpacity: 1, weight: 0,
    }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [8, 8] });
    mapRef.current = map;

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (points.length < 1) return null;

  return (
    <div
      ref={containerRef}
      className="route-map-preview"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export default function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const { t, locale, setLocale, dateLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('profile');

  // Profile form state
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Password form state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Routes state
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [ratingAggregates, setRatingAggregates] = useState<Record<string, { average: number; count: number }>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [routeLocations, setRouteLocations] = useState<Record<string, { from: string; to: string }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setAvatarUrl(user.avatar_url || '');
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'routes') {
      loadRoutes();
    }
  }, [activeTab]);

  const loadRoutes = async () => {
    setRoutesLoading(true);
    setRoutesError('');
    try {
      const [data, categories] = await Promise.all([
        routesApi.getRoutes(),
        categoriesApi.getCategories().catch(() => [] as Category[]),
      ]);
      setRoutes(data);
      const map: Record<string, string> = {};
      categories.forEach((c) => { map[c.id] = c.name; });
      setCategoryMap(map);

      // Lazily load start/end place names via reverse geocoding (1 req/sec Nominatim limit).
      // If both names resolve to the same string, zoom in (suburb → street → building) until they differ.
      (async () => {
        for (const route of data) {
          if (route.points.length < 1) continue;
          const first = route.points[0];
          const last = route.points[route.points.length - 1];
          const coordsMatch = first.lat === last.lat && first.lng === last.lng;

          let fromName = '';
          let toName = '';

          for (const zoom of [14, 16, 18]) {
            fromName = first.name || await reverseGeocodeAtZoom(first.lat, first.lng, zoom);
            await sleep(1100);
            toName = coordsMatch ? fromName : (last.name || await reverseGeocodeAtZoom(last.lat, last.lng, zoom));
            if (!coordsMatch) await sleep(1100);

            // Stop as soon as names differ, or if coords are identical (will never differ)
            if (fromName !== toName || coordsMatch) break;
          }

          if (fromName || toName) {
            setRouteLocations(prev => ({ ...prev, [route.id]: { from: fromName, to: toName } }));
          }
        }
      })();

      // Load comment counts, like counts, and rating aggregates in parallel
      const counts: Record<string, number> = {};
      const likes: Record<string, number> = {};
      const ratings: Record<string, { average: number; count: number }> = {};

      const [commentResults, likeResults, ratingResults] = await Promise.all([
        Promise.allSettled(data.map((route) => routesApi.getCommentCount(route.id))),
        Promise.allSettled(data.map((route) => routesApi.getLikeCount(route.id))),
        Promise.allSettled(data.map((route) => routesApi.getRatingAggregate(route.id))),
      ]);

      commentResults.forEach((result, idx) => {
        counts[data[idx].id] = result.status === 'fulfilled' ? result.value : 0;
      });
      likeResults.forEach((result, idx) => {
        likes[data[idx].id] = result.status === 'fulfilled' ? result.value.count : 0;
      });
      ratingResults.forEach((result, idx) => {
        ratings[data[idx].id] = result.status === 'fulfilled'
          ? { average: result.value.average, count: result.value.count }
          : { average: 0, count: 0 };
      });

      setCommentCounts(counts);
      setLikeCounts(likes);
      setRatingAggregates(ratings);
    } catch (err: any) {
      setRoutesError(err.response?.data || t('profile.loadRoutesFailed'));
    } finally {
      setRoutesLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      await profileApi.updateProfile({
        name: name || undefined,
        avatar_url: avatarUrl || undefined,
      });
      await refreshUser();
      setProfileSuccess(t('profile.updateSuccess'));
    } catch (err: any) {
      setProfileError(err.response?.data || t('profile.updateFailed'));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordsMismatch'));
      setPasswordLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('profile.passwordMinLength'));
      setPasswordLoading(false);
      return;
    }

    try {
      await profileApi.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
      });
      setPasswordSuccess(t('profile.passwordChanged'));
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.response?.data || t('profile.passwordChangeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleShareRoute = async (routeId: string) => {
    try {
      const { share_token } = await routesApi.enableShare(routeId);
      setRoutes(routes.map(r =>
        r.id === routeId ? { ...r, share_token } : r
      ));
      const link = `${window.location.origin}/shared/${share_token}`;
      await navigator.clipboard.writeText(link);
      toast.success(t('profile.linkCopied'));
    } catch (err: any) {
      setRoutesError(err.response?.data || t('profile.shareFailed'));
    }
  };

  const handleCopyLink = async (shareToken: string) => {
    const link = `${window.location.origin}/shared/${shareToken}`;
    await navigator.clipboard.writeText(link);
    toast.success(t('profile.linkCopied'));
  };

  const handleUnshareRoute = async (routeId: string) => {
    try {
      await routesApi.disableShare(routeId);
      setRoutes(routes.map(r =>
        r.id === routeId ? { ...r, share_token: undefined } : r
      ));
    } catch (err: any) {
      setRoutesError(err.response?.data || t('profile.unshareFailed'));
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    if (!confirm(t('profile.confirmDelete'))) {
      return;
    }

    try {
      await routesApi.deleteRoute(routeId);
      setRoutes(routes.filter(r => r.id !== routeId));
    } catch (err: any) {
      setRoutesError(err.response?.data || t('profile.deleteFailed'));
    }
  };

  const handleImportGeoJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setRoutesError('');

    try {
      const importedRoute = await routesApi.importFromGeoJson(file);
      setRoutes([importedRoute, ...routes]);
    } catch (err: any) {
      setRoutesError(err.response?.data || t('profile.importFailed'));
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const toggleRouteSelection = (id: string) => {
    setSelectedRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleShowSelected = () => {
    const ids = Array.from(selectedRouteIds).join(',');
    console.log("Navigating to multi-route view:", ids);
    navigate(`/map?routes=${ids}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="profile-page">
      <header className="profile-header">
        <h1>{t('profile.title')}</h1>
        <div className="header-actions">
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin')} className="btn-secondary">
              {t('admin.title')}
            </button>
          )}
          <button onClick={() => navigate('/explore')} className="btn-secondary">
            {t('explore.catalog')}
          </button>
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('profile.backToMap')}
          </button>
          <NotificationBell />
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '\u263D' : '\u2600'}
          </button>
          <button onClick={handleLogout} className="btn-logout">
            {t('profile.logout')}
          </button>
        </div>
      </header>

      <div className="profile-content">
        <nav className="profile-tabs">
          <button
            className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            {t('profile.tabs.profile')}
          </button>
          <button
            className={`tab ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            {t('profile.tabs.security')}
          </button>
          <button
            className={`tab ${activeTab === 'routes' ? 'active' : ''}`}
            onClick={() => setActiveTab('routes')}
          >
            {t('profile.tabs.routes')}
          </button>
        </nav>

        <div className="tab-content">
          {activeTab === 'profile' && (
            <div className="profile-tab">
              <form onSubmit={handleProfileSubmit}>
                <div className="form-group">
                  <label>{t('profile.email')}</label>
                  <input type="email" value={user?.email || ''} disabled />
                </div>

                <div className="form-group">
                  <label>{t('profile.role')}</label>
                  <input type="text" value={user?.role ? t(`admin.roles.${user.role}` as any) : ''} disabled />
                </div>

                <div className="form-group">
                  <label>{t('profile.name')}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('profile.enterName')}
                  />
                </div>

                <div className="form-group">
                  <label>{t('profile.avatarUrl')}</label>
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.png"
                  />
                </div>

                <div className="form-group">
                  <label>{t('profile.memberSince')}</label>
                  <input
                    type="text"
                    value={user ? formatDate(user.created_at) : ''}
                    disabled
                  />
                </div>

                <div className="form-group">
                  <label>{t('profile.language')}</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                  </select>
                </div>

                {profileError && <div className="error-message">{profileError}</div>}
                {profileSuccess && <div className="success-message">{profileSuccess}</div>}

                <button type="submit" disabled={profileLoading} className="btn-primary">
                  {profileLoading ? t('profile.saving') : t('profile.saveChanges')}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="security-tab">
              <h2>{t('profile.changePassword')}</h2>
              <form onSubmit={handlePasswordSubmit}>
                <div className="form-group">
                  <label>{t('profile.currentPassword')}</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>{t('profile.newPassword')}</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>

                <div className="form-group">
                  <label>{t('profile.confirmPassword')}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                {passwordError && <div className="error-message">{passwordError}</div>}
                {passwordSuccess && <div className="success-message">{passwordSuccess}</div>}

                <button type="submit" disabled={passwordLoading} className="btn-primary">
                  {passwordLoading ? t('profile.changing') : t('profile.changePasswordBtn')}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'routes' && (
            <div className="routes-tab">
              <div className="routes-header">
                <h2>{t('profile.mySavedRoutes')}</h2>
                <div className="routes-actions">
                  {selectedRouteIds.size > 0 && (
                    <button
                      onClick={handleShowSelected}
                      className="btn-primary"
                    >
                      {t('profile.showSelected', { count: selectedRouteIds.size })}
                    </button>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".geojson,.json"
                    onChange={handleImportGeoJson}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importLoading}
                    className="btn-secondary"
                  >
                    {importLoading ? t('profile.importing') : t('profile.importGeoJson')}
                  </button>
                </div>
              </div>

              {routesLoading && <div className="loading">{t('profile.loadingRoutes')}</div>}
              {routesError && <div className="error-message">{routesError}</div>}

              {!routesLoading && routes.length === 0 && (
                <div className="no-routes">
                  <p>{t('profile.noRoutes')}</p>
                  <button onClick={() => navigate('/map')} className="btn-primary">
                    {t('profile.createRoute')}
                  </button>
                </div>
              )}

              {routes.length > 0 && (
                <div className="routes-list">
                  {routes.map((route) => {
                    const firstCatName = (route.category_ids?.[0] && categoryMap[route.category_ids[0]]) || '';
                    const accentColor = getCategoryColor(firstCatName);
                    return (
                      <div
                        key={route.id}
                        className={`route-card ${selectedRouteIds.has(route.id) ? 'selected' : ''}`}
                        style={{ '--card-accent': accentColor } as React.CSSProperties}
                      >
                        <div className="route-card-body" onClick={() => toggleRouteSelection(route.id)}>
                          <div className="route-card-info">
                            <h3 className="route-card-title">{route.name}</h3>
                            {(route.category_ids?.length ?? 0) > 0 && (
                              <div className="route-tags">
                                {route.category_ids.map((id) => (
                                  <span key={id} className="route-tag">{categoryMap[id] || id}</span>
                                ))}
                              </div>
                            )}
                            {routeLocations[route.id] && (
                              <div className="route-card-location">
                                <span className="route-loc-name">{routeLocations[route.id].from}</span>
                                <ArrowRight size={12} className="route-loc-arrow" />
                                <span className="route-loc-name">{routeLocations[route.id].to}</span>
                              </div>
                            )}
                            <div className="route-card-stats">
                              <span className="route-stat"><MapPin size={15} color={accentColor} />{route.points.length}</span>
                              {route.points.length >= 2 && (
                                <span className="route-stat"><ArrowLeftRight size={15} color="#60a5fa" />{formatDistance(totalDistance(route.points))}</span>
                              )}
                              {commentCounts[route.id] != null && (
                                <span className="route-stat"><MessageCircle size={15} color="#a78bfa" />{commentCounts[route.id]}</span>
                              )}
                              {likeCounts[route.id] != null && (
                                <span className="route-stat"><Heart size={15} color="#f87171" />{likeCounts[route.id]}</span>
                              )}
                              {ratingAggregates[route.id]?.count > 0 && (
                                <span className="route-stat"><Star size={15} color="#fbbf24" />{ratingAggregates[route.id].average.toFixed(1)}</span>
                              )}
                            </div>
                            <div className="route-card-date">{t('profile.created')} {formatDate(route.created_at)}</div>
                          </div>
                          <RouteMapPreview points={route.points} color={accentColor} />
                          {selectedRouteIds.has(route.id) && <div className="route-selected-badge">✓</div>}
                        </div>
                        <div className="route-card-footer">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/map?route=${route.id}`); }}
                            className="btn-secondary"
                          >
                            {t('profile.view')}
                          </button>
                          {route.share_token ? (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopyLink(route.share_token!); }}
                                className="btn-secondary"
                              >
                                {t('profile.copyLink')}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUnshareRoute(route.id); }}
                                className="btn-secondary"
                              >
                                {t('profile.unshare')}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleShareRoute(route.id); }}
                              className="btn-secondary"
                            >
                              {t('profile.share')}
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); exportAsGpx(route.name, route.points); }}
                            className="btn-secondary"
                          >
                            {t('export.gpx')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); exportAsKml(route.name, route.points); }}
                            className="btn-secondary"
                          >
                            {t('export.kml')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteRoute(route.id); }}
                            className="btn-danger"
                          >
                            {t('profile.delete')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
