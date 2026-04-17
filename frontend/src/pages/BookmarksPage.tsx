import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import type { ExploreRoute } from '../api/routes';
import { categoriesApi, type Category } from '../api/categories';
import { MapPin, ArrowUpRight } from 'lucide-react';
import { getLocalizedCategoryName } from '../utils/categories';
import { asTranslationKey } from '../i18n';
import { getErrorMessage } from '../utils/errors';
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
    categoriesApi.getCategories().then((cats) => {
      setAvailableCategories(cats);
    }).catch((err) => console.error('Failed to load categories:', err));
  }, []);

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await routesApi.getBookmarks();
      console.log(`[BookmarksPage] loaded ${data.length} bookmarks`);
      setRoutes(data);
    } catch (err) {
      console.error('[BookmarksPage] failed to load bookmarks:', err);
      setError(getErrorMessage(err, t('bookmarks.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

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
        <div>
          <h1>{t('bookmarks.title')}</h1>
          <p className="bookmarks-header-subtitle">{t('bookmarks.savedCount', { count: routes.length })}</p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('bookmarks.backToMap')}
          </button>
          <button onClick={() => navigate('/explore')} className="btn-secondary">
            {t('explore.catalog')}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '☽' : '☀'}
          </button>
        </div>
      </header>

      <div className="bookmarks-content">
        <section className="bookmarks-summary">
          <div>
            <span className="bookmarks-overline">{t('bookmarks.title')}</span>
            <p>{t('bookmarks.savedCount', { count: routes.length })}</p>
          </div>
          {routes.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => navigate('/explore')}>
              {t('explore.catalog')}
            </button>
          )}
        </section>

        {error && <div className="error-message">{error}</div>}

        {loading && (
          <div className="bookmarks-loading">{t('common.loading')}</div>
        )}

        {!loading && routes.length === 0 && !error && (
          <div className="bookmarks-empty">
            <p>{t('bookmarks.empty')}</p>
            <span>{t('bookmarks.emptyHint')}</span>
            <button onClick={() => navigate('/explore')} className="btn-primary">
              {t('explore.catalog')}
            </button>
          </div>
        )}

        {routes.length > 0 && (
          <div className="bookmarks-grid">
            {routes.map((route) => (
              <article
                key={route.id}
                className="bookmarks-card"
                onClick={() => navigate(`/shared/${route.share_token}`)}
              >
                <div className="bookmarks-card-top">
                  <h3 className="bookmarks-card-name">{route.name}</h3>
                  <span className="bookmarks-card-open">{t('common.open')} <ArrowUpRight size={14} /></span>
                </div>
                <div className="bookmarks-card-meta">
                  <span className="bookmarks-meta-item"><MapPin size={14} />{t('bookmarks.pointsCount', { count: route.points_count })}</span>
                  <span className="bookmarks-card-date">{formatDate(route.created_at)}</span>
                </div>
                <div className="bookmarks-card-stats">
                  <span className="bookmarks-card-likes">♡ {route.likes_count}</span>
                  {route.ratings_count > 0 && (
                    <span className="bookmarks-card-rating">★ {route.avg_rating.toFixed(1)} ({route.ratings_count})</span>
                  )}
                </div>
                {route.category_ids.length > 0 && (
                  <div className="route-tags">
                    {route.category_ids.map((id) => {
                      const category = availableCategories.find((value) => value.id === id);
                      return (
                        <span key={id} className="route-tag">
                          {category ? getLocalizedCategoryName(category.name, t) : id}
                        </span>
                      );
                    })}
                  </div>
                )}
                {route.seasons.length > 0 && (
                  <div className="route-tags">
                    {route.seasons.map((value) => (
                      <span key={value} className={`route-tag season-tag season-${value}`}>
                        {t(asTranslationKey(`seasons.${value}`))}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
