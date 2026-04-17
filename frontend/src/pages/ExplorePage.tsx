import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { routesApi } from '../api/routes';
import type { ExploreRoute } from '../api/routes';
import { categoriesApi, type Category } from '../api/categories';
import { getLocalizedCategoryName } from '../utils/categories';
import { ArrowUpRight, FilterX, MapPin } from 'lucide-react';
import { asTranslationKey } from '../i18n';
import { getErrorMessage } from '../utils/errors';
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
  const [initialLoad, setInitialLoad] = useState(true);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef(search);

  const getCurrentSeason = (): string => {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  };

  useEffect(() => {
    categoriesApi.getCategories().then((cats) => {
      setAvailableCategories(cats);
    }).catch((err) => console.error('Failed to load categories:', err));
  }, []);

  const fetchRoutes = useCallback(async (
    searchValue: string,
    categoryIdValue: string,
    seasonValue: string,
    sortValue: SortOption,
    offsetValue: number,
    append: boolean,
  ) => {
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
        setRoutes((prev) => [...prev, ...data.routes]);
      } else {
        setRoutes(data.routes);
      }
      setTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, t('explore.loadFailed')));
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [t]);

  useEffect(() => {
    setOffset(0);
    fetchRoutes(searchRef.current, categoryId, season, sort, 0, false);
  }, [sort, categoryId, season, fetchRoutes]);

  useEffect(() => {
    const handler = () => fetchRoutes(search, categoryId, season, sort, 0, false);
    window.addEventListener('routeUpdated', handler);
    return () => window.removeEventListener('routeUpdated', handler);
  }, [fetchRoutes, search, categoryId, season, sort]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    searchRef.current = value;
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

  const handleResetFilters = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setSearch('');
    searchRef.current = '';
    setCategoryId('');
    setSeason('');
    setSort('newest');
    setOffset(0);
    fetchRoutes('', '', '', 'newest', 0, false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const categoryName = categoryId
    ? availableCategories.find((category) => category.id === categoryId)?.name
    : undefined;
  const activeFilters = [
    search.trim() ? { key: 'search', label: search.trim() } : null,
    categoryName ? { key: 'category', label: getLocalizedCategoryName(categoryName, t) } : null,
    season ? { key: 'season', label: t(asTranslationKey(`seasons.${season}`)) } : null,
    sort !== 'newest' ? { key: 'sort', label: t(asTranslationKey(`explore.sort${sort === 'oldest' ? 'Oldest' : sort === 'popular' ? 'Popular' : 'TopRated'}`)) } : null,
  ].filter((value): value is { key: string; label: string } => Boolean(value));

  const hasMore = routes.length < total;

  return (
    <div className="explore-page">
      <header className="explore-header">
        <div>
          <h1>{t('explore.title')}</h1>
          <p className="explore-header-subtitle">{t('explore.results', { count: total })}</p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('/map')} className="btn-secondary">
            {t('explore.backToMap')}
          </button>
          <button onClick={toggleTheme} className="theme-toggle-btn" title={t('theme.toggle')}>
            {theme === 'light' ? '☽' : '☀'}
          </button>
        </div>
      </header>

      <div className="explore-content">
        <section className="explore-controls-card">
          <div className="explore-controls-head">
            <div>
              <span className="explore-overline">{t('explore.filtersTitle')}</span>
              <p className="explore-controls-copy">{t('explore.results', { count: total })}</p>
            </div>
            {activeFilters.length > 0 && (
              <button type="button" className="explore-clear-btn" onClick={handleResetFilters}>
                <FilterX size={14} /> {t('common.reset')}
              </button>
            )}
          </div>

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
                  {t(asTranslationKey(`tags.${cat.name}`)) || cat.name}
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
              className={`explore-season-toggle${season === getCurrentSeason() ? ' active' : ''}`}
              onClick={() => setSeason((current) => current === getCurrentSeason() ? '' : getCurrentSeason())}
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

          {activeFilters.length > 0 && (
            <div className="explore-active-filters">
              {activeFilters.map((filter) => (
                <span key={filter.key} className="explore-filter-chip">{filter.label}</span>
              ))}
            </div>
          )}
        </section>

        {error && <div className="error-message">{error}</div>}

        {!initialLoad && routes.length === 0 && !loading && (
          <div className="explore-empty">
            <p>{t('explore.noRoutes')}</p>
            <span>{t('explore.emptyHint')}</span>
            {activeFilters.length > 0 && (
              <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                {t('common.reset')}
              </button>
            )}
          </div>
        )}

        {routes.length > 0 && (
          <>
            <div className="explore-grid">
              {routes.map((route) => (
                <article
                  key={route.id}
                  className="explore-card"
                  onClick={() => navigate(`/shared/${route.share_token}`)}
                >
                  <div className="explore-card-top">
                    <h3 className="explore-card-name">{route.name}</h3>
                    <span className="explore-card-open">{t('common.open')} <ArrowUpRight size={14} /></span>
                  </div>
                  <div className="explore-card-meta">
                    <span className="explore-meta-item"><MapPin size={14} />{t('explore.pointsCount', { count: route.points_count })}</span>
                    <span className="explore-card-date">{formatDate(route.created_at)}</span>
                  </div>
                  <div className="explore-card-stats">
                    <span className="explore-card-likes">♡ {route.likes_count}</span>
                    {route.ratings_count > 0 && (
                      <span className="explore-card-rating">★ {route.avg_rating.toFixed(1)} ({route.ratings_count})</span>
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

            {hasMore && (
              <div className="explore-load-more">
                <button onClick={handleLoadMore} disabled={loading} className="btn-primary">
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
