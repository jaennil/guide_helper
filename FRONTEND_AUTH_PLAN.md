# Frontend Authentication Implementation Plan

## Overview
Add JWT-based authentication to the React frontend for Guide Helper application. Users must authenticate to access the map functionality.

## Current State
- **Auth Service**: Ready with endpoints at `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`
- **Frontend**: React + TypeScript map application without auth
- **No routing**: Single page application (App.tsx)
- **No auth state management**: No context or token storage

## Auth Service API Contracts

### Register
```
POST /api/v1/auth/register
Body: { "email": "user@example.com", "password": "password123" }
Response: { "access_token": "...", "refresh_token": "...", "token_type": "Bearer" }
Status: 201 Created / 400 Bad Request
```

### Login
```
POST /api/v1/auth/login
Body: { "email": "user@example.com", "password": "password" }
Response: { "access_token": "...", "refresh_token": "...", "token_type": "Bearer" }
Status: 200 OK / 401 Unauthorized
```

### Refresh Token
```
POST /api/v1/auth/refresh
Body: { "refresh_token": "..." }
Response: { "access_token": "...", "token_type": "Bearer" }
Status: 200 OK / 401 Unauthorized
```

## Implementation Steps

### Phase 1: Setup Dependencies (15 min)

1. **Install packages**:
   ```bash
   cd frontend
   npm install react-router-dom axios jwt-decode
   npm install --save-dev @types/jwt-decode
   ```

2. **Dependencies**:
   - `react-router-dom`: For routing (login page, map page)
   - `axios`: For API calls
   - `jwt-decode`: To decode JWT tokens and check expiration

### Phase 2: Create Auth API Client (15 min)

**File**: `frontend/src/api/auth.ts`

```typescript
import axios from 'axios';

const API_BASE_URL = '/api/v1/auth';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RefreshResponse {
  access_token: string;
  token_type: string;
}

export const authApi = {
  async register(email: string, password: string): Promise<AuthResponse> {
    const response = await axios.post(`${API_BASE_URL}/register`, {
      email,
      password,
    });
    return response.data;
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await axios.post(`${API_BASE_URL}/login`, {
      email,
      password,
    });
    return response.data;
  },

  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    const response = await axios.post(`${API_BASE_URL}/refresh`, {
      refresh_token: refreshToken,
    });
    return response.data;
  },
};
```

### Phase 3: Create Auth Context (30 min)

**File**: `frontend/src/context/AuthContext.tsx`

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { authApi, AuthResponse } from '../api/auth';
import { jwtDecode } from 'jwt-decode';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check if token is expired
  const isTokenExpired = (token: string): boolean => {
    try {
      const decoded: any = jwtDecode(token);
      return decoded.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  };

  // Try to refresh access token
  const tryRefreshToken = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const response = await authApi.refreshToken(refreshToken);
      localStorage.setItem(TOKEN_KEY, response.access_token);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
      return false;
    }
  };

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem(TOKEN_KEY);

      if (!token) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      if (isTokenExpired(token)) {
        const refreshed = await tryRefreshToken();
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  // Auto-refresh token before expiration
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;

      try {
        const decoded: any = jwtDecode(token);
        const expiresIn = decoded.exp * 1000 - Date.now();

        // Refresh if less than 5 minutes remaining
        if (expiresIn < 5 * 60 * 1000) {
          await tryRefreshToken();
        }
      } catch (error) {
        console.error('Token check failed:', error);
      }
    }, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const saveTokens = (response: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
    setIsAuthenticated(true);
  };

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    saveTokens(response);
  };

  const register = async (email: string, password: string) => {
    const response = await authApi.register(email, password);
    saveTokens(response);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setIsAuthenticated(false);
  };

  const getAccessToken = (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        login,
        register,
        logout,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

### Phase 4: Create Login/Register Page (30 min)

**File**: `frontend/src/pages/Auth.tsx`

```typescript
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './Auth.css';

export function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password);
      }
      navigate('/map');
    } catch (err: any) {
      setError(err.response?.data || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Guide Helper</h1>
        <h2>{isLogin ? 'Login' : 'Register'}</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isLogin ? 1 : 8}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
            {!isLogin && (
              <small>Password must be at least 8 characters</small>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>

        <div className="auth-switch">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
          >
            {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**File**: `frontend/src/pages/Auth.css`

```css
.auth-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.auth-card {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

.auth-card h1 {
  text-align: center;
  color: #667eea;
  margin-bottom: 0.5rem;
}

.auth-card h2 {
  text-align: center;
  color: #333;
  margin-bottom: 1.5rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #333;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
}

.form-group small {
  display: block;
  margin-top: 0.25rem;
  color: #666;
  font-size: 0.875rem;
}

.error-message {
  background: #fee;
  color: #c33;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

button[type="submit"] {
  width: 100%;
  padding: 0.75rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

button[type="submit"]:hover:not(:disabled) {
  background: #5568d3;
}

button[type="submit"]:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.auth-switch {
  margin-top: 1.5rem;
  text-align: center;
}

.auth-switch button {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 0.875rem;
  text-decoration: underline;
}

.auth-switch button:hover {
  color: #5568d3;
}
```

### Phase 5: Create Map Page Component (10 min)

**File**: `frontend/src/pages/MapPage.tsx`

Move the entire App.tsx content here and add a logout button:

```typescript
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
// ... all App.tsx imports

export function MapPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // ... all App.tsx code

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="App">
      <div className="map-header">
        <div className="mode-switcher">
          {/* ... existing mode switcher */}
        </div>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
      {/* ... rest of map content */}
    </div>
  );
}
```

Add to `App.css`:
```css
.map-header {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
}

.map-header > * {
  pointer-events: auto;
}

.logout-btn {
  background: #dc3545;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
}

.logout-btn:hover {
  background: #c82333;
}
```

### Phase 6: Setup Routing and Protected Routes (20 min)

**File**: `frontend/src/components/ProtectedRoute.tsx`

```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

**File**: `frontend/src/App.tsx` (replace entirely)

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Auth } from './pages/Auth';
import { MapPage } from './pages/MapPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route
            path="/map"
            element={
              <ProtectedRoute>
                <MapPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/map" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

Add loading screen styles to `App.css`:
```css
.loading-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: 1.5rem;
  color: #667eea;
}
```

### Phase 7: Update Main Entry Point (5 min)

**File**: `frontend/src/main.tsx` (should already be correct, verify)

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### Phase 8: Testing (20 min)

1. **Start development server**:
   ```bash
   npm run dev
   ```

2. **Test Registration**:
   - Navigate to http://localhost:5173
   - Should redirect to /login
   - Click "Register"
   - Enter email and password (min 8 chars)
   - Should register and redirect to /map

3. **Test Login**:
   - Logout from map
   - Should redirect to /login
   - Enter credentials
   - Should login and show map

4. **Test Token Persistence**:
   - Login
   - Refresh page
   - Should stay logged in (not redirect to login)

5. **Test Auto-Refresh**:
   - Stay logged in for >5 minutes
   - Token should auto-refresh
   - Should not get logged out

6. **Test Logout**:
   - Click logout button
   - Should redirect to /login
   - Try accessing /map directly
   - Should redirect to /login

7. **Test Protected Routes**:
   - Logout
   - Try navigating to http://localhost:5173/map
   - Should redirect to /login

8. **Test Error Handling**:
   - Try wrong credentials
   - Should show error message
   - Try weak password on register
   - Should show validation error

### Phase 9: Build and Deploy (10 min)

1. **Build frontend**:
   ```bash
   npm run build
   ```

2. **Commit changes**:
   ```bash
   git add -A
   git commit -m "feat(frontend): add JWT authentication

   - added login/register pages with form validation
   - implemented auth context with JWT token management
   - added auto-refresh for access tokens
   - protected map route with authentication
   - added logout functionality
   - tokens stored in localStorage
   - auto-redirect to login for unauthenticated users"
   ```

3. **Push changes**:
   ```bash
   git push origin main
   ```

4. **Verify deployment**:
   - Wait for CI/CD to build and deploy
   - Access https://guidehelper.ru.tuna.am
   - Should show login page
   - Test full auth flow

## File Structure Summary

```
frontend/
├── src/
│   ├── api/
│   │   └── auth.ts              # NEW: Auth API client
│   ├── components/
│   │   └── ProtectedRoute.tsx   # NEW: Route guard
│   ├── context/
│   │   └── AuthContext.tsx      # NEW: Auth state management
│   ├── pages/
│   │   ├── Auth.tsx             # NEW: Login/Register page
│   │   ├── Auth.css             # NEW: Auth page styles
│   │   └── MapPage.tsx          # NEW: Map page (moved from App.tsx)
│   ├── App.tsx                  # MODIFIED: Now handles routing
│   ├── App.css                  # MODIFIED: Add map-header, logout-btn, loading-screen
│   └── main.tsx                 # VERIFY: Should be unchanged
└── package.json                 # MODIFIED: New dependencies
```

## Security Considerations

1. **JWT Storage**: Using localStorage (acceptable for this use case)
   - Alternative: httpOnly cookies (requires backend changes)

2. **Token Expiration**: Auto-refresh implemented
   - Access token refreshed before expiration
   - Refresh token stored securely

3. **HTTPS**: Required in production (handled by tuna tunnel)

4. **XSS Protection**: React escapes by default
   - Don't use dangerouslySetInnerHTML with user input

5. **Password Validation**:
   - Min 8 chars enforced on register
   - Backend validates email format

## Troubleshooting

### Issue: Infinite redirect loop
**Cause**: isAuthenticated state not updating correctly
**Fix**: Check localStorage has tokens, verify token not expired

### Issue: 401 Unauthorized after some time
**Cause**: Access token expired and refresh failed
**Fix**: Check refresh token is valid, check auth service logs

### Issue: Can't login after registration
**Cause**: Auth service down or wrong credentials
**Fix**: Check auth pod logs: `kubectl logs -n guide-helper deployment/auth`

### Issue: CORS errors
**Cause**: Nginx not proxying /api/v1/auth correctly
**Fix**: Verify nginx.conf has auth proxy rules (should already be there)

## Next Steps (Optional Enhancements)

1. **Remember Me**: Add checkbox to persist tokens longer
2. **Password Reset**: Add "Forgot Password" flow
3. **User Profile**: Show user email on map page
4. **Session Management**: Show active sessions, logout all devices
5. **2FA**: Add two-factor authentication
6. **Social Login**: Add Google/GitHub OAuth

## Estimated Time
- **Total**: ~2.5 hours
- **Core Implementation**: 2 hours
- **Testing**: 20 minutes
- **Deployment**: 10 minutes
