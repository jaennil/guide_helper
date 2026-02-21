import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { routesApi } from '../api/routes';
import type { Comment } from '../api/routes';
import { ConfirmDialog } from './ConfirmDialog';

interface CommentSectionProps {
  routeId: string;
  routeOwnerId?: string;
}

export function CommentSection({ routeId, routeOwnerId }: CommentSectionProps) {
  const { isAuthenticated, user } = useAuth();
  const { t, dateLocale } = useLanguage();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);

  useEffect(() => {
    loadComments();
  }, [routeId]);

  const loadComments = async () => {
    setLoading(true);
    try {
      const data = await routesApi.getComments(routeId);
      setComments(data);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() || !user) return;

    setSubmitting(true);
    setError('');
    try {
      const authorName = user.name || user.email;
      const comment = await routesApi.createComment(routeId, {
        text: text.trim(),
        author_name: authorName,
      });
      setComments((prev) => [...prev, comment]);
      setText('');
    } catch (err) {
      console.error('Failed to create comment:', err);
      setError(t('comments.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (commentId: string) => {
    setConfirmDeleteCommentId(commentId);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteCommentId) return;
    const commentId = confirmDeleteCommentId;
    setConfirmDeleteCommentId(null);
    try {
      await routesApi.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const canDelete = (comment: Comment) => {
    if (!user) return false;
    return comment.user_id === user.id || (routeOwnerId && user.id === routeOwnerId);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
    <div className="comment-section">
      <div className="comment-section-header">
        <h3>{t('comments.title')} ({comments.length})</h3>
      </div>

      <div className="comment-list">
        {loading && <div className="comment-loading">{t('common.loading')}</div>}

        {!loading && comments.length === 0 && (
          <div className="comment-empty">{t('comments.noComments')}</div>
        )}

        {comments.map((comment) => (
          <div key={comment.id} className="comment-item">
            <div className="comment-meta">
              <span className="comment-author">{comment.author_name}</span>
              <span className="comment-date">{formatDate(comment.created_at)}</span>
            </div>
            <div className="comment-text">{comment.text}</div>
            {canDelete(comment) && (
              <button
                className="comment-delete-btn"
                onClick={() => handleDelete(comment.id)}
              >
                {t('comments.delete')}
              </button>
            )}
          </div>
        ))}
      </div>

      {isAuthenticated ? (
        <div className="comment-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('comments.placeholder')}
            maxLength={2000}
            rows={2}
          />
          {error && <div className="comment-error">{error}</div>}
          <button
            onClick={handleSubmit}
            disabled={submitting || !text.trim()}
            className="comment-submit-btn"
          >
            {submitting ? t('comments.submitting') : t('comments.submit')}
          </button>
        </div>
      ) : (
        <div className="comment-login-hint">{t('comments.loginToComment')}</div>
      )}
    </div>

    {confirmDeleteCommentId && (
      <ConfirmDialog
        message={t('comments.confirmDelete')}
        confirmLabel={t('comments.delete')}
        cancelLabel={t('map.cancel')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteCommentId(null)}
      />
    )}
    </>
  );
}
