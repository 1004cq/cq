import { DEFAULT_LOCALE, LOCALE_SOURCE_STORAGE_KEY, LOCALE_STORAGE_KEY, type LocaleSource, type SupportedLocale, normalizeLocale } from './config';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;

export type MessageSchema = typeof zhCN;

function getNestedValue(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, object);
}

function interpolate(template: string, variables?: Record<string, string | number>): string {
  if (!variables) return template;
  return Object.entries(variables).reduce((result, [key, value]) => {
    return result.replaceAll(`{{${key}}}`, String(value));
  }, template);
}

export function getBrowserLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const candidates = Array.isArray(window.navigator.languages) && window.navigator.languages.length > 0
    ? window.navigator.languages
    : [window.navigator.language];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function getStoredLocale(): SupportedLocale | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return value ? normalizeLocale(value) : null;
}

export function getStoredLocaleSource(): LocaleSource | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LOCALE_SOURCE_STORAGE_KEY);
  return value === 'user' || value === 'system' || value === 'server' ? value : null;
}

export function persistLocale(locale: SupportedLocale, source: LocaleSource) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  window.localStorage.setItem(LOCALE_SOURCE_STORAGE_KEY, source);
  document.documentElement.lang = locale;
}

export function detectInitialLocale(): { locale: SupportedLocale; source: LocaleSource } {
  const storedLocale = getStoredLocale();
  const storedSource = getStoredLocaleSource();
  if (storedLocale) {
    return { locale: storedLocale, source: storedSource ?? 'user' };
  }
  return { locale: getBrowserLocale(), source: 'system' };
}

export function translate(
  locale: SupportedLocale,
  key: string,
  variables?: Record<string, string | number>,
): string {
  const localized = getNestedValue(messages[locale], key);
  const fallback = getNestedValue(messages[DEFAULT_LOCALE], key);
  const raw = (typeof localized === 'string' ? localized : typeof fallback === 'string' ? fallback : key);
  return interpolate(raw, variables);
}
