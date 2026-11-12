import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GamePhase, RawPostGame } from '../../../shared/types'
import type { Catalog } from '../engine/catalog'
import { champFromLive, type GameData } from '../engine/gameData'
import { tr, type Lang } from '../../../shared/i18n'
import { isMode, type Role } from '../engine/role'
import { modeOf } from '../../../shared/modes'
import { useRoleCatalogs } from './useRemoteMeta'
import { computeLearning, type Learning } from '../engine/learning'
import {
  analyzeGame,
  FACTS_VERSION,
  normalizeGame,
  repairStoredRoles,
  type GameFacts,
  type GameReport
} from '../engine/postgame'

export type ReviewStatus =
  | { state: 'idle' }
  | { state: 'waiting' }
  | { state: 'importing'; done: number; total: number }
  | { state: 'info'; message: string }
  | { state: 'error'; message: string }

export interface ReviewState {
  reports: GameReport[]
  learning: Learning
  status: ReviewStatus
  /** Bilan de la partie qui vient de se terminer, pas encore consulté. */
  fresh: number | null
  markSeen: () => void
  analyzeLast: () => void
  importRecent: (count: number) => void
}

/** Parties analysées (les plus récentes) : au-delà, elles restent enregistrées sur le disque. */
const MAX_ANALYZED = 120
const END_PHASES: GamePhase[] = ['EndOfGame', 'PreEndOfGame']
const IDLE_PHASES: GamePhase[] = ['Lobby', 'None', 'Matchmaking', 'ReadyCheck', 'ChampSelect']

/* eslint-disable @typescript-eslint/no-explicit-any */
function isFacts(x: any): x is GameFacts {
  return (
    x &&
    x.v === FACTS_VERSION &&
    typeof x.gameId === 'number' &&
    typeof x.me === 'number' &&
    Array.isArray(x.players) &&
    x.players.some((p: any) => p?.pid === x.me) &&
    Array.isArray(x.frames) &&
    Array.isArray(x.items) &&
    Array.isArray(x.kills) &&
    Array.isArray(x.monsters)
  )
}

/**
 * Bilans d'après-partie : détection de la fin de partie, récupération dans l'historique du client,
 * enregistrement, analyse de toutes les parties et apprentissage.
 */
export function useReview(
  gd: GameData | null,
  catalog: Catalog,
  role: Role,
  meta: { url: string; level: 'master' | 'gold' },
  autoReview: boolean,
  lang: Lang
): ReviewState {
  const [facts, setFacts] = useState<GameFacts[]>([])
  const [status, setStatus] = useState<ReviewStatus>({ state: 'idle' })
  const [fresh, setFresh] = useState<number | null>(null)
  const inGameSince = useRef<number | null>(null)
  const busy = useRef(false)
  const autoRef = useRef(autoReview)
  const gdRef = useRef(gd)
  // Poste de la partie en cours (attribué en sélection) : sert au bilan de fin de partie.
  const roleRef = useRef(role)

  useEffect(() => {
    autoRef.current = autoReview
    gdRef.current = gd
    roleRef.current = role
  }, [autoReview, gd, role])

  // Bilans enregistrés.
  useEffect(() => {
    void window.api
      .listReports()
      .then((list) => setFacts(list.filter(isFacts).map(repairStoredRoles)))
  }, [])

  const store = useCallback(async (raw: RawPostGame | null, myRole?: Role): Promise<string> => {
    if (!raw)
      return tr(
        'partie introuvable dans l’historique du client',
        'game not found in the client history'
      )
    const data = gdRef.current
    const f = normalizeGame(
      raw,
      (rawName, name) => (data ? champFromLive(data, rawName, name)?.key : undefined),
      myRole
    )
    if ('skip' in f) return `${tr('partie ignorée', 'game skipped')}: ${f.skip}`
    const res = await window.api.saveReport(f.gameId, f)
    if (!res.success) return `${tr('enregistrement impossible', 'could not save')} (${res.error})`
    setFacts((prev) =>
      [f, ...prev.filter((x) => x.gameId !== f.gameId)].sort((a, b) => b.createdAt - a.createdAt)
    )
    return ''
  }, [])

  // Fin de partie détectée → bilan automatique.
  useEffect(() => {
    const collect = (since: number): void => {
      if (busy.current) return
      busy.current = true
      setStatus({ state: 'waiting' })
      const myRole = roleRef.current
      void window.api
        .waitForFinishedGame(since)
        .then(async (raw) => {
          const error = await store(raw, myRole)
          if (error) setStatus({ state: 'info', message: error })
          else {
            setStatus({ state: 'idle' })
            if (raw) setFresh(raw.gameId)
          }
        })
        .catch((e) => setStatus({ state: 'error', message: String(e?.message ?? e) }))
        .finally(() => {
          busy.current = false
        })
    }
    const onPhase = (p: GamePhase): void => {
      if (p === 'InProgress' || p === 'GameStart') {
        inGameSince.current ??= Date.now()
        return
      }
      const since = inGameSince.current
      if (since === null) return
      if (END_PHASES.includes(p) || IDLE_PHASES.includes(p)) {
        inGameSince.current = null
        if (autoRef.current) collect(since)
      }
    }
    const offs = [
      window.api.onPhaseUpdate(onPhase),
      window.api.onLiveUpdate((d) => {
        if (d && d.gameTime > 60) inGameSince.current ??= Date.now() - d.gameTime * 1000
      })
    ]
    void window.api.getInitialState().then((s) => onPhase(s.phase))
    return () => offs.forEach((off) => off())
  }, [store])

  const analyzeLast = useCallback((): void => {
    if (busy.current) return
    busy.current = true
    setStatus({ state: 'waiting' })
    void (async () => {
      try {
        const recent = await window.api.getRecentGames(1)
        if (!recent.length) {
          setStatus({
            state: 'info',
            message: tr(
              'Aucune partie dans l’historique (client connecté ?)',
              'No game in the history (is the client connected?)'
            )
          })
          return
        }
        const raw = await window.api.getGameDetails(recent[0].gameId)
        const error = await store(raw)
        if (error) setStatus({ state: 'info', message: error })
        else {
          setStatus({ state: 'idle' })
          setFresh(recent[0].gameId)
        }
      } catch (e) {
        setStatus({ state: 'error', message: String((e as Error)?.message ?? e) })
      } finally {
        busy.current = false
      }
    })()
  }, [store])

  const known = useMemo(() => new Set(facts.map((f) => f.gameId)), [facts])

  const importRecent = useCallback(
    (count: number): void => {
      if (busy.current) return
      busy.current = true
      void (async () => {
        try {
          const recent = (await window.api.getRecentGames(count)).filter(
            // Faille et modes pris en charge (ARAM, ARAM Mayhem…) ; pas l'Arène ni TFT.
            (g) => !known.has(g.gameId) && modeOf(g.queueId, null, g.mapId) !== null
          )
          let added = 0
          for (let i = 0; i < recent.length; i++) {
            setStatus({ state: 'importing', done: i, total: recent.length })
            const raw = await window.api.getGameDetails(recent[i].gameId)
            if (!(await store(raw))) added++
          }
          setStatus({
            state: 'info',
            message: recent.length
              ? tr(
                  `${added} partie(s) ajoutée(s) sur ${recent.length} récupérée(s).`,
                  `${added} game(s) added out of ${recent.length} fetched.`
                )
              : tr('Aucune nouvelle partie à importer.', 'No new game to import.')
          })
        } catch (e) {
          setStatus({ state: 'error', message: String((e as Error)?.message ?? e) })
        } finally {
          busy.current = false
        }
      })()
    },
    [known, store]
  )

  // Parties jouées à d'autres postes : la méta de leur poste (builds, repères).
  const otherRoles = useMemo(
    () =>
      [...new Set(facts.slice(0, MAX_ANALYZED).map((f) => f.role ?? 'jungle'))].filter(
        (r) => r !== role
      ),
    [facts, role]
  )
  const others = useRoleCatalogs(otherRoles, meta.url, meta.level)

  // Analyse de toutes les parties enregistrées avec le moteur actuel.
  const reports = useMemo(() => {
    if (!gd) return []
    const out: GameReport[] = []
    for (const f of facts.slice(0, MAX_ANALYZED)) {
      const r = f.role ?? 'jungle'
      const cat = r === role ? catalog : others.get(r)
      // Méta de ce poste pas encore chargée : la partie sera analysée dès qu'elle arrive.
      if (!cat) continue
      try {
        out.push(analyzeGame(gd, cat, f))
      } catch {
        // Partie non analysable avec ces données : ignorée.
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
  }, [gd, catalog, role, others, facts, lang])

  // Apprentissage : parties de la Faille entre elles (tous postes), et chaque mode à part (un
  // objet ou une erreur en ARAM ne dit rien de la Faille, et inversement).
  const learning = useMemo(() => {
    const mode = isMode(role) ? role : null
    return computeLearning(reports.filter((r) => (isMode(r.role) ? r.role : null) === mode))
  }, [reports, role])

  return {
    reports,
    learning,
    status,
    fresh,
    markSeen: () => setFresh(null),
    analyzeLast,
    importRecent
  }
}
