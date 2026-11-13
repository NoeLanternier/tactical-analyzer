// Modes de jeu pris en charge en plus de la Faille de l'invocateur (parties classées et normales).
//
// Chaque mode a sa méta (meta-aram.json, meta-urf.json…), ses builds, ses statistiques et ses
// repères, comme un poste de la Faille. Les files (identifiants de queue) viennent des données du
// client (queues.json) ; le mode du jeu (« ARAM », « KIWI »…) sert de secours quand la file est
// inconnue (application lancée en pleine partie sans le client).
//
// Modes privés : Riot ne publie pas leurs parties (ARAM Mayhem et ses variantes, Mêlée), il n'y a
// donc pas de méta collectée. ARAM Mayhem reprend la méta ARAM (même carte, mêmes objets) ; ses
// augments sont classés d'après ce qu'ils renforcent et les parties du joueur.

export type ModeKey = 'aram' | 'mayhem' | 'mayhem-classic' | 'arurf' | 'urf' | 'ofa' | 'brawl'

export interface ModeInfo {
  key: ModeKey
  /** Nom affiché [français, anglais]. */
  name: [string, string]
  /** Files de ce mode (la première est celle que la collecte interroge). */
  queues: number[]
  /** Modes du jeu (API en jeu, champ gameMode) correspondant à ce mode. */
  gameModes: string[]
  /** Carte : 12 = Abîme hurlant, 11 = Faille de l'invocateur. */
  map: number
  /** Champions tirés au hasard (banc et relances) plutôt que choisis. */
  allRandom: boolean
  /** Retour à la base possible (sinon : achats seulement à la mort ou à la fontaine). */
  recall: boolean
  /** Balises achetables (vision). */
  wards: boolean
  /** Augments à choisir pendant la partie (ARAM Mayhem). */
  augments: boolean
  /** Runes utilisables (désactivées en ARAM Mayhem : vérifié en partie et dans l'historique). */
  runes: boolean
  /** Mode temporaire : présent seulement certaines semaines. */
  temporary: boolean
  /** Parties non publiées par Riot dans son API : pas de méta collectée pour ce mode. */
  privateData: boolean
  /** Méta d'un autre mode utilisée à la place (mode privé joué sur la même carte). */
  metaFrom?: ModeKey
  /** Or de départ. */
  startGold: number
}

export const MODES: Record<ModeKey, ModeInfo> = {
  aram: {
    key: 'aram',
    name: ['ARAM', 'ARAM'],
    queues: [450, 62, 63, 64, 65, 930, 931, 720, 721, 451, 452, 860, 861, 3200, 3210, 3220, 3230],
    gameModes: ['ARAM'],
    map: 12,
    allRandom: true,
    recall: false,
    wards: false,
    augments: false,
    runes: true,
    temporary: false,
    startGold: 1400,
    privateData: false
  },
  mayhem: {
    key: 'mayhem',
    name: ['ARAM Mayhem', 'ARAM: Mayhem'],
    queues: [2400, 2401, 2403, 2405, 2410, 3240, 3270],
    gameModes: ['KIWI'],
    map: 12,
    allRandom: true,
    recall: false,
    wards: false,
    augments: true,
    runes: false,
    temporary: false,
    startGold: 1400,
    privateData: true,
    metaFrom: 'aram'
  },
  'mayhem-classic': {
    key: 'mayhem-classic',
    name: ['ARAM Mayhem « classique »', 'ARAM: Mayhem Classic-ish'],
    queues: [2450, 3280],
    gameModes: ['KIWI_JADE'],
    map: 12,
    allRandom: true,
    recall: false,
    wards: false,
    augments: true,
    runes: true,
    temporary: true,
    startGold: 1400,
    privateData: true,
    metaFrom: 'aram'
  },
  arurf: {
    key: 'arurf',
    name: ['ARURF', 'ARURF'],
    queues: [900, 1010, 1011, 1012, 318, 319],
    gameModes: ['ARURF', 'SNOWURF'],
    map: 11,
    allRandom: true,
    recall: true,
    wards: true,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500,
    privateData: false
  },
  urf: {
    key: 'urf',
    name: ['URF', 'URF'],
    queues: [1900],
    gameModes: ['URF'],
    map: 11,
    allRandom: false,
    recall: true,
    wards: true,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500,
    privateData: false
  },
  ofa: {
    key: 'ofa',
    name: ['Un pour tous', 'One for All'],
    queues: [1020],
    gameModes: ['ONEFORALL'],
    map: 11,
    allRandom: false,
    recall: true,
    wards: true,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500,
    privateData: false
  },
  brawl: {
    key: 'brawl',
    name: ['Mêlée', 'Brawl'],
    queues: [2300, 2301, 2302, 2303, 2304, 2305],
    gameModes: ['BRAWL'],
    map: 0,
    allRandom: false,
    recall: true,
    wards: false,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500,
    privateData: true
  }
}

export const MODE_KEYS = Object.keys(MODES) as ModeKey[]

/**
 * Files de la Faille de l'invocateur (queues.json du client). Classées : solo/duo, flexible, 5s.
 * Normales (mêmes règles que les classées) : draft, Clash, et les anciennes « blind » et « rapide ».
 * Swiftplay : partie accélérée (niveau 3 et 1 400 PO au départ, or et expérience augmentés, Baron
 * à 12 min), à mesurer à part.
 */
const RANKED_QUEUES = new Set([420, 421, 422, 440, 441, 442, 710])
const NORMAL_QUEUES = new Set([400, 401, 402, 403, 430, 431, 432, 433, 490, 700, 701])
const SWIFT_QUEUES = new Set([480])
/** Parties à moins de 5 contre 5 (ARAM 1v1 et 3v3, Mêlée 1v1…). */
const SMALL_QUEUES = new Set([451, 452, 2301, 2302, 2303, 2304, 2305])

const isBotsQueue = (q: number): boolean =>
  (q >= 800 && q < 900) || (q >= 4200 && q < 4300) || q === 4320 || q === 4321
/** Personnalisées (0, 3100 à 3299 dont l'outil d'entraînement) et tutoriels (2000 à 2099). */
const isCustomQueue = (q: number): boolean =>
  q === 0 || (q >= 3100 && q < 3300) || (q >= 2000 && q < 2100)

export const isModeKey = (x: unknown): x is ModeKey =>
  typeof x === 'string' && (MODE_KEYS as string[]).includes(x)

/**
 * Mode d'une partie : 'sr' (Faille de l'invocateur, postes), un mode pris en charge, ou null (mode
 * non pris en charge : Arène, TFT…). La file prime ; le mode du jeu sert de secours. Sert aux
 * conseils (builds du mode, y compris en partie personnalisée ou contre l'IA) ; ce qui compte dans
 * les statistiques est décidé par gameTypeOf.
 */
export function modeOf(
  queueId: number | null | undefined,
  gameMode?: string | null,
  mapId?: number | null
): ModeKey | 'sr' | null {
  const q = Number(queueId) || 0
  if (q > 0) {
    for (const m of MODE_KEYS) if (MODES[m].queues.includes(q)) return m
    if (RANKED_QUEUES.has(q) || NORMAL_QUEUES.has(q) || SWIFT_QUEUES.has(q)) return 'sr'
    // Contre l'IA, personnalisées, tutoriels sur la Faille (l'ARAM contre l'IA est dans MODES).
    if (
      (isBotsQueue(q) || (q >= 3100 && q < 3200) || (q >= 2000 && q < 2100)) &&
      !(Number(mapId) > 0 && Number(mapId) !== 11)
    )
      return 'sr'
  }
  const g = String(gameMode ?? '').toUpperCase()
  if (g) {
    if (g === 'CLASSIC' || g === 'PRACTICETOOL' || g === 'TUTORIAL')
      return Number(mapId) === 11 || !mapId ? 'sr' : null
    for (const m of MODE_KEYS) if (MODES[m].gameModes.includes(g)) return m
    return null
  }
  // File inconnue (personnalisée…) : la carte décide.
  if (Number(mapId) === 11) return 'sr'
  if (Number(mapId) === 12) return 'aram'
  return q > 0 ? null : 'sr'
}

/** Nature de la file : ce qui compte (ou non) dans les statistiques. */
export type QueueKind = 'ranked' | 'normal' | 'swift' | 'mode' | 'bots' | 'custom' | 'small'

export function queueKind(queueId: number | null | undefined, gameType?: string | null): QueueKind {
  const q = Number(queueId) || 0
  if (String(gameType ?? '').toUpperCase() === 'CUSTOM_GAME' || isCustomQueue(q)) return 'custom'
  if (isBotsQueue(q)) return 'bots'
  if (SMALL_QUEUES.has(q)) return 'small'
  if (RANKED_QUEUES.has(q)) return 'ranked'
  if (SWIFT_QUEUES.has(q)) return 'swift'
  if (NORMAL_QUEUES.has(q)) return 'normal'
  return 'mode'
}

/**
 * Type de partie pour les statistiques (bilans, apprentissage, « L'app t'aide-t-elle ? ») : les
 * classées, les normales et Swiftplay de la Faille à part, chaque mode à part. Null : partie
 * jamais comptée (contre l'IA, personnalisée, tutoriel, moins de 5 contre 5, mode inconnu).
 */
export type GameType = 'ranked' | 'normal' | 'swift' | ModeKey

export function gameTypeOf(
  queueId: number | null | undefined,
  mode: ModeKey | 'sr' | null,
  gameType?: string | null
): GameType | null {
  const k = queueKind(queueId, gameType)
  if (k === 'bots' || k === 'custom' || k === 'small' || mode === null) return null
  if (mode !== 'sr') return mode
  return k === 'ranked' || k === 'normal' || k === 'swift' ? k : null
}

/**
 * Famille de règles : les classées et les normales de la Faille se jouent avec les mêmes règles,
 * ce que tu y apprends (objets, points faibles) vaut pour les deux. Swiftplay et chaque mode à part.
 */
export const rulesFamily = (t: GameType): string => (t === 'ranked' || t === 'normal' ? 'sr' : t)

const TYPE_NAMES: Record<'ranked' | 'normal' | 'swift', [string, string]> = {
  ranked: ['Classées', 'Ranked'],
  normal: ['Normales', 'Normal'],
  swift: ['Swiftplay', 'Swiftplay']
}

/** Nom d'un type de partie (au pluriel : « Classées », « Normales »…). */
export function gameTypeName(t: GameType, lang: 'fr' | 'en'): string {
  const i = lang === 'en' ? 1 : 0
  return t === 'ranked' || t === 'normal' || t === 'swift' ? TYPE_NAMES[t][i] : MODES[t].name[i]
}

const QUEUE_NAMES: Record<number, [string, string]> = {
  420: ['Classée solo/duo', 'Ranked Solo/Duo'],
  440: ['Classée flexible', 'Ranked Flex'],
  710: ['Classée 5s', 'Ranked 5s'],
  400: ['Normale (draft)', 'Normal Draft'],
  430: ['Normale (aveugle)', 'Normal Blind'],
  490: ['Partie rapide', 'Quickplay'],
  700: ['Clash', 'Clash'],
  720: ['Clash ARAM', 'ARAM Clash'],
  480: ['Swiftplay', 'Swiftplay']
}

const TYPE_SINGULAR: Record<'ranked' | 'normal' | 'swift', [string, string]> = {
  ranked: ['Classée', 'Ranked'],
  normal: ['Normale', 'Normal'],
  swift: ['Swiftplay', 'Swiftplay']
}

/** Nom de la file d'une partie (« Classée solo/duo », « Clash »…), sinon celui du type. */
export function queueName(queueId: number, type: GameType | null, lang: 'fr' | 'en'): string {
  const i = lang === 'en' ? 1 : 0
  const q = QUEUE_NAMES[queueId]
  if (q) return q[i]
  if (!type) return '?'
  return type === 'ranked' || type === 'normal' || type === 'swift'
    ? TYPE_SINGULAR[type][i]
    : MODES[type].name[i]
}

/** Nom affiché d'un mode. */
export function modeName(key: ModeKey, lang: 'fr' | 'en'): string {
  return MODES[key].name[lang === 'en' ? 1 : 0]
}
