use uuid::Uuid;

use crate::domain::notification::Notification;
use crate::usecase::contracts::NotificationRepository;
use crate::usecase::error::UsecaseError;

pub struct NotificationsUseCase<N>
where
    N: NotificationRepository,
{
    notification_repository: N,
}

impl<N> NotificationsUseCase<N>
where
    N: NotificationRepository,
{
    pub fn new(notification_repository: N) -> Self {
        Self { notification_repository }
    }

    pub fn notification_repository(&self) -> &N {
        &self.notification_repository
    }

    #[tracing::instrument(skip(self, actor_name, message), fields(%user_id, %notification_type, %route_id))]
    pub async fn create_notification(
        &self,
        user_id: Uuid,
        notification_type: String,
        route_id: Uuid,
        actor_name: String,
        message: String,
    ) -> Result<Notification, UsecaseError> {
        tracing::debug!("creating notification");

        let notification = Notification::new(user_id, notification_type, route_id, actor_name, message);
        self.notification_repository.create(&notification).await?;

        tracing::info!(notification_id = %notification.id, user_id = %user_id, "notification created");
        Ok(notification)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, %limit, %offset))]
    pub async fn list_notifications(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Notification>, UsecaseError> {
        tracing::debug!("listing notifications");

        let notifications = self.notification_repository.find_by_user_id(user_id, limit, offset).await?;

        tracing::debug!(user_id = %user_id, count = notifications.len(), "retrieved notifications");
        Ok(notifications)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn count_unread(&self, user_id: Uuid) -> Result<i64, UsecaseError> {
        tracing::debug!("counting unread notifications");

        let count = self.notification_repository.count_unread(user_id).await?;

        tracing::debug!(user_id = %user_id, count, "unread count retrieved");
        Ok(count)
    }

    #[tracing::instrument(skip(self), fields(notification_id = %id, user_id = %user_id))]
    pub async fn mark_as_read(&self, id: Uuid, user_id: Uuid) -> Result<(), UsecaseError> {
        tracing::debug!("marking notification as read");

        self.notification_repository.mark_as_read(id, user_id).await?;

        tracing::debug!(notification_id = %id, "notification marked as read");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn mark_all_as_read(&self, user_id: Uuid) -> Result<(), UsecaseError> {
        tracing::debug!("marking all notifications as read");

        self.notification_repository.mark_all_as_read(user_id).await?;

        tracing::debug!(user_id = %user_id, "all notifications marked as read");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::notification::Notification;
    use crate::repository::errors::RepositoryError;
    use crate::usecase::contracts::MockNotificationRepository;

    #[tokio::test]
    async fn test_create_notification_success() {
        let mut mock_repo = MockNotificationRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = NotificationsUseCase::new(mock_repo);
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();

        let result = usecase
            .create_notification(
                user_id,
                "like".to_string(),
                route_id,
                "actor@test.com".to_string(),
                "liked your route".to_string(),
            )
            .await;

        assert!(result.is_ok());
        let notification = result.unwrap();
        assert_eq!(notification.user_id, user_id);
        assert_eq!(notification.route_id, route_id);
        assert_eq!(notification.notification_type, "like");
        assert!(!notification.is_read);
    }

    #[tokio::test]
    async fn test_create_notification_repo_error() {
        let mut mock_repo = MockNotificationRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Err(RepositoryError::DatabaseError("db error".to_string())));

        let usecase = NotificationsUseCase::new(mock_repo);

        let result = usecase
            .create_notification(
                Uuid::new_v4(),
                "like".to_string(),
                Uuid::new_v4(),
                "actor".to_string(),
                "msg".to_string(),
            )
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_notifications_success() {
        let mut mock_repo = MockNotificationRepository::new();
        let user_id = Uuid::new_v4();

        let notification = Notification::new(
            user_id,
            "comment".to_string(),
            Uuid::new_v4(),
            "actor".to_string(),
            "new comment".to_string(),
        );
        let notifications = vec![notification];

        mock_repo
            .expect_find_by_user_id()
            .withf(move |uid, limit, offset| *uid == user_id && *limit == 10 && *offset == 0)
            .times(1)
            .return_once(move |_, _, _| Ok(notifications));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.list_notifications(user_id, 10, 0).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_list_notifications_empty() {
        let mut mock_repo = MockNotificationRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_user_id()
            .times(1)
            .returning(|_, _, _| Ok(vec![]));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.list_notifications(user_id, 20, 0).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_count_unread_success() {
        let mut mock_repo = MockNotificationRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_count_unread()
            .withf(move |uid| *uid == user_id)
            .times(1)
            .returning(|_| Ok(5));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.count_unread(user_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5);
    }

    #[tokio::test]
    async fn test_count_unread_zero() {
        let mut mock_repo = MockNotificationRepository::new();

        mock_repo
            .expect_count_unread()
            .times(1)
            .returning(|_| Ok(0));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.count_unread(Uuid::new_v4()).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_mark_as_read_success() {
        let mut mock_repo = MockNotificationRepository::new();
        let notification_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_mark_as_read()
            .withf(move |id, uid| *id == notification_id && *uid == user_id)
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.mark_as_read(notification_id, user_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_mark_as_read_repo_error() {
        let mut mock_repo = MockNotificationRepository::new();

        mock_repo
            .expect_mark_as_read()
            .times(1)
            .returning(|_, _| Err(RepositoryError::NotFound));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.mark_as_read(Uuid::new_v4(), Uuid::new_v4()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_mark_all_as_read_success() {
        let mut mock_repo = MockNotificationRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_mark_all_as_read()
            .withf(move |uid| *uid == user_id)
            .times(1)
            .returning(|_| Ok(()));

        let usecase = NotificationsUseCase::new(mock_repo);
        let result = usecase.mark_all_as_read(user_id).await;

        assert!(result.is_ok());
    }
}
