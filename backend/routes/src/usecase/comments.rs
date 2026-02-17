use anyhow::{anyhow, Error};
use uuid::Uuid;

use crate::domain::comment::Comment;
use crate::usecase::contracts::{CommentRepository, RouteRepository};

pub struct CommentsUseCase<C, R>
where
    C: CommentRepository,
    R: RouteRepository,
{
    comment_repository: C,
    route_repository: R,
}

impl<C, R> CommentsUseCase<C, R>
where
    C: CommentRepository,
    R: RouteRepository,
{
    pub fn new(comment_repository: C, route_repository: R) -> Self {
        Self {
            comment_repository,
            route_repository,
        }
    }

    pub fn comment_repository(&self) -> &C {
        &self.comment_repository
    }

    #[tracing::instrument(skip(self, author_name, text), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn create_comment(
        &self,
        route_id: Uuid,
        user_id: Uuid,
        author_name: String,
        text: String,
    ) -> Result<Comment, Error> {
        tracing::debug!("creating comment");

        // Verify route exists
        self.route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        let comment = Comment::new(route_id, user_id, author_name, text);
        self.comment_repository.create(&comment).await?;

        tracing::info!(comment_id = %comment.id, route_id = %route_id, "comment created successfully");
        Ok(comment)
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    pub async fn list_comments(&self, route_id: Uuid) -> Result<Vec<Comment>, Error> {
        tracing::debug!("listing comments for route");

        let comments = self.comment_repository.find_by_route_id(route_id).await?;

        tracing::debug!(route_id = %route_id, count = comments.len(), "retrieved comments");
        Ok(comments)
    }

    #[tracing::instrument(skip(self), fields(comment_id = %comment_id, user_id = %user_id, %role))]
    pub async fn delete_comment(&self, comment_id: Uuid, user_id: Uuid, role: &str) -> Result<(), Error> {
        tracing::debug!("deleting comment");

        let comment = self
            .comment_repository
            .find_by_id(comment_id)
            .await?
            .ok_or_else(|| anyhow!("Comment not found"))?;

        // Admin and moderator can delete any comment
        let is_privileged = role == "admin" || role == "moderator";

        // Check authorization: comment author, route owner, or admin/moderator can delete
        if comment.user_id != user_id && !is_privileged {
            let route = self
                .route_repository
                .find_by_id(comment.route_id)
                .await?
                .ok_or_else(|| anyhow!("Route not found"))?;

            if route.user_id != user_id {
                tracing::warn!(
                    comment_id = %comment_id,
                    user_id = %user_id,
                    "unauthorized comment delete attempt"
                );
                return Err(anyhow!("Not authorized to delete this comment"));
            }
        }

        if is_privileged && comment.user_id != user_id {
            tracing::info!(%role, %comment_id, "privileged comment deletion");
        }

        self.comment_repository.delete(comment_id).await?;

        tracing::info!(comment_id = %comment_id, "comment deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    pub async fn count_comments(&self, route_id: Uuid) -> Result<i64, Error> {
        tracing::debug!("counting comments for route");

        let count = self.comment_repository.count_by_route_id(route_id).await?;

        tracing::debug!(route_id = %route_id, count, "counted comments");
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::route::Route;
    use crate::usecase::contracts::{MockCommentRepository, MockRouteRepository};

    #[tokio::test]
    async fn test_create_comment_success() {
        let mut mock_comment_repo = MockCommentRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        let route = Route {
            id: route_id,
            user_id: Uuid::new_v4(),
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            tags: vec![],
        };
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_comment_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase
            .create_comment(route_id, user_id, "User".to_string(), "Nice!".to_string())
            .await;

        assert!(result.is_ok());
        let comment = result.unwrap();
        assert_eq!(comment.route_id, route_id);
        assert_eq!(comment.user_id, user_id);
        assert_eq!(comment.text, "Nice!");
    }

    #[tokio::test]
    async fn test_create_comment_route_not_found() {
        let mock_comment_repo = MockCommentRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase
            .create_comment(
                route_id,
                Uuid::new_v4(),
                "User".to_string(),
                "Text".to_string(),
            )
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_comment_by_author() {
        let mut mock_comment_repo = MockCommentRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let comment_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        let comment = Comment {
            id: comment_id,
            route_id: Uuid::new_v4(),
            user_id,
            author_name: "Author".to_string(),
            text: "My comment".to_string(),
            created_at: chrono::Utc::now(),
        };
        let comment_clone = comment.clone();

        mock_comment_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(comment_id))
            .times(1)
            .returning(move |_| Ok(Some(comment_clone.clone())));

        mock_comment_repo
            .expect_delete()
            .with(mockall::predicate::eq(comment_id))
            .times(1)
            .returning(|_| Ok(()));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase.delete_comment(comment_id, user_id, "user").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_comment_by_route_owner() {
        let mut mock_comment_repo = MockCommentRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let comment_id = Uuid::new_v4();
        let route_owner_id = Uuid::new_v4();
        let comment_author_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();

        let comment = Comment {
            id: comment_id,
            route_id,
            user_id: comment_author_id,
            author_name: "Author".to_string(),
            text: "Comment".to_string(),
            created_at: chrono::Utc::now(),
        };
        let comment_clone = comment.clone();

        mock_comment_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(comment_id))
            .times(1)
            .returning(move |_| Ok(Some(comment_clone.clone())));

        let route = Route {
            id: route_id,
            user_id: route_owner_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            tags: vec![],
        };
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_comment_repo
            .expect_delete()
            .with(mockall::predicate::eq(comment_id))
            .times(1)
            .returning(|_| Ok(()));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase.delete_comment(comment_id, route_owner_id, "user").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_comment_unauthorized() {
        let mut mock_comment_repo = MockCommentRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let comment_id = Uuid::new_v4();
        let random_user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();

        let comment = Comment {
            id: comment_id,
            route_id,
            user_id: Uuid::new_v4(), // different from random_user_id
            author_name: "Author".to_string(),
            text: "Comment".to_string(),
            created_at: chrono::Utc::now(),
        };
        let comment_clone = comment.clone();

        mock_comment_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(comment_id))
            .times(1)
            .returning(move |_| Ok(Some(comment_clone.clone())));

        let route = Route {
            id: route_id,
            user_id: Uuid::new_v4(), // different from random_user_id
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            tags: vec![],
        };
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase.delete_comment(comment_id, random_user_id, "user").await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not authorized"));
    }

    #[tokio::test]
    async fn test_list_comments() {
        let mut mock_comment_repo = MockCommentRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_comment_repo
            .expect_find_by_route_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(vec![]));

        let usecase = CommentsUseCase::new(mock_comment_repo, mock_route_repo);
        let result = usecase.list_comments(route_id).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
