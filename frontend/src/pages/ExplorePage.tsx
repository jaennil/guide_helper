import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import type { ExploreRoute } from '../api/routes';
import './ExplorePage.css';

type SortOption = 'newest' | 'oldest' | 'popular' | 'top_rated';

const PAGE_SIZE = 20;

export default function ExplorePage() {
  const { t, dateLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [routes, setRoutes] = useState<ExploreRoute[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [offset, setOffset] = useState(0);
  const [initialLoad, setInitialLoad] = useState(true);

  const AVAILABLE_TAGS = ['hiking', 'cycling', 'historical', 'nature', 'urban'] as const;

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchRoutes = useCallback(async (searchValue: string, tagValue: string, sortValue: SortOption, offsetValue: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const data = await routesApi.exploreRoutes({
        search: searchValue || undefined,
        tag: tagValue || undefined,
        sort: sortValue,
        limit: PAGE_SIZE,
        offset: offsetValue,
      });
      if (append) {
        setRoutes(prev => [...prev, ...data.routes]);
      } else {
        setRoutes(data.routes);
      }
      setTotal(data.total);
    } catch (err: any) {
      setError(err.response?.data || t('explore.loadFailed'));
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [t]);

  // Initial load, sort, and tag change
  useEffect(() => {
    setOffset(0);
    fetchRoutes(search, tag, sort, 0, false);
  }, [sort, tag]);

  // Search with debounce
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      fetchRoutes(value, tag, sort, 0, false);
    }, 400);
  };

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchRoutes(search, tag, sort, newOffset, true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const hasMore = routes.length < total;

  return (
    <div className="explore-page">
      <header className="explore-header">
        <h1>{t('explore.title')}</h1>
        <div className="header-actions">
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('explore.backToMap')}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '\u263D' : '\u2600'}
          </button>
        </div>
      </header>

      <div className="explore-content">
        <div className="explore-controls">
          <input
            type="text"
            className="explore-search"
            placeholder={t('explore.searchPlaceholder')}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <select
            className="explore-tag-filter"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">{t('explore.allTags')}</option>
            {AVAILABLE_TAGS.map((t_tag) => (
              <option key={t_tag} value={t_tag}>
                {t(`tags.${t_tag}` as any)}
              </option>
            ))}
          </select>
          <select
            className="explore-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
          >
            <option value="newest">{t('explore.sortNewest')}</option>
            <option value="oldest">{t('explore.sortOldest')}</option>
            <option value="popular">{t('explore.sortPopular')}</option>
            <option value="top_rated">{t('explore.sortTopRated')}</option>
          </select>
        </div>

        {error && <div className="error-message">{error}</div>}

        {!initialLoad && routes.length === 0 && !loading && (
          <div className="explore-empty">
            <p>{t('explore.noRoutes')}</p>
          </div>
        )}

        {routes.length > 0 && (
          <>
            <div className="explore-grid">
              {routes.map((route) => (
                <div
                  key={route.id}
                  className="explore-card"
                  onClick={() => navigate(`/shared/${route.share_token}`)}
                >
                  <h3 className="explore-card-name">{route.name}</h3>
                  <div className="explore-card-meta">
                    <span>{t('explore.pointsCount', { count: route.points_count })}</span>
                    <span className="explore-card-date">{formatDate(route.created_at)}</span>
                  </div>
                  <div className="explore-card-stats">
                    <span className="explore-card-likes">
                      &#9825; {route.likes_count}
                    </span>
                    {route.ratings_count > 0 && (
                      <span className="explore-card-rating">
                        &#9733; {route.avg_rating.toFixed(1)} ({route.ratings_count})
                      </span>
                    )}
                  </div>
                  {route.tags.length > 0 && (
                    <div className="route-tags">
                      {route.tags.map((tag) => (
                        <span key={tag} className="route-tag">{t(`tags.${tag}` as any)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="explore-load-more">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? t('common.loading') : t('explore.loadMore')}
                </button>
              </div>
            )}
          </>
        )}

        {initialLoad && loading && (
          <div className="explore-loading">{t('common.loading')}</div>
        )}
      </div>
    </div>
  );
}
