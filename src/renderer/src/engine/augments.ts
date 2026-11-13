import type { AugmentInfo, Catalog } from './catalog'
import type { JunglerBuild } from '../data/junglers'
import type { PersonalItemBonus } from './items'
import { norm } from './normalize'
import { fmtNumber, fmtPct, getLang, tr } from '../../../shared/i18n'

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

/** Niveaux des paliers d'augments en ARAM Mayhem. */
export const AUGMENT_LEVELS = [3, 7, 11, 15]

/** Écart d'un augment pour ce champion : estimation propre, sinon tous champions, sinon 0. */
function liftOf(catalog: Catalog, build: JunglerBuild | null, id: number): AugmentPick | null {
  const info = catalog.augmentInfo?.[id]
  if (!info) return null
  const mine = build?.augments?.find((a) => a.id === id)
  if (mine)
    return { info, lift: mine.lift, winRate: mine.winRate, games: mine.games, ownData: true }
  return {
    info,
    lift: info.lift ?? 0,
    winRate: info.winRate ?? null,
    games: info.games ?? 0,
    ownData: false
  }
}

/** Écart propre à deux augments pris ensemble (0 si non mesuré). */
export function pairLift(catalog: Catalog, a: number, b: number): number {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`
  return catalog.augmentPairs?.[key]?.[1] ?? 0
}

export interface OfferedAugment {
  pick: AugmentPick
  /** Écart total estimé : champion + affinités avec les augments déjà pris (0,01 = 1 point). */
  score: number
  reasons: string[]
  rank: number
}

const pts = (x: number): string => `${x >= 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`

/**
 * Augments proposés à un palier, du meilleur au moins bon pour ce champion, compte tenu des
 * augments déjà pris (affinités mesurées entre augments).
 */
export function rankOffered(
  catalog: Catalog,
  build: JunglerBuild | null,
  offered: number[],
  chosen: number[]
): OfferedAugment[] {
  const out: OfferedAugment[] = []
  for (const id of offered) {
    const pick = liftOf(catalog, build, id)
    if (!pick) continue
    const reasons: string[] = []
    if (pick.games > 0)
      reasons.push(
        pick.ownData
          ? tr(
              `${pts(pick.lift)} pt avec ce champion (${fmtNumber(pick.games)} parties)`,
              `${pts(pick.lift)} pt with this champion (${fmtNumber(pick.games)} games)`
            )
          : tr(
              `${pts(pick.lift)} pt tous champions confondus`,
              `${pts(pick.lift)} pt across all champions`
            )
      )
    let synergy = 0
    for (const c of chosen) {
      const x = pairLift(catalog, id, c)
      synergy += x
      const other = catalog.augmentInfo?.[c]
      if (other && Math.abs(x) >= 0.005)
        reasons.push(
          x > 0
            ? tr(
                `va avec ${augmentName(other)} (${pts(x)} pt)`,
                `goes with ${augmentName(other)} (${pts(x)} pt)`
              )
            : tr(
                `mal avec ${augmentName(other)} (${pts(x)} pt)`,
                `poor with ${augmentName(other)} (${pts(x)} pt)`
              )
        )
    }
    if (!pick.games) reasons.push(tr('pas encore de données', 'no data yet'))
    out.push({
      pick,
      score: pick.lift + Math.max(-0.05, Math.min(0.05, synergy)),
      reasons,
      rank: 0
    })
  }
  return out.sort((a, b) => b.score - a.score).map((x, i) => ({ ...x, rank: i + 1 }))
}

/**
 * Bonus d'objets selon les augments pris : un objet que les joueurs achètent bien plus souvent avec
 * cet augment (et qui gagne avec) remonte dans le build. Combiné à un autre bonus (apprentissage).
 */
export function augmentItemBonus(
  catalog: Catalog,
  chosen: number[],
  other?: PersonalItemBonus
): PersonalItemBonus | undefined {
  const rows = new Map<string, { bonus: number; aug: AugmentInfo; uplift: number }>()
  for (const a of chosen) {
    const info = catalog.augmentInfo?.[a]
    for (const r of catalog.augmentItems?.[a] ?? []) {
      if (!info) continue
      const bonus = Math.max(-0.3, Math.min(0.6, 1.2 * r.uplift + 6 * r.lift))
      const key = norm(r.item)
      const prev = rows.get(key)
      if (!prev || bonus > prev.bonus) rows.set(key, { bonus, aug: info, uplift: r.uplift })
    }
  }
  if (!rows.size) return other
  return (itemName) => {
    const base = other?.(itemName) ?? null
    const row = rows.get(norm(itemName))
    if (!row) return base
    const reason =
      row.bonus >= 0.1
        ? tr(
            `avec ${augmentName(row.aug)} (+${fmtPct(row.uplift, 0)} d’achats)`,
            `with ${augmentName(row.aug)} (+${fmtPct(row.uplift, 0)} buys)`
          )
        : base?.reason
    return { bonus: (base?.bonus ?? 0) + row.bonus, reason }
  }
}
