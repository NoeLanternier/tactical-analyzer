// Poids des critères du moteur, réglés chaque nuit par le pipeline de méta (tactique-meta,
// src/tuning.mjs) : chaque critère est multiplié par son coefficient, mesuré sur les nouvelles
// parties Master+ avec la méta de la veille. 1 = poids d'origine. Sans réglage (méta intégrée, ou
// trop peu de parties), tous les coefficients valent 1.

export const TUNING_KEYS = [
  'pick',
  'vs',
  'pairs',
  'famBase',
  'famCtx',
  'choiceBase',
  'choiceCtx',
  'counter'
] as const
export type TuningKey = (typeof TUNING_KEYS)[number]

export interface EngineTuning {
  /** Parties utilisées pour le réglage. */
  games: number
  weights: Record<TuningKey, number>
}

export const MIN_TUNING_GAMES = 2000

/** Coefficient d'un critère (1 sans réglage). */
export const tw = (tuning: EngineTuning | undefined | null, key: TuningKey): number =>
  tuning?.weights[key] ?? 1

export function parseTuning(data: unknown): EngineTuning | undefined {
  if (!data || typeof data !== 'object') return undefined
  const raw = data as { games?: unknown; weights?: unknown }
  const games = typeof raw.games === 'number' && Number.isFinite(raw.games) ? raw.games : 0
  if (games < MIN_TUNING_GAMES || !raw.weights || typeof raw.weights !== 'object') return undefined
  const given = raw.weights as Record<string, unknown>
  const weights = {} as Record<TuningKey, number>
  for (const k of TUNING_KEYS) {
    const v = given[k]
    weights[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1
  }
  return { games, weights }
}
