import axios from 'axios';
import { API_BASE_URL } from './config';

const AUTH_URL = `${API_BASE_URL}/api/v1/auth`;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatar_url?: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const profileApi = {
  async getProfile(): Promise<UserProfile> {
    const response = await axios.get(`${AUTH_URL}/me`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
    const response = await axios.put(`${AUTH_URL}/me`, data, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await axios.put(`${AUTH_URL}/password`, data, {
      headers: getAuthHeader(),
    });
  },
};
