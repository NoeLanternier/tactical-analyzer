// Niveau des données (Master+ ou Or à Émeraude) et état de la méta distante.
import { tr } from '../../../shared/i18n'

/** Nom affiché d'un niveau de jeu. */
export const levelName = (b: 'master' | 'gold' | undefined): string =>
  b === 'gold' ? tr('Or à Émeraude', 'Gold to Emerald') : 'Master+'

/** Niveau des données : réglage, ou rang classé du joueur en mode automatique. */
export type MetaLevel = 'master' | 'gold'

const HIGH_TIERS = new Set(['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'])

export function metaLevelFor(setting: 'auto' | MetaLevel, tier: string | null): MetaLevel {
  if (setting !== 'auto') return setting
  // Rang inconnu (client pas encore connecté) : Master+ ; non classé ou Fer à Émeraude : Or.
  if (!tier) return 'master'
  return HIGH_TIERS.has(tier) ? 'master' : 'gold'
}

/** URL de la méta Or à Émeraude, à côté de meta.json (null pour une URL personnalisée). */
export function goldUrlOf(metaUrl: string): string | null {
  return /\/meta\.json$/.test(metaUrl) ? metaUrl.replace(/meta\.json$/, 'meta-gold.json') : null
}

/** En dessous, la méta Or n'est pas encore utilisée (début de collecte). */
export const GOLD_MIN_GAMES = 15000

/** Âge d'une méta en jours (null si inconnu). */
export function metaAgeDays(
  generatedAt: string | null | undefined,
  now = Date.now()
): number | null {
  if (!generatedAt) return null
  const t = Date.parse(generatedAt)
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null
}

/** Rang classé mémorisé (dernier connu), pour choisir la méta dès le démarrage. */
const TIER_KEY = 'tactique-rank-tier'
export function readTier(): string | null {
  try {
    return localStorage.getItem(TIER_KEY)
  } catch {
    return null
  }
}
export function saveTier(tier: string): void {
  try {
    localStorage.setItem(TIER_KEY, tier)
  } catch {
    // Facultatif.
  }
}
