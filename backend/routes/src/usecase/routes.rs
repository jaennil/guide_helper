use std::sync::Arc;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::route::{ExploreRouteRow, PhotoStatus, Route, RoutePoint};
use crate::usecase::anthropic::AnthropicClient;
use crate::usecase::contracts::RouteRepository;
use crate::usecase::error::UsecaseError;
use crate::usecase::nominatim::NominatimClient;
use crate::usecase::openai::{
    OpenAIClient, VisionChatRequest, VisionContentPart, VisionImageUrl, VisionMessage,
};

pub struct RoutesUseCase<R>
where
    R: RouteRepository,
{
    route_repository: Arc<R>,
    nominatim: Option<Arc<NominatimClient>>,
    ollama_client: Option<Arc<OpenAIClient>>,
    anthropic_client: Option<Arc<AnthropicClient>>,
    ollama_vision_model: String,
}

impl<R> RoutesUseCase<R>
where
    R: RouteRepository + Send + Sync + 'static,
{
    pub fn new(route_repository: R) -> Self {
        Self {
            route_repository: Arc::new(route_repository),
            nominatim: None,
            ollama_client: None,
            anthropic_client: None,
            ollama_vision_model: "llama3.2-vision".to_string(),
        }
    }

    pub fn with_nominatim(mut self, nominatim: NominatimClient) -> Self {
        self.nominatim = Some(Arc::new(nominatim));
        self
    }

    pub fn with_ollama(mut self, client: OpenAIClient, model: String) -> Self {
        self.ollama_client = Some(Arc::new(client));
        self.ollama_vision_model = model;
        self
    }

    pub fn with_anthropic(mut self, client: AnthropicClient) -> Self {
        self.anthropic_client = Some(Arc::new(client));
        self
    }

    pub fn route_repository(&self) -> &R {
        &self.route_repository
    }

    /// Spawns a background task to geocode route start/end and persist to DB.
    fn spawn_geocoding(&self, route_id: Uuid, points: Vec<RoutePoint>) {
        if points.is_empty() {
            return;
        }
        let Some(nominatim) = self.nominatim.clone() else {
            return;
        };
        let repo = Arc::clone(&self.route_repository);

        tokio::spawn(async move {
            let first = &points[0];
            let last = &points[points.len() - 1];

            let (start, end) = nominatim
                .resolve_route_locations((first.lat, first.lng), (last.lat, last.lng))
                .await;

            let start = if start.is_empty() { None } else { Some(start) };
            let end = if end.is_empty() { None } else { Some(end) };

            if let Err(e) = repo.update_locations(route_id, start, end).await {
                tracing::warn!(error = %e, %route_id, "failed to save geocoded route locations");
            }
        });
    }

    #[tracing::instrument(skip(self, points), fields(user_id = %user_id, name = %name, point_count = points.len()))]
    pub async fn create_route(
        &self,
        user_id: Uuid,
        name: String,
        points: Vec<RoutePoint>,
        category_ids: Vec<Uuid>,
        seasons: Vec<String>,
        line_color: Option<String>,
        started_at: Option<DateTime<Utc>>,
        is_draft: bool,
        source_route_id: Option<Uuid>,
    ) -> Result<Route, UsecaseError> {
        tracing::debug!(?category_ids, ?seasons, "creating new route");

        let (resolved_source_route_id, version_group_id, version_number) =
            if let Some(source_route_id) = source_route_id {
                let source_route = self
                    .route_repository
                    .find_by_id(source_route_id)
                    .await?
                    .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

                if source_route.user_id != user_id {
                    tracing::warn!("unauthorized source route access attempt");
                    return Err(UsecaseError::NotFound("Route".to_string()));
                }

                let version_group_id = source_route.version_group_id;
                let version_number = self
                    .route_repository
                    .find_max_version_number(version_group_id)
                    .await?
                    + 1;

                (
                    Some(source_route.id),
                    Some(version_group_id),
                    version_number,
                )
            } else {
                (None, None, 1)
            };

        let route = Route::new(
            user_id,
            name,
            points.clone(),
            category_ids,
            seasons,
            line_color,
            started_at,
            is_draft,
            resolved_source_route_id,
            version_group_id,
            version_number,
        );
        self.route_repository.create(&route).await?;

        self.spawn_geocoding(route.id, points);

        tracing::debug!(route_id = %route.id, "route created successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn get_route(&self, user_id: Uuid, route_id: Uuid) -> Result<Route, UsecaseError> {
        tracing::debug!("getting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            tracing::warn!("unauthorized route access attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn get_user_routes(&self, user_id: Uuid) -> Result<Vec<Route>, UsecaseError> {
        tracing::debug!("getting user routes");

        let routes = self.route_repository.find_by_user_id(user_id).await?;

        // Backfill locations for any routes missing them
        for route in routes.iter().filter(|r| r.start_location.is_none()) {
            self.spawn_geocoding(route.id, route.points.clone());
        }

        tracing::debug!(%user_id, count = routes.len(), "retrieved user routes");
        Ok(routes)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn get_route_versions(
        &self,
        user_id: Uuid,
        route_id: Uuid,
    ) -> Result<Vec<Route>, UsecaseError> {
        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        if route.user_id != user_id {
            tracing::warn!("unauthorized route history access attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        let routes = self
            .route_repository
            .find_by_version_group_and_user(user_id, route.version_group_id)
            .await?;

        for version in routes.iter().filter(|r| r.start_location.is_none()) {
            self.spawn_geocoding(version.id, version.points.clone());
        }

        Ok(routes)
    }

    #[tracing::instrument(skip(self, points), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn update_route(
        &self,
        user_id: Uuid,
        route_id: Uuid,
        name: Option<String>,
        points: Option<Vec<RoutePoint>>,
        category_ids: Option<Vec<Uuid>>,
        seasons: Option<Vec<String>>,
        line_color: Option<String>,
        started_at: Option<Option<DateTime<Utc>>>,
        is_draft: Option<bool>,
    ) -> Result<Route, UsecaseError> {
        tracing::debug!(?category_ids, ?seasons, "updating route");

        let mut route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            tracing::warn!("unauthorized route update attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        let points_changed = points.is_some();
        route.update(
            name,
            points,
            category_ids,
            seasons,
            line_color,
            started_at,
            None,
            is_draft,
        );
        self.route_repository.update(&route).await?;

        if points_changed {
            self.spawn_geocoding(route.id, route.points.clone());
        }

        tracing::debug!(%route_id, "route updated successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn enable_sharing(
        &self,
        user_id: Uuid,
        route_id: Uuid,
    ) -> Result<Uuid, UsecaseError> {
        tracing::debug!("enabling sharing for route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        if route.user_id != user_id {
            tracing::warn!("unauthorized share enable attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        if route.is_draft {
            return Err(UsecaseError::Validation(
                "Черновик нельзя опубликовать. Сначала переведи его в готовый маршрут.".to_string(),
            ));
        }

        // Reuse existing token if already shared
        if let Some(token) = route.share_token {
            tracing::debug!(%route_id, %token, "route already shared, returning existing token");
            return Ok(token);
        }

        let token = Uuid::new_v4();
        self.route_repository
            .set_share_token(route_id, Some(token))
            .await?;

        tracing::info!(%route_id, %token, "sharing enabled for route");
        Ok(token)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn disable_sharing(&self, user_id: Uuid, route_id: Uuid) -> Result<(), UsecaseError> {
        tracing::debug!("disabling sharing for route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        if route.user_id != user_id {
            tracing::warn!("unauthorized share disable attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        self.route_repository
            .set_share_token(route_id, None)
            .await?;

        tracing::info!(%route_id, "sharing disabled for route");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(share_token = %token))]
    pub async fn get_shared_route(&self, token: Uuid) -> Result<Route, UsecaseError> {
        tracing::debug!("getting shared route by token");

        let route = self
            .route_repository
            .find_by_share_token(token)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Shared route".to_string()))?;

        tracing::debug!(route_id = %route.id, "shared route retrieved successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(?search, ?category_id, %sort, %limit, %offset))]
    pub async fn explore_routes(
        &self,
        search: Option<String>,
        category_id: Option<Uuid>,
        season: Option<String>,
        sort: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ExploreRouteRow>, i64), UsecaseError> {
        tracing::debug!("exploring shared routes");

        let order_clause = match sort {
            "oldest" => "r.created_at ASC",
            "popular" => "likes_count DESC, r.created_at DESC",
            "top_rated" => "avg_rating DESC, ratings_count DESC, r.created_at DESC",
            _ => "r.created_at DESC", // "newest" default
        };

        let routes = self
            .route_repository
            .explore_shared(
                search.clone(),
                category_id,
                season.clone(),
                order_clause,
                limit,
                offset,
            )
            .await?;
        let total = self
            .route_repository
            .count_explore_shared(search, category_id, season)
            .await?;

        tracing::debug!(count = routes.len(), total, "explored shared routes");
        Ok((routes, total))
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id, %role))]
    pub async fn delete_route(
        &self,
        user_id: Uuid,
        route_id: Uuid,
        role: &str,
    ) -> Result<(), UsecaseError> {
        tracing::debug!("deleting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        // Admin and moderator can delete any route
        let is_privileged = role == "admin" || role == "moderator";
        if route.user_id != user_id && !is_privileged {
            tracing::warn!("unauthorized route delete attempt");
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        if is_privileged && route.user_id != user_id {
            tracing::info!(%role, %route_id, owner_id = %route.user_id, "privileged route deletion");
        }

        self.route_repository.delete(route_id).await?;

        tracing::debug!(%route_id, "route deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn generate_description(
        &self,
        user_id: Uuid,
        route_id: Uuid,
    ) -> Result<String, UsecaseError> {
        tracing::info!("generating AI description for route");

        if self.anthropic_client.is_none() && self.ollama_client.is_none() {
            tracing::warn!("AI clients are not configured");
            return Err(UsecaseError::Internal(
                "AI description generation is not configured".to_string(),
            ));
        }

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        if route.user_id != user_id {
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        let photo_urls: Vec<String> = route
            .points
            .iter()
            .filter_map(|p| p.photo.as_ref())
            .filter(|ph| ph.status == PhotoStatus::Done)
            .map(|ph| ph.original.clone())
            .collect();

        if photo_urls.is_empty() {
            return Err(UsecaseError::Validation(
                "Route has no processed photos".to_string(),
            ));
        }

        let description = if let Some(client) = self.anthropic_client.as_ref() {
            tracing::info!(
                provider = "claude",
                photo_count = photo_urls.len(),
                "sending photos to Anthropic for description"
            );
            client
                .describe_route_from_images(&route.name, &photo_urls)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, "Anthropic vision call failed");
                    UsecaseError::Internal(format!("AI generation failed: {}", e))
                })?
        } else {
            let client = self.ollama_client.as_ref().ok_or_else(|| {
                tracing::warn!("AI description generation is not configured");
                UsecaseError::Internal("AI description generation is not configured".to_string())
            })?;

            tracing::info!(
                provider = "ollama",
                photo_count = photo_urls.len(),
                "sending photos to Ollama for description"
            );

            let mut content: Vec<VisionContentPart> = vec![VisionContentPart {
                part_type: "text".to_string(),
                text: Some(format!(
                    "Ты — помощник туристического гида. По фотографиям с маршрута «{}» напиши краткое описание маршрута на русском языке (3-5 предложений): что можно увидеть, какая атмосфера, для кого подходит.",
                    route.name
                )),
                image_url: None,
            }];

            for url in &photo_urls {
                content.push(VisionContentPart {
                    part_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(VisionImageUrl { url: url.clone() }),
                });
            }

            let request = VisionChatRequest {
                model: self.ollama_vision_model.clone(),
                messages: vec![VisionMessage {
                    role: "user".to_string(),
                    content,
                }],
            };

            let response = client.vision_chat(request).await.map_err(|e| {
                tracing::error!(error = %e, "Ollama vision call failed");
                UsecaseError::Internal(format!("AI generation failed: {}", e))
            })?;

            response
                .choices
                .into_iter()
                .next()
                .and_then(|c| c.message.content)
                .ok_or_else(|| UsecaseError::Internal("Empty response from Ollama".to_string()))?
        };

        tracing::info!(
            desc_len = description.len(),
            "AI description generated successfully"
        );
        Ok(description)
    }

    pub async fn save_description(
        &self,
        user_id: Uuid,
        route_id: Uuid,
        description: String,
    ) -> Result<Route, UsecaseError> {
        let mut route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        if route.user_id != user_id {
            return Err(UsecaseError::NotFound("Route".to_string()));
        }

        route.update(None, None, None, None, None, None, Some(description), None);
        self.route_repository.update(&route).await?;

        tracing::info!(%route_id, "route description saved");
        Ok(route)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usecase::contracts::MockRouteRepository;

    fn make_route(user_id: Uuid, route_id: Uuid) -> Route {
        Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            started_at: None,
            share_token: None,
            category_ids: vec![],
            start_location: None,
            end_location: None,
            seasons: vec![],
            line_color: None,
            description: None,
            is_draft: false,
            source_route_id: None,
            version_group_id: route_id,
            version_number: 1,
        }
    }

    #[tokio::test]
    async fn test_create_route() {
        let mut mock_repo = MockRouteRepository::new();

        mock_repo.expect_create().times(1).returning(|_| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let user_id = Uuid::new_v4();
        let points = vec![RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: None,
            note: None,
            marker_color: None,
            marker_size: None,
            preview_size: None,
            preview_shape: None,
            segment_mode: None,
            segment_duration_minutes: None,
            photo: None,
        }];

        let result = usecase
            .create_route(
                user_id,
                "Test Route".to_string(),
                points,
                vec![],
                vec![],
                Some("#3388ff".to_string()),
                None,
                false,
                None,
            )
            .await;

        assert!(result.is_ok());
        let route = result.unwrap();
        assert_eq!(route.user_id, user_id);
        assert_eq!(route.name, "Test Route");
        assert_eq!(route.line_color.as_deref(), Some("#3388ff"));
    }

    #[tokio::test]
    async fn test_get_route_success() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = make_route(user_id, route_id);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_route_not_found() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_route_wrong_user() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let other_user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = make_route(other_user_id, route_id);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_route_versions_success() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let version_group_id = Uuid::new_v4();

        let mut route = make_route(user_id, route_id);
        route.version_group_id = version_group_id;

        let mut newer_version = make_route(user_id, Uuid::new_v4());
        newer_version.version_group_id = version_group_id;
        newer_version.version_number = 2;
        newer_version.is_draft = true;

        let route_clone = route.clone();
        let newer_version_clone = newer_version.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_find_by_version_group_and_user()
            .with(
                mockall::predicate::eq(user_id),
                mockall::predicate::eq(version_group_id),
            )
            .times(1)
            .returning(move |_, _| Ok(vec![newer_version_clone.clone()]));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route_versions(user_id, route_id).await;

        assert!(result.is_ok());
        let versions = result.unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].version_number, 2);
        assert!(versions[0].is_draft);
    }

    #[tokio::test]
    async fn test_get_route_versions_wrong_user() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let other_user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = make_route(other_user_id, route_id);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route_versions(user_id, route_id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_route_success() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = make_route(user_id, route_id);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_delete()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.delete_route(user_id, route_id, "user").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_enable_sharing() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = make_route(user_id, route_id);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_set_share_token()
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.enable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_enable_sharing_already_shared() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let existing_token = Uuid::new_v4();
        let mut route = make_route(user_id, route_id);
        route.share_token = Some(existing_token);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.enable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), existing_token);
    }

    #[tokio::test]
    async fn test_disable_sharing() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let mut route = make_route(user_id, route_id);
        route.share_token = Some(Uuid::new_v4());
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_set_share_token()
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.disable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_shared_route() {
        let mut mock_repo = MockRouteRepository::new();
        let token = Uuid::new_v4();
        let mut route = make_route(Uuid::new_v4(), Uuid::new_v4());
        route.name = "Shared".to_string();
        route.share_token = Some(token);
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_share_token()
            .with(mockall::predicate::eq(token))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_shared_route(token).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().name, "Shared");
    }

    #[tokio::test]
    async fn test_get_shared_route_not_found() {
        let mut mock_repo = MockRouteRepository::new();
        let token = Uuid::new_v4();

        mock_repo
            .expect_find_by_share_token()
            .with(mockall::predicate::eq(token))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_shared_route(token).await;

        assert!(result.is_err());
    }
}
