import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { adminApi } from '../api/admin';
import type { AdminUser, AuthStatsResponse, RoutesStatsResponse, AdminRoute, AdminComment } from '../api/admin';
import { routesApi } from '../api/routes';
import { categoriesApi } from '../api/categories';
import type { Category } from '../api/categories';
import { settingsApi, DEFAULT_DIFFICULTY_THRESHOLDS } from '../api/settings';
import type { DifficultyThresholds } from '../api/settings';
import './AdminPage.css';

type AdminTab = 'dashboard' | 'users' | 'routes' | 'comments' | 'categories' | 'settings';

const PAGE_SIZE = 20;

export default function AdminPage() {
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');

  // Dashboard state
  const [authStats, setAuthStats] = useState<AuthStatsResponse | null>(null);
  const [routesStats, setRoutesStats] = useState<RoutesStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(0);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  // Routes state
  const [adminRoutes, setAdminRoutes] = useState<AdminRoute[]>([]);
  const [routesTotal, setRoutesTotal] = useState(0);
  const [routesPage, setRoutesPage] = useState(0);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState('');

  // Comments state
  const [adminComments, setAdminComments] = useState<AdminComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsPage, setCommentsPage] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');

  // Categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<{ id: string; name: string } | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Settings state
  const [thresholds, setThresholds] = useState<DifficultyThresholds>(DEFAULT_DIFFICULTY_THRESHOLDS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const [auth, routes] = await Promise.all([
        adminApi.getAuthStats(),
        adminApi.getRoutesStats(),
      ]);
      setAuthStats(auth);
      setRoutesStats(routes);
    } catch (err: any) {
      console.error('Failed to load admin stats:', err);
      setStatsError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setStatsLoading(false);
    }
  }, [t]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const data = await adminApi.getUsers({
        limit: PAGE_SIZE,
        offset: usersPage * PAGE_SIZE,
        search: usersSearch || undefined,
      });
      setUsers(data.users);
      setUsersTotal(data.total);
    } catch (err: any) {
      console.error('Failed to load users:', err);
      setUsersError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setUsersLoading(false);
    }
  }, [usersPage, usersSearch, t]);

  const loadAdminRoutes = useCallback(async () => {
    setRoutesLoading(true);
    setRoutesError('');
    try {
      const data = await adminApi.getAdminRoutes({
        limit: PAGE_SIZE,
        offset: routesPage * PAGE_SIZE,
      });
      setAdminRoutes(data.routes);
      setRoutesTotal(data.total);
    } catch (err: any) {
      console.error('Failed to load admin routes:', err);
      setRoutesError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setRoutesLoading(false);
    }
  }, [routesPage, t]);

  const loadAdminComments = useCallback(async () => {
    setCommentsLoading(true);
    setCommentsError('');
    try {
      const data = await adminApi.getAdminComments({
        limit: PAGE_SIZE,
        offset: commentsPage * PAGE_SIZE,
      });
      setAdminComments(data.comments);
      setCommentsTotal(data.total);
    } catch (err: any) {
      console.error('Failed to load admin comments:', err);
      setCommentsError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setCommentsLoading(false);
    }
  }, [commentsPage, t]);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError('');
    try {
      const data = await categoriesApi.getCategories();
      setCategories(data);
    } catch (err: any) {
      console.error('Failed to load categories:', err);
      setCategoriesError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setCategoriesLoading(false);
    }
  }, [t]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      const data = await settingsApi.getDifficultyThresholds();
      setThresholds(data);
    } catch (err: any) {
      console.error('Failed to load settings:', err);
      setSettingsError(err.response?.data || t('admin.loadFailed'));
    } finally {
      setSettingsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeTab === 'dashboard') loadStats();
  }, [activeTab, loadStats]);

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
  }, [activeTab, loadUsers]);

  useEffect(() => {
    if (activeTab === 'routes') loadAdminRoutes();
  }, [activeTab, loadAdminRoutes]);

  useEffect(() => {
    if (activeTab === 'comments') loadAdminComments();
  }, [activeTab, loadAdminComments]);

  useEffect(() => {
    if (activeTab === 'categories') loadCategories();
  }, [activeTab, loadCategories]);

  useEffect(() => {
    if (activeTab === 'settings') loadSettings();
  }, [activeTab, loadSettings]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await adminApi.updateUserRole(userId, newRole);
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      if (authStats) loadStats();
    } catch (err: any) {
      console.error('Failed to update role:', err);
      toast.error(err.response?.data || t('admin.roleUpdateFailed'));
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setUsersPage(0);
      loadUsers();
    }
  };

  const handleDeleteRoute = (routeId: string) => {
    setConfirmDialog({
      message: t('admin.routes.confirmDelete'),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await routesApi.deleteRoute(routeId);
          loadAdminRoutes();
        } catch (err: any) {
          console.error('Failed to delete route:', err);
          toast.error(err.response?.data || t('admin.routes.deleteFailed'));
        }
      },
    });
  };

  const handleDeleteComment = (commentId: string) => {
    setConfirmDialog({
      message: t('admin.comments.confirmDelete'),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await routesApi.deleteComment(commentId);
          loadAdminComments();
        } catch (err: any) {
          console.error('Failed to delete comment:', err);
          toast.error(err.response?.data || t('admin.comments.deleteFailed'));
        }
      },
    });
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      await categoriesApi.createCategory(newCategoryName.trim());
      setNewCategoryName('');
      loadCategories();
    } catch (err: any) {
      console.error('Failed to create category:', err);
      toast.error(err.response?.data || t('admin.categories.createFailed'));
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) return;
    try {
      await categoriesApi.updateCategory(editingCategory.id, editingCategory.name.trim());
      setEditingCategory(null);
      loadCategories();
    } catch (err: any) {
      console.error('Failed to update category:', err);
      toast.error(err.response?.data || t('admin.categories.updateFailed'));
    }
  };

  const handleDeleteCategory = (id: string) => {
    setConfirmDialog({
      message: t('admin.categories.confirmDelete'),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await categoriesApi.deleteCategory(id);
          loadCategories();
        } catch (err: any) {
          console.error('Failed to delete category:', err);
          toast.error(err.response?.data || t('admin.categories.deleteFailed'));
        }
      },
    });
  };

  const handleThresholdChange = (field: keyof DifficultyThresholds, value: string) => {
    setThresholds(prev => ({ ...prev, [field]: Number(value) }));
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      await settingsApi.updateDifficultyThresholds(thresholds);
      setSettingsSuccess(t('admin.settings.saved'));
      console.log('[admin] difficulty thresholds saved');
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      setSettingsError(err.response?.data || t('admin.settings.saveFailed'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const usersTotalPages = Math.ceil(usersTotal / PAGE_SIZE);
  const routesTotalPages = Math.ceil(routesTotal / PAGE_SIZE);
  const commentsTotalPages = Math.ceil(commentsTotal / PAGE_SIZE);

  const getRoleCount = (role: string): number => {
    if (!authStats) return 0;
    const item = authStats.by_role.find(r => r.role === role);
    return item?.count || 0;
  };

  return (
    <div className="admin-page">
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}
      <header className="admin-header">
        <h1>{t('admin.title')}</h1>
        <div className="header-actions">
          <button onClick={() => navigate('/profile')} className="btn-secondary">
            {t('profile.title')}
          </button>
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('profile.backToMap')}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '\u263D' : '\u2600'}
          </button>
        </div>
      </header>

      <div className="admin-content">
        <nav className="admin-tabs">
          {(['dashboard', 'users', 'routes', 'comments', 'categories', 'settings'] as AdminTab[]).map((tab) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`admin.${tab}` as any)}
            </button>
          ))}
        </nav>

        <div className="admin-tab-content">
          {activeTab === 'dashboard' && (
            <div>
              {statsLoading && <div className="loading">{t('common.loading')}</div>}
              {statsError && <div className="error-message">{statsError}</div>}
              {!statsLoading && authStats && routesStats && (
                <div className="stats-grid">
                  <div className="stat-card">
                    <p className="stat-value">{authStats.total_users}</p>
                    <p className="stat-label">{t('admin.stats.totalUsers')}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-value">{routesStats.total_routes}</p>
                    <p className="stat-label">{t('admin.stats.totalRoutes')}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-value">{routesStats.total_comments}</p>
                    <p className="stat-label">{t('admin.stats.totalComments')}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-value">{getRoleCount('admin')}</p>
                    <p className="stat-label">{t('admin.roles.admin')}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-value">{getRoleCount('moderator')}</p>
                    <p className="stat-label">{t('admin.roles.moderator')}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-value">{getRoleCount('user')}</p>
                    <p className="stat-label">{t('admin.roles.user')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'users' && (
            <div>
              <div className="users-search">
                <input
                  type="text"
                  placeholder={t('admin.search')}
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>

              {usersLoading && <div className="loading">{t('common.loading')}</div>}
              {usersError && <div className="error-message">{usersError}</div>}

              {!usersLoading && users.length > 0 && (
                <>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>{t('profile.email')}</th>
                        <th>{t('profile.name')}</th>
                        <th>{t('profile.role')}</th>
                        <th>{t('profile.memberSince')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.email}</td>
                          <td>{u.name || '\u2014'}</td>
                          <td>
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            >
                              <option value="user">{t('admin.roles.user')}</option>
                              <option value="moderator">{t('admin.roles.moderator')}</option>
                              <option value="admin">{t('admin.roles.admin')}</option>
                            </select>
                          </td>
                          <td>
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="pagination">
                    <button
                      disabled={usersPage === 0}
                      onClick={() => setUsersPage(p => p - 1)}
                    >
                      {t('admin.prevPage')}
                    </button>
                    <span>
                      {t('admin.pageInfo', {
                        current: usersPage + 1,
                        total: usersTotalPages,
                      })}
                    </span>
                    <button
                      disabled={usersPage + 1 >= usersTotalPages}
                      onClick={() => setUsersPage(p => p + 1)}
                    >
                      {t('admin.nextPage')}
                    </button>
                  </div>
                </>
              )}

              {!usersLoading && users.length === 0 && !usersError && (
                <p>{t('admin.noUsers')}</p>
              )}
            </div>
          )}

          {activeTab === 'routes' && (
            <div>
              {routesLoading && <div className="loading">{t('common.loading')}</div>}
              {routesError && <div className="error-message">{routesError}</div>}

              {!routesLoading && adminRoutes.length > 0 && (
                <>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>{t('admin.routes.name')}</th>
                        <th>{t('admin.routes.points')}</th>
                        <th>{t('admin.routes.created')}</th>
                        <th>{t('admin.routes.shared')}</th>
                        <th>{t('admin.routes.tags')}</th>
                        <th>{t('admin.routes.delete')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminRoutes.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.points_count}</td>
                          <td>{new Date(r.created_at).toLocaleDateString()}</td>
                          <td>{r.share_token ? '\u2713' : '\u2014'}</td>
                          <td>{r.tags.join(', ') || '\u2014'}</td>
                          <td>
                            <button
                              className="btn-danger-sm"
                              onClick={() => handleDeleteRoute(r.id)}
                            >
                              {t('admin.routes.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="pagination">
                    <button
                      disabled={routesPage === 0}
                      onClick={() => setRoutesPage(p => p - 1)}
                    >
                      {t('admin.prevPage')}
                    </button>
                    <span>
                      {t('admin.pageInfo', {
                        current: routesPage + 1,
                        total: routesTotalPages,
                      })}
                    </span>
                    <button
                      disabled={routesPage + 1 >= routesTotalPages}
                      onClick={() => setRoutesPage(p => p + 1)}
                    >
                      {t('admin.nextPage')}
                    </button>
                  </div>
                </>
              )}

              {!routesLoading && adminRoutes.length === 0 && !routesError && (
                <p>{t('admin.routes.noRoutes')}</p>
              )}
            </div>
          )}

          {activeTab === 'comments' && (
            <div>
              {commentsLoading && <div className="loading">{t('common.loading')}</div>}
              {commentsError && <div className="error-message">{commentsError}</div>}

              {!commentsLoading && adminComments.length > 0 && (
                <>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>{t('admin.comments.author')}</th>
                        <th>{t('admin.comments.text')}</th>
                        <th>{t('admin.comments.routeId')}</th>
                        <th>{t('admin.comments.created')}</th>
                        <th>{t('admin.comments.delete')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminComments.map((c) => (
                        <tr key={c.id}>
                          <td>{c.author_name}</td>
                          <td className="comment-text-cell">{c.text}</td>
                          <td className="route-id-cell">{c.route_id.slice(0, 8)}...</td>
                          <td>{new Date(c.created_at).toLocaleDateString()}</td>
                          <td>
                            <button
                              className="btn-danger-sm"
                              onClick={() => handleDeleteComment(c.id)}
                            >
                              {t('admin.comments.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="pagination">
                    <button
                      disabled={commentsPage === 0}
                      onClick={() => setCommentsPage(p => p - 1)}
                    >
                      {t('admin.prevPage')}
                    </button>
                    <span>
                      {t('admin.pageInfo', {
                        current: commentsPage + 1,
                        total: commentsTotalPages,
                      })}
                    </span>
                    <button
                      disabled={commentsPage + 1 >= commentsTotalPages}
                      onClick={() => setCommentsPage(p => p + 1)}
                    >
                      {t('admin.nextPage')}
                    </button>
                  </div>
                </>
              )}

              {!commentsLoading && adminComments.length === 0 && !commentsError && (
                <p>{t('admin.comments.noComments')}</p>
              )}
            </div>
          )}

          {activeTab === 'categories' && (
            <div>
              {categoriesLoading && <div className="loading">{t('common.loading')}</div>}
              {categoriesError && <div className="error-message">{categoriesError}</div>}

              <div className="category-add-form">
                <input
                  type="text"
                  placeholder={t('admin.categories.enterName')}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                />
                <button className="btn-primary" onClick={handleAddCategory}>
                  {t('admin.categories.add')}
                </button>
              </div>

              {!categoriesLoading && categories.length > 0 && (
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>{t('admin.categories.name')}</th>
                      <th>{t('admin.categories.created')}</th>
                      <th>{t('admin.categories.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat) => (
                      <tr key={cat.id}>
                        <td>
                          {editingCategory?.id === cat.id ? (
                            <input
                              type="text"
                              value={editingCategory.name}
                              onChange={(e) =>
                                setEditingCategory({ ...editingCategory, name: e.target.value })
                              }
                              onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory()}
                              autoFocus
                            />
                          ) : (
                            cat.name
                          )}
                        </td>
                        <td>{new Date(cat.created_at).toLocaleDateString()}</td>
                        <td>
                          {editingCategory?.id === cat.id ? (
                            <>
                              <button className="btn-primary-sm" onClick={handleUpdateCategory}>
                                {t('map.save')}
                              </button>
                              <button
                                className="btn-secondary-sm"
                                onClick={() => setEditingCategory(null)}
                              >
                                {t('map.cancel')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn-secondary-sm"
                                onClick={() =>
                                  setEditingCategory({ id: cat.id, name: cat.name })
                                }
                              >
                                {t('admin.categories.edit')}
                              </button>
                              <button
                                className="btn-danger-sm"
                                onClick={() => handleDeleteCategory(cat.id)}
                              >
                                {t('admin.categories.delete')}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {!categoriesLoading && categories.length === 0 && !categoriesError && (
                <p>{t('admin.categories.noCategories')}</p>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <h2 className="settings-section-title">{t('admin.settings.difficultyThresholds')}</h2>
              {settingsLoading && <div className="loading">{t('common.loading')}</div>}
              {settingsError && <div className="error-message">{settingsError}</div>}
              {settingsSuccess && <div className="success-message">{settingsSuccess}</div>}
              {!settingsLoading && (
                <div className="settings-form">
                  <div className="settings-field">
                    <label>{t('admin.settings.distanceEasyMax')}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={thresholds.distance_easy_max_km}
                      onChange={(e) => handleThresholdChange('distance_easy_max_km', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('admin.settings.distanceModerateMax')}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={thresholds.distance_moderate_max_km}
                      onChange={(e) => handleThresholdChange('distance_moderate_max_km', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('admin.settings.elevationEasyMax')}</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={thresholds.elevation_easy_max_m}
                      onChange={(e) => handleThresholdChange('elevation_easy_max_m', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('admin.settings.elevationModerateMax')}</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={thresholds.elevation_moderate_max_m}
                      onChange={(e) => handleThresholdChange('elevation_moderate_max_m', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('admin.settings.scoreEasyMax')}</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={thresholds.score_easy_max}
                      onChange={(e) => handleThresholdChange('score_easy_max', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('admin.settings.scoreModerateMax')}</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={thresholds.score_moderate_max}
                      onChange={(e) => handleThresholdChange('score_moderate_max', e.target.value)}
                    />
                  </div>
                  <button
                    className="btn-primary settings-save-btn"
                    onClick={handleSaveSettings}
                    disabled={settingsSaving}
                  >
                    {settingsSaving ? t('admin.settings.saving') : t('admin.settings.save')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
