import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/auth';
import type { AuthResponse } from '../api/auth';
import { profileApi } from '../api/profile';
import type { UserProfile } from '../api/profile';
import { jwtDecode } from 'jwt-decode';
import {
  cacheUserProfile,
  clearPrivateOfflineData,
  getCachedUserProfile,
  shouldUseOfflineFallback,
} from '../utils/offlineCache';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  getAccessToken: () => string | null;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

interface JwtPayload {
  exp?: number;
}

function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<JwtPayload>(token);
    return !decoded.exp || decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Fetch user profile
  const fetchUserProfile = useCallback(async () => {
    try {
      const profile = await profileApi.getProfile();
      setUser(profile);
      cacheUserProfile(profile);
      return profile;
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      const cachedProfile = getCachedUserProfile();
      if (cachedProfile && shouldUseOfflineFallback(error)) {
        setUser(cachedProfile);
        return cachedProfile;
      }
      setUser(null);
      return null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    await fetchUserProfile();
  }, [fetchUserProfile]);

  const logout = useCallback(() => {
    void clearPrivateOfflineData();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  // Try to refresh access token
  const tryRefreshToken = useCallback(async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const response = await authApi.refreshToken(refreshToken);
      localStorage.setItem(TOKEN_KEY, response.access_token);
      setIsAuthenticated(true);
      await fetchUserProfile();
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      const cachedProfile = getCachedUserProfile();
      if (cachedProfile && shouldUseOfflineFallback(error)) {
        setIsAuthenticated(true);
        setUser(cachedProfile);
        return true;
      }
      logout();
      return false;
    }
  }, [fetchUserProfile, logout]);

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
        await tryRefreshToken();
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);
      await fetchUserProfile();
      setIsLoading(false);
    };

    checkAuth();
  }, [fetchUserProfile, tryRefreshToken]);

  // Auto-refresh token before expiration
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;

      try {
        const decoded = jwtDecode<JwtPayload>(token);
        const expiresIn = decoded.exp ? decoded.exp * 1000 - Date.now() : 0;

        // Refresh if less than 5 minutes remaining
        if (expiresIn < 5 * 60 * 1000) {
          await tryRefreshToken();
        }
      } catch (error) {
        console.error('Token check failed:', error);
      }
    }, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, [isAuthenticated, tryRefreshToken]);

  const saveTokens = useCallback(async (response: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
    setIsAuthenticated(true);
    await fetchUserProfile();
  }, [fetchUserProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    await saveTokens(response);
  }, [saveTokens]);

  const register = useCallback(async (email: string, password: string) => {
    const response = await authApi.register(email, password);
    await saveTokens(response);
  }, [saveTokens]);

  const getAccessToken = useCallback((): string | null => {
    return localStorage.getItem(TOKEN_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        login,
        register,
        logout,
        getAccessToken,
        refreshUser,
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
