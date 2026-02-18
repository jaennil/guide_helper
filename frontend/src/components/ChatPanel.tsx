import React, { useState, useRef, useEffect } from 'react';
import { chatApi, type ChatAction, type ChatPoint, type ChatRouteRef } from '../api/chat';
import { useLanguage } from '../context/LanguageContext';
import './ChatPanel.css';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onShowPoints: (points: ChatPoint[]) => void;
  onShowRoutes: (routeIds: string[]) => void;
}

export function ChatPanel({ isOpen, onClose, onShowPoints, onShowRoutes }: ChatPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useLanguage();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError('');

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await chatApi.sendMessage(text, conversationId);
      setConversationId(response.conversation_id);

      const assistantMsg: DisplayMessage = {
        id: response.id,
        role: 'assistant',
        content: response.message,
        actions: response.actions,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      if (err.response?.status === 503) {
        setError(t('chat.unavailable'));
      } else {
        setError(t('chat.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
    setError('');
  };

  const handleShowPoints = (points: ChatPoint[]) => {
    onShowPoints(points);
  };

  const handleShowRoutes = (routes: ChatRouteRef[]) => {
    const ids = routes.map((r) => r.id);
    onShowRoutes(ids);
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <h3>{t('chat.title')}</h3>
        <div className="chat-header-actions">
          <button onClick={handleNewConversation}>{t('chat.newConversation')}</button>
          <button onClick={onClose}>{'\u2715'}</button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div>{msg.content}</div>
            {msg.actions && msg.actions.length > 0 && (
              <div className="chat-message-actions">
                {msg.actions.map((action, idx) => {
                  if (action.type === 'show_points' && action.points) {
                    return (
                      <button
                        key={idx}
                        className="chat-action-btn"
                        onClick={() => handleShowPoints(action.points!)}
                      >
                        {t('chat.showOnMap')}
                      </button>
                    );
                  }
                  if (action.type === 'show_routes' && action.routes) {
                    return (
                      <div key={idx}>
                        {action.routes.map((route) => (
                          <div
                            key={route.id}
                            className="chat-route-card"
                            onClick={() => handleShowRoutes([route])}
                          >
                            <span className="chat-route-card-name">{route.name}</span>
                            <span className="chat-route-card-meta">
                              {route.tags.join(', ')}
                              {route.avg_rating > 0 && ` \u2022 ${route.avg_rating.toFixed(1)}\u2605`}
                              {route.likes_count > 0 && ` \u2022 ${route.likes_count}\u2764`}
                            </span>
                          </div>
                        ))}
                        <button
                          className="chat-action-btn"
                          onClick={() => handleShowRoutes(action.routes!)}
                        >
                          {t('chat.showOnMap')}
                        </button>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          rows={1}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? t('chat.sending') : t('chat.send')}
        </button>
      </div>
    </div>
  );
}
