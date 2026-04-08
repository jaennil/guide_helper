import type { TranslationKey } from '../i18n';

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function getLocalizedCategoryName(name: string | undefined, t: TranslateFn): string {
  if (!name) return '';

  const normalized = name.trim().toLowerCase();
  const key = `tags.${normalized}` as TranslationKey;
  const translated = t(key);

  return translated === key ? name : translated;
}
