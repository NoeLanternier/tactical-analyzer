import type { Benchmark, Catalog } from './catalog'
import type { GameData } from './gameData'
import {
  DEFAULT_BENCH_BY_ROLE,
  SWIFT_TIME,
  cleanStoredItems,
  foldEvolutions,
  purchasesOf,
  type GameFacts
} from './postgame'
import type { Lane } from './role'
import { MODES, gameTypeOf, modeOf, type ModeKey } from '../../../shared/modes'

// Modes privés (ARAM Mayhem…) : Riot ne publie pas leurs parties, la collecte n'a donc ni repères
// ni statistiques d'augments. L'historique du client, lui, donne pour chacune de tes parties les
// dix joueurs : leurs augments, leurs objets, leur or, leurs dégâts et le résultat. L'app en tire,
// sur ton ordinateur seulement, des repères (médianes des joueurs de tes parties) et le résultat
// des augments que tu as vus pris.

export interface ModeAugmentStat {
  /** Joueurs de tes parties qui l'ont pris, et leurs victoires. */
  n: number
  wins: number
  /** Dont toi. */
  mine: number
  mineWins: number
}

export interface ModeData {
  mode: ModeKey
  /** Tes parties enregistrées dans ce mode. */
  games: number
  /** Joueurs observés (10 par partie). */
  players: number
  augments: Map<number, ModeAugmentStat>
  /** Médianes des joueurs de tes parties (null : pas encore assez de parties). */
  bench: Benchmark | null
}

/** Joueurs à partir desquels les médianes servent de repères (une partie complète). */
export const MIN_BENCH_PLAYERS = 10

const median = (xs: number[]): number => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return 0
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Type de la partie (null : jamais comptée, comme une partie personnalisée). */
const gameMode = (f: GameFacts): string | null =>
  gameTypeOf(f.queueId, f.role && f.role in MODES ? (f.role as ModeKey) : modeOf(f.queueId))

/** Données de tes parties dans ce mode. */
export function modeData(facts: GameFacts[], mode: ModeKey): ModeData {
  const augments = new Map<number, ModeAugmentStat>()
  const gold: number[] = []
  const dmg: number[] = []
  const deaths: number[] = []
  const share: number[] = []
  const kp: number[] = []
  let games = 0
  for (const f of facts) {
    if (gameMode(f) !== mode) continue
    const minutes = f.duration / 60
    if (!(minutes >= 5) || f.players.length < 2) continue
    games++
    const teamDmg = new Map<number, number>()
    const teamKills = new Map<number, number>()
    for (const p of f.players) {
      teamDmg.set(p.team, (teamDmg.get(p.team) ?? 0) + p.phys + p.magic)
      teamKills.set(p.team, (teamKills.get(p.team) ?? 0) + p.k)
    }
    for (const p of f.players) {
      gold.push(p.gold / minutes)
      dmg.push((p.phys + p.magic) / minutes)
      deaths.push((p.d / minutes) * 10)
      const td = teamDmg.get(p.team) ?? 0
      if (td > 0) share.push((p.phys + p.magic) / td)
      const tk = teamKills.get(p.team) ?? 0
      if (tk > 0) kp.push(Math.min(1, (p.k + p.a) / tk))
      for (const id of new Set(p.augments ?? [])) {
        if (!(id > 0)) continue
        const s = augments.get(id) ?? { n: 0, wins: 0, mine: 0, mineWins: 0 }
        s.n++
        if (p.win) s.wins++
        if (p.pid === f.me) {
          s.mine++
          if (p.win) s.mineWins++
        }
        augments.set(id, s)
      }
    }
  }
  const players = gold.length
  const bench: Benchmark | null =
    players >= MIN_BENCH_PLAYERS
      ? {
          ...DEFAULT_BENCH_BY_ROLE[mode],
          games: players,
          goldPerMin: median(gold),
          dmgPerMin: median(dmg),
          deathsPer10: median(deaths),
          dmgShare: median(share),
          kp: median(kp)
        }
      : null
  return { mode, games, players, augments, bench }
}

/**
 * Repères d'un mode privé tirés de tes parties. Méta empruntée (ARAM pour ARAM Mayhem) : les
 * repères de chaque champion y sont mis à l'échelle du mode (or, dégâts et morts des joueurs de
 * tes parties comparés à ceux de la méta) ; sinon, les médianes de tes parties pour tous.
 */
export function withModeBench(catalog: Catalog, data: ModeData | null): Catalog {
  const lobby = data?.bench
  if (!lobby || !MODES[data.mode].privateData) return catalog
  const base = catalog.borrowedFrom ? catalog.benchmarks : undefined
  const all = base?.['_all']
  const ratio = (a: number | undefined, b: number | undefined): number =>
    a && b && a > 0 && b > 0 ? Math.max(0.5, Math.min(2.5, a / b)) : 1
  const rGold = ratio(lobby.goldPerMin, all?.goldPerMin)
  const rDmg = ratio(lobby.dmgPerMin, all?.dmgPerMin)
  const rDeaths = ratio(lobby.deathsPer10, all?.deathsPer10)
  const benchmarks: Record<string, Benchmark> = {}
  if (all)
    for (const [champ, b] of Object.entries(base ?? {})) {
      if (champ === '_all') continue
      benchmarks[champ] = {
        ...b,
        ...(b.goldPerMin !== undefined ? { goldPerMin: b.goldPerMin * rGold } : {}),
        ...(b.dmgPerMin !== undefined ? { dmgPerMin: b.dmgPerMin * rDmg } : {}),
        ...(b.deathsPer10 !== undefined ? { deathsPer10: b.deathsPer10 * rDeaths } : {})
      }
    }
  benchmarks['_all'] = lobby
  const name = MODES[data.mode].name
  return {
    ...catalog,
    benchmarks,
    benchNote: all
      ? [
          `joueurs ${MODES[catalog.borrowedFrom!].name[0]} du patch, à l'échelle des ${data.players} joueurs de tes parties ${name[0]}`,
          `${MODES[catalog.borrowedFrom!].name[1]} players this patch, scaled to the ${data.players} players of your ${name[1]} games`
        ]
      : [
          `médianes des ${data.players} joueurs de tes parties ${name[0]}`,
          `medians of the ${data.players} players of your ${name[1]} games`
        ]
  }
}

// --- Swiftplay : repères tirés des joueurs de tes parties ---
//
// Swiftplay se joue avec des règles accélérées (niveau 3 et 1 400 PO au départ, or et expérience
// augmentés) : les repères des parties classées n'ont pas de sens. Les repères d'un poste sont les
// médianes des autres joueurs à ce poste dans tes parties Swiftplay (au moins ton adversaire direct
// de la partie analysée), aux mêmes instants que l'analyse (10 min de partie normale ≈ 7 min).

export interface LobbyBench {
  bench: Benchmark
  /** Joueurs à ce poste observés dans tes parties. */
  players: number
}

/** Repères d'un poste d'après les autres joueurs de tes parties Swiftplay (null : aucun). */
export function swiftBench(facts: GameFacts[], role: Lane, gd: GameData): LobbyBench | null {
  const m10 = Math.round(10 * SWIFT_TIME)
  const m15 = Math.round(15 * SWIFT_TIME)
  const xs: Record<string, number[]> = {
    cs10: [],
    cs15: [],
    gold15: [],
    level15: [],
    firstItem: [],
    secondItem: [],
    kp: [],
    visionPerMin: [],
    goldPerMin: [],
    dmgPerMin: [],
    deathsPer10: [],
    dmgShare: []
  }
  let players = 0
  for (const stored of facts) {
    if (gameTypeOf(stored.queueId, 'sr') !== 'swift') continue
    const f = foldEvolutions(cleanStoredItems(stored), gd)
    const minutes = f.duration / 60
    if (!(minutes >= 5)) continue
    const teamDmg = new Map<number, number>()
    const teamKills = new Map<number, number>()
    for (const p of f.players) {
      teamDmg.set(p.team, (teamDmg.get(p.team) ?? 0) + p.phys + p.magic)
      teamKills.set(p.team, (teamKills.get(p.team) ?? 0) + p.k)
    }
    f.players.forEach((p, idx) => {
      if (p.pid === f.me || p.role !== role) return
      players++
      const at = (m: number, k: number): number | undefined =>
        f.frames.length > m ? f.frames[m]?.[idx]?.[k] : undefined
      const put = (key: string, v: number | undefined): void => {
        if (typeof v === 'number') xs[key].push(v)
      }
      put('cs10', at(m10, 2))
      put('cs15', at(m15, 2))
      put('gold15', at(m15, 0))
      put('level15', at(m15, 3))
      const seen = new Set<number>()
      const times: number[] = []
      for (const b of purchasesOf(f, p.pid)) {
        if (seen.has(b.id) || !gd.items.get(b.id)?.isLegendary) continue
        seen.add(b.id)
        times.push(b.t / 60)
      }
      put('firstItem', times[0])
      put('secondItem', times[1])
      const tk = teamKills.get(p.team) ?? 0
      if (tk > 0) xs.kp.push(Math.min(1, (p.k + p.a) / tk))
      xs.visionPerMin.push(p.vision / minutes)
      xs.goldPerMin.push(p.gold / minutes)
      xs.dmgPerMin.push((p.phys + p.magic) / minutes)
      xs.deathsPer10.push((p.d / minutes) * 10)
      const td = teamDmg.get(p.team) ?? 0
      if (td > 0) xs.dmgShare.push((p.phys + p.magic) / td)
    })
  }
  if (!players) return null
  const def = DEFAULT_BENCH_BY_ROLE[role]
  const pick = (k: string, fallback: number): number => (xs[k].length ? median(xs[k]) : fallback)
  return {
    players,
    bench: {
      ...def,
      games: players,
      // Sans mesure : repère des parties classées ramené au rythme de Swiftplay.
      cs10: pick('cs10', def.cs10 * SWIFT_TIME),
      cs15: pick('cs15', def.cs15 * SWIFT_TIME),
      gold15: pick('gold15', def.gold15),
      level15: pick('level15', def.level15),
      firstItem: pick('firstItem', def.firstItem * SWIFT_TIME),
      secondItem: pick('secondItem', def.secondItem * SWIFT_TIME),
      kp: pick('kp', def.kp),
      visionPerMin: pick('visionPerMin', def.visionPerMin),
      goldPerMin: pick('goldPerMin', 0) || undefined,
      dmgPerMin: pick('dmgPerMin', 0) || undefined,
      deathsPer10: pick('deathsPer10', 0) || undefined,
      dmgShare: pick('dmgShare', 0) || undefined
    }
  }
}

/**
 * Catalogue d'une partie Swiftplay : repères des joueurs de tes parties à ce poste (sinon, repères
 * par défaut du poste ramenés au rythme de Swiftplay : jamais ceux des parties classées tels quels).
 */
export function withSwiftBench(catalog: Catalog, lobby: LobbyBench | null, role: Lane): Catalog {
  if (!lobby) {
    const def = DEFAULT_BENCH_BY_ROLE[role]
    return {
      ...catalog,
      benchmarks: {
        _all: {
          ...def,
          cs10: def.cs10 * SWIFT_TIME,
          cs15: def.cs15 * SWIFT_TIME,
          firstItem: def.firstItem * SWIFT_TIME,
          secondItem: def.secondItem * SWIFT_TIME
        }
      },
      benchNote: [
        'repères par défaut du poste ramenés au rythme de Swiftplay',
        'default role benchmarks scaled to the Swiftplay pace'
      ]
    }
  }
  return {
    ...catalog,
    benchmarks: { _all: lobby.bench },
    benchNote: [
      `médianes des ${lobby.players} autres joueurs à ton poste dans tes parties Swiftplay`,
      `medians of the ${lobby.players} other players in your role in your Swiftplay games`
    ]
  }
}

/** Partie normale : mêmes règles que les classées, comparée aux joueurs des parties classées. */
export function withNormalNote(catalog: Catalog): Catalog {
  const level =
    catalog.statsBracket === 'gold' ? ['Or à Émeraude', 'Gold to Emerald'] : ['Master+', 'Master+']
  return {
    ...catalog,
    benchNote: [
      `joueurs ${level[0]} en partie classée (mêmes règles que les normales)`,
      `${level[1]} players in ranked games (same rules as normal games)`
    ]
  }
}
