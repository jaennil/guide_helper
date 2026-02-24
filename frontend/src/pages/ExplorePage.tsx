import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import type { ExploreRoute } from '../api/routes';
import { categoriesApi, type Category } from '../api/categories';
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
  const [categoryId, setCategoryId] = useState('');
  const [season, setSeason] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [offset, setOffset] = useState(0);

  const getCurrentSeason = (): string => {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  };
  const [initialLoad, setInitialLoad] = useState(true);

  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  useEffect(() => {
    categoriesApi.getCategories().then(cats => {
      setAvailableCategories(cats);
    }).catch(err => console.error('Failed to load categories:', err));
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchRoutes = useCallback(async (searchValue: string, categoryIdValue: string, seasonValue: string, sortValue: SortOption, offsetValue: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const data = await routesApi.exploreRoutes({
        search: searchValue || undefined,
        category_id: categoryIdValue || undefined,
        season: seasonValue || undefined,
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

  // Initial load, sort, category and season change
  useEffect(() => {
    setOffset(0);
    fetchRoutes(search, categoryId, season, sort, 0, false);
  }, [sort, categoryId, season]);

  // Search with debounce
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      fetchRoutes(value, categoryId, season, sort, 0, false);
    }, 400);
  };

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchRoutes(search, categoryId, season, sort, newOffset, true);
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
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t('explore.allCategories')}</option>
            {availableCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {t(`tags.${cat.name}` as any) || cat.name}
              </option>
            ))}
          </select>
          <select
            className="explore-tag-filter"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <option value="">{t('seasons.all')}</option>
            <option value="winter">{t('seasons.winter')}</option>
            <option value="spring">{t('seasons.spring')}</option>
            <option value="summer">{t('seasons.summer')}</option>
            <option value="autumn">{t('seasons.autumn')}</option>
          </select>
          <button
            className={`btn-secondary${season === getCurrentSeason() ? ' active' : ''}`}
            onClick={() => setSeason(s => s === getCurrentSeason() ? '' : getCurrentSeason())}
          >
            {t('seasons.current')}
          </button>
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
                  {route.category_ids.length > 0 && (
                    <div className="route-tags">
                      {route.category_ids.map((id) => {
                        const cat = availableCategories.find(c => c.id === id);
                        return <span key={id} className="route-tag">{cat ? (t(`tags.${cat.name}` as any) || cat.name) : id}</span>;
                      })}
                    </div>
                  )}
                  {route.seasons.length > 0 && (
                    <div className="route-tags">
                      {route.seasons.map((s) => (
                        <span key={s} className={`route-tag season-tag season-${s}`}>{t(`seasons.${s}` as any)}</span>
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
