use uuid::Uuid;

use crate::domain::category::Category;
use crate::usecase::contracts::CategoryRepository;
use crate::usecase::error::UsecaseError;

pub struct CategoriesUseCase<C>
where
    C: CategoryRepository,
{
    category_repository: C,
}

impl<C> CategoriesUseCase<C>
where
    C: CategoryRepository,
{
    pub fn new(category_repository: C) -> Self {
        Self { category_repository }
    }

    #[tracing::instrument(skip(self, name), fields(%name))]
    pub async fn create_category(&self, name: String) -> Result<Category, UsecaseError> {
        tracing::debug!("creating category");

        let category = Category::new(name);
        self.category_repository.create(&category).await?;

        tracing::info!(category_id = %category.id, name = %category.name, "category created successfully");
        Ok(category)
    }

    #[tracing::instrument(skip(self))]
    pub async fn list_categories(&self) -> Result<Vec<Category>, UsecaseError> {
        tracing::debug!("listing categories");

        let categories = self.category_repository.find_all().await?;

        tracing::debug!(count = categories.len(), "retrieved categories");
        Ok(categories)
    }

    #[tracing::instrument(skip(self), fields(category_id = %id, %new_name))]
    pub async fn update_category(&self, id: Uuid, new_name: String) -> Result<(), UsecaseError> {
        tracing::debug!("updating category");

        self.category_repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Category".to_string()))?;

        self.category_repository.update(id, &new_name).await?;

        tracing::info!(category_id = %id, "category updated successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(category_id = %id))]
    pub async fn delete_category(&self, id: Uuid) -> Result<(), UsecaseError> {
        tracing::debug!("deleting category");

        self.category_repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Category".to_string()))?;

        self.category_repository.delete(id).await?;

        tracing::info!(category_id = %id, "category deleted successfully");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::category::Category;
    use crate::repository::errors::RepositoryError;
    use crate::usecase::contracts::MockCategoryRepository;

    #[tokio::test]
    async fn test_create_category_success() {
        let mut mock_repo = MockCategoryRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.create_category("Hiking".to_string()).await;

        assert!(result.is_ok());
        let category = result.unwrap();
        assert_eq!(category.name, "Hiking");
    }

    #[tokio::test]
    async fn test_create_category_repo_error() {
        let mut mock_repo = MockCategoryRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Err(RepositoryError::DatabaseError("duplicate".to_string())));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.create_category("Hiking".to_string()).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_categories_success() {
        let mut mock_repo = MockCategoryRepository::new();

        let categories = vec![
            Category::new("Hiking".to_string()),
            Category::new("Cycling".to_string()),
        ];

        mock_repo
            .expect_find_all()
            .times(1)
            .return_once(move || Ok(categories));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.list_categories().await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_list_categories_empty() {
        let mut mock_repo = MockCategoryRepository::new();

        mock_repo
            .expect_find_all()
            .times(1)
            .returning(|| Ok(vec![]));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.list_categories().await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_update_category_success() {
        let mut mock_repo = MockCategoryRepository::new();
        let category_id = Uuid::new_v4();

        let category = Category {
            id: category_id,
            name: "Old Name".to_string(),
            created_at: chrono::Utc::now(),
        };

        mock_repo
            .expect_find_by_id()
            .withf(move |id| *id == category_id)
            .times(1)
            .return_once(move |_| Ok(Some(category)));

        mock_repo
            .expect_update()
            .withf(move |id, name| *id == category_id && name == "New Name")
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.update_category(category_id, "New Name".to_string()).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_category_not_found() {
        let mut mock_repo = MockCategoryRepository::new();
        let category_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .times(1)
            .returning(|_| Ok(None));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.update_category(category_id, "New".to_string()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_delete_category_success() {
        let mut mock_repo = MockCategoryRepository::new();
        let category_id = Uuid::new_v4();

        let category = Category {
            id: category_id,
            name: "To Delete".to_string(),
            created_at: chrono::Utc::now(),
        };

        mock_repo
            .expect_find_by_id()
            .withf(move |id| *id == category_id)
            .times(1)
            .return_once(move |_| Ok(Some(category)));

        mock_repo
            .expect_delete()
            .withf(move |id| *id == category_id)
            .times(1)
            .returning(|_| Ok(()));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.delete_category(category_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_category_not_found() {
        let mut mock_repo = MockCategoryRepository::new();
        let category_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .times(1)
            .returning(|_| Ok(None));

        let usecase = CategoriesUseCase::new(mock_repo);
        let result = usecase.delete_category(category_id).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }
}
