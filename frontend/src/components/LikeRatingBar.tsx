import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { routesApi } from '../api/routes';

interface LikeRatingBarProps {
  routeId: string;
}

export function LikeRatingBar({ routeId }: LikeRatingBarProps) {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();

  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  const [ratingAverage, setRatingAverage] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [routeId]);

  const loadData = async () => {
    try {
      const [likeData, ratingData] = await Promise.all([
        routesApi.getLikeCount(routeId),
        routesApi.getRatingAggregate(routeId),
      ]);
      setLikeCount(likeData.count);
      setRatingAverage(ratingData.average);
      setRatingCount(ratingData.count);

      if (isAuthenticated) {
        const [likeStatus, userRatingData] = await Promise.all([
          routesApi.getUserLikeStatus(routeId),
          routesApi.getUserRating(routeId),
        ]);
        setLiked(likeStatus.liked);
        setUserRating(userRatingData.rating);
      }
    } catch (err) {
      console.error('Failed to load like/rating data:', err);
    }
  };

  const handleToggleLike = async () => {
    if (!isAuthenticated || likeLoading) return;

    setLikeLoading(true);
    try {
      const result = await routesApi.toggleLike(routeId);
      setLiked(result.liked);
      setLikeCount(result.count);
    } catch (err) {
      console.error('Failed to toggle like:', err);
    } finally {
      setLikeLoading(false);
    }
  };

  const handleSetRating = async (value: number) => {
    if (!isAuthenticated || ratingLoading) return;

    // Click on same star removes rating
    if (userRating === value) {
      setRatingLoading(true);
      try {
        await routesApi.removeRating(routeId);
        setUserRating(null);
        const agg = await routesApi.getRatingAggregate(routeId);
        setRatingAverage(agg.average);
        setRatingCount(agg.count);
      } catch (err) {
        console.error('Failed to remove rating:', err);
      } finally {
        setRatingLoading(false);
      }
      return;
    }

    setRatingLoading(true);
    try {
      const result = await routesApi.setRating(routeId, value);
      setUserRating(result.user_rating);
      setRatingAverage(result.average);
      setRatingCount(result.count);
    } catch (err) {
      console.error('Failed to set rating:', err);
    } finally {
      setRatingLoading(false);
    }
  };

  const displayRating = hoveredStar ?? userRating ?? 0;

  return (
    <div className="like-rating-bar">
      <div className="like-section">
        <button
          className={`like-btn ${liked ? 'liked' : ''}`}
          onClick={handleToggleLike}
          disabled={!isAuthenticated || likeLoading}
          title={!isAuthenticated ? t('likes.loginToLike') : liked ? t('likes.liked') : t('likes.like')}
        >
          <span className="like-icon">{liked ? '\u2665' : '\u2661'}</span>
          <span className="like-count">{likeCount}</span>
        </button>
      </div>

      <div className="rating-section">
        <div
          className={`star-rating ${!isAuthenticated ? 'readonly' : ''}`}
          title={!isAuthenticated ? t('rating.loginToRate') : undefined}
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              className={`star ${star <= displayRating ? 'filled' : ''}`}
              onClick={() => handleSetRating(star)}
              onMouseEnter={() => isAuthenticated && setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(null)}
            >
              {star <= displayRating ? '\u2605' : '\u2606'}
            </span>
          ))}
        </div>
        <span className="rating-info">
          {ratingCount > 0
            ? `${ratingAverage.toFixed(1)} (${ratingCount})`
            : `0 (${ratingCount})`}
        </span>
      </div>
    </div>
  );
}
