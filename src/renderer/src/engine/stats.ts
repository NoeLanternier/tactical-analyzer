// Lissage bayésien empirique, côté app.
//
// Un taux de victoire observé sur n parties s'écarte du vrai taux d'environ 50 / √n points (±5
// points sur 100 parties), alors que les vrais écarts entre deux options sont de l'ordre d'un
// point. La collecte mesure donc, pour chaque famille de statistiques, la taille des vrais écarts
// et publie le nombre de parties « a priori » k correspondant (champ `priors` de la méta). Un écart
// observé sur n parties vaut alors, au mieux, n / (n + k) fois cet écart.

export interface Priors {
  /** Affrontement direct (adversaire de voie, jungler adverse). */
  vs: number
  /** Synergie avec un allié, affrontement avec un adversaire hors voie. */
  pair: number
  /** Champion face à un type de composition adverse. */
  comp: number
  /** Famille de build (premier objet), et famille selon la composition adverse. */
  fam: number
  famCtx: number
  runes: number
  keystone: number
  boots: number
  skills: number
  start: number
  pet: number
  /** Choix (runes, bottes…) selon la composition adverse. */
  choiceCtx: number
  /** Objet comparé aux autres objets achetés au même rang. */
  slot: number
  /** Points de taux gagnés quand la part d'une option double. */
  slope: { item: number; skills: number; start: number }
}

/** Valeurs mesurées en novembre 2026, utilisées tant que la méta n'en publie pas. */
export const DEFAULT_PRIORS: Priors = {
  vs: 1000,
  pair: 20000,
  comp: 1500,
  fam: 5000,
  famCtx: 5000,
  runes: 2000,
  keystone: 4000,
  boots: 2000,
  skills: 4000,
  start: 5000,
  pet: 10000,
  choiceCtx: 3000,
  slot: 1000,
  slope: { item: 0.003, skills: 0.003, start: 0.003 }
}

const num = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null

/** Lissages publiés par la méta (undefined si la méta n'en a pas : collecte plus ancienne). */
export function parsePriors(raw: unknown): Priors | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (num(r.vs) === null) return undefined
  const out: Priors = { ...DEFAULT_PRIORS, slope: { ...DEFAULT_PRIORS.slope } }
  for (const key of Object.keys(DEFAULT_PRIORS) as (keyof Priors)[]) {
    if (key === 'slope') continue
    const v = num(r[key])
    if (v !== null) out[key] = Math.max(100, Math.min(50000, v))
  }
  const slope = r.slope as Record<string, unknown> | undefined
  for (const key of ['item', 'skills', 'start'] as const) {
    const v = slope?.[key]
    if (typeof v === 'number' && Number.isFinite(v))
      out.slope[key] = Math.max(0, Math.min(0.005, v))
  }
  return out
}

/** Taux estimé : taux observé sur `games` parties, ramené vers `prior` avec une force `k`. */
export const shrunk = (games: number, rate: number, prior: number, k: number): number =>
  (rate * games + prior * k) / (games + k)

export const logit = (p: number): number => Math.log(p / (1 - p))
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
