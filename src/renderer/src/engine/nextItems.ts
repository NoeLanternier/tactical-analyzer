import type { NextStats } from '../data/junglers'
import type { ThreatProfile } from './threat'
import { contextWeights, stateWeights } from './variants'

// Objet suivant (4e au 6e objet) : même estimation que la collecte (tactique-meta,
// src/nextItems.mjs), qui la vérifie chaque nuit sur les parties du lendemain.
//
// Pour un objet candidat : son écart propre pour le champion (victoires en plus par achat à avance
// égale), les interactions avec les objets déjà possédés (pondérées par ce que chacun distingue :
// un objet que presque tout le monde a déjà ne dit rien de plus), et celles avec la composition
// adverse et l'avance ou le retard. Score = pente × (écart + γ × part des joueurs qui le prennent),
// la pente et γ étant réglés par le backtest (meta.nextModel).

export interface NextModel {
  /** Poids de la popularité (part des joueurs qui prennent l'objet après les mêmes objets). */
  gamma: number
  /** Pente de calibration des écarts (1 : bien calibrés). */
  slope: number
  /** Réglé par le backtest (sinon : valeurs par défaut). */
  measured: boolean
  decisions: number
}

export const DEFAULT_NEXT_MODEL: NextModel = {
  gamma: 0.05,
  slope: 1,
  measured: false,
  decisions: 0
}

export interface NextEstimate {
  /** Écart estimé (0,01 = 1 point de victoire), à avance égale. */
  lift: number
  /** Part des joueurs qui le prennent après ces objets. */
  share: number
  games: number
  /** Presque jamais pris avec l'un des objets possédés. */
  excluded: boolean
  /** Objet possédé avec lequel il va le mieux (interaction pondérée), pour l'explication. */
  best: { item: string; value: number } | null
}

/** Estimation pour un objet candidat (null : jamais acheté à ce stade par ce champion). */
export function nextEstimate(
  next: NextStats | undefined,
  item: string,
  owned: string[],
  contexts: [string, number][] = []
): NextEstimate | null {
  const b = next?.base?.[item]
  if (!b) return null
  let inter = 0
  let weight = 0
  let shareSum = 0
  let shared = 0
  let excluded = false
  let best: NextEstimate['best'] = null
  for (const j of owned) {
    const grp = next.after?.[j]
    if (!grp) continue
    const w = Math.max(0, Math.min(1, 1 - grp.t / Math.max(1, next.n ?? grp.t)))
    const cell = grp.i?.[item]
    inter += w * (cell ? cell[1] : 0)
    weight += w
    if (cell && (!best || w * cell[1] > best.value)) best = { item: j, value: w * cell[1] }
    if (grp.t >= 30) {
      shareSum += cell ? cell[2] : 0
      shared++
    }
    // (absent de la liste : moins de 5 achats après lui, alors qu'on en attendrait au moins 12.)
    if (!cell && grp.t >= 300 && b[2] >= 0.04) excluded = true
  }
  let ctxSum = 0
  let ctxWeight = 0
  for (const [x, w] of contexts) {
    const byItem = next.ctx?.[x]
    if (!byItem || !(w > 0)) continue
    ctxSum += w * (byItem[item]?.[1] ?? 0)
    ctxWeight += w
  }
  return {
    lift: b[1] + (weight >= 0.05 ? inter / weight : 0) + ctxSum / Math.max(1, ctxWeight),
    share: shared ? shareSum / shared : b[2],
    games: b[0],
    excluded,
    best: best && weight >= 0.05 ? { item: best.item, value: best.value / weight } : null
  }
}

/** Score d'un candidat (même échelle que l'écart : 0,01 ≈ 1 point). */
export const nextScore = (e: NextEstimate, model: NextModel): number =>
  model.slope * (e.lift + model.gamma * e.share)

/**
 * Contextes de la partie pour l'objet suivant, avec leur poids de 0 à 1 : composition adverse
 * (dégâts magiques ou physiques, soins, résistance, contrôles), et en partie, avance ou retard.
 */
export function nextContexts(threat: ThreatProfile): [string, number][] {
  const w = { ...contextWeights(threat), ...stateWeights(threat) }
  return (Object.entries(w) as [string, number][]).filter(([, x]) => x > 0)
}

/* eslint-disable @typescript-eslint/no-explicit-any -- lecture de JSON distant, vérifié champ par champ */

/** Lecture de build.next (méta distante) ; null si absent ou mal formé. */
export function parseNext(raw: unknown): NextStats | undefined {
  const r = raw as any
  if (!r || typeof r !== 'object' || typeof r.n !== 'number' || !r.base) return undefined
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const triple = (v: any): v is [number, number, number] =>
    Array.isArray(v) && num(v[0]) && num(v[1]) && num(v[2])
  const base: NextStats['base'] = {}
  for (const [k, v] of Object.entries<any>(r.base))
    if (triple(v)) base[k] = [v[0], Math.max(-0.1, Math.min(0.1, v[1])), v[2]]
  if (!Object.keys(base).length) return undefined
  const after: NextStats['after'] = {}
  for (const [k, g] of Object.entries<any>(r.after ?? {})) {
    if (!num(g?.t) || !g.i || typeof g.i !== 'object') continue
    const i: Record<string, [number, number, number]> = {}
    for (const [item, v] of Object.entries<any>(g.i))
      if (triple(v)) i[item] = [v[0], Math.max(-0.1, Math.min(0.1, v[1])), v[2]]
    after[k] = { t: g.t, i }
  }
  const ctx: NextStats['ctx'] = {}
  for (const [x, byItem] of Object.entries<any>(r.ctx ?? {})) {
    if (!byItem || typeof byItem !== 'object') continue
    const m: Record<string, [number, number]> = {}
    for (const [item, v] of Object.entries<any>(byItem))
      if (Array.isArray(v) && num(v[0]) && num(v[1]))
        m[item] = [v[0], Math.max(-0.1, Math.min(0.1, v[1]))]
    ctx[x] = m
  }
  return { n: r.n, base, after, ctx }
}

/** Lecture de meta.nextModel (valeurs par défaut si absent). */
export function parseNextModel(raw: unknown): NextModel | undefined {
  const r = raw as any
  if (!r || typeof r !== 'object') return undefined
  const gamma = Number(r.gamma)
  const slope = Number(r.slope)
  if (!Number.isFinite(gamma) || !Number.isFinite(slope)) return undefined
  return {
    gamma: Math.max(0, Math.min(1, gamma)),
    slope: Math.max(0, Math.min(2, slope)),
    measured: r.measured === true,
    decisions: Number(r.decisions) || 0
  }
}
