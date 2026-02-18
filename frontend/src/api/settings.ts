import axios from 'axios';
import { API_BASE_URL } from './config';

export interface DifficultyThresholds {
  distance_easy_max_km: number;
  distance_moderate_max_km: number;
  elevation_easy_max_m: number;
  elevation_moderate_max_m: number;
  score_easy_max: number;
  score_moderate_max: number;
}

export const DEFAULT_DIFFICULTY_THRESHOLDS: DifficultyThresholds = {
  distance_easy_max_km: 5,
  distance_moderate_max_km: 15,
  elevation_easy_max_m: 300,
  elevation_moderate_max_m: 800,
  score_easy_max: 3,
  score_moderate_max: 4,
};

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const settingsApi = {
  async getDifficultyThresholds(): Promise<DifficultyThresholds> {
    const response = await axios.get(`${API_BASE_URL}/api/v1/settings/difficulty`);
    return response.data;
  },

  async updateDifficultyThresholds(thresholds: DifficultyThresholds): Promise<DifficultyThresholds> {
    const response = await axios.put(
      `${API_BASE_URL}/api/v1/admin/settings/difficulty`,
      thresholds,
      { headers: getAuthHeader() }
    );
    return response.data;
  },
};
