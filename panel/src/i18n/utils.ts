export type PanelLocale = 'en' | 'zh-CN';

export const PANEL_LOCALE_STORAGE_KEY = 'i18n-ai-diff:panel:locale';

export function isPanelLocale(value: string | null | undefined): value is PanelLocale {
  return value === 'en' || value === 'zh-CN';
}

export function readStoredLocale(): PanelLocale {
  try {
    const stored = window.localStorage.getItem(PANEL_LOCALE_STORAGE_KEY);
    if (isPanelLocale(stored)) return stored;
  } catch {
    // Ignore unavailable storage.
  }
  return resolveBrowserLocale(window.navigator.language);
}

export function storeLocale(locale: PanelLocale): void {
  try {
    window.localStorage.setItem(PANEL_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Personal preference storage is best effort; the UI can still switch for this session.
  }
}

export function resolveBrowserLocale(language: string): PanelLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function panelIntlLocale(locale: PanelLocale): 'en-US' | 'zh-CN' {
  return locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  ));
}
