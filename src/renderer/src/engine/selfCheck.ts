import type { GameReport } from './postgame'
import { gameTypeOf, modeOf } from '../../../shared/modes'

// « Est-ce que l'app t'aide ? » : tes parties où tu as suivi les conseils, comparées à celles où
// tu ne les as pas suivis.
// - Build : part des achats conformes au conseil de chaque moment (rejeu du moteur sur la partie).
// - Draft : rang de ton champion dans le classement de l'app au moment où tu l'as verrouillé
//   (journal de draft enregistré en sélection des champions).
// C'est une comparaison de tes propres parties, pas une preuve : il faut assez de parties de
// chaque côté pour qu'un écart veuille dire quelque chose. Elle se fait par type de partie
// (classées, normales, ARAM…) : les bilans passés ici sont tous du même type.

/** Ton choix au moment du verrouillage, d'après le classement de l'app. */
export interface DraftLogEntry {
  /** Heure du verrouillage (ms). */
  t: number
  champ: string
  rank: number
  total: number
  /** Taux de victoire estimé de ton champion, et du meilleur choix du classement. */
  winRate: number
  bestWinRate: number
  known: { allies: number; enemies: number }
  /** File de la partie (absente des journaux plus anciens : classée en pratique). */
  queue?: number
}

export interface Group {
  games: number
  wins: number
}

export interface Comparison {
  followed: Group
  other: Group
  /** 'few' : pas assez de parties ; 'better' / 'worse' : écart net ; 'same' : pas d'écart net. */
  verdict: 'few' | 'better' | 'worse' | 'same'
  /** Parties qui manquent pour conclure (0 si assez). */
  missing: number
}

export interface SelfCheck {
  build: Comparison
  draft: Comparison
  /** Taux de victoire estimé par l'app à la draft, comparé à ton taux réel (parties suivies). */
  calibration: { games: number; expected: number; actual: number } | null
  /** Parties avec un journal de draft. */
  draftGames: number
}

/** Achats conformes au conseil : au moins 70 % suivi, au plus 40 % non suivi. */
export const BUILD_FOLLOWED = 0.7
export const BUILD_IGNORED = 0.4
/** Champion verrouillé parmi les 5 meilleurs du classement de la draft. */
export const DRAFT_TOP = 5
/** Parties minimales de chaque côté avant de conclure. */
export const MIN_GROUP = 15

const add = (g: Group, win: boolean): void => {
  g.games++
  if (win) g.wins++
}

export function compare(followed: Group, other: Group): Comparison {
  const missing = Math.max(0, MIN_GROUP - followed.games) + Math.max(0, MIN_GROUP - other.games)
  if (missing > 0) return { followed, other, verdict: 'few', missing }
  const p1 = followed.wins / followed.games
  const p2 = other.wins / other.games
  const p = (followed.wins + other.wins) / (followed.games + other.games)
  const se = Math.sqrt(Math.max(1e-9, p * (1 - p) * (1 / followed.games + 1 / other.games)))
  const z = (p1 - p2) / se
  // Seuil modéré (≈ 90 %) : on cherche une tendance nette, pas une preuve scientifique.
  const verdict = z >= 1.64 ? 'better' : z <= -1.64 ? 'worse' : 'same'
  return { followed, other, verdict, missing: 0 }
}

/** Journal de draft de la partie : même champion, verrouillé peu avant le début de la partie. */
export function draftEntryFor(r: GameReport, log: DraftLogEntry[]): DraftLogEntry | null {
  if (!r.champ) return null
  const start = r.facts.createdAt
  let best: DraftLogEntry | null = null
  for (const e of log) {
    if (e.champ !== r.champ.id) continue
    if (e.t < start - 15 * 60_000 || e.t > start + 2 * 60_000) continue
    // Draft d'une autre file (sélection annulée puis autre partie…) : pas cette partie.
    if (e.queue !== undefined && gameTypeOf(e.queue, modeOf(e.queue)) !== r.type) continue
    if (!best || Math.abs(start - e.t) < Math.abs(start - best.t)) best = e
  }
  return best
}

export function computeSelfCheck(reports: GameReport[], log: DraftLogEntry[]): SelfCheck {
  const build = { followed: { games: 0, wins: 0 }, other: { games: 0, wins: 0 } }
  const draft = { followed: { games: 0, wins: 0 }, other: { games: 0, wins: 0 } }
  let expected = 0
  let actualWins = 0
  let calibrated = 0
  let draftGames = 0
  for (const r of reports) {
    if (r.adherence !== null && r.purchases.length >= 2) {
      if (r.adherence >= BUILD_FOLLOWED) add(build.followed, r.win)
      else if (r.adherence <= BUILD_IGNORED) add(build.other, r.win)
    }
    const e = draftEntryFor(r, log)
    if (e) {
      draftGames++
      add(e.rank <= DRAFT_TOP ? draft.followed : draft.other, r.win)
      expected += e.winRate
      if (r.win) actualWins++
      calibrated++
    }
  }
  return {
    build: compare(build.followed, build.other),
    draft: compare(draft.followed, draft.other),
    calibration:
      calibrated >= 10
        ? { games: calibrated, expected: expected / calibrated, actual: actualWins / calibrated }
        : null,
    draftGames
  }
}

// --- Journal de draft (dans le dossier de l'app, via le stockage local du navigateur intégré) ---

const LOG_KEY = 'tactique-draft-log'
const MAX_LOG = 300

export function readDraftLog(): DraftLogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((e) => e && typeof e.t === 'number' && typeof e.champ === 'string')
      : []
  } catch {
    return []
  }
}

export function appendDraftLog(entry: DraftLogEntry): void {
  try {
    const log = readDraftLog().filter(
      (e) => Math.abs(e.t - entry.t) > 60_000 || e.champ !== entry.champ
    )
    log.push(entry)
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)))
  } catch {
    // Facultatif : sans stockage, la draft n'est simplement pas comptée.
  }
}
