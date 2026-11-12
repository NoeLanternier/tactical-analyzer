// Modes de jeu pris en charge en plus de la Faille de l'invocateur (parties classées et normales).
//
// Chaque mode a sa méta (meta-aram.json, meta-mayhem.json…), ses builds, ses statistiques et ses
// repères, comme un poste de la Faille. Les files (identifiants de queue) viennent des données du
// client (queues.json) ; le mode du jeu (« ARAM », « KIWI »…) sert de secours quand la file est
// inconnue (application lancée en pleine partie sans le client).

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
  /** Runes utilisables (désactivées en ARAM Mayhem, vérifié sur les données de la collecte). */
  runes: boolean
  /** Mode temporaire : présent seulement certaines semaines. */
  temporary: boolean
  /** Or de départ. */
  startGold: number
}

export const MODES: Record<ModeKey, ModeInfo> = {
  aram: {
    key: 'aram',
    name: ['ARAM', 'ARAM'],
    queues: [450, 62, 63, 64, 65, 930, 931],
    gameModes: ['ARAM'],
    map: 12,
    allRandom: true,
    recall: false,
    wards: false,
    augments: false,
    runes: true,
    temporary: false,
    startGold: 1400
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
    startGold: 1400
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
    startGold: 1400
  },
  arurf: {
    key: 'arurf',
    name: ['ARURF', 'ARURF'],
    queues: [900, 1010, 318, 319],
    gameModes: ['ARURF', 'SNOWURF'],
    map: 11,
    allRandom: true,
    recall: true,
    wards: true,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500
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
    startGold: 500
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
    startGold: 500
  },
  brawl: {
    key: 'brawl',
    name: ['Mêlée', 'Brawl'],
    queues: [2300],
    gameModes: ['BRAWL'],
    map: 0,
    allRandom: false,
    recall: true,
    wards: false,
    augments: false,
    runes: true,
    temporary: true,
    startGold: 500
  }
}

export const MODE_KEYS = Object.keys(MODES) as ModeKey[]

/** Files de la Faille de l'invocateur : classées, normales, rapides, Clash, contre l'IA. */
const SR_QUEUES = new Set([400, 420, 430, 440, 480, 490, 700, 720, 830, 840, 850, 870, 880, 890])

export const isModeKey = (x: unknown): x is ModeKey =>
  typeof x === 'string' && (MODE_KEYS as string[]).includes(x)

/**
 * Mode d'une partie : 'sr' (Faille de l'invocateur, postes), un mode pris en charge, ou null (mode
 * non pris en charge : Arène, TFT…). La file prime ; le mode du jeu sert de secours.
 */
export function modeOf(
  queueId: number | null | undefined,
  gameMode?: string | null,
  mapId?: number | null
): ModeKey | 'sr' | null {
  const q = Number(queueId) || 0
  if (q > 0) {
    if (SR_QUEUES.has(q)) return 'sr'
    for (const m of MODE_KEYS) if (MODES[m].queues.includes(q)) return m
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

/** Nom affiché d'un mode. */
export function modeName(key: ModeKey, lang: 'fr' | 'en'): string {
  return MODES[key].name[lang === 'en' ? 1 : 0]
}
