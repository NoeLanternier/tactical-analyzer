import type { Archetype } from '../data/items'
import { tr } from '../../../shared/i18n'

// Poste joué : jungle, top, milieu, tireur (bot) ou support. Chaque poste a sa méta (meta.json
// pour la jungle, meta-top.json…), ses builds, ses statistiques de draft et ses repères.

export type Role = 'top' | 'jungle' | 'mid' | 'bot' | 'support'
export const ROLES: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

const ROLE_NAMES: Record<Role, [string, string]> = {
  top: ['Top', 'Top'],
  jungle: ['Jungle', 'Jungle'],
  mid: ['Milieu', 'Mid'],
  bot: ['Tireur', 'Bot'],
  support: ['Support', 'Support']
}
export const roleLabel = (r: Role): string => tr(...ROLE_NAMES[r])

/** Poste du client (« middle », « utility »…) ou de l'API en jeu (« MIDDLE »…). */
export function roleFromPosition(pos: string | null | undefined): Role | null {
  switch ((pos ?? '').toLowerCase()) {
    case 'top':
      return 'top'
    case 'jungle':
      return 'jungle'
    case 'middle':
    case 'mid':
      return 'mid'
    case 'bottom':
    case 'bot':
    case 'adc':
      return 'bot'
    case 'utility':
    case 'support':
      return 'support'
    default:
      return null
  }
}

/** Poste au sens du client (pour les runes recommandées par Riot). */
export const clientPosition = (r: Role): string =>
  ({ top: 'top', jungle: 'jungle', mid: 'middle', bot: 'bottom', support: 'utility' })[r]

/**
 * Poste joué : réglage, sinon poste attribué en sélection, sinon poste en partie, sinon
 * Châtiment → jungle, sinon dernier poste connu.
 */
export function detectRole(opts: {
  setting: 'auto' | Role
  assigned: string
  live: string | null
  hasSmite: boolean
  last: Role | null
}): Role {
  if (opts.setting !== 'auto') return opts.setting
  return (
    roleFromPosition(opts.assigned) ??
    roleFromPosition(opts.live) ??
    (opts.hasSmite ? 'jungle' : null) ??
    opts.last ??
    'jungle'
  )
}

/** URL de la méta d'un poste, à côté de meta.json (null pour une URL personnalisée). */
export function roleMetaUrl(metaUrl: string, role: Role, gold: boolean): string | null {
  if (!/\/meta\.json$/.test(metaUrl)) return role === 'jungle' && !gold ? metaUrl : null
  const name = `meta${gold ? '-gold' : ''}${role === 'jungle' ? '' : `-${role}`}.json`
  return metaUrl.replace(/meta\.json$/, name)
}

/** Objets de départ habituels quand la méta n'en donne pas (hors jungle). */
export function defaultStart(archetype: Archetype, role: Role): string[] {
  if (role === 'support') return ['World Atlas', 'Health Potion']
  if (archetype === 'TANK') return ["Doran's Shield", 'Health Potion']
  if (archetype === 'AP_BURST' || archetype === 'AP_FIGHTER' || archetype === 'ENCHANTER')
    return ["Doran's Ring", 'Health Potion', 'Health Potion']
  return ["Doran's Blade", 'Health Potion']
}

/** Poste mémorisé (dernier connu), pour choisir la méta dès le démarrage. */
const ROLE_KEY = 'tactique-role'
export function readRole(): Role | null {
  try {
    const r = localStorage.getItem(ROLE_KEY)
    return r && (ROLES as string[]).includes(r) ? (r as Role) : null
  } catch {
    return null
  }
}
export function saveRole(r: Role): void {
  try {
    localStorage.setItem(ROLE_KEY, r)
  } catch {
    // Facultatif.
  }
}
