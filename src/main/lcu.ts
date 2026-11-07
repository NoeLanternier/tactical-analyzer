import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  authenticate,
  createHttp1Request,
  createWebSocketConnection,
  type Credentials,
  type LeagueWebSocket
} from 'league-connect'
import {
  EMPTY_DRAFT,
  type ActionResult,
  type ChampionPool,
  type DraftState,
  type GamePhase,
  type ItemSetPayload,
  type LcuStatus,
  type RawPostGame,
  type RecentGame,
  type RecommendedRunePage,
  type RunePagePayload
} from '../shared/types'
import { debugLog } from './logger'
import { tr } from '../shared/i18n'

/** Préfixe des pages de runes et sets d'items créés par l'application. */
export const TACTIQUE_TAG = 'Tactique'
const SMITE_ID = 11
const RESET_PHASES = ['None', 'Lobby', 'Matchmaking', 'EndOfGame', 'TerminatedInError']

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface LcuResponse<T> {
  ok: boolean
  status: number
  data: T | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Connexion au client League of Legends (LCU).
 * - se reconnecte automatiquement si le client est fermé puis relancé ;
 * - lit l'état initial (utile si l'app est lancée en pleine sélection) ;
 * - émet 'status', 'phase' et 'draft'.
 */
export class LcuService extends EventEmitter {
  status: LcuStatus = 'disconnected'
  phase: GamePhase = 'None'
  draft: DraftState = EMPTY_DRAFT
  /** Langue du client League of Legends ("fr_FR", "en_US"...), null si inconnue. */
  locale: string | null = null

  private credentials: Credentials | null = null
  private ws: LeagueWebSocket | null = null
  private running = false
  private lastDraftKey = ''

  start(): void {
    if (this.running) return
    this.running = true
    void this.connectLoop()
  }

  stop(): void {
    this.running = false
    this.ws?.close()
  }

  private async connectLoop(): Promise<void> {
    while (this.running) {
      try {
        this.setStatus('connecting')
        this.credentials = await authenticate({ awaitConnection: true, pollInterval: 3000 })
        const ws = await createWebSocketConnection({
          authenticationOptions: { awaitConnection: true, pollInterval: 3000 },
          pollInterval: 2000,
          maxRetries: -1
        })
        this.ws = ws
        const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
        this.subscribe(ws)
        this.setStatus('connected')
        debugLog('lcu', { connected: this.credentials.port })
        await this.loadInitialState()
        await closed
      } catch (error) {
        debugLog('lcu', { error: String(error) })
      }
      this.ws = null
      this.credentials = null
      this.setStatus('disconnected')
      this.setPhase('None')
      this.setDraft(EMPTY_DRAFT)
      await sleep(3000)
    }
  }

  private subscribe(ws: LeagueWebSocket): void {
    ws.subscribe('/lol-gameflow/v1/gameflow-phase', (data) => {
      if (typeof data === 'string') this.setPhase(data)
    })
    ws.subscribe('/lol-champ-select/v1/session', (data, event: any) => {
      // À la fin de la sélection, le client envoie un événement "Delete" sans données : on garde
      // le dernier état (le champion reste utile pendant le chargement de la partie).
      if (!data || event?.eventType === 'Delete') return
      this.processSession(data)
    })
  }

  private async loadInitialState(): Promise<void> {
    try {
      const loc = await this.request<any>('GET', '/riotclient/region-locale')
      const locale = typeof loc.data?.locale === 'string' ? loc.data.locale : null
      if (loc.ok && locale && locale !== this.locale) {
        this.locale = locale
        this.emit('locale', locale)
      }
    } catch (error) {
      debugLog('lcu', { localeError: String(error) })
    }
    try {
      const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
      if (phase.ok && typeof phase.data === 'string') this.setPhase(phase.data)
      if (this.phase === 'ChampSelect') {
        const session = await this.request<any>('GET', '/lol-champ-select/v1/session')
        if (session.ok && session.data) this.processSession(session.data)
      }
    } catch (error) {
      debugLog('lcu', { initialStateError: String(error) })
    }
  }

  private processSession(data: any): void {
    if (!data || !Array.isArray(data.myTeam) || data.localPlayerCellId === undefined) return
    const localCellId: number = data.localPlayerCellId
    const myTeam: any[] = data.myTeam
    const theirTeam: any[] = Array.isArray(data.theirTeam) ? data.theirTeam : []
    const actions: any[] = Array.isArray(data.actions) ? data.actions.flat() : []

    const me = myTeam.find((p) => p.cellId === localCellId)
    const localChampId: number = me ? me.championId || me.championPickIntent || 0 : 0

    const myPickActions = actions.filter((a) => a.actorCellId === localCellId && a.type === 'pick')
    let isLocked = myPickActions.some((a) => a.completed)
    // Modes sans action de pick (ARAM, aléatoire...) : un championId définitif vaut verrouillage.
    if (myPickActions.length === 0 && me?.championId) isLocked = true
    if (data.timer?.phase === 'FINALIZATION' && me?.championId) isLocked = true

    const inProgress = (type: string): boolean =>
      actions.some(
        (a) => a.actorCellId === localCellId && a.type === type && a.isInProgress && !a.completed
      )
    const bannedIds = new Set<number>()
    for (const a of actions)
      if (a.type === 'ban' && a.completed && a.championId > 0) bannedIds.add(a.championId)
    for (const id of [...(data.bans?.myTeamBans ?? []), ...(data.bans?.theirTeamBans ?? [])])
      if (id > 0) bannedIds.add(id)

    const draft: DraftState = {
      localChampId,
      isLocked,
      position: String(me?.assignedPosition || '').toLowerCase(),
      hasSmite: me?.spell1Id === SMITE_ID || me?.spell2Id === SMITE_ID,
      allyIds: myTeam
        .filter((p) => p.cellId !== localCellId)
        .map((p) => p.championId || p.championPickIntent || 0)
        .filter((id: number) => id > 0),
      // Les intentions de pick adverses ne sont pas visibles : on ne lit que les choix confirmés.
      enemyIds: theirTeam.map((p) => p.championId || 0).filter((id: number) => id > 0),
      bannedIds: [...bannedIds],
      banTurn: inProgress('ban'),
      pickTurn: inProgress('pick'),
      timerPhase: String(data.timer?.phase ?? '')
    }
    debugLog('draft', { phase: this.phase, timer: data.timer?.phase, draft })
    this.setDraft(draft)
  }

  // --- Requêtes ----------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown
  ): Promise<LcuResponse<T>> {
    if (!this.credentials)
      throw new Error(
        tr('Client League of Legends non connecté', 'League of Legends client not connected')
      )
    const res = await createHttp1Request(
      { method, url, body: body as Record<string, unknown> | undefined },
      this.credentials
    )
    let data: T | null
    try {
      const text = res.text()
      data = text ? (JSON.parse(text) as T) : null
    } catch {
      data = null
    }
    return { ok: res.ok, status: res.status, data }
  }

  private static errorMessage(res: LcuResponse<any>): string {
    const msg = res.data && typeof res.data === 'object' ? res.data.message : ''
    return msg ? `${res.status} – ${msg}` : `code ${res.status}`
  }

  /**
   * Crée ou met à jour la page de runes "Tactique".
   * Ne touche jamais aux pages du joueur, sauf si l'option "remplacer la page active" est activée
   * et qu'il n'y a plus de place pour une nouvelle page.
   */
  async applyRunePage(payload: RunePagePayload, replaceIfFull: boolean): Promise<ActionResult> {
    try {
      if (payload.selectedPerkIds.length !== 9 || !payload.primaryStyleId || !payload.subStyleId) {
        return { success: false, error: tr('Page de runes incomplète', 'Incomplete rune page') }
      }
      const pagesRes = await this.request<any[]>('GET', '/lol-perks/v1/pages')
      if (!pagesRes.ok || !Array.isArray(pagesRes.data)) {
        return {
          success: false,
          error: `${tr('Lecture des pages impossible', 'Cannot read rune pages')} (${LcuService.errorMessage(pagesRes)})`
        }
      }
      const pages = pagesRes.data
      const body = {
        name: `${TACTIQUE_TAG}: ${payload.name}`.slice(0, 25),
        primaryStyleId: payload.primaryStyleId,
        subStyleId: payload.subStyleId,
        selectedPerkIds: payload.selectedPerkIds,
        current: true
      }

      const ours = pages.filter(
        (p) => p.isEditable && typeof p.name === 'string' && p.name.startsWith(TACTIQUE_TAG)
      )
      if (ours.length > 0) {
        const put = await this.request('PUT', `/lol-perks/v1/pages/${ours[0].id}`, body)
        if (put.ok) return { success: true }
        // Mise à jour refusée : on supprime nos anciennes pages et on en recrée une.
        for (const p of ours) await this.request('DELETE', `/lol-perks/v1/pages/${p.id}`)
      }

      const post = await this.request('POST', '/lol-perks/v1/pages', body)
      if (post.ok) return { success: true }

      if (replaceIfFull) {
        const target =
          pages.find((p) => p.isEditable && p.current) ?? pages.find((p) => p.isEditable)
        if (target) {
          const put = await this.request('PUT', `/lol-perks/v1/pages/${target.id}`, body)
          if (put.ok) return { success: true }
          return {
            success: false,
            error: `${tr('Remplacement refusé', 'Replacement refused')} (${LcuService.errorMessage(put)})`
          }
        }
      }
      return {
        success: false,
        error: tr(
          `Création refusée (${LcuService.errorMessage(post)}). Libère une page de runes ou active « Remplacer la page active ».`,
          `Creation refused (${LcuService.errorMessage(post)}). Free a rune page or enable “Replace the active page”.`
        )
      }
    } catch (error) {
      return { success: false, error: String((error as Error)?.message ?? error) }
    }
  }

  /** Maîtrise des champions et champions jouables du joueur (pour les conseils de pick). */
  /** Rang classé solo/duo du joueur connecté ('GOLD', 'UNRANKED'…), null si inconnu. */
  async getRankedTier(): Promise<string | null> {
    if (!this.credentials) return null
    try {
      const res = await this.request<any>('GET', '/lol-ranked/v1/current-ranked-stats')
      if (!res.ok) return null
      const tier = res.data?.queueMap?.RANKED_SOLO_5x5?.tier
      if (typeof tier !== 'string') return null
      return tier && tier.toUpperCase() !== 'NONE' ? tier.toUpperCase() : 'UNRANKED'
    } catch {
      return null
    }
  }

  async getChampionPool(): Promise<ChampionPool> {
    const pool: ChampionPool = { mastery: [], owned: [] }
    if (!this.credentials) return pool
    try {
      let mastery = await this.request<any[]>(
        'GET',
        '/lol-champion-mastery/v1/local-player/champion-mastery'
      )
      if (!mastery.ok || !Array.isArray(mastery.data)) {
        const summoner = await this.request<any>('GET', '/lol-summoner/v1/current-summoner')
        const id = summoner.data?.summonerId
        if (id)
          mastery = await this.request<any[]>(
            'GET',
            `/lol-collections/v1/inventories/${id}/champion-mastery`
          )
      }
      if (mastery.ok && Array.isArray(mastery.data)) {
        pool.mastery = mastery.data
          .map((m) => ({ championId: Number(m.championId), points: Number(m.championPoints ?? 0) }))
          .filter((m) => m.championId > 0)
          .sort((a, b) => b.points - a.points)
      }
      const owned = await this.request<any[]>('GET', '/lol-champions/v1/owned-champions-minimal')
      if (owned.ok && Array.isArray(owned.data)) {
        pool.owned = owned.data
          .filter((c) => c?.ownership?.owned || c?.ownership?.rental?.rented || c?.freeToPlay)
          .map((c) => Number(c.id))
          .filter((id) => id > 0)
      }
    } catch (error) {
      debugLog('lcu', { poolError: String(error) })
    }
    return pool
  }

  /** Pages recommandées par Riot (données du patch en cours) pour un champion et un poste. */
  async getRecommendedRunes(championId: number, position: string): Promise<RecommendedRunePage[]> {
    if (!this.credentials || !championId) return []
    const pos = position || 'jungle'
    const candidates = Array.from(new Set([pos.toUpperCase(), pos.toLowerCase()]))
    for (const p of candidates) {
      try {
        const res = await this.request<any[]>(
          'GET',
          `/lol-perks/v1/recommended-pages/champion/${championId}/position/${p}/map/11`
        )
        if (!res.ok || !Array.isArray(res.data)) continue
        const pages = res.data
          .map((page): RecommendedRunePage => {
            const rawPerks: any[] = Array.isArray(page.perks)
              ? page.perks
              : Array.isArray(page.perkIds)
                ? page.perkIds
                : []
            const perkIds = rawPerks
              .map((x) => (typeof x === 'number' ? x : Number(x?.id)))
              .filter((x) => Number.isFinite(x) && x > 0)
            return {
              primaryStyleId: Number(page.primaryPerkStyleId ?? page.primaryStyleId ?? 0),
              subStyleId: Number(page.secondaryPerkStyleId ?? page.subStyleId ?? 0),
              perkIds,
              keystoneId: Number(page.keystone?.id ?? perkIds[0] ?? 0),
              summonerSpellIds: Array.isArray(page.summonerSpellIds) ? page.summonerSpellIds : []
            }
          })
          .filter((page) => page.perkIds.length === 9 && page.primaryStyleId && page.subStyleId)
        if (pages.length > 0) return pages
      } catch (error) {
        debugLog('lcu', { recommendedError: String(error) })
      }
    }
    return []
  }

  /**
   * Écrit le set d'items "Tactique" dans le client : il apparaît dans la boutique en jeu.
   * Les sets créés par le joueur sont conservés.
   */
  async applyItemSet(payload: ItemSetPayload): Promise<ActionResult> {
    try {
      const summoner = await this.request<any>('GET', '/lol-summoner/v1/current-summoner')
      if (!summoner.ok || !summoner.data?.summonerId) {
        return { success: false, error: tr('Invocateur introuvable', 'Summoner not found') }
      }
      const { summonerId, accountId } = summoner.data
      const url = `/lol-item-sets/v1/item-sets/${summonerId}/sets`
      const current = await this.request<any>('GET', url)
      if (!current.ok) {
        return {
          success: false,
          error: `${tr('Lecture des sets impossible', 'Cannot read item sets')} (${LcuService.errorMessage(current)})`
        }
      }
      const existing: any[] = Array.isArray(current.data?.itemSets) ? current.data.itemSets : []
      const kept = existing.filter(
        (s) => !(typeof s?.title === 'string' && s.title.startsWith(TACTIQUE_TAG))
      )
      const newSet = {
        title: `${TACTIQUE_TAG}: ${payload.title}`,
        type: 'custom',
        map: 'any',
        mode: 'any',
        priority: false,
        sortrank: 0,
        startedFrom: 'blank',
        uid: randomUUID(),
        associatedChampions: [payload.championId],
        associatedMaps: [11],
        preferredItemSlots: [],
        blocks: payload.blocks.map((b) => ({
          type: b.type,
          hideIfSummonerSpell: '',
          showIfSummonerSpell: '',
          items: b.items
        }))
      }
      const put = await this.request('PUT', url, {
        accountId: current.data?.accountId ?? accountId,
        itemSets: [...kept, newSet],
        timestamp: Date.now()
      })
      if (!put.ok)
        return {
          success: false,
          error: `${tr('Set refusé', 'Item set refused')} (${LcuService.errorMessage(put)})`
        }
      return { success: true }
    } catch (error) {
      return { success: false, error: String((error as Error)?.message ?? error) }
    }
  }

  // --- Après-partie ----------------------------------------------------------------------

  /** Identifiants des dernières parties du joueur (les plus récentes d'abord). */
  async getRecentGames(count: number): Promise<RecentGame[]> {
    if (!this.credentials) return []
    const res = await this.request<any>(
      'GET',
      `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${Math.max(1, Math.min(count, 100))}`
    )
    if (!res.ok || !res.data) return []
    const list: any[] = Array.isArray(res.data?.games?.games)
      ? res.data.games.games
      : Array.isArray(res.data?.games)
        ? res.data.games
        : []
    return list
      .map((g) => ({
        gameId: Number(g.gameId),
        createdAt: Number(g.gameCreation ?? 0),
        queueId: Number(g.queueId ?? 0),
        mapId: Number(g.mapId ?? 0)
      }))
      .filter((g) => g.gameId > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Partie qui vient de se terminer (écran de fin de partie). */
  async getEndOfGameId(): Promise<number | null> {
    if (!this.credentials) return null
    try {
      const res = await this.request<any>('GET', '/lol-end-of-game/v1/eog-stats-block')
      const id = Number(res.data?.gameId ?? 0)
      return res.ok && id > 0 ? id : null
    } catch {
      return null
    }
  }

  /** Détail complet d'une partie et sa chronologie (minute par minute), avec le puuid du joueur. */
  async getGameDetails(gameId: number): Promise<RawPostGame | null> {
    if (!this.credentials) return null
    const game = await this.request<any>('GET', `/lol-match-history/v1/games/${gameId}`)
    const participants = game.data?.participants ?? game.data?.info?.participants
    if (!game.ok || !Array.isArray(participants) || participants.length < 2) return null
    let timeline: unknown = null
    try {
      const tl = await this.request<any>('GET', `/lol-match-history/v1/game-timelines/${gameId}`)
      if (tl.ok) timeline = tl.data
    } catch (error) {
      debugLog('postgame', { timelineError: String(error) })
    }
    const summoner = await this.request<any>('GET', '/lol-summoner/v1/current-summoner')
    return {
      gameId,
      game: game.data,
      timeline,
      puuid: String(summoner.data?.puuid ?? ''),
      summonerId: Number(summoner.data?.summonerId ?? 0)
    }
  }

  /**
   * Récupère la partie qui vient de se terminer : l'historique du client met parfois une à deux
   * minutes à l'enregistrer, on réessaie donc pendant quelques minutes.
   */
  async waitForFinishedGame(
    sinceMs: number,
    timeoutMs = 4 * 60 * 1000
  ): Promise<RawPostGame | null> {
    const deadline = Date.now() + timeoutMs
    let gameId = await this.getEndOfGameId()
    while (Date.now() < deadline && this.credentials) {
      try {
        if (!gameId) {
          const recent = await this.getRecentGames(3)
          const candidate = recent.find((g) => g.createdAt >= sinceMs - 15 * 60 * 1000)
          if (candidate) gameId = candidate.gameId
        }
        if (gameId) {
          const details = await this.getGameDetails(gameId)
          if (details) return details
        }
      } catch (error) {
        debugLog('postgame', { waitError: String(error) })
      }
      await sleep(10000)
    }
    return null
  }

  // --- État ------------------------------------------------------------------------------

  private setStatus(status: LcuStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit('status', status)
  }

  private setPhase(phase: GamePhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.emit('phase', phase)
    if (RESET_PHASES.includes(phase)) this.setDraft(EMPTY_DRAFT)
  }

  private setDraft(draft: DraftState): void {
    const key = JSON.stringify(draft)
    if (key === this.lastDraftKey) return
    this.lastDraftKey = key
    this.draft = draft
    this.emit('draft', draft)
  }
}
