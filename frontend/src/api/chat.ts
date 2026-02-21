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
  category_ids: string[];
  avg_rating: number;
  likes_count: number;
}

export interface ChatAction {
  type: 'show_points' | 'show_routes' | 'navigate';
  points?: ChatPoint[];
  routes?: ChatRouteRef[];
  path?: string;
  label?: string;
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

export interface ConversationSummary {
  conversation_id: string;
  last_message: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  title: string;
}

export interface ListConversationsResponse {
  conversations: ConversationSummary[];
  total: number;
}

export interface ChatStreamEvent {
  type: 'token' | 'actions' | 'done' | 'error';
  content?: string;
  actions?: ChatAction[];
  id?: string;
  conversation_id?: string;
  message?: string;
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

  async sendMessageStream(
    message: string,
    conversationId: string | undefined,
    onToken: (content: string) => void,
    onActions: (actions: ChatAction[]) => void,
    onDone: (id: string, conversationId: string) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    const token = localStorage.getItem('access_token');
    const response = await fetch(`${CHAT_URL}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId || undefined,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw { response: { status: response.status }, message: text };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (!data) continue;

          try {
            const event: ChatStreamEvent = JSON.parse(data);
            switch (event.type) {
              case 'token':
                if (event.content) onToken(event.content);
                break;
              case 'actions':
                if (event.actions) onActions(event.actions);
                break;
              case 'done':
                if (event.id && event.conversation_id) onDone(event.id, event.conversation_id);
                break;
              case 'error':
                onError(event.message || 'Unknown error');
                break;
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    }
  },

  async getHistory(conversationId: string): Promise<ChatHistoryMessage[]> {
    const response = await axios.get(`${CHAT_URL}/${conversationId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async listConversations(): Promise<ListConversationsResponse> {
    const response = await axios.get(CHAT_URL, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  async deleteConversation(conversationId: string): Promise<void> {
    await axios.delete(`${CHAT_URL}/${conversationId}`, {
      headers: getAuthHeader(),
    });
  },

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await axios.delete(`${CHAT_URL}/${conversationId}/messages/${messageId}`, {
      headers: getAuthHeader(),
    });
  },
};
