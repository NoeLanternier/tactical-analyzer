import { AUGMENT_TAGS, type AugmentInfo, type AugmentTag, type Catalog } from './catalog'
import type { JunglerBuild } from '../data/junglers'
import type { PersonalItemBonus } from './items'
import type { ChampInfo, GameData, ItemInfo } from './gameData'
import type { ModeData } from './modeData'
import { profileOf, type MeasuredProfiles } from './threat'
import { norm } from './normalize'
import { fmtNumber, fmtPct, getLang, tr } from '../../../shared/i18n'

// ARAM Mayhem : augments conseillés pour le champion, par rareté. À chaque palier (niveaux 3, 7,
// 11 et 15), le jeu propose trois augments d'une même rareté (une relance possible).
//
// Riot ne publie pas les parties de ce mode : pas de taux de victoire collectés. L'app classe donc
// les augments d'après ce qu'ils renforcent (texte du jeu : puissance, attaques, résistances,
// soins…) comparé à ce dont le champion se sert (son build et son profil mesuré sur la Faille),
// les objets qu'ils améliorent, et ce que tu as vu dans tes propres parties (les dix joueurs de
// chaque partie, d'après l'historique du client). Si la méta du mode contient un jour des
// statistiques mesurées (écart de taux de victoire), elles s'ajoutent.

export type Rarity = AugmentInfo['rarity']
export const RARITY_ORDER: Rarity[] = ['silver', 'gold', 'prismatic']

/** Ce dont le champion se sert, de 0 à 1 pour chaque caractéristique d'augment. */
export type AugmentProfile = Record<AugmentTag, number>

/** Contexte du classement : profil du champion, objets du build, tes parties dans ce mode. */
export interface AugmentContext {
  profile: AugmentProfile | null
  /** Objets du build (noms normalisés), y compris leurs composants. */
  buildItems: Set<string>
  personal: ModeData | null
  /** Nom d'objet affiché (nom anglais des données → langue de l'app). */
  itemLabel: (english: string) => string
}

export interface AugmentPick {
  info: AugmentInfo
  /** Écart de taux de victoire mesuré par la collecte (0,01 = 1 point), 0 si inconnu. */
  lift: number
  winRate: number | null
  games: number
  /** Estimation propre au champion (sinon : tous champions confondus). */
  ownData: boolean
  /** Note de l'augment pour ce champion (même échelle que l'écart : 0,01 ≈ 1 point). */
  score: number
  /** Ce qui justifie la note (affinités, objets, tes parties, statistiques). */
  reasons: string[]
}

export interface AugmentAdvice {
  byRarity: Record<Rarity, { best: AugmentPick[]; avoid: AugmentPick[] }>
  /** Parties du champion dans ce mode (0 : estimations tous champions confondus). */
  games: number
  /** Le classement vient des statistiques collectées (sinon : affinités et tes parties). */
  measured: boolean
}

/** Nom de l'augment dans la langue de l'app. */
export const augmentName = (a: AugmentInfo): string => (getLang() === 'en' ? a.name : a.nameFr)

/** Description dans la langue de l'app ('' si inconnue). */
export const augmentDesc = (a: AugmentInfo): string =>
  (getLang() === 'en' ? a.desc : (a.descFr ?? a.desc)) ?? ''

/** Adresse de l'icône (données du jeu sur CommunityDragon). */
export function augmentIconUrl(a: AugmentInfo): string | null {
  const m = /^\/lol-game-data\/assets\/(.+)$/i.exec(a.icon)
  return m
    ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${m[1].toLowerCase()}`
    : null
}

/** Niveaux des paliers d'augments en ARAM Mayhem. */
export const AUGMENT_LEVELS = [3, 7, 11, 15]

const TAG_LABEL: Record<AugmentTag, [string, string]> = {
  ap: ['puissance', 'ability power'],
  ad: ['dégâts d’attaque', 'attack damage'],
  attack: ['attaques', 'attacks'],
  as: ['vitesse d’attaque', 'attack speed'],
  crit: ['critiques', 'crits'],
  onhit: ['effets à l’impact', 'on-hit'],
  ability: ['compétences', 'abilities'],
  haste: ['accélération', 'ability haste'],
  ult: ['ultime', 'ultimate'],
  tank: ['résistances', 'resistances'],
  heal: ['soins', 'healing'],
  shield: ['boucliers', 'shields'],
  ally: ['alliés', 'allies'],
  vamp: ['vol de vie', 'life steal'],
  mana: ['mana', 'mana'],
  ms: ['vitesse', 'move speed'],
  cc: ['contrôles', 'crowd control'],
  gold: ['or', 'gold'],
  summoner: ['sort d’invocateur', 'summoner spell'],
  melee: ['corps à corps', 'melee'],
  ranged: ['distance', 'ranged']
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** Composants d'un objet (récursivement), pour reconnaître Brillance dans la Trinité… */
function withComponents(gd: GameData, item: ItemInfo, out: Set<string>, depth = 0): void {
  out.add(norm(item.name))
  if (depth > 3) return
  for (const id of item.from) {
    const c = gd.items.get(id)
    if (c) withComponents(gd, c, out, depth + 1)
  }
}

/** Objets finaux du build : trois premiers, puis les deux options les plus jouées. */
function buildItemList(gd: GameData | null, build: JunglerBuild | null): ItemInfo[] {
  if (!gd || !build) return []
  return [...build.core, ...build.options.slice(0, 2)]
    .map((n) => gd.itemsByName.get(norm(n)))
    .filter((x): x is ItemInfo => !!x)
}

/** Caractéristiques d'objet (Data Dragon) utilisées pour le profil. */
const STAT_TAGS = new Set([
  'SpellDamage',
  'Damage',
  'AttackSpeed',
  'CriticalStrike',
  'OnHit',
  'Armor',
  'SpellBlock',
  'Health',
  'AbilityHaste',
  'CooldownReduction',
  'LifeSteal',
  'SpellVamp',
  'Mana',
  'ManaRegen'
])

/**
 * Profil du champion pour les augments : son build (part des objets qui donnent de la puissance,
 * des dégâts d'attaque, de la vitesse d'attaque…) et son profil mesuré (part de dégâts magiques,
 * dépendance aux attaques de base, soins, boucliers, contrôles).
 */
export function augmentProfile(
  gd: GameData | null,
  champ: ChampInfo | null,
  build: JunglerBuild | null,
  measured?: MeasuredProfiles
): AugmentProfile | null {
  if (!champ) return null
  const p = profileOf(champ, measured)
  // Objets sans caractéristiques connues (données incomplètes) : le profil seul.
  const items = buildItemList(gd, build).filter((i) => i.tags.some((t) => STAT_TAGS.has(t)))
  const n = items.length
  const share = (...tags: string[]): number =>
    n ? items.filter((i) => tags.some((t) => i.tags.includes(t))).length / n : 0
  const ability = clamp01(1 - 0.7 * p.aa)
  const enchanter = build?.archetype === 'ENCHANTER'
  return {
    ap: n ? 0.4 * p.ap + 0.6 * share('SpellDamage') : p.ap,
    ad: n ? 0.4 * (1 - p.ap) + 0.6 * share('Damage') : 1 - p.ap,
    attack: p.aa,
    as: n ? Math.max(share('AttackSpeed'), 0.6 * p.aa) : 0.8 * p.aa,
    crit: n ? Math.max(share('CriticalStrike'), 0.5 * p.crit) : p.crit,
    onhit: n ? Math.max(share('OnHit'), 0.4 * p.aa) : 0.5 * p.aa,
    ability,
    haste: n ? 0.6 * share('AbilityHaste', 'CooldownReduction') + 0.4 * ability : 0.6 * ability,
    ult: 0.5,
    tank: n ? Math.max(p.tank, share('Armor', 'SpellBlock'), 0.7 * share('Health')) : p.tank,
    heal: Math.max(p.heal, 0.6 * share('LifeSteal', 'SpellVamp')),
    shield: p.shield,
    ally: enchanter ? 1 : 0.5 * Math.max(p.heal, p.shield),
    vamp: Math.max(0.35, share('LifeSteal', 'SpellVamp')),
    mana: n ? share('Mana', 'ManaRegen') : 0.3,
    ms: 0.5,
    cc: p.cc,
    gold: 0.5,
    summoner: 0.5,
    melee: 0.5,
    ranged: 0.5
  }
}

/** Contexte du classement pour un champion. */
export function augmentContext(
  gd: GameData | null,
  champ: ChampInfo | null,
  build: JunglerBuild | null,
  measured: MeasuredProfiles | undefined,
  personal: ModeData | null
): AugmentContext {
  const buildItems = new Set<string>()
  if (gd) for (const it of buildItemList(gd, build)) withComponents(gd, it, buildItems)
  const itemLabel = (english: string): string => {
    if (!gd) return english
    const k = norm(english)
    const exact = gd.itemsByName.get(k)
    if (exact) return exact.label
    // Nom abrégé (« Zhonya's ») : l'objet final qui le contient.
    for (const it of gd.items.values())
      if (it.isLegendary && norm(it.name).includes(k)) return it.label
    return english
  }
  return { profile: augmentProfile(gd, champ, build, measured), buildItems, personal, itemLabel }
}

/** Affinité de 0 à 1 entre un augment et le champion (null : augment sans caractéristique). */
export function augmentFit(info: AugmentInfo, profile: AugmentProfile): number | null {
  const tags = info.tags
  if (!tags) return null
  let w = 0
  let t = 0
  for (const k of AUGMENT_TAGS) {
    const x = tags[k] ?? 0
    if (x <= 0) continue
    w += x
    t += x * profile[k]
  }
  return w > 0 ? t / w : null
}

/** Poids de l'affinité dans la note (affinité 1 contre 0 ≈ 8 points). */
const FIT_WEIGHT = 0.08
/** Augment qui améliore un objet du build (ou absent du build). */
const UPGRADE_HAVE = 0.03
const UPGRADE_MISSING = -0.02
const QUEST_HAVE = 0.02
/** Lissage de tes parties : ce nombre de joueurs à 50 % de victoires s'ajoute. */
const PERSONAL_PRIOR = 20

/** Écart de victoire lissé des joueurs de tes parties qui ont pris l'augment. */
function personalLift(
  personal: ModeData | null,
  id: number
): { lift: number; n: number; wins: number } {
  const s = personal?.augments.get(id)
  if (!s?.n) return { lift: 0, n: 0, wins: 0 }
  return {
    lift: (s.wins + PERSONAL_PRIOR / 2) / (s.n + PERSONAL_PRIOR) - 0.5,
    n: s.n,
    wins: s.wins
  }
}

const pts = (x: number): string => `${x >= 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`
const labels = (tags: AugmentTag[]): string => tags.map((t) => tr(...TAG_LABEL[t])).join(', ')

/** Note d'un augment pour ce champion, avec ses raisons. */
function pickOf(
  build: JunglerBuild | null,
  info: AugmentInfo,
  ctx: AugmentContext | undefined,
  meanFit: number
): AugmentPick {
  const mine = build?.augments?.find((a) => a.id === info.id)
  const lift = mine?.lift ?? info.lift ?? 0
  const games = mine?.games ?? info.games ?? 0
  const pick: AugmentPick = {
    info,
    lift,
    winRate: mine?.winRate ?? info.winRate ?? null,
    games,
    ownData: !!mine,
    score: lift,
    reasons: []
  }
  if (games > 0)
    pick.reasons.push(
      mine
        ? tr(
            `${pts(lift)} pt avec ce champion (${fmtNumber(games)} parties)`,
            `${pts(lift)} pt with this champion (${fmtNumber(games)} games)`
          )
        : tr(`${pts(lift)} pt tous champions confondus`, `${pts(lift)} pt across all champions`)
    )
  if (!ctx) return pick
  // Affinité : ce que l'augment renforce comparé à ce dont le champion se sert.
  const fit = ctx.profile ? augmentFit(info, ctx.profile) : null
  if (fit !== null && ctx.profile) {
    pick.score += FIT_WEIGHT * (fit - meanFit)
    const tags = AUGMENT_TAGS.filter((k) => (info.tags?.[k] ?? 0) >= 0.5)
    const good = tags
      .filter((k) => ctx.profile![k] >= 0.55)
      .sort((a, b) => ctx.profile![b] - ctx.profile![a])
    const poor = tags.filter((k) => ctx.profile![k] <= 0.25)
    if (fit - meanFit >= 0.1 && good.length)
      pick.reasons.push(
        tr(
          `va avec ton champion : ${labels(good.slice(0, 2))}`,
          `fits your champion: ${labels(good.slice(0, 2))}`
        )
      )
    else if (fit - meanFit <= -0.1 && poor.length)
      pick.reasons.push(
        tr(
          `peu utile pour ton champion : ${labels(poor.slice(0, 2))}`,
          `little use for your champion: ${labels(poor.slice(0, 2))}`
        )
      )
  }
  // Objet amélioré, objets de quête : dans ton build ou non.
  const quest = (info.items ?? []).filter((n) => ctx.buildItems.has(norm(n)))
  if (info.upgrade) {
    // (Immolation : Égide de feu solaire ou Rayonnement creux, objets cités dans la description.)
    const have =
      quest.length > 0 || [...ctx.buildItems].some((n) => n.includes(norm(info.upgrade!)))
    pick.score += have ? UPGRADE_HAVE : UPGRADE_MISSING
    const up = ctx.itemLabel(info.upgrade)
    pick.reasons.push(
      have
        ? tr(`améliore ${up} (dans ton build)`, `upgrades ${up} (in your build)`)
        : tr(`améliore ${up}, absent de ton build`, `upgrades ${up}, not in your build`)
    )
  } else if (quest.length) {
    pick.score += QUEST_HAVE
    const names = quest.map(ctx.itemLabel).join(', ')
    pick.reasons.push(tr(`avec ${names} (dans ton build)`, `with ${names} (in your build)`))
  }
  // Tes parties : joueurs qui l'ont pris et leurs victoires (lissé : quelques parties comptent peu).
  const own = personalLift(ctx.personal, info.id)
  if (own.n > 0) {
    pick.score += own.lift
    pick.reasons.push(
      tr(
        `tes parties : ${own.n} joueur${own.n > 1 ? 's' : ''}, ${own.wins} victoire${own.wins > 1 ? 's' : ''}`,
        `your games: ${own.n} player${own.n > 1 ? 's' : ''}, ${own.wins} win${own.wins === 1 ? '' : 's'}`
      )
    )
  }
  return pick
}

/** Affinité moyenne des augments du mode pour ce champion (point neutre des notes). */
function meanFitOf(catalog: Catalog, ctx: AugmentContext | undefined): number {
  if (!ctx?.profile) return 0.5
  let t = 0
  let n = 0
  for (const a of Object.values(catalog.augmentInfo ?? {})) {
    const f = augmentFit(a, ctx.profile)
    if (f === null) continue
    t += f
    n++
  }
  return n ? t / n : 0.5
}

/** Seuils du conseil avant la partie. */
const BEST = 0.004
const AVOID = -0.012

/**
 * Augments conseillés pour ce champion, par rareté : les meilleurs, et ceux à éviter. Sans
 * contexte : statistiques collectées seulement (null s'il n'y en a pas).
 */
export function augmentAdvice(
  catalog: Catalog,
  build: JunglerBuild | null,
  max = 5,
  ctx?: AugmentContext
): AugmentAdvice | null {
  const info = catalog.augmentInfo
  if (!info) return null
  const measured =
    !!build?.augments?.length || Object.values(info).some((a) => a.lift !== undefined)
  if (!measured && !ctx) return null
  const meanFit = meanFitOf(catalog, ctx)
  const picks = Object.values(info)
    .filter((a) => ctx || a.lift !== undefined || build?.augments?.some((x) => x.id === a.id))
    .map((a) => pickOf(build, a, ctx, meanFit))
  if (!picks.length) return null
  const byRarity = {} as AugmentAdvice['byRarity']
  for (const r of RARITY_ORDER) {
    const list = picks.filter((p) => p.info.rarity === r).sort((a, b) => b.score - a.score)
    byRarity[r] = {
      best: list.filter((p) => p.score > (measured ? 0 : BEST)).slice(0, max),
      avoid: list
        .filter((p) => p.score <= AVOID)
        .slice(-3)
        .reverse()
    }
  }
  return { byRarity, games: build?.games ?? 0, measured }
}

/** Écart propre à deux augments pris ensemble (0 si non mesuré). */
export function pairLift(catalog: Catalog, a: number, b: number): number {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`
  return catalog.augmentPairs?.[key]?.[1] ?? 0
}

export interface OfferedAugment {
  pick: AugmentPick
  /** Note totale : champion + affinités avec les augments déjà pris (0,01 ≈ 1 point). */
  score: number
  reasons: string[]
  rank: number
}

/**
 * Augments proposés à un palier, du meilleur au moins bon pour ce champion, compte tenu des
 * augments déjà pris (affinités mesurées entre augments, s'il y en a).
 */
export function rankOffered(
  catalog: Catalog,
  build: JunglerBuild | null,
  offered: number[],
  chosen: number[],
  ctx?: AugmentContext
): OfferedAugment[] {
  const out: OfferedAugment[] = []
  const meanFit = meanFitOf(catalog, ctx)
  for (const id of offered) {
    const info = catalog.augmentInfo?.[id]
    if (!info) continue
    const pick = pickOf(build, info, ctx, meanFit)
    const reasons = [...pick.reasons]
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
    if (!reasons.length)
      reasons.push(
        ctx
          ? tr(
              'effet général, sans lien particulier avec ton champion',
              'general effect, not tied to your champion'
            )
          : tr('pas encore de données', 'no data yet')
      )
    out.push({
      pick,
      score: pick.score + Math.max(-0.05, Math.min(0.05, synergy)),
      reasons,
      rank: 0
    })
  }
  return out.sort((a, b) => b.score - a.score).map((x, i) => ({ ...x, rank: i + 1 }))
}

/** Caractéristiques d'objet (Data Dragon) correspondant aux caractéristiques d'augment. */
const ITEM_TAGS: Partial<Record<AugmentTag, string[]>> = {
  ap: ['SpellDamage'],
  ad: ['Damage'],
  as: ['AttackSpeed'],
  crit: ['CriticalStrike'],
  onhit: ['OnHit'],
  haste: ['AbilityHaste', 'CooldownReduction'],
  tank: ['Armor', 'SpellBlock', 'Health'],
  vamp: ['LifeSteal', 'SpellVamp'],
  mana: ['Mana', 'ManaRegen']
}
/** Bonus d'un objet qui va avec un augment pris (affinité totale) ; objet amélioré ou de quête. */
const ITEM_FIT_BONUS = 0.15
const ITEM_TARGET_BONUS = 0.5

/**
 * Bonus d'objets selon les augments pris : un objet que les joueurs achètent bien plus souvent avec
 * cet augment (statistiques collectées), l'objet qu'il améliore ou qu'il demande (quête), et les
 * objets qui renforcent la même chose que lui (puissance, attaques…). Combiné à un autre bonus
 * (apprentissage).
 */
export function augmentItemBonus(
  catalog: Catalog,
  chosen: number[],
  other?: PersonalItemBonus,
  gd?: GameData | null
): PersonalItemBonus | undefined {
  const rows = new Map<string, { bonus: number; reason: string }>()
  const keep = (name: string, bonus: number, reason: string): void => {
    const key = norm(name)
    const prev = rows.get(key)
    if (!prev || bonus > prev.bonus) rows.set(key, { bonus, reason })
  }
  // Affinités : pour chaque objet connu, part des caractéristiques de l'augment qu'il renforce.
  const fits: { info: AugmentInfo; tags: [AugmentTag, number][] }[] = []
  for (const a of chosen) {
    const info = catalog.augmentInfo?.[a]
    if (!info) continue
    for (const r of catalog.augmentItems?.[a] ?? []) {
      const bonus = Math.max(-0.3, Math.min(0.6, 1.2 * r.uplift + 6 * r.lift))
      keep(
        r.item,
        bonus,
        bonus >= 0.1
          ? tr(
              `avec ${augmentName(info)} (+${fmtPct(r.uplift, 0)} d’achats)`,
              `with ${augmentName(info)} (+${fmtPct(r.uplift, 0)} buys)`
            )
          : ''
      )
    }
    if (!gd) continue
    const targets = [...(info.items ?? [])]
    if (info.upgrade) {
      // Objet amélioré et objets qui le contiennent (Brillance → Trinité, Lich Bane…).
      const up = norm(info.upgrade)
      for (const it of gd.items.values()) {
        if (!it.isLegendary && !it.isBoots) continue
        const comps = new Set<string>()
        withComponents(gd, it, comps)
        if ([...comps].some((n) => n.includes(up))) targets.push(it.name)
      }
    }
    for (const name of targets)
      keep(
        name,
        ITEM_TARGET_BONUS,
        tr(`amélioré par ${augmentName(info)}`, `upgraded by ${augmentName(info)}`)
      )
    const tags = AUGMENT_TAGS.filter((k) => ITEM_TAGS[k] && (info.tags?.[k] ?? 0) >= 0.5).map(
      (k) => [k, info.tags![k]!] as [AugmentTag, number]
    )
    if (tags.length) fits.push({ info, tags })
  }
  if (!rows.size && !fits.length) return other
  return (itemName) => {
    const base = other?.(itemName) ?? null
    const row = rows.get(norm(itemName))
    let bonus = row?.bonus ?? 0
    let reason = row?.reason || ''
    if (!row && gd && fits.length) {
      const it = gd.itemsByName.get(norm(itemName))
      if (it)
        for (const f of fits) {
          const w = f.tags.reduce((t, [, x]) => t + x, 0)
          const hit = f.tags
            .filter(([k]) => ITEM_TAGS[k]!.some((t) => it.tags.includes(t)))
            .reduce((t, [, x]) => t + x, 0)
          const b = (ITEM_FIT_BONUS * hit) / w
          if (b > bonus) {
            bonus = b
            reason =
              b >= 0.07
                ? tr(`va avec ${augmentName(f.info)}`, `goes with ${augmentName(f.info)}`)
                : ''
          }
        }
    }
    if (!bonus) return base
    return { bonus: (base?.bonus ?? 0) + bonus, reason: reason || base?.reason }
  }
}
