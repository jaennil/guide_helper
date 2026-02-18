use anyhow::{anyhow, Error};
use uuid::Uuid;

use crate::domain::category::Category;
use crate::usecase::contracts::CategoryRepository;

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
    pub async fn create_category(&self, name: String) -> Result<Category, Error> {
        tracing::debug!("creating category");

        let category = Category::new(name);
        self.category_repository.create(&category).await?;

        tracing::info!(category_id = %category.id, name = %category.name, "category created successfully");
        Ok(category)
    }

    #[tracing::instrument(skip(self))]
    pub async fn list_categories(&self) -> Result<Vec<Category>, Error> {
        tracing::debug!("listing categories");

        let categories = self.category_repository.find_all().await?;

        tracing::debug!(count = categories.len(), "retrieved categories");
        Ok(categories)
    }

    #[tracing::instrument(skip(self), fields(category_id = %id, %new_name))]
    pub async fn update_category(&self, id: Uuid, new_name: String) -> Result<(), Error> {
        tracing::debug!("updating category");

        self.category_repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| anyhow!("Category not found"))?;

        self.category_repository.update(id, &new_name).await?;

        tracing::info!(category_id = %id, "category updated successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(category_id = %id))]
    pub async fn delete_category(&self, id: Uuid) -> Result<(), Error> {
        tracing::debug!("deleting category");

        self.category_repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| anyhow!("Category not found"))?;

        self.category_repository.delete(id).await?;

        tracing::info!(category_id = %id, "category deleted successfully");
        Ok(())
    }
}
