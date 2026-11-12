"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, t as translate, type Locale } from "@/lib/i18n";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const Ctx = createContext<LocaleCtx>({ locale: "en", setLocale: () => {}, t: (k) => translate("en", k) });

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    setState(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  const value: LocaleCtx = { locale, setLocale, t: useCallback((k: string) => translate(locale, k), [locale]) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  return useContext(Ctx);
}

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <span className="inline-flex items-center gap-1" aria-label={t("locale.label")}>
      {(["en", "fr", "sw"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={locale === l ? "font-bold text-ink-950 underline" : "text-ink-500 hover:text-ink-950"}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
