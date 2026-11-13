import type { Benchmark, Catalog } from './catalog'
import { DEFAULT_BENCH_BY_ROLE, type GameFacts } from './postgame'
import { MODES, modeOf, type ModeKey } from '../../../shared/modes'

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

const gameMode = (f: GameFacts): ModeKey | 'sr' | null =>
  f.role && f.role in MODES ? (f.role as ModeKey) : modeOf(f.queueId)

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
