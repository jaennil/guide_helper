import axios from 'axios';

const API_BASE_URL = '/api/v1/routes';

export interface RoutePoint {
  lat: number;
  lng: number;
  name?: string;
  segment_mode?: 'auto' | 'manual'; // mode for segment TO this point
  photo?: string; // base64 encoded image
}

export interface Route {
  id: string;
  user_id: string;
  name: string;
  points: RoutePoint[];
  created_at: string;
  updated_at: string;
}

export interface CreateRouteRequest {
  name: string;
  points: RoutePoint[];
}

export interface UpdateRouteRequest {
  name?: string;
  points?: RoutePoint[];
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const routesApi = {
  async getRoutes(): Promise<Route[]> {
    const response = await axios.get(API_BASE_URL, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async getRoute(id: string): Promise<Route> {
    const response = await axios.get(`${API_BASE_URL}/${id}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async createRoute(data: CreateRouteRequest): Promise<Route> {
    const response = await axios.post(API_BASE_URL, data, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async updateRoute(id: string, data: UpdateRouteRequest): Promise<Route> {
    const response = await axios.put(`${API_BASE_URL}/${id}`, data, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async deleteRoute(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/${id}`, {
      headers: getAuthHeader(),
    });
  },

  async importFromGeoJson(file: File): Promise<Route> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axios.post(`${API_BASE_URL}/import`, formData, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
