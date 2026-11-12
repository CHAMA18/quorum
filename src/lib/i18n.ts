/**
 * Desk i18n: dictionary, locale resolution, and lookup.
 *
 * Wired through the root layout: the `quorum-locale` cookie selects the
 * locale, the layout sets `<html lang>` from it, and `LocaleProvider`
 * carries it to client components. Unknown locales and keys fall back to
 * English, never blank. Full per-route localization builds on this core.
 */

export type Locale = "en" | "fr" | "sw";
export const LOCALE_COOKIE = "quorum-locale";
export const LOCALES: Locale[] = ["en", "fr", "sw"];

const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    "gate.pending": "Human gate — pending",
    "gate.refused": "Unsigned filing is refused",
    "review.start": "Start review",
    "review.findings": "Findings",
    "tender.award": "Award",
    "common.committeeDecides": "The committee decides",
    "oversight.title": "Oversight metrics",
    "oversight.backlog": "Backlog",
    "oversight.completed": "Completed",
    "oversight.totalRuns": "Total runs",
    "oversight.avgCycle": "Avg cycle",
    "oversight.exceptions": "Exceptions",
    "oversight.delayed": "Delayed tenders",
    "oversight.none": "None",
    "oversight.unavailable": "Metrics unavailable — sidecar unreachable",
    "oversight.hours": "h",
    "integrations.registry": "Registry organizations",
    "integrations.checkpoints": "Persisted checkpoints",
    "locale.label": "Language",
  },
  fr: {
    "gate.pending": "Validation humaine — en attente",
    "gate.refused": "Le dépôt non signé est refusé",
    "review.start": "Lancer l'évaluation",
    "review.findings": "Constats",
    "tender.award": "Attribution",
    "common.committeeDecides": "Le comité décide",
    "oversight.title": "Indicateurs de supervision",
    "oversight.backlog": "En attente",
    "oversight.completed": "Terminés",
    "oversight.totalRuns": "Évaluations totales",
    "oversight.avgCycle": "Cycle moyen",
    "oversight.exceptions": "Exceptions",
    "oversight.delayed": "Appels d'offres en retard",
    "oversight.none": "Aucun",
    "oversight.unavailable": "Indicateurs indisponibles — service injoignable",
    "oversight.hours": "h",
    "integrations.registry": "Organisations au registre",
    "integrations.checkpoints": "Points de reprise persistés",
    "locale.label": "Langue",
  },
  sw: {
    "gate.pending": "Kibali cha binadamu — kinasubiri",
    "gate.refused": "Uwasilishaji usiotiwa saini umekataliwa",
    "review.start": "Anza ukaguzi",
    "review.findings": "Matokeo",
    "tender.award": "Tuzo",
    "common.committeeDecides": "Kamati inaamua",
    "oversight.title": "Vipimo vya usimamizi",
    "oversight.backlog": "Kazi zinazosubiri",
    "oversight.completed": "Zimekamilika",
    "oversight.totalRuns": "Ukaguzi wote",
    "oversight.avgCycle": "Mzunguko wa wastani",
    "oversight.exceptions": "Hitilafu",
    "oversight.delayed": "Zabuni zilizochelewa",
    "oversight.none": "Hakuna",
    "oversight.unavailable": "Vipimo havipatikani — huduma haifikiki",
    "oversight.hours": "saa",
    "integrations.registry": "Mashirika ya sajili",
    "integrations.checkpoints": "Sehemu za kuendelezea zilizohifadhiwa",
    "locale.label": "Lugha",
  },
};

export function isLocale(v: string | undefined | null): v is Locale {
  return v === "en" || v === "fr" || v === "sw";
}

export function resolveLocale(cookieValue: string | undefined | null): Locale {
  return isLocale(cookieValue) ? cookieValue : "en";
}

export function t(locale: string | undefined, key: string): string {
  const loc: Locale = isLocale(locale) ? locale : "en";
  return MESSAGES[loc][key] ?? MESSAGES.en[key] ?? key;
}
