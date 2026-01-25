import axios from 'axios';

const API_BASE_URL = '/api/v1/auth';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
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
    const response = await axios.get(`${API_BASE_URL}/me`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
    const response = await axios.put(`${API_BASE_URL}/me`, data, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await axios.put(`${API_BASE_URL}/password`, data, {
      headers: getAuthHeader(),
    });
  },
};
