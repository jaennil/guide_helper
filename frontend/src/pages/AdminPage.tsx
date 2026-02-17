import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { adminApi } from '../api/admin';
import type { AdminUser, AuthStatsResponse, RoutesStatsResponse } from '../api/admin';
import './AdminPage.css';

type AdminTab = 'dashboard' | 'users';

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
        </div>
      </div>
    </div>
  );
}
