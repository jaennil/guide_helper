import axios from 'axios';

const API_BASE_URL = '/api/v1/routes';

export interface PhotoData {
  original: string;
  thumbnail_url?: string;
  status: string;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  name?: string;
  segment_mode?: 'auto' | 'manual'; // mode for segment TO this point
  photo?: PhotoData;
}

export interface Route {
  id: string;
  user_id: string;
  name: string;
  points: RoutePoint[];
  created_at: string;
  updated_at: string;
  share_token?: string;
}

export interface Comment {
  id: string;
  route_id: string;
  user_id: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface CreateCommentRequest {
  text: string;
  author_name: string;
}

export interface LikeCountResponse {
  count: number;
}

export interface ToggleLikeResponse {
  liked: boolean;
  count: number;
}

export interface UserLikeStatusResponse {
  liked: boolean;
}

export interface RatingAggregateResponse {
  average: number;
  count: number;
}

export interface UserRatingResponse {
  rating: number | null;
}

export interface SetRatingResponse {
  average: number;
  count: number;
  user_rating: number;
}

export interface ExploreRoute {
  id: string;
  name: string;
  points_count: number;
  created_at: string;
  share_token: string;
  likes_count: number;
  avg_rating: number;
  ratings_count: number;
}

export interface ExploreResponse {
  routes: ExploreRoute[];
  total: number;
}

export interface ExploreParams {
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
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

  async enableShare(id: string): Promise<{ share_token: string }> {
    const response = await axios.post(`${API_BASE_URL}/${id}/share`, {}, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async disableShare(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/${id}/share`, {
      headers: getAuthHeader(),
    });
  },

  async exploreRoutes(params: ExploreParams = {}): Promise<ExploreResponse> {
    const response = await axios.get(`${API_BASE_URL}/explore`, { params });
    return response.data;
  },

  async getSharedRoute(token: string): Promise<Route> {
    const response = await axios.get(`/api/v1/shared/${token}`);
    return response.data;
  },

  async getComments(routeId: string): Promise<Comment[]> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/comments`);
    return response.data;
  },

  async createComment(routeId: string, data: CreateCommentRequest): Promise<Comment> {
    const response = await axios.post(`${API_BASE_URL}/${routeId}/comments`, data, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async deleteComment(commentId: string): Promise<void> {
    await axios.delete(`/api/v1/comments/${commentId}`, {
      headers: getAuthHeader(),
    });
  },

  async getCommentCount(routeId: string): Promise<number> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/comments/count`);
    return response.data.count;
  },

  async getLikeCount(routeId: string): Promise<LikeCountResponse> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/like`);
    return response.data;
  },

  async getUserLikeStatus(routeId: string): Promise<UserLikeStatusResponse> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/like/me`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async toggleLike(routeId: string): Promise<ToggleLikeResponse> {
    const response = await axios.post(`${API_BASE_URL}/${routeId}/like`, {}, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async getRatingAggregate(routeId: string): Promise<RatingAggregateResponse> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/rating`);
    return response.data;
  },

  async getUserRating(routeId: string): Promise<UserRatingResponse> {
    const response = await axios.get(`${API_BASE_URL}/${routeId}/rating/me`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async setRating(routeId: string, rating: number): Promise<SetRatingResponse> {
    const response = await axios.put(`${API_BASE_URL}/${routeId}/rating`, { rating }, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async removeRating(routeId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/${routeId}/rating`, {
      headers: getAuthHeader(),
    });
  },
};
