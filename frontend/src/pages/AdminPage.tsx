import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { adminApi } from '../api/admin';
import type { AdminUser, AuthStatsResponse, RoutesStatsResponse } from '../api/admin';
import { settingsApi, DEFAULT_DIFFICULTY_THRESHOLDS } from '../api/settings';
import type { DifficultyThresholds } from '../api/settings';
import './AdminPage.css';

type AdminTab = 'dashboard' | 'users' | 'settings';

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
    if (activeTab === 'dashboard') {
      loadStats();
    }
  }, [activeTab, loadStats]);

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    }
  }, [activeTab, loadUsers]);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadSettings();
    }
  }, [activeTab, loadSettings]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await adminApi.updateUserRole(userId, newRole);
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      // Refresh stats if on dashboard
      if (authStats) {
        loadStats();
      }
    } catch (err: any) {
      console.error('Failed to update role:', err);
      alert(err.response?.data || t('admin.roleUpdateFailed'));
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setUsersPage(0);
      loadUsers();
    }
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

  const totalPages = Math.ceil(usersTotal / PAGE_SIZE);

  const getRoleCount = (role: string): number => {
    if (!authStats) return 0;
    const item = authStats.by_role.find(r => r.role === role);
    return item?.count || 0;
  };

  return (
    <div className="admin-page">
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
          <button
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            {t('admin.dashboard')}
          </button>
          <button
            className={`tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            {t('admin.users')}
          </button>
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            {t('admin.settings')}
          </button>
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
                          <td>{u.name || '—'}</td>
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
                        total: totalPages,
                      })}
                    </span>
                    <button
                      disabled={usersPage + 1 >= totalPages}
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
