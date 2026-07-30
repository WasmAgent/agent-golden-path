import { createContext, useContext, useMemo, ReactNode } from 'react'
import { type Lang, translate, localeCode } from './strings'

// LanguageProvider — the app is English-only. The provider/hook are kept so
// existing imports (useLanguage, useT) keep working; the language is always 'en'.

// Read the active language outside React (e.g. from the chat fetch call).
export function getStoredLang(): Lang {
  return 'en'
}

export type TFn = (key: string, params?: Record<string, string | number>) => string

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFn
  locale: string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const value = useMemo<LanguageContextValue>(() => ({
    lang: 'en',
    setLang: () => { /* single-language app — no-op */ },
    t: (key, params) => translate('en', key, params),
    locale: localeCode('en'),
  }), [])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}

// Convenience hook when a component only needs the translate function.
export function useT(): TFn {
  return useLanguage().t
}
