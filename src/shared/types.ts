// Types partagés entre le processus main, le preload et l'interface.
// Aucun code exécutable ici : uniquement des types.
import type { Lang, LanguageSetting } from './i18n'

export type LcuStatus = 'disconnected' | 'connecting' | 'connected'

export type GamePhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | 'Reconnect'
  | 'TerminatedInError'
  | string

export interface DraftPlayer {
  cellId: number
  championId: number
  /** Position assignée par le client ("jungle", "top"...), vide en partie normale/blind. */
  position: string
  spell1Id: number
  spell2Id: number
}

export interface DraftState {
  /** Champion survolé ou verrouillé par le joueur local (0 = aucun). */
  localChampId: number
  isLocked: boolean
  /** Position du joueur local ("jungle", "top", "", ...). */
  position: string
  /** Le joueur local a Châtiment (11) dans ses sorts. */
  hasSmite: boolean
  allyIds: number[]
  enemyIds: number[]
  /** Champions bannis (des deux équipes). */
  bannedIds: number[]
  /** C'est au joueur local de bannir / de choisir maintenant. */
  banTurn: boolean
  pickTurn: boolean
  /** Phase du minuteur de sélection : PLANNING, BAN_PICK, FINALIZATION... */
  timerPhase: string
}

/** Champions du joueur : maîtrise (points) et champions possédés ou gratuits. */
export interface ChampionPool {
  mastery: { championId: number; points: number }[]
  owned: number[]
}

export type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

export const EMPTY_DRAFT: DraftState = {
  localChampId: 0,
  isLocked: false,
  position: '',
  hasSmite: false,
  allyIds: [],
  enemyIds: [],
  bannedIds: [],
  banTurn: false,
  pickTurn: false,
  timerPhase: ''
}

export interface RunePagePayload {
  name: string
  primaryStyleId: number
  subStyleId: number
  /** 9 identifiants : 6 runes (keystone + 3 primaires + 2 secondaires) puis 3 fragments. */
  selectedPerkIds: number[]
}

export interface ItemSetBlock {
  type: string
  items: { id: string; count: number }[]
}

export interface ItemSetPayload {
  title: string
  championId: number
  blocks: ItemSetBlock[]
}

export interface ActionResult {
  success: boolean
  error?: string
}

/** Page de runes recommandée par le client Riot (normalisée). */
export interface RecommendedRunePage {
  primaryStyleId: number
  subStyleId: number
  perkIds: number[]
  keystoneId: number
  summonerSpellIds: number[]
}

export interface LiveItem {
  itemID: number
  count: number
  slot: number
}

export interface LivePlayer {
  championName: string
  rawChampionName: string
  /** Poste en partie (« TOP », « JUNGLE »… ; vide si inconnu). */
  position: string
  riotId: string
  summonerName: string
  team: 'ORDER' | 'CHAOS' | string
  level: number
  isDead: boolean
  items: LiveItem[]
  scores: { kills: number; deaths: number; assists: number; creepScore: number; wardScore: number }
}

/** Élimination d'un champion (événements de l'API en jeu). Noms : Riot ID sans le tag. */
export interface LiveKill {
  t: number
  killer: string
  victim: string
  assisters: string[]
}

export interface LiveGameData {
  gameTime: number
  /** Éliminations de champions depuis le début de la partie. */
  kills?: LiveKill[]
  activePlayer: {
    riotId: string
    summonerName: string
    currentGold: number
    level: number
  } | null
  allPlayers: LivePlayer[]
}

export type RuneSource = 'auto' | 'tactique' | 'riot'

export interface Settings {
  /** Injection automatique de la page de runes. */
  autoRunes: boolean
  /** Si toutes les pages sont utilisées, remplacer la page active (sinon : message d'erreur). */
  replaceActivePageIfFull: boolean
  /** Envoyer l'ordre d'items adaptatif dans la boutique en jeu (set d'items du client). */
  autoItemSet: boolean
  /** Origine des runes : auto (base tactique si à jour, sinon Riot), base tactique, ou recommandations Riot. */
  runeSource: RuneSource
  /** Côté de l'écran où s'affiche l'overlay. */
  side: 'left' | 'right'
  /** URL du JSON de méta (builds, statistiques). Vide : méta officielle (DEFAULT_META_URL). */
  metaUrl: string
  /**
   * Niveau des données : auto = selon le rang classé (Or à Émeraude jusqu'à Émeraude, Master+ à
   * partir de Diamant), ou imposé.
   */
  metaLevel: 'auto' | 'master' | 'gold'
  /** Poste joué : auto = poste attribué en sélection (sinon détecté en partie), ou imposé. */
  role: 'auto' | 'top' | 'jungle' | 'mid' | 'bot' | 'support'
  /** Journal de debug dans le dossier de l'application. */
  debug: boolean
  /**
   * Jeton GitHub en lecture seule pour les mises à jour depuis un dépôt privé (vide : dépôt
   * public). Gardé seulement dans les réglages locaux.
   */
  updateToken: string
  /** Lancer l'application au démarrage de Windows. */
  launchAtStartup: boolean
  /** Bilan automatique en fin de partie. */
  autoReview: boolean
  /** Adapter le build à vos propres résultats (apprentissage à partir des bilans). */
  personalLearning: boolean
  /** Langue de l'application : auto = langue du client League of Legends. */
  language: LanguageSetting
}

/** Méta officielle, recalculée chaque nuit à partir des parties Master+ (dépôt tactique-meta). */
export const DEFAULT_META_URL =
  'https://raw.githubusercontent.com/NoeLanternier/tactique-meta/main/meta.json'

export const DEFAULT_SETTINGS: Settings = {
  autoRunes: true,
  replaceActivePageIfFull: false,
  autoItemSet: true,
  runeSource: 'auto',
  side: 'left',
  metaUrl: DEFAULT_META_URL,
  metaLevel: 'auto',
  role: 'auto',
  debug: false,
  updateToken: '',
  launchAtStartup: true,
  autoReview: true,
  personalLearning: true,
  language: 'auto'
}

/** Partie de l'historique du client. */
export interface RecentGame {
  gameId: number
  createdAt: number
  queueId: number
  mapId: number
}

/** Données brutes d'après-partie lues dans le client (format de l'historique Riot). */
/**
 * Journal enregistré pendant la partie à partir de l'API en jeu (toutes les 2 s) : l'historique du
 * client ne contient pas les achats d'objets, ce journal permet d'en connaître le minutage exact.
 */
export interface GameJournal {
  /** Heure (ms) correspondant au début de la partie. */
  startedAt: number
  /** Temps de jeu (s) du premier relevé : au-delà de ~2 min, l'app a été ouverte en cours de partie. */
  from: number
  lastTime: number
  /** Indice du joueur local dans players (-1 si inconnu). */
  me: number
  /** position : poste selon l'API en jeu (« TOP », « UTILITY »…), vide si inconnu. */
  players: { champ: string; raw: string; team: string; position?: string }[]
  /** [seconde, indice du joueur, objet, op] : 1 = apparu dans l'inventaire, 0 = disparu. */
  items: [number, number, number, number][]
  /** [seconde, or en poche] du joueur local. */
  gold: [number, number][]
}

export interface RawPostGame {
  gameId: number
  game: unknown
  timeline: unknown
  puuid: string
  summonerId: number
  /** Dernier journal de partie enregistré (rattaché si les champions correspondent). */
  journal?: GameJournal | null
}

export interface TactiqueApi {
  onDraftUpdate: (cb: (draft: DraftState) => void) => () => void
  onPhaseUpdate: (cb: (phase: GamePhase) => void) => () => void
  onLcuStatus: (cb: (status: LcuStatus) => void) => () => void
  onLiveUpdate: (cb: (data: LiveGameData | null) => void) => () => void
  onTogglePin: (cb: () => void) => () => void
  getInitialState: () => Promise<{
    status: LcuStatus
    phase: GamePhase
    draft: DraftState
    lang: Lang
  }>
  /** Langue effective (réglage, ou langue du client LoL en mode auto). */
  onLangUpdate: (cb: (lang: Lang) => void) => () => void
  applyRunes: (payload: RunePagePayload) => Promise<ActionResult>
  applyItemSet: (payload: ItemSetPayload) => Promise<ActionResult>
  getRecommendedRunes: (championId: number, position: string) => Promise<RecommendedRunePage[]>
  getChampionPool: () => Promise<ChampionPool>
  /** Rang classé solo du joueur ('GOLD', 'UNRANKED'…), null si inconnu. */
  getRankedTier: () => Promise<string | null>
  getAppInfo: () => Promise<{ version: string; update: UpdateStatus }>
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  checkForUpdates: () => void
  installUpdate: () => void
  getSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<Settings>
  fetchMetaOverride: (url: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  /** Dernière méta reçue pour cette URL, gardée sur le disque (démarrage rapide, hors ligne). */
  getCachedMeta: (url: string) => Promise<{ data: unknown; savedAt: string } | null>
  /** Attend la partie qui vient de se terminer (jusqu'à 4 min) et la renvoie. */
  waitForFinishedGame: (sinceMs: number) => Promise<RawPostGame | null>
  getRecentGames: (count: number) => Promise<RecentGame[]>
  getGameDetails: (gameId: number) => Promise<RawPostGame | null>
  /** Bilans enregistrés (données compactes de chaque partie), les plus récents d'abord. */
  listReports: () => Promise<unknown[]>
  saveReport: (gameId: number, facts: unknown) => Promise<ActionResult>
  openReportsFolder: () => void
  setOverlayMode: (expanded: boolean) => void
  closeApp: () => void
}
