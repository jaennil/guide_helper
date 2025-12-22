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
