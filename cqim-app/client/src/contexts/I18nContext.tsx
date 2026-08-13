import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type LocaleSource, type SupportedLocale } from '@/lib/i18n/config';
import { detectInitialLocale, persistLocale, translate } from '@/lib/i18n';

type TranslateVariables = Record<string, string | number>;

interface I18nContextValue {
  locale: SupportedLocale;
  localeSource: LocaleSource;
  availableLocales: readonly SupportedLocale[];
  localeLabel: string;
  setLocale: (locale: SupportedLocale, source?: LocaleSource) => void;
  t: (key: string, variables?: TranslateVariables) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const initialState = detectInitialLocale();
  const [locale, setLocaleState] = useState<SupportedLocale>(initialState.locale);
  const [localeSource, setLocaleSource] = useState<LocaleSource>(initialState.source);

  useEffect(() => {
    persistLocale(locale, localeSource);
  }, [locale, localeSource]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    localeSource,
    availableLocales: SUPPORTED_LOCALES,
    localeLabel: LOCALE_LABELS[locale],
    setLocale: (nextLocale: SupportedLocale, source: LocaleSource = 'user') => {
      setLocaleState(nextLocale);
      setLocaleSource(source);
      persistLocale(nextLocale, source);
    },
    t: (key: string, variables?: TranslateVariables) => translate(locale, key, variables),
  }), [locale, localeSource]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
