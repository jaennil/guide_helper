use anyhow::Error;
use uuid::Uuid;

use crate::domain::notification::Notification;
use crate::usecase::contracts::NotificationRepository;

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
    ) -> Result<Notification, Error> {
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
    ) -> Result<Vec<Notification>, Error> {
        tracing::debug!("listing notifications");

        let notifications = self.notification_repository.find_by_user_id(user_id, limit, offset).await?;

        tracing::debug!(user_id = %user_id, count = notifications.len(), "retrieved notifications");
        Ok(notifications)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn count_unread(&self, user_id: Uuid) -> Result<i64, Error> {
        tracing::debug!("counting unread notifications");

        let count = self.notification_repository.count_unread(user_id).await?;

        tracing::debug!(user_id = %user_id, count, "unread count retrieved");
        Ok(count)
    }

    #[tracing::instrument(skip(self), fields(notification_id = %id, user_id = %user_id))]
    pub async fn mark_as_read(&self, id: Uuid, user_id: Uuid) -> Result<(), Error> {
        tracing::debug!("marking notification as read");

        self.notification_repository.mark_as_read(id, user_id).await?;

        tracing::debug!(notification_id = %id, "notification marked as read");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn mark_all_as_read(&self, user_id: Uuid) -> Result<(), Error> {
        tracing::debug!("marking all notifications as read");

        self.notification_repository.mark_all_as_read(user_id).await?;

        tracing::debug!(user_id = %user_id, "all notifications marked as read");
        Ok(())
    }
}
