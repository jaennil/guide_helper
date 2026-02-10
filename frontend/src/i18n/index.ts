import { en } from './locales/en';
import { ru } from './locales/ru';

export type Locale = 'en' | 'ru';
export type TranslationKey = keyof typeof en;
export const translations: Record<Locale, Record<TranslationKey, string>> = { en, ru };

export function t(locale: Locale, key: TranslationKey, params?: Record<string, string | number>): string {
  let text = translations[locale][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export const dateLocales: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU' };
export const LANGUAGE_STORAGE_KEY = 'language';
