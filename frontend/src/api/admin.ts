import axios from 'axios';
import { API_BASE_URL } from './config';

const AUTH_URL = `${API_BASE_URL}/api/v1/admin`;
const ROUTES_URL = `${API_BASE_URL}/api/v1/admin/routes`;

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

export interface UsersListResponse {
  users: AdminUser[];
  total: number;
}

export interface AuthStatsResponse {
  total_users: number;
  by_role: { role: string; count: number }[];
}

export interface RoutesStatsResponse {
  total_routes: number;
  total_comments: number;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const adminApi = {
  async getUsers(params: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<UsersListResponse> {
    const response = await axios.get(`${AUTH_URL}/users`, {
      headers: getAuthHeader(),
      params,
    });
    return response.data;
  },

  async updateUserRole(userId: string, role: string): Promise<void> {
    await axios.put(
      `${AUTH_URL}/users/${userId}/role`,
      { role },
      { headers: getAuthHeader() }
    );
  },

  async getAuthStats(): Promise<AuthStatsResponse> {
    const response = await axios.get(`${AUTH_URL}/stats`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async getRoutesStats(): Promise<RoutesStatsResponse> {
    const response = await axios.get(`${ROUTES_URL}/stats`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },
};
