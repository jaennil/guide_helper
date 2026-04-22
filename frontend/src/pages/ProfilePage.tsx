import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { ConfirmDialog } from '../components/ConfirmDialog';
import { categoriesApi } from '../api/categories';
import type { Category } from '../api/categories';
import { getLocalizedCategoryName } from '../utils/categories';
import { normalizeRouteLineColor } from '../utils/routeColors';
import { asTranslationKey } from '../i18n';
import { getErrorMessage } from '../utils/errors';
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

interface RouteGroup {
  versionGroupId: string;
  current: Route;
  versions: Route[];
}

function sortRoutesForVersionGroup(routes: Route[]) {
  return [...routes].sort((left, right) => {
    if (right.version_number !== left.version_number) {
      return right.version_number - left.version_number;
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function buildRouteGroups(routes: Route[]): RouteGroup[] {
  const groups = new Map<string, Route[]>();

  routes.forEach((route) => {
    const key = route.version_group_id || route.id;
    const current = groups.get(key) ?? [];
    current.push(route);
    groups.set(key, current);
  });

  return [...groups.entries()]
    .map(([versionGroupId, groupRoutes]) => {
      const versions = sortRoutesForVersionGroup(groupRoutes);
      return {
        versionGroupId,
        current: versions[0],
        versions,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.current.updated_at).getTime() - new Date(left.current.updated_at).getTime(),
    );
}

function getRouteStatusLabel(route: Route, t: ReturnType<typeof useLanguage>['t']) {
  if (route.is_draft) {
    return t('profile.routeStatusDraft');
  }

  return route.share_token ? t('profile.sharedStatusPublic') : t('profile.sharedStatusPrivate');
}

function getRouteStatusClass(route: Route) {
  if (route.is_draft) {
    return 'draft';
  }

  return route.share_token ? 'shared' : 'private';
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
  }, [points, color]);

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
  const [confirmDeleteRouteId, setConfirmDeleteRouteId] = useState<string | null>(null);
  const [renamingRouteId, setRenamingRouteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expandedVersionGroups, setExpandedVersionGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setAvatarUrl(user.avatar_url || '');
    }
  }, [user]);

  const loadRoutes = useCallback(async () => {
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
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.loadRoutesFailed')));
    } finally {
      setRoutesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeTab === 'routes') {
      loadRoutes();
    }
  }, [activeTab, loadRoutes]);

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
    } catch (err) {
      setProfileError(getErrorMessage(err, t('profile.updateFailed')));
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
    } catch (err) {
      setPasswordError(getErrorMessage(err, t('profile.passwordChangeFailed')));
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
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.shareFailed')));
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
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.unshareFailed')));
    }
  };

  const handleStartRename = (route: Route) => {
    setRenamingRouteId(route.id);
    setRenameValue(route.name);
  };

  const handleConfirmRename = async (routeId: string) => {
    const newName = renameValue.trim();
    if (!newName) return;
    try {
      const updated = await routesApi.updateRoute(routeId, { name: newName });
      setRoutes(routes.map(r => r.id === routeId ? { ...r, name: updated.name } : r));
      setRenamingRouteId(null);
      window.dispatchEvent(new CustomEvent('routeUpdated'));
    } catch {
      toast.error(t('profile.renameFailed'));
    }
  };

  const handleDeleteRoute = (routeId: string) => {
    setConfirmDeleteRouteId(routeId);
  };

  const toggleVersionGroup = (versionGroupId: string) => {
    setExpandedVersionGroups((prev) => {
      const next = new Set(prev);
      if (next.has(versionGroupId)) {
        next.delete(versionGroupId);
      } else {
        next.add(versionGroupId);
      }
      return next;
    });
  };

  const handlePublishDraft = async (route: Route) => {
    try {
      const updated = await routesApi.updateRoute(route.id, { is_draft: false });
      setRoutes((current) => current.map((item) => (item.id === route.id ? updated : item)));
      toast.success(t('profile.routeDraftPublished'));
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.routeDraftPublishFailed')));
    }
  };

  const handleCreateRouteVersion = async (route: Route) => {
    try {
      const created = await routesApi.createRoute({
        name: route.name,
        points: route.points,
        category_ids: route.category_ids,
        seasons: route.seasons,
        line_color: route.line_color,
        started_at: route.started_at,
        is_draft: true,
        source_route_id: route.id,
      });
      setRoutes((current) => [created, ...current]);
      toast.success(t('profile.routeVersionCreated'));
      navigate(`/map?route=${created.id}`);
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.routeVersionCreateFailed')));
    }
  };

  const handleConfirmDeleteRoute = async () => {
    if (!confirmDeleteRouteId) return;
    const routeId = confirmDeleteRouteId;
    setConfirmDeleteRouteId(null);
    try {
      await routesApi.deleteRoute(routeId);
      setRoutes(routes.filter(r => r.id !== routeId));
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.deleteFailed')));
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
    } catch (err) {
      setRoutesError(getErrorMessage(err, t('profile.importFailed')));
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const closeRouteActionMenu = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const details = target.closest('details');
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
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

  const routeGroups = useMemo(() => buildRouteGroups(routes), [routes]);

  return (
    <>
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
                  <input type="text" value={user?.role ? t(asTranslationKey(`admin.roles.${user.role}`)) : ''} disabled />
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
                <div className="routes-header-copy">
                  <h2>{t('profile.mySavedRoutes')}</h2>
                  <p>{t('explore.results', { count: routeGroups.length })}</p>
                </div>
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

              {routeGroups.length > 0 && (
                <div className="routes-list">
                  {routeGroups.map((group) => {
                    const route = group.current;
                    const isExpanded = expandedVersionGroups.has(group.versionGroupId);
                    const firstCatName = (route.category_ids?.[0] && categoryMap[route.category_ids[0]]) || '';
                    const accentColor = getCategoryColor(firstCatName);
                    return (
                      <div
                        key={group.versionGroupId}
                        className={`route-card ${selectedRouteIds.has(route.id) ? 'selected' : ''}`}
                        style={{ '--card-accent': accentColor } as React.CSSProperties}
                      >
                        <div className="route-card-body" onClick={() => toggleRouteSelection(route.id)}>
                          <div className="route-card-info">
                            {renamingRouteId === route.id ? (
                              <div className="route-rename-row" onClick={e => e.stopPropagation()}>
                                <input
                                  className="route-rename-input"
                                  value={renameValue}
                                  autoFocus
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleConfirmRename(route.id);
                                    if (e.key === 'Escape') setRenamingRouteId(null);
                                  }}
                                />
                                <button className="btn-secondary" onClick={() => handleConfirmRename(route.id)}>{t('profile.renameSave')}</button>
                                <button className="btn-secondary" onClick={() => setRenamingRouteId(null)}>{t('map.cancel')}</button>
                              </div>
                            ) : (
                              <h3 className="route-card-title">{route.name}</h3>
                            )}
                            <div className="route-tags route-tags-inline">
                              {(route.category_ids?.length ?? 0) > 0 && route.category_ids.map((id) => (
                                <span key={id} className="route-tag">{getLocalizedCategoryName(categoryMap[id], t) || id}</span>
                              ))}
                              {(route.seasons?.length ?? 0) > 0 && route.seasons.map((season) => (
                                <span key={season} className={`route-tag season-tag season-${season}`}>{t(asTranslationKey(`seasons.${season}`))}</span>
                              ))}
                              <span className={`route-tag route-visibility-badge ${getRouteStatusClass(route)}`}>
                                {getRouteStatusLabel(route, t)}
                              </span>
                              <span className="route-tag route-version-badge">
                                {t('profile.routeVersionLabel', { current: route.version_number, total: group.versions.length })}
                              </span>
                            </div>
                            {(route.start_location || route.end_location) && (
                              <div className="route-card-location">
                                <span className="route-loc-name">{route.start_location}</span>
                                <ArrowRight size={12} className="route-loc-arrow" />
                                <span className="route-loc-name">{route.end_location}</span>
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
                            {group.versions.length > 1 && (
                              <button
                                type="button"
                                className="route-version-toggle"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleVersionGroup(group.versionGroupId);
                                }}
                              >
                                {isExpanded
                                  ? t('profile.routeVersionsHide')
                                  : t('profile.routeVersionsShow', { count: group.versions.length })}
                              </button>
                            )}
                          </div>
                          <RouteMapPreview
                            points={route.points}
                            color={route.line_color ? normalizeRouteLineColor(route.line_color) : accentColor}
                          />
                          {selectedRouteIds.has(route.id) && <div className="route-selected-badge">✓</div>}
                        </div>
                        <div className="route-card-footer">
                          <div className="route-card-actions-primary">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/map?route=${route.id}`); }}
                              className="btn-secondary"
                            >
                              {route.is_draft ? t('profile.routeContinueDraft') : t('profile.view')}
                            </button>
                            {route.is_draft ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); void handlePublishDraft(route); }}
                                className="btn-secondary"
                              >
                                {t('profile.routePublishDraft')}
                              </button>
                            ) : route.share_token ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopyLink(route.share_token!); }}
                                className="btn-secondary"
                              >
                                {t('profile.copyLink')}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleShareRoute(route.id); }}
                                className="btn-secondary"
                              >
                                {t('profile.share')}
                              </button>
                            )}
                          </div>
                          <details className="route-card-more" onClick={(e) => e.stopPropagation()}>
                            <summary className="route-card-more-toggle">{t('profile.moreActions')}</summary>
                            <div className="route-card-more-menu">
                              <button
                                onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); handleStartRename(route); }}
                                className="btn-secondary"
                              >
                                {t('profile.rename')}
                              </button>
                              {route.share_token && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); handleUnshareRoute(route.id); }}
                                  className="btn-secondary"
                                >
                                  {t('profile.unshare')}
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); void handleCreateRouteVersion(route); }}
                                className="btn-secondary"
                              >
                                {t('profile.routeCreateVersion')}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); exportAsGpx(route.name, route.points); }}
                                className="btn-secondary"
                              >
                                {t('export.gpx')}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); exportAsKml(route.name, route.points); }}
                                className="btn-secondary"
                              >
                                {t('export.kml')}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); closeRouteActionMenu(e.currentTarget); handleDeleteRoute(route.id); }}
                                className="btn-danger"
                              >
                                {t('profile.delete')}
                              </button>
                            </div>
                          </details>
                        </div>
                        {isExpanded && group.versions.length > 1 && (
                          <div className="route-version-history">
                            {group.versions.map((version) => (
                              <div key={version.id} className="route-version-item">
                                <div className="route-version-item-main">
                                  <div className="route-version-item-title">
                                    {version.name}
                                  </div>
                                  <div className="route-version-item-meta">
                                    {getRouteStatusLabel(version, t)} • {t('profile.routeVersionNumber', { version: version.version_number })} • {formatDate(version.updated_at)}
                                  </div>
                                </div>
                                <div className="route-version-item-actions">
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/map?route=${version.id}`);
                                    }}
                                  >
                                    {version.is_draft ? t('profile.routeContinueDraft') : t('profile.view')}
                                  </button>
                                  {!version.is_draft && (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleCreateRouteVersion(version);
                                      }}
                                    >
                                      {t('profile.routeCreateVersion')}
                                    </button>
                                  )}
                                  {version.is_draft && (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handlePublishDraft(version);
                                      }}
                                    >
                                      {t('profile.routePublishDraft')}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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

    {confirmDeleteRouteId && (
      <ConfirmDialog
        message={t('profile.confirmDelete')}
        confirmLabel={t('profile.delete')}
        cancelLabel={t('map.cancel')}
        onConfirm={handleConfirmDeleteRoute}
        onCancel={() => setConfirmDeleteRouteId(null)}
      />
    )}
    </>
  );
}
