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
