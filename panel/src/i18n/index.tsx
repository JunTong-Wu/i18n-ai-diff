import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import enPanel from './locales/en/panel.json';
import zhPanel from './locales/zh-CN/panel.json';
import {
  interpolate,
  panelIntlLocale,
  readStoredLocale,
  storeLocale,
  type PanelLocale,
} from './utils';

export type { PanelLocale } from './utils';
export { PANEL_LOCALE_STORAGE_KEY } from './utils';

export type TranslationKey = keyof typeof enPanel;
type PanelDictionary = Record<TranslationKey, string>;

const fallbackDictionary = enPanel as PanelDictionary;
const translations: Record<PanelLocale, PanelDictionary> = {
  en: fallbackDictionary,
  'zh-CN': zhPanel as PanelDictionary,
};

interface PanelI18nContextValue {
  locale: PanelLocale;
  setLocale(locale: PanelLocale): void;
  t(key: TranslationKey, values?: Record<string, string | number>): string;
  formatNumber(value: number): string;
  formatTime(value: string): string;
}

const PanelI18nContext = createContext<PanelI18nContextValue | null>(null);

export function PanelI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<PanelLocale>(() => readStoredLocale());

  const setLocale = useCallback((nextLocale: PanelLocale) => {
    setLocaleState(nextLocale);
    storeLocale(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<PanelI18nContextValue>(() => {
    const dictionary = translations[locale];
    const intlLocale = panelIntlLocale(locale);
    return {
      locale,
      setLocale,
      t(key, values) {
        return interpolate(dictionary[key] ?? fallbackDictionary[key] ?? key, values);
      },
      formatNumber(valueToFormat) {
        return new Intl.NumberFormat(intlLocale).format(valueToFormat);
      },
      formatTime(valueToFormat) {
        return new Intl.DateTimeFormat(intlLocale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(valueToFormat));
      },
    };
  }, [locale, setLocale]);

  return (
    <PanelI18nContext.Provider value={value}>
      {children}
    </PanelI18nContext.Provider>
  );
}

export function usePanelI18n(): PanelI18nContextValue {
  const context = useContext(PanelI18nContext);
  if (!context) {
    throw new Error('usePanelI18n must be used inside PanelI18nProvider');
  }
  return context;
}
