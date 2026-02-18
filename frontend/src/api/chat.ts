import axios from 'axios';
import { API_BASE_URL } from './config';

const CHAT_URL = `${API_BASE_URL}/api/v1/chat`;

export interface ChatPoint {
  lat: number;
  lng: number;
  name: string;
}

export interface ChatRouteRef {
  id: string;
  name: string;
  tags: string[];
  avg_rating: number;
  likes_count: number;
}

export interface ChatAction {
  type: 'show_points' | 'show_routes';
  points?: ChatPoint[];
  routes?: ChatRouteRef[];
}

export interface ChatMessageResponse {
  id: string;
  message: string;
  actions: ChatAction[];
  conversation_id: string;
}

export interface ChatHistoryMessage {
  id: string;
  role: string;
  content: string;
  actions: ChatAction[] | null;
  created_at: string;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const chatApi = {
  async sendMessage(message: string, conversationId?: string): Promise<ChatMessageResponse> {
    const response = await axios.post(
      CHAT_URL,
      {
        message,
        conversation_id: conversationId || undefined,
      },
      {
        headers: getAuthHeader(),
        timeout: 180000,
      },
    );
    return response.data;
  },

  async getHistory(conversationId: string): Promise<ChatHistoryMessage[]> {
    const response = await axios.get(`${CHAT_URL}/${conversationId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },
};
