// Langue de l'application (français ou anglais).
//
// Chaque processus (principal et interface) garde sa langue courante ; les textes sont écrits
// directement dans le code sous la forme tr('Texte français', 'English text'), ce qui garde les
// deux versions côte à côte et évite les clés introuvables.

export type Lang = 'fr' | 'en'
export type LanguageSetting = 'auto' | Lang

let current: Lang = 'fr'

export function setLang(lang: Lang): void {
  current = lang
}

export function getLang(): Lang {
  return current
}

/** Texte dans la langue courante. */
export function tr(fr: string, en: string): string {
  return current === 'en' ? en : fr
}

/** Langue à partir d'un code de langue Riot ou système ("fr_FR", "en-US", "de_DE"...). */
export function langFromLocale(locale: string | null | undefined): Lang {
  return /^fr/i.test(locale ?? '') ? 'fr' : 'en'
}

/** Nombre formaté selon la langue (séparateur de milliers, virgule ou point décimal). */
export function fmtNumber(value: number, decimals = 0): string {
  return value.toLocaleString(current === 'en' ? 'en-US' : 'fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

/** Pourcentage : « 12,5 % » en français, « 12.5% » en anglais. */
export function fmtPct(ratio: number, decimals = 0): string {
  const n = fmtNumber(ratio * 100, decimals)
  return current === 'en' ? `${n}%` : `${n} %`
}

/** Unité d'or : « po » (pièces d'or) en français, « g » en anglais. */
export function gold(value: number): string {
  return `${fmtNumber(Math.round(value))} ${current === 'en' ? 'g' : 'po'}`
}
