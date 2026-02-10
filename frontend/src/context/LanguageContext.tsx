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

const RUSSIAN_SPEAKING_COUNTRIES = new Set(['RU', 'BY', 'KZ', 'UA', 'KG', 'TJ', 'UZ', 'TM', 'MD']);
const IP_DETECT_TIMEOUT_MS = 3000;

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'ru' || stored === 'en') {
    return stored;
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, newLocale);
    console.log(`[i18n] locale changed to: ${newLocale}`);
  }, []);

  useEffect(() => {
    const hasStoredLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) !== null;
    if (hasStoredLanguage) {
      console.log('[i18n] using stored locale:', locale);
      return;
    }

    console.log('[i18n] no stored locale, detecting by IP...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IP_DETECT_TIMEOUT_MS);

    fetch('https://ipapi.co/json/', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        const country = data?.country_code;
        console.log('[i18n] detected country:', country);
        if (country && RUSSIAN_SPEAKING_COUNTRIES.has(country)) {
          setLocale('ru');
        } else {
          setLocale('en');
        }
      })
      .catch((err) => {
        console.warn('[i18n] IP detection failed, defaulting to en:', err.message);
        setLocale('en');
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

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
