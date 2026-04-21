import { requestJson } from "./client";

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export async function getCategories() {
  return requestJson<Category[]>("/api/v1/categories", {
    auth: false,
  });
}
