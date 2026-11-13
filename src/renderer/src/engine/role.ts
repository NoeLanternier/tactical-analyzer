import type { Archetype } from '../data/items'
import { getLang, tr } from '../../../shared/i18n'
import { MODES, isModeKey, modeName, type ModeKey } from '../../../shared/modes'

// Poste joué sur la Faille (jungle, top, milieu, tireur, support) ou mode de jeu (ARAM, ARAM
// Mayhem…). Chacun a sa méta (meta.json pour la jungle, meta-top.json…, meta-aram.json…), ses
// builds, ses statistiques de sélection et ses repères.

export type Lane = 'top' | 'jungle' | 'mid' | 'bot' | 'support'
export type Role = Lane | ModeKey
/** Postes de la Faille. */
export const ROLES: Lane[] = ['top', 'jungle', 'mid', 'bot', 'support']

export const isLane = (r: Role | null | undefined): r is Lane =>
  !!r && (ROLES as string[]).includes(r)
export const isMode = (r: Role | null | undefined): r is ModeKey => isModeKey(r)

const ROLE_NAMES: Record<Lane, [string, string]> = {
  top: ['Top', 'Top'],
  jungle: ['Jungle', 'Jungle'],
  mid: ['Milieu', 'Mid'],
  bot: ['Tireur', 'Bot'],
  support: ['Support', 'Support']
}
export const roleLabel = (r: Role): string =>
  isMode(r) ? modeName(r, getLang()) : tr(...ROLE_NAMES[r])

/** Poste du client (« middle », « utility »…) ou de l'API en jeu (« MIDDLE »…). */
export function roleFromPosition(pos: string | null | undefined): Lane | null {
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

/** Poste au sens du client (pour les runes recommandées par Riot) ; vide hors de la Faille. */
export const clientPosition = (r: Role): string =>
  isMode(r)
    ? ''
    : { top: 'top', jungle: 'jungle', mid: 'middle', bot: 'bottom', support: 'utility' }[r]

/** Carte du poste ou du mode (11 Faille, 12 Abîme hurlant, 0 inconnue). */
export const mapOf = (r: Role): number => (isMode(r) ? MODES[r].map : 11)

/**
 * Poste joué : hors de la Faille, le mode de la partie ; sinon réglage, poste attribué en
 * sélection, poste en partie, Châtiment → jungle, et enfin dernier poste connu.
 */
export function detectRole(opts: {
  setting: 'auto' | Lane
  assigned: string
  live: string | null
  hasSmite: boolean
  last: Lane | null
  /** Mode de la partie ('sr' ou null : Faille de l'invocateur). */
  mode?: ModeKey | 'sr' | null
}): Role {
  if (opts.mode && opts.mode !== 'sr') return opts.mode
  if (opts.setting !== 'auto') return opts.setting
  return (
    roleFromPosition(opts.assigned) ??
    roleFromPosition(opts.live) ??
    (opts.hasSmite ? 'jungle' : null) ??
    opts.last ??
    'jungle'
  )
}

/**
 * URL de la méta d'un poste ou d'un mode, à côté de meta.json (null pour une URL personnalisée).
 * Les modes n'ont qu'un niveau de données (joueurs de tous rangs) : pas de méta Or. Mode privé
 * (parties non publiées par Riot) : la méta du mode dont il reprend la carte (ARAM Mayhem → ARAM).
 */
export function roleMetaUrl(metaUrl: string, role: Role, gold: boolean): string | null {
  if (isMode(role)) {
    if (gold || !/\/meta\.json$/.test(metaUrl)) return null
    return metaUrl.replace(/meta\.json$/, `meta-${MODES[role].metaFrom ?? role}.json`)
  }
  if (!/\/meta\.json$/.test(metaUrl)) return role === 'jungle' && !gold ? metaUrl : null
  const name = `meta${gold ? '-gold' : ''}${role === 'jungle' ? '' : `-${role}`}.json`
  return metaUrl.replace(/meta\.json$/, name)
}

/**
 * Augments des modes (données du jeu publiées par la collecte : noms, descriptions, ce qu'ils
 * renforcent), à côté de meta.json. Null : mode sans augments ou URL personnalisée.
 */
export function augmentsUrl(metaUrl: string, role: Role): string | null {
  if (!isMode(role) || !MODES[role].augments || !/\/meta\.json$/.test(metaUrl)) return null
  return metaUrl.replace(/meta\.json$/, 'meta-augments.json')
}

/** Objets de départ habituels quand la méta n'en donne pas (hors jungle). */
export function defaultStart(archetype: Archetype, role: Role): string[] {
  // Abîme hurlant : 1 400 pièces d'or au départ, un composant d'objet et une potion.
  if (isMode(role) && MODES[role].map === 12) {
    if (archetype === 'TANK') return ['Kindlegem', 'Health Potion']
    if (archetype === 'ENCHANTER') return ['Forbidden Idol', 'Health Potion']
    if (archetype === 'AP_BURST' || archetype === 'AP_FIGHTER')
      return ['Lost Chapter', 'Health Potion']
    if (archetype === 'AD_CARRY') return ['Noonquiver', 'Health Potion']
    return ["Caulfield's Warhammer", 'Health Potion']
  }
  if (role === 'support') return ['World Atlas', 'Health Potion']
  if (archetype === 'TANK') return ["Doran's Shield", 'Health Potion']
  if (archetype === 'AP_BURST' || archetype === 'AP_FIGHTER' || archetype === 'ENCHANTER')
    return ["Doran's Ring", 'Health Potion', 'Health Potion']
  return ["Doran's Blade", 'Health Potion']
}

/** Poste de la Faille mémorisé (dernier connu), pour choisir la méta dès le démarrage. */
const ROLE_KEY = 'tactique-role'
export function readRole(): Lane | null {
  try {
    const r = localStorage.getItem(ROLE_KEY)
    return r && (ROLES as string[]).includes(r) ? (r as Lane) : null
  } catch {
    return null
  }
}
export function saveRole(r: Role): void {
  // Les modes ne remplacent pas le dernier poste joué sur la Faille.
  if (!isLane(r)) return
  try {
    localStorage.setItem(ROLE_KEY, r)
  } catch {
    // Facultatif.
  }
}
