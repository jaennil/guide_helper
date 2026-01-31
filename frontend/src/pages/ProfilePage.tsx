import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { profileApi } from '../api/profile';
import { routesApi } from '../api/routes';
import type { Route } from '../api/routes';
import './ProfilePage.css';

type TabType = 'profile' | 'security' | 'routes';

export default function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
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
      const data = await routesApi.getRoutes();
      setRoutes(data);
    } catch (err: any) {
      setRoutesError(err.response?.data || 'Failed to load routes');
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
      setProfileSuccess('Profile updated successfully');
    } catch (err: any) {
      setProfileError(err.response?.data || 'Failed to update profile');
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
      setPasswordError('New passwords do not match');
      setPasswordLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      setPasswordLoading(false);
      return;
    }

    try {
      await profileApi.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
      });
      setPasswordSuccess('Password changed successfully');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.response?.data || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    if (!confirm('Are you sure you want to delete this route?')) {
      return;
    }

    try {
      await routesApi.deleteRoute(routeId);
      setRoutes(routes.filter(r => r.id !== routeId));
    } catch (err: any) {
      setRoutesError(err.response?.data || 'Failed to delete route');
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
      setRoutesError(err.response?.data || 'Failed to import route from GeoJSON');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="profile-page">
      <header className="profile-header">
        <h1>Profile</h1>
        <div className="header-actions">
          <button onClick={() => navigate('/map')} className="btn-secondary">
            Back to Map
          </button>
          <button onClick={handleLogout} className="btn-logout">
            Logout
          </button>
        </div>
      </header>

      <div className="profile-content">
        <nav className="profile-tabs">
          <button
            className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Profile
          </button>
          <button
            className={`tab ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            Security
          </button>
          <button
            className={`tab ${activeTab === 'routes' ? 'active' : ''}`}
            onClick={() => setActiveTab('routes')}
          >
            My Routes
          </button>
        </nav>

        <div className="tab-content">
          {activeTab === 'profile' && (
            <div className="profile-tab">
              <form onSubmit={handleProfileSubmit}>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={user?.email || ''} disabled />
                </div>

                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>

                <div className="form-group">
                  <label>Avatar URL</label>
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.png"
                  />
                </div>

                <div className="form-group">
                  <label>Member since</label>
                  <input
                    type="text"
                    value={user ? formatDate(user.created_at) : ''}
                    disabled
                  />
                </div>

                {profileError && <div className="error-message">{profileError}</div>}
                {profileSuccess && <div className="success-message">{profileSuccess}</div>}

                <button type="submit" disabled={profileLoading} className="btn-primary">
                  {profileLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="security-tab">
              <h2>Change Password</h2>
              <form onSubmit={handlePasswordSubmit}>
                <div className="form-group">
                  <label>Current Password</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>

                <div className="form-group">
                  <label>Confirm New Password</label>
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
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'routes' && (
            <div className="routes-tab">
              <div className="routes-header">
                <h2>My Saved Routes</h2>
                <div className="routes-actions">
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
                    {importLoading ? 'Importing...' : 'Import GeoJSON'}
                  </button>
                </div>
              </div>

              {routesLoading && <div className="loading">Loading routes...</div>}
              {routesError && <div className="error-message">{routesError}</div>}

              {!routesLoading && routes.length === 0 && (
                <div className="no-routes">
                  <p>You haven't saved any routes yet.</p>
                  <button onClick={() => navigate('/map')} className="btn-primary">
                    Create a Route
                  </button>
                </div>
              )}

              {routes.length > 0 && (
                <div className="routes-list">
                  {routes.map((route) => (
                    <div key={route.id} className="route-card">
                      <div className="route-info">
                        <h3>{route.name}</h3>
                        <p>{route.points.length} points</p>
                        <p className="route-date">
                          Created: {formatDate(route.created_at)}
                        </p>
                      </div>
                      <div className="route-actions">
                        <button
                          onClick={() => navigate(`/map?route=${route.id}`)}
                          className="btn-secondary"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDeleteRoute(route.id)}
                          className="btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
