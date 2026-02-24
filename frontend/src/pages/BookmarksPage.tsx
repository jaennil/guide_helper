import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import type { ExploreRoute } from '../api/routes';
import { categoriesApi, type Category } from '../api/categories';
import './BookmarksPage.css';

export default function BookmarksPage() {
  const { t, dateLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [routes, setRoutes] = useState<ExploreRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  useEffect(() => {
    categoriesApi.getCategories().then(cats => {
      setAvailableCategories(cats);
    }).catch(err => console.error('Failed to load categories:', err));
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await routesApi.getBookmarks();
      console.log(`[BookmarksPage] loaded ${data.length} bookmarks`);
      setRoutes(data);
    } catch (err: any) {
      console.error('[BookmarksPage] failed to load bookmarks:', err);
      setError(err.response?.data || t('bookmarks.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bookmarks-page">
      <header className="bookmarks-header">
        <h1>{t('bookmarks.title')}</h1>
        <div className="header-actions">
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('bookmarks.backToMap')}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '\u263D' : '\u2600'}
          </button>
        </div>
      </header>

      <div className="bookmarks-content">
        {error && <div className="error-message">{error}</div>}

        {loading && (
          <div className="bookmarks-loading">{t('common.loading')}</div>
        )}

        {!loading && routes.length === 0 && !error && (
          <div className="bookmarks-empty">
            <p>{t('bookmarks.empty')}</p>
            <button onClick={() => navigate('/explore')} className="btn-primary">
              {t('explore.catalog')}
            </button>
          </div>
        )}

        {routes.length > 0 && (
          <div className="bookmarks-grid">
            {routes.map((route) => (
              <div
                key={route.id}
                className="bookmarks-card"
                onClick={() => navigate(`/shared/${route.share_token}`)}
              >
                <h3 className="bookmarks-card-name">{route.name}</h3>
                <div className="bookmarks-card-meta">
                  <span>{t('bookmarks.pointsCount', { count: route.points_count })}</span>
                  <span className="bookmarks-card-date">{formatDate(route.created_at)}</span>
                </div>
                <div className="bookmarks-card-stats">
                  <span className="bookmarks-card-likes">&#9825; {route.likes_count}</span>
                  {route.ratings_count > 0 && (
                    <span className="bookmarks-card-rating">
                      &#9733; {route.avg_rating.toFixed(1)} ({route.ratings_count})
                    </span>
                  )}
                </div>
                {route.category_ids.length > 0 && (
                  <div className="route-tags">
                    {route.category_ids.map((id) => {
                      const cat = availableCategories.find(c => c.id === id);
                      return (
                        <span key={id} className="route-tag">
                          {cat ? (t(`tags.${cat.name}` as any) || cat.name) : id}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
