import axios from 'axios';
import { API_BASE_URL } from './config';

const NOTIFICATIONS_URL = `${API_BASE_URL}/api/v1/notifications`;

export interface Notification {
  id: string;
  user_id: string;
  notification_type: string;
  route_id: string;
  actor_name: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsListResponse {
  notifications: Notification[];
  unread_count: number;
}

export interface UnreadCountResponse {
  unread_count: number;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const notificationsApi = {
  async list(params?: {
    limit?: number;
    offset?: number;
  }): Promise<NotificationsListResponse> {
    const response = await axios.get(NOTIFICATIONS_URL, {
      headers: getAuthHeader(),
      params,
    });
    return response.data;
  },

  async unreadCount(): Promise<number> {
    const response = await axios.get<UnreadCountResponse>(
      `${NOTIFICATIONS_URL}/unread-count`,
      { headers: getAuthHeader() }
    );
    return response.data.unread_count;
  },

  async markRead(id: string): Promise<void> {
    await axios.post(
      `${NOTIFICATIONS_URL}/${id}/read`,
      {},
      { headers: getAuthHeader() }
    );
  },

  async markAllRead(): Promise<void> {
    await axios.post(
      `${NOTIFICATIONS_URL}/read-all`,
      {},
      { headers: getAuthHeader() }
    );
  },
};
