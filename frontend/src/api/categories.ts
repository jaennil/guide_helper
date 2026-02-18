import axios from 'axios';
import { API_BASE_URL } from './config';

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
    const response = await axios.get(CATEGORIES_URL);
    return response.data;
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
