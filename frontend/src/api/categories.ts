import axios from 'axios';
import { API_BASE_URL } from './config';
import { cacheCategories, getCachedCategories, shouldUseOfflineFallback } from '../utils/offlineCache';

const CATEGORIES_URL = `${API_BASE_URL}/api/v1/categories`;
const ADMIN_CATEGORIES_URL = `${API_BASE_URL}/api/v1/admin/categories`;

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const categoriesApi = {
  async getCategories(): Promise<Category[]> {
    try {
      const response = await axios.get(CATEGORIES_URL);
      await cacheCategories(response.data);
      return response.data;
    } catch (error) {
      if (shouldUseOfflineFallback(error)) {
        const cachedCategories = await getCachedCategories();
        if (cachedCategories) {
          return cachedCategories;
        }
      }
      throw error;
    }
  },

  async createCategory(name: string): Promise<Category> {
    const response = await axios.post(
      ADMIN_CATEGORIES_URL,
      { name },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  async updateCategory(id: string, name: string): Promise<void> {
    await axios.put(
      `${ADMIN_CATEGORIES_URL}/${id}`,
      { name },
      { headers: getAuthHeader() }
    );
  },

  async deleteCategory(id: string): Promise<void> {
    await axios.delete(`${ADMIN_CATEGORIES_URL}/${id}`, {
      headers: getAuthHeader(),
    });
  },
};
