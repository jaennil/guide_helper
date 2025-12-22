import React, { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../api/auth';
import type { AuthResponse } from '../api/auth';
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
        await tryRefreshToken();
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
