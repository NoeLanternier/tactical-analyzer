import {
  JUNGLE_BUILDS,
  META_PATCH,
  type BuildChoices,
  type BuildVariant,
  type ChoiceStats,
  type JunglerBuild,
  type NamedChoice,
  type PetChoice,
  type RuneChoice,
  type SkillChoice,
  type RuneSpec,
  type SituationContext
} from '../data/junglers'
import type { Archetype } from '../data/items'
import type { ChampInfo, GameData } from './gameData'
import { norm } from './normalize'
import { resolveSpec } from './runes'
import { profileOf, type MeasuredProfiles } from './threat'
import { tr } from '../../../shared/i18n'
import { parseTuning, type EngineTuning } from './tuning'

// Catalogue des builds : base tactique + mise à jour distante éventuelle + build générique pour
// tout champion absent de la base (nouveau champion, pick original...).

/**
 * Statistiques d'un jungler sur le patch (méta distante), en [parties, taux de victoire] :
 * vs = contre chaque jungler adverse, with = avec chaque champion allié, against = contre chaque
 * adversaire hors jungler (with / against absents des méta plus anciennes).
 */
export interface JunglerStat {
  games: number
  winRate: number
  vs: Record<string, [number, number]>
  with: Record<string, [number, number]>
  against: Record<string, [number, number]>
  /** Combats contre chaque jungler adverse ('_all' : tous), par période : [combats, part gagnée]. */
  duels?: Record<string, Partial<Record<DuelPeriod, [number, number]>>>
  /** Début de partie : part des départs côté haut, minute et voies de la première élimination. */
  opening?: {
    games: number
    top: number
    firstMinute: number | null
    firstLanes: Partial<Record<'top' | 'mid' | 'bot' | 'jungle', number>>
  }
  /** Taux de victoire selon la composition adverse : [parties, taux] (équipe très AP, AD…). */
  contexts?: Partial<Record<SituationContext, [number, number]>>
  /** Part des parties où le champion est banni. */
  banRate?: number
}

export type DuelPeriod = 'early' | 'mid' | 'late'
const DUEL_PERIODS: DuelPeriod[] = ['early', 'mid', 'late']

/** Repères d'un jungler Master+ (moyennes du patch, méta distante). */
export interface Benchmark {
  games: number
  /** Sbires + monstres à 10 et 15 min. */
  cs10: number
  cs15: number
  /** Or total et niveau à 15 min. */
  gold15: number
  level15: number
  /** Minute de fin du 1er et du 2e objet légendaire. */
  firstItem: number
  secondItem: number
  /** Participation aux éliminations (0..1). */
  kp: number
  visionPerMin: number
  controlWardsPer10: number
}

export interface Catalog {
  patch: string
  builds: Map<string, JunglerBuild>
  /** Source de la base : intégrée ou URL distante. */
  origin: 'intégrée' | 'distante'
  /** Profils mesurés de tous les champions (méta distante). */
  profiles?: MeasuredProfiles
  /** Taux de victoire des junglers et de leurs affrontements (méta distante). */
  junglerStats?: Record<string, JunglerStat>
  /** Repères Master+ par champion (et '_all' pour l'ensemble des junglers). */
  benchmarks?: Record<string, Benchmark>
  /**
   * Objets face aux adversaires (méta distante) : pour chaque objet, écart de taux de victoire
   * [parties, écart] face à un champion ('Zed') ou à un type d'objet adverse ('#pctHp').
   */
  itemCounters?: ItemCounters
  /** Poids des critères du moteur réglés par le pipeline (méta distante). */
  tuning?: EngineTuning
  /** Backtest de la méta (parties jugées avec la méta de la veille). */
  backtest?: BacktestSummary
  /** Niveau de jeu des statistiques des junglers et des repères (méta distante). */
  statsBracket?: 'master' | 'gold'
}

export interface BacktestCell {
  games: number
  winRate: number | null
}
export interface BacktestSummary {
  games: number
  /** Famille de build recommandée suivie, ou non. */
  variant: { followed: BacktestCell; other: BacktestCell }
  /** Objets situationnels recommandés : au moins 2 achetés (high), aucun (low). */
  items: { high: BacktestCell; low: BacktestCell }
}

export type ItemCounters = Record<string, Record<string, [number, number]>>

export function defaultCatalog(): Catalog {
  return {
    patch: META_PATCH,
    builds: new Map(JUNGLE_BUILDS.map((b) => [b.id, b])),
    origin: 'intégrée'
  }
}

/** Base d'un poste hors jungle : pas de builds intégrés, tout vient de la méta du poste. */
export function roleBaseCatalog(): Catalog {
  return { patch: META_PATCH, builds: new Map(), origin: 'intégrée' }
}

const ARCHETYPES: Archetype[] = [
  'AD_FIGHTER',
  'AD_ASSASSIN',
  'AD_CARRY',
  'AP_FIGHTER',
  'AP_BURST',
  'TANK',
  'ENCHANTER'
]

/* eslint-disable @typescript-eslint/no-explicit-any */
function isBuild(x: any): x is JunglerBuild {
  return x && typeof x.id === 'string' && isBuildShape(x)
}

/** Champs communs à un build et à une famille de build. */
function isBuildShape(x: any): boolean {
  return (
    x &&
    ARCHETYPES.includes(x.archetype) &&
    (typeof x.pet === 'string' || x.pet === null) &&
    typeof x.boots === 'string' &&
    Array.isArray(x.core) &&
    x.core.length === 3 &&
    Array.isArray(x.options) &&
    x.runes &&
    typeof x.runes.keystone === 'string' &&
    Array.isArray(x.runes.primary) &&
    x.runes.primary.length === 3 &&
    Array.isArray(x.runes.secondary) &&
    x.runes.secondary.length === 2 &&
    Array.isArray(x.runes.shards) &&
    x.runes.shards.length === 3
  )
}

/**
 * Fusionne un JSON distant { patch: "16.22", builds: [...] } (ou directement un tableau) avec la
 * base intégrée. Les entrées invalides sont ignorées.
 */
export function mergeOverride(
  base: Catalog,
  data: unknown
): {
  catalog: Catalog
  accepted: number
  rejected: number
  generatedAt: string | null
  sampleGames: number | null
} {
  const raw: any = data
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.builds) ? raw.builds : []
  const builds = new Map(base.builds)
  const patch = typeof raw?.patch === 'string' ? raw.patch : base.patch
  const bracket: 'master' | 'gold' = raw?.bracket === 'gold' ? 'gold' : 'master'
  let accepted = 0
  let rejected = 0
  for (const b of list) {
    if (isBuild(b)) {
      builds.set(b.id, {
        ...b,
        skills: typeof b.skills === 'string' ? b.skills : '',
        patch: typeof b.patch === 'string' ? b.patch : patch,
        games: typeof b.games === 'number' ? b.games : undefined,
        winRate: typeof b.winRate === 'number' ? b.winRate : undefined,
        start:
          Array.isArray(b.start) && b.start.every((x: unknown) => typeof x === 'string')
            ? b.start
            : undefined,
        bracket,
        situational: parseSituational(b.situational),
        variants: parseVariants(b.variants),
        choices: parseChoices(b.choices)
      })
      accepted++
    } else rejected++
  }
  const generatedAt = typeof raw?.generatedAt === 'string' ? raw.generatedAt : null
  const sampleGames = typeof raw?.sampleGames === 'number' ? raw.sampleGames : null
  return {
    catalog: {
      patch,
      builds,
      origin: accepted > 0 ? 'distante' : base.origin,
      profiles: parseProfiles(raw?.profiles) ?? base.profiles,
      junglerStats: parseJunglerStats(raw?.junglers) ?? base.junglerStats,
      benchmarks: parseBenchmarks(raw?.benchmarks) ?? base.benchmarks,
      statsBracket: parseJunglerStats(raw?.junglers) ? bracket : base.statsBracket,
      itemCounters: parseItemCounters(raw?.itemCounters) ?? base.itemCounters,
      tuning: parseTuning(raw?.tuning) ?? base.tuning,
      backtest: parseBacktest(raw?.backtest) ?? base.backtest
    },
    accepted,
    rejected,
    generatedAt,
    sampleGames
  }
}

const num = (x: any): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

const CONTEXT_KEYS: SituationContext[] = ['all', 'ap', 'ad', 'heal', 'tank', 'cc']

function parseSituational(raw: any): JunglerBuild['situational'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<JunglerBuild['situational']> = {}
  for (const ctx of CONTEXT_KEYS) {
    const c = raw[ctx]
    if (!c || !Array.isArray(c.items) || num(c.games) === null) continue
    const items = c.items
      .filter(
        (x: any) => typeof x?.item === 'string' && num(x.share) !== null && num(x.lift) !== null
      )
      .map((x: any) => ({
        item: x.item,
        share: x.share,
        lift: x.lift,
        games: num(x.games) ?? 0,
        ...(num(x.minute) !== null ? { minute: x.minute } : {})
      }))
    if (items.length) out[ctx] = { games: c.games, items }
  }
  return Object.keys(out).length ? out : undefined
}

function parseVariants(raw: any): BuildVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: BuildVariant[] = []
  for (const v of raw) {
    if (!isBuildShape(v) || typeof v.key !== 'string') continue
    if (num(v.games) === null || num(v.winRate) === null || num(v.share) === null) continue
    const contexts: BuildVariant['contexts'] = {}
    for (const ctx of CONTEXT_KEYS) {
      const c = v.contexts?.[ctx]
      if (Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null) contexts[ctx] = [c[0], c[1]]
    }
    const runeChoices = parseRuneChoices(v.runeChoices)
    out.push({
      ...(runeChoices ? { runeChoices } : {}),
      key: v.key,
      archetype: v.archetype,
      pet: v.pet,
      boots: v.boots,
      core: v.core,
      options: v.options,
      skills: typeof v.skills === 'string' ? v.skills : '',
      runes: v.runes,
      games: v.games,
      winRate: v.winRate,
      share: v.share,
      contexts
    })
  }
  return out.length >= 2 ? out : undefined
}

/** Champs communs d'une option mesurée, ou null si invalide. */
function parseChoiceStats(x: any): ChoiceStats | null {
  if (!x || num(x.games) === null || num(x.winRate) === null || num(x.share) === null) return null
  const contexts: ChoiceStats['contexts'] = {}
  for (const ctx of CONTEXT_KEYS) {
    const c = x.contexts?.[ctx]
    if (Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null) contexts[ctx] = [c[0], c[1]]
  }
  return { games: x.games, winRate: x.winRate, share: x.share, contexts }
}

const isRuneSpec = (r: any): r is RuneSpec =>
  r &&
  typeof r.keystone === 'string' &&
  Array.isArray(r.primary) &&
  r.primary.length === 3 &&
  typeof r.secondaryTree === 'string' &&
  Array.isArray(r.secondary) &&
  r.secondary.length === 2 &&
  Array.isArray(r.shards) &&
  r.shards.length === 3

function parseRuneChoices(raw: any): RuneChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.flatMap((x: any) => {
    const st = parseChoiceStats(x)
    return st && isRuneSpec(x.runes) ? [{ ...st, runes: x.runes }] : []
  })
  return out.length >= 2 ? out : undefined
}

function parseChoices(raw: any): BuildChoices | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: BuildChoices = {}
  const runes = parseRuneChoices(raw.runes)
  if (runes) out.runes = runes
  const named = (list: any): NamedChoice[] =>
    Array.isArray(list)
      ? list.flatMap((x: any) => {
          const st = parseChoiceStats(x)
          return st && typeof x.name === 'string' ? [{ ...st, name: x.name }] : []
        })
      : []
  const boots = named(raw.boots)
  if (boots.length >= 2) out.boots = boots
  const pets: PetChoice[] = named(raw.pet).map((p, i) => {
    const vs: Record<string, [number, number]> = {}
    for (const [k, v] of Object.entries<any>(raw.pet[i]?.vs ?? {}))
      if (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null) vs[k] = [v[0], v[1]]
    return { ...p, vs }
  })
  if (pets.length >= 2) out.pet = pets
  const skills: SkillChoice[] = Array.isArray(raw.skills)
    ? raw.skills.flatMap((x: any) => {
        const st = parseChoiceStats(x)
        return st && typeof x.value === 'string' ? [{ ...st, value: x.value }] : []
      })
    : []
  if (skills.length >= 2) out.skills = skills
  return Object.keys(out).length ? out : undefined
}

function parseBacktest(raw: any): BacktestSummary | undefined {
  const cell = (c: any): BacktestCell | null =>
    num(c?.games) !== null ? { games: c.games, winRate: num(c.winRate) } : null
  if (num(raw?.games) === null) return undefined
  const followed = cell(raw.variant?.followed)
  const other = cell(raw.variant?.other)
  const high = cell(raw.items?.high)
  const low = cell(raw.items?.low)
  if (!followed || !other || !high || !low) return undefined
  return { games: raw.games, variant: { followed, other }, items: { high, low } }
}

function parseItemCounters(raw: any): ItemCounters | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: ItemCounters = {}
  for (const [item, row] of Object.entries<any>(raw)) {
    if (!row || typeof row !== 'object') continue
    const r: Record<string, [number, number]> = {}
    for (const [foe, v] of Object.entries<any>(row))
      if (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null) r[foe] = [v[0], v[1]]
    if (Object.keys(r).length) out[item] = r
  }
  return Object.keys(out).length ? out : undefined
}

function parseProfiles(raw: any): MeasuredProfiles | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: MeasuredProfiles = {}
  for (const [id, p] of Object.entries<any>(raw)) {
    const keys = ['ap', 'tank', 'cc', 'heal', 'shield', 'crit', 'aa', 'games'] as const
    if (keys.every((k) => num(p?.[k]) !== null)) {
      out[id] = {
        ap: p.ap,
        tank: p.tank,
        cc: p.cc,
        heal: p.heal,
        shield: p.shield,
        crit: p.crit,
        aa: p.aa,
        games: p.games
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

function parseJunglerStats(raw: any): Record<string, JunglerStat> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, JunglerStat> = {}
  for (const [id, j] of Object.entries<any>(raw)) {
    if (num(j?.games) === null || num(j?.winRate) === null) continue
    const pairs = (m: any): Record<string, [number, number]> => {
      const r: Record<string, [number, number]> = {}
      for (const [k, v] of Object.entries<any>(m ?? {})) {
        if (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null) r[k] = [v[0], v[1]]
      }
      return r
    }
    out[id] = {
      games: j.games,
      winRate: j.winRate,
      vs: pairs(j.vs),
      with: pairs(j.with),
      against: pairs(j.against)
    }
    const contexts = pairs(j.contexts) as NonNullable<JunglerStat['contexts']>
    if (Object.keys(contexts).length) out[id].contexts = contexts
    if (num(j.banRate) !== null) out[id].banRate = j.banRate
    if (j.duels && typeof j.duels === 'object') {
      const duels: NonNullable<JunglerStat['duels']> = {}
      for (const [enemy, row] of Object.entries<any>(j.duels)) {
        const r: Partial<Record<DuelPeriod, [number, number]>> = {}
        for (const p of DUEL_PERIODS) {
          const v = row?.[p]
          if (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null) r[p] = [v[0], v[1]]
        }
        if (Object.keys(r).length) duels[enemy] = r
      }
      if (Object.keys(duels).length) out[id].duels = duels
    }
    const o = j.opening
    if (o && num(o.games) !== null && num(o.top) !== null) {
      const lanes: NonNullable<JunglerStat['opening']>['firstLanes'] = {}
      for (const lane of ['top', 'mid', 'bot', 'jungle'] as const)
        if (num(o.firstLanes?.[lane]) !== null) lanes[lane] = o.firstLanes[lane]
      out[id].opening = {
        games: o.games,
        top: o.top,
        firstMinute: num(o.firstMinute),
        firstLanes: lanes
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

const BENCH_KEYS = [
  'games',
  'cs10',
  'cs15',
  'gold15',
  'level15',
  'firstItem',
  'secondItem',
  'kp',
  'visionPerMin',
  'controlWardsPer10'
] as const

function parseBenchmarks(raw: any): Record<string, Benchmark> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, Benchmark> = {}
  for (const [id, b] of Object.entries<any>(raw)) {
    if (!BENCH_KEYS.every((k) => num(b?.[k]) !== null)) continue
    // Valeurs aberrantes (trop peu de parties, bug) : ignorées.
    if (b.cs10 <= 0 || b.firstItem <= 0 || b.secondItem <= b.firstItem || b.kp <= 0) continue
    out[id] = Object.fromEntries(BENCH_KEYS.map((k) => [k, b[k]])) as unknown as Benchmark
  }
  return Object.keys(out).length ? out : undefined
}

const GENERIC_RUNES: Record<Archetype, RuneSpec> = {
  AD_FIGHTER: {
    keystone: 'Conqueror',
    primary: ['Triumph', 'Legend: Alacrity', 'Last Stand'],
    secondaryTree: 'Inspiration',
    secondary: ['Magical Footwear', 'Cosmic Insight'],
    shards: ['AS', 'AF', 'HS']
  },
  AD_ASSASSIN: {
    keystone: 'Electrocute',
    primary: ['Sudden Impact', 'Grisly Mementos', 'Treasure Hunter'],
    secondaryTree: 'Precision',
    secondary: ['Triumph', 'Coup de Grace'],
    shards: ['AF', 'AF', 'HS']
  },
  AD_CARRY: {
    keystone: 'Lethal Tempo',
    primary: ['Triumph', 'Legend: Alacrity', 'Coup de Grace'],
    secondaryTree: 'Domination',
    secondary: ['Sudden Impact', 'Treasure Hunter'],
    shards: ['AS', 'AF', 'HS']
  },
  AP_FIGHTER: {
    keystone: 'Conqueror',
    primary: ['Triumph', 'Legend: Haste', 'Last Stand'],
    secondaryTree: 'Inspiration',
    secondary: ['Magical Footwear', 'Cosmic Insight'],
    shards: ['AF', 'AF', 'HS']
  },
  AP_BURST: {
    keystone: 'Dark Harvest',
    primary: ['Sudden Impact', 'Grisly Mementos', 'Treasure Hunter'],
    secondaryTree: 'Sorcery',
    secondary: ['Transcendence', 'Waterwalking'],
    shards: ['AF', 'AF', 'HS']
  },
  TANK: {
    keystone: 'Aftershock',
    primary: ['Font of Life', 'Conditioning', 'Overgrowth'],
    secondaryTree: 'Precision',
    secondary: ['Triumph', 'Legend: Alacrity'],
    shards: ['AS', 'HS', 'HS']
  },
  ENCHANTER: {
    keystone: 'Summon Aery',
    primary: ['Nimbus Cloak', 'Transcendence', 'Waterwalking'],
    secondaryTree: 'Inspiration',
    secondary: ['Cash Back', 'Cosmic Insight'],
    shards: ['AH', 'MS', 'HS']
  }
}

const GENERIC_ITEMS: Record<Archetype, Pick<JunglerBuild, 'pet' | 'boots' | 'core' | 'options'>> = {
  AD_FIGHTER: {
    pet: 'Scorchclaw Pup',
    boots: 'Plated Steelcaps',
    core: ['Eclipse', 'Black Cleaver', "Death's Dance"],
    options: ["Sterak's Gage", 'Guardian Angel', 'Maw of Malmortius', 'Spirit Visage']
  },
  AD_ASSASSIN: {
    pet: 'Gustwalker Hatchling',
    boots: 'Ionian Boots of Lucidity',
    core: ['Voltaic Cyclosword', 'Bastionbreaker', 'Edge of Night'],
    options: ["Serylda's Grudge", "Serpent's Fang", 'Guardian Angel']
  },
  AD_CARRY: {
    pet: 'Gustwalker Hatchling',
    boots: "Berserker's Greaves",
    core: ['Kraken Slayer', 'The Collector', "Lord Dominik's Regards"],
    options: ['Infinity Edge', 'Guardian Angel', "Death's Dance"]
  },
  AP_FIGHTER: {
    pet: 'Gustwalker Hatchling',
    boots: "Sorcerer's Shoes",
    core: ['Riftmaker', "Liandry's Torment", "Zhonya's Hourglass"],
    options: ["Rabadon's Deathcap", 'Void Staff', 'Spirit Visage']
  },
  AP_BURST: {
    pet: 'Scorchclaw Pup',
    boots: "Sorcerer's Shoes",
    core: ['Lich Bane', 'Shadowflame', "Zhonya's Hourglass"],
    options: ["Rabadon's Deathcap", 'Void Staff', "Banshee's Veil"]
  },
  TANK: {
    pet: 'Mosstomper Seedling',
    boots: 'Plated Steelcaps',
    core: ['Heartsteel', 'Sunfire Aegis', "Jak'Sho, The Protean"],
    options: ['Thornmail', 'Force of Nature', "Randuin's Omen", 'Spirit Visage']
  },
  ENCHANTER: {
    pet: 'Gustwalker Hatchling',
    boots: 'Ionian Boots of Lucidity',
    core: ['Redemption', 'Moonstone Renewer', 'Ardent Censer'],
    options: ["Shurelya's Battlesong", 'Dawncore']
  }
}

export function guessArchetype(champ: ChampInfo, measured?: MeasuredProfiles): Archetype {
  const p = profileOf(champ, measured)
  const f = p.flags
  if (f.includes('E') && p.tank < 0.7 && p.ap >= 0.5) return 'ENCHANTER'
  if (p.tank >= 0.8 || (!p.measured && f.includes('T'))) return 'TANK'
  if (p.ap >= 0.6) return f.includes('B') || p.tank >= 0.5 ? 'AP_FIGHTER' : 'AP_BURST'
  if (f.includes('A')) return 'AD_ASSASSIN'
  if (f.includes('M') || p.crit >= 0.5) return 'AD_CARRY'
  return 'AD_FIGHTER'
}

export function getBuild(
  catalog: Catalog,
  champ: ChampInfo,
  jungle = true
): { build: JunglerBuild; generic: boolean } {
  const known = catalog.builds.get(champ.id)
  if (known) return { build: known, generic: false }
  const archetype = guessArchetype(champ, catalog.profiles)
  const items = GENERIC_ITEMS[archetype]
  return {
    build: {
      id: champ.id,
      archetype,
      skills: '',
      runes: GENERIC_RUNES[archetype],
      ...items,
      // Hors jungle : pas de familier (objets de départ du poste, voir engine/role.ts).
      pet: jungle ? items.pet : null
    },
    generic: true
  }
}

export interface ValidationReport {
  checkedBuilds: number
  issues: string[]
}

/** Vérifie chaque build contre les données Riot du patch en cours. */
export function validateCatalog(gd: GameData, catalog: Catalog): ValidationReport {
  const issues: string[] = []
  for (const b of catalog.builds.values()) {
    if (!gd.championsById.has(b.id))
      issues.push(`${b.id}: ${tr('champion inconnu', 'unknown champion')}`)
    const runes = resolveSpec(gd, b.runes)
    if (!runes)
      issues.push(
        `${b.id}: ${tr('page de runes invalide', 'invalid rune page')} (${b.runes.keystone})`
      )
    else if (runes.repairs.length)
      issues.push(`${b.id}: ${tr('runes corrigées', 'runes fixed')} (${runes.repairs.join(', ')})`)
    for (const name of [b.pet, b.boots, ...b.core, ...b.options, ...(b.start ?? [])]) {
      if (name && !gd.itemsByName.has(norm(name)))
        issues.push(`${b.id}: ${tr('objet introuvable', 'item not found')} “${name}”`)
    }
    for (const c of [
      ...(b.choices?.runes ?? []),
      ...(b.variants ?? []).flatMap((v) => v.runeChoices ?? [])
    ])
      if (!resolveSpec(gd, c.runes))
        issues.push(
          `${b.id}: ${tr('page de runes invalide', 'invalid rune page')} (${c.runes.keystone})`
        )
    for (const c of [...(b.choices?.boots ?? []), ...(b.choices?.pet ?? [])])
      if (!gd.itemsByName.has(norm(c.name)))
        issues.push(`${b.id}: ${tr('objet introuvable', 'item not found')} “${c.name}”`)
    for (const v of b.variants ?? []) {
      if (!resolveSpec(gd, v.runes))
        issues.push(`${b.id} (${v.key}): ${tr('page de runes invalide', 'invalid rune page')}`)
      for (const name of [v.pet, v.boots, ...v.core, ...v.options])
        if (name && !gd.itemsByName.has(norm(name)))
          issues.push(`${b.id} (${v.key}): ${tr('objet introuvable', 'item not found')} “${name}”`)
    }
  }
  return { checkedBuilds: catalog.builds.size, issues }
}
