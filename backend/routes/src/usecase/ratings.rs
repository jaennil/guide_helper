use anyhow::{anyhow, Error};
use uuid::Uuid;

use crate::domain::rating::{RatingInfo, RouteRating};
use crate::usecase::contracts::{RatingRepository, RouteRepository};

pub struct RatingsUseCase<Ra, R>
where
    Ra: RatingRepository,
    R: RouteRepository,
{
    rating_repository: Ra,
    route_repository: R,
}

impl<Ra, R> RatingsUseCase<Ra, R>
where
    Ra: RatingRepository,
    R: RouteRepository,
{
    pub fn new(rating_repository: Ra, route_repository: R) -> Self {
        Self {
            rating_repository,
            route_repository,
        }
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id, rating_value = rating))]
    pub async fn set_rating(
        &self,
        route_id: Uuid,
        user_id: Uuid,
        rating: i16,
    ) -> Result<(), Error> {
        tracing::debug!("setting rating");

        if !(1..=5).contains(&rating) {
            return Err(anyhow!("Rating must be between 1 and 5"));
        }

        // Verify route exists
        self.route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        let route_rating = RouteRating::new(route_id, user_id, rating);
        self.rating_repository.upsert(&route_rating).await?;

        tracing::info!(route_id = %route_id, user_id = %user_id, rating, "rating set successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn remove_rating(&self, route_id: Uuid, user_id: Uuid) -> Result<(), Error> {
        tracing::debug!("removing rating");

        self.rating_repository
            .delete_by_route_and_user(route_id, user_id)
            .await?;

        tracing::info!(route_id = %route_id, user_id = %user_id, "rating removed successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    pub async fn get_rating_info(
        &self,
        route_id: Uuid,
        user_id: Option<Uuid>,
    ) -> Result<RatingInfo, Error> {
        tracing::debug!("getting rating info");

        let (average, count) = self.rating_repository.get_aggregate(route_id).await?;

        let user_rating = if let Some(uid) = user_id {
            self.rating_repository
                .find_by_route_and_user(route_id, uid)
                .await?
                .map(|r| r.rating)
        } else {
            None
        };

        tracing::debug!(route_id = %route_id, average, count, ?user_rating, "rating info retrieved");
        Ok(RatingInfo {
            average,
            count,
            user_rating,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::route::Route;
    use crate::usecase::contracts::{MockRatingRepository, MockRouteRepository};

    fn make_route(route_id: Uuid) -> Route {
        Route {
            id: route_id,
            user_id: Uuid::new_v4(),
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            tags: vec![],
        }
    }

    #[tokio::test]
    async fn test_set_rating_success() {
        let mut mock_rating_repo = MockRatingRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let route = make_route(route_id);
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_rating_repo
            .expect_upsert()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase.set_rating(route_id, user_id, 4).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_set_rating_invalid_value() {
        let mock_rating_repo = MockRatingRepository::new();
        let mock_route_repo = MockRouteRepository::new();

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase
            .set_rating(Uuid::new_v4(), Uuid::new_v4(), 0)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("between 1 and 5"));

        let mock_rating_repo = MockRatingRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase
            .set_rating(Uuid::new_v4(), Uuid::new_v4(), 6)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("between 1 and 5"));
    }

    #[tokio::test]
    async fn test_set_rating_route_not_found() {
        let mock_rating_repo = MockRatingRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase.set_rating(route_id, Uuid::new_v4(), 3).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_remove_rating_success() {
        let mut mock_rating_repo = MockRatingRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        mock_rating_repo
            .expect_delete_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase.remove_rating(route_id, user_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_rating_info_with_user() {
        let mut mock_rating_repo = MockRatingRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        mock_rating_repo
            .expect_get_aggregate()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok((4.2, 10)));

        let user_id_clone = user_id;
        mock_rating_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(move |r, u| Ok(Some(RouteRating::new(r, u, 5))));

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase.get_rating_info(route_id, Some(user_id)).await;

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.average, 4.2);
        assert_eq!(info.count, 10);
        assert_eq!(info.user_rating, Some(5));
    }

    #[tokio::test]
    async fn test_get_rating_info_without_user() {
        let mut mock_rating_repo = MockRatingRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_rating_repo
            .expect_get_aggregate()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok((3.5, 7)));

        let usecase = RatingsUseCase::new(mock_rating_repo, mock_route_repo);
        let result = usecase.get_rating_info(route_id, None).await;

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.average, 3.5);
        assert_eq!(info.count, 7);
        assert_eq!(info.user_rating, None);
    }
}
