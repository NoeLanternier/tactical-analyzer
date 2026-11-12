import type { AugmentInfo, Catalog } from './catalog'
import type { JunglerBuild } from '../data/junglers'
import { getLang } from '../../../shared/i18n'

// ARAM Mayhem : augments conseillés pour le champion, par rareté. À chaque palier (niveaux 3, 7,
// 11 et 15), le jeu propose trois augments d'une même rareté (une relance possible) : l'app classe
// ceux de chaque rareté selon le taux de victoire des joueurs qui les ont pris avec ce champion,
// lissé vers l'effet de l'augment tous champions confondus (calculé par la collecte).

export type Rarity = AugmentInfo['rarity']
export const RARITY_ORDER: Rarity[] = ['silver', 'gold', 'prismatic']

export interface AugmentPick {
  info: AugmentInfo
  /** Écart de taux de victoire estimé (0,01 = 1 point). */
  lift: number
  winRate: number | null
  games: number
  /** Estimation propre au champion (sinon : tous champions confondus). */
  ownData: boolean
}

export interface AugmentAdvice {
  byRarity: Record<Rarity, { best: AugmentPick[]; avoid: AugmentPick[] }>
  /** Parties du champion dans ce mode (0 : estimations tous champions confondus). */
  games: number
}

/** Nom de l'augment dans la langue de l'app. */
export const augmentName = (a: AugmentInfo): string => (getLang() === 'en' ? a.name : a.nameFr)

/** Adresse de l'icône (données du jeu sur CommunityDragon). */
export function augmentIconUrl(a: AugmentInfo): string | null {
  const m = /^\/lol-game-data\/assets\/(.+)$/i.exec(a.icon)
  return m
    ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${m[1].toLowerCase()}`
    : null
}

/** Écart à partir duquel un augment est signalé comme à éviter. */
const AVOID = -0.012

export function augmentAdvice(
  catalog: Catalog,
  build: JunglerBuild | null,
  max = 5
): AugmentAdvice | null {
  const info = catalog.augmentInfo
  if (!info) return null
  const own = new Map((build?.augments ?? []).map((a) => [a.id, a]))
  const picks: AugmentPick[] = []
  for (const a of Object.values(info)) {
    const mine = own.get(a.id)
    if (mine)
      picks.push({
        info: a,
        lift: mine.lift,
        winRate: mine.winRate,
        games: mine.games,
        ownData: true
      })
    else if (a.lift !== undefined)
      picks.push({
        info: a,
        lift: a.lift,
        winRate: a.winRate ?? null,
        games: a.games ?? 0,
        ownData: false
      })
  }
  if (!picks.length) return null
  const byRarity = {} as AugmentAdvice['byRarity']
  for (const r of RARITY_ORDER) {
    const list = picks.filter((p) => p.info.rarity === r).sort((a, b) => b.lift - a.lift)
    byRarity[r] = {
      best: list.filter((p) => p.lift > 0).slice(0, max),
      avoid: list
        .filter((p) => p.lift <= AVOID)
        .slice(-3)
        .reverse()
    }
  }
  return { byRarity, games: build?.games ?? 0 }
}
