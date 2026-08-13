export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export const LOCALE_STORAGE_KEY = 'imim_locale';
export const LOCALE_SOURCE_STORAGE_KEY = 'imim_locale_source';

export type LocaleSource = 'user' | 'system' | 'server';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};

const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-hans-cn': 'zh-CN',
  'zh-sg': 'zh-CN',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  'en-au': 'en-US',
};

export function normalizeLocale(input?: string | null): SupportedLocale {
  if (!input) return DEFAULT_LOCALE;
  const normalized = input.trim().toLowerCase();
  if (LOCALE_ALIASES[normalized]) return LOCALE_ALIASES[normalized];

  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';

  return DEFAULT_LOCALE;
}

export function isSupportedLocale(input?: string | null): input is SupportedLocale {
  return SUPPORTED_LOCALES.includes(input as SupportedLocale);
}
