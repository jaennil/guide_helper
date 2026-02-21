import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { chatApi, type ChatAction, type ChatPoint, type ChatRouteRef, type ConversationSummary } from '../api/chat';
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen && textareaRef.current && !showHistory) {
      textareaRef.current.focus();
    }
  }, [isOpen, showHistory]);

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

    // Try streaming first, fallback to non-streaming
    try {
      const streamingMsgId = crypto.randomUUID();
      let streamingContent = '';
      let streamingActions: ChatAction[] = [];

      // Add placeholder assistant message for streaming
      setMessages((prev) => [
        ...prev,
        { id: streamingMsgId, role: 'assistant', content: '' },
      ]);

      await chatApi.sendMessageStream(
        text,
        conversationId,
        (content) => {
          streamingContent += content;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMsgId ? { ...m, content: streamingContent } : m,
            ),
          );
        },
        (actions) => {
          streamingActions = actions;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMsgId ? { ...m, actions } : m,
            ),
          );
        },
        (id, convId) => {
          setConversationId(convId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMsgId
                ? { ...m, id, content: streamingContent, actions: streamingActions.length > 0 ? streamingActions : undefined }
                : m,
            ),
          );
        },
        (errorMsg) => {
          setError(errorMsg);
          // Remove the placeholder message on error
          setMessages((prev) => prev.filter((m) => m.id !== streamingMsgId));
        },
      );
    } catch (err: any) {
      // Remove streaming placeholder if it exists
      setMessages((prev) => prev.filter((m) => m.role !== 'assistant' || m.content !== ''));

      const status = err?.response?.status;
      if (status === 429) {
        setError(t('chat.rateLimited'));
      } else if (status === 503) {
        setError(t('chat.unavailable'));
      } else {
        // Fallback to non-streaming
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
        } catch (fallbackErr: any) {
          const fbStatus = fallbackErr?.response?.status;
          if (fbStatus === 429) {
            setError(t('chat.rateLimited'));
          } else if (fbStatus === 503) {
            setError(t('chat.unavailable'));
          } else {
            setError(t('chat.error'));
          }
        }
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

  const handleCopy = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard API may not be available
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!conversationId) return;
    try {
      await chatApi.deleteMessage(conversationId, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {
      // ignore
    }
  };

  const handleShowHistory = async () => {
    setShowHistory(true);
    setLoadingHistory(true);
    try {
      const response = await chatApi.listConversations();
      setConversations(response.conversations);
    } catch {
      setConversations([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadConversation = async (convId: string) => {
    setShowHistory(false);
    setLoadingHistory(true);
    try {
      const history = await chatApi.getHistory(convId);
      const msgs: DisplayMessage[] = history.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        actions: m.actions || undefined,
      }));
      setMessages(msgs);
      setConversationId(convId);
      setError('');
    } catch {
      setError(t('chat.error'));
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      await chatApi.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.conversation_id !== convId));
      if (conversationId === convId) {
        handleNewConversation();
      }
    } catch {
      // ignore
    }
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (showHistory) {
    return (
      <section className="chat-panel" role="complementary" aria-label={t('chat.history')}>
        <div className="chat-panel-header">
          <h3>{t('chat.history')}</h3>
          <div className="chat-header-actions">
            <button aria-label={t('chat.backToChat')} onClick={() => setShowHistory(false)}>{t('chat.backToChat')}</button>
            <button aria-label="Close" onClick={onClose}>{'\u2715'}</button>
          </div>
        </div>

        <nav className="chat-conversations-list" aria-label={t('chat.history')}>
          {loadingHistory && <div className="chat-typing"><span className="chat-typing-dot" /><span className="chat-typing-dot" /><span className="chat-typing-dot" /></div>}
          {!loadingHistory && conversations.length === 0 && (
            <div className="chat-empty">{t('chat.noConversations')}</div>
          )}
          {conversations.map((conv) => (
            <div key={conv.conversation_id} className="chat-conversation-item">
              <div
                className="chat-conversation-item-content"
                onClick={() => handleLoadConversation(conv.conversation_id)}
              >
                <div className="chat-conversation-item-message">
                  {(conv.title || conv.last_message).length > 80
                    ? (conv.title || conv.last_message).slice(0, 80) + '...'
                    : (conv.title || conv.last_message)}
                </div>
                <div className="chat-conversation-item-meta">
                  {conv.message_count} msg &middot; {formatTimestamp(conv.updated_at)}
                </div>
              </div>
              <button
                className="chat-conversation-delete"
                aria-label={t('chat.deleteConversation')}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.conversation_id);
                }}
              >
                {t('chat.deleteConversation')}
              </button>
            </div>
          ))}
        </nav>
      </section>
    );
  }

  return (
    <section className="chat-panel" role="complementary" aria-label={t('chat.title')}>
      <div className="chat-panel-header">
        <h3>{t('chat.title')}</h3>
        <div className="chat-header-actions">
          <button aria-label={t('chat.history')} onClick={handleShowHistory}>{t('chat.history')}</button>
          <button aria-label={t('chat.newConversation')} onClick={handleNewConversation}>{t('chat.newConversation')}</button>
          <button aria-label="Close" onClick={onClose}>{'\u2715'}</button>
        </div>
      </div>

      <div className="chat-messages" role="log" aria-live="polite" aria-label="Messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            {msg.role === 'assistant' ? (
              <div className="chat-message-markdown">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div>{msg.content}</div>
            )}
            {msg.role === 'assistant' && msg.content && (
              <button
                className="chat-message-copy"
                aria-label="Copy"
                onClick={() => handleCopy(msg.id, msg.content)}
              >
                {copiedId === msg.id ? t('chat.copied') : '\u2398'}
              </button>
            )}
            <button
              className="chat-message-delete"
              aria-label={t('chat.deleteMessage')}
              onClick={() => handleDeleteMessage(msg.id)}
            >
              {t('chat.deleteMessage')}
            </button>
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
                              {(route.category_ids?.length ?? 0) > 0 && route.category_ids.join(', ')}
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
                  if (action.type === 'navigate' && action.path) {
                    return (
                      <button
                        key={idx}
                        className="chat-action-btn chat-action-navigate"
                        onClick={() => { navigate(action.path!); onClose(); }}
                      >
                        {t('chat.goTo')} {action.label || action.path}
                      </button>
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
          aria-label={t('chat.placeholder')}
          rows={1}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          aria-label={t('chat.send')}
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? t('chat.sending') : t('chat.send')}
        </button>
      </div>
    </section>
  );
}
