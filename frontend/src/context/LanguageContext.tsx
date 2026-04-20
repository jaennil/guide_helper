import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { t as translate, dateLocales, LANGUAGE_STORAGE_KEY } from '../i18n';
import type { Locale, TranslationKey } from '../i18n';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  dateLocale: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const RUSSIAN_LANGUAGE_PREFIXES = ['ru', 'be', 'uk', 'kk', 'ky', 'tg', 'uz'];

function detectBrowserLocale(): Locale {
  const languageTags = navigator.languages?.length ? navigator.languages : [navigator.language];
  const normalizedTags = languageTags.map((language) => language.toLowerCase());
  return normalizedTags.some((language) =>
    RUSSIAN_LANGUAGE_PREFIXES.some((prefix) => language === prefix || language.startsWith(`${prefix}-`)),
  )
    ? 'ru'
    : 'en';
}

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'ru' || stored === 'en') {
    return stored;
  }
  return detectBrowserLocale();
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, newLocale);
    console.log(`[i18n] locale changed to: ${newLocale}`);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  const dateLocale = dateLocales[locale];

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, dateLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
