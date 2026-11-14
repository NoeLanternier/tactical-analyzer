import type { LivePlayer } from '../../../shared/types'
import type { BuildVariant, JunglerBuild, SituationContext } from '../data/junglers'
import type { ItemCounters } from './catalog'
import { baseItemId, type GameData, type ItemInfo } from './gameData'
import { FOE_TRAIT_LABEL } from './itemTraits'
import { clamp01, norm } from './normalize'
import { threatWeight, type ThreatProfile } from './threat'
import { tw, type EngineTuning } from './tuning'
import { DEFAULT_PRIORS, shrunk as bayes, type Priors } from './stats'
import { fmtPct, tr } from '../../../shared/i18n'

// Choix de la famille de build (ex. Graves crit ou létalité, Diana AP ou tank) :
// - en partie, la famille déjà commencée (objet ou composants achetés) est suivie ;
// - sinon, celle qui gagne le plus dans des parties qui ressemblent à celle-ci : contextes
//   adverses mesurés en Master+, objets de la famille face aux adversaires présents, et dégâts
//   qui manquent à l'équipe.

export interface VariantOption {
  variant: BuildVariant
  /** Taux de victoire estimé dans cette partie. */
  estimate: number
}

export interface VariantChoice {
  /** Build à suivre (celui du champion, avec le cœur, les runes et les options de la famille). */
  build: JunglerBuild
  chosen: VariantOption | null
  /** Toutes les familles, de la meilleure à la moins bonne. */
  options: VariantOption[]
  /** Famille imposée par les achats déjà faits. */
  locked: boolean
  reason: string | null
}

/**
 * Poids de chaque contexte de composition adverse dans cette partie (familles de build, choix de
 * runes, score des objets).
 */
export function contextWeights(threat: ThreatProfile): Partial<Record<SituationContext, number>> {
  if (threat.enemies.length === 0) return {}
  const m = threat.metrics
  return {
    ap: clamp01((m.ap - 0.5) / 0.3),
    ad: clamp01((m.ad - 0.5) / 0.3),
    heal: m.heal,
    tank: m.tanky,
    cc: m.cc
  }
}

/**
 * Poids des contextes « en avance » et « en retard » (objets) : l'écart d'or des objets entre les
 * deux équipes, 2 % d'écart ne comptant pas et 10 % comptant pleinement. Le retard personnel compte
 * aussi (voir threat.ts).
 */
export function stateWeights(threat: ThreatProfile): Partial<Record<SituationContext, number>> {
  if (!threat.live) return {}
  const m = threat.metrics
  return {
    ahead: clamp01((0.25 * m.ahead - 0.02) / 0.08),
    behind: clamp01((0.25 * m.behind - 0.02) / 0.08)
  }
}

export const CONTEXT_LABEL: Partial<Record<SituationContext, [string, string]>> = {
  ap: ['vs AP', 'vs AP'],
  ad: ['vs AD', 'vs AD'],
  heal: ['vs soins', 'vs healing'],
  tank: ['vs tanks', 'vs tanks'],
  cc: ['vs contrôles', 'vs CC']
}

/**
 * Effet moyen des objets face aux adversaires présents (champions pondérés par leur avance, et
 * types d'objets adverses en partie), d'après la méta distante.
 */
export function counterLift(
  itemName: string,
  threat: ThreatProfile,
  counters: ItemCounters | undefined
): { lift: number; best: { foe: string; lift: number; games: number } | null } {
  // foe : nom affiché de l'adversaire ou du type d'objet adverse le plus marquant.
  const row = counters?.[itemName]
  if (!row || threat.enemies.length === 0) return { lift: 0, best: null }
  const totalPower = threat.enemies.reduce((s, e) => s + threatWeight(e), 0) || 1
  const mean = totalPower / threat.enemies.length
  let lift = 0
  let best: { foe: string; lift: number; games: number } | null = null
  const add = (label: string, value: number, games: number): void => {
    lift += value
    if (!best || Math.abs(value) > Math.abs(best.lift)) best = { foe: label, lift: value, games }
  }
  for (const e of threat.enemies) {
    const cell = row[e.champ.id]
    if (cell) add(e.champ.label, cell[1] * (threatWeight(e) / mean), cell[0])
  }
  for (const t of threat.foeTraits) {
    const cell = row[`#${t}`]
    if (cell) add(tr(...FOE_TRAIT_LABEL[t]), cell[1], cell[0])
  }
  return { lift, best }
}

/** L'objet se construit-il (directement ou non) à partir de ce composant ? */
function buildsFrom(gd: GameData, item: ItemInfo, componentId: number, depth = 0): boolean {
  if (depth > 4) return false
  return item.from.some((id) => {
    if (id === componentId) return true
    const sub = gd.items.get(id)
    return sub ? buildsFrom(gd, sub, componentId, depth + 1) : false
  })
}

/** Famille commencée : premier objet possédé, ou composants achetés pour lui. */
function startedVariant(
  gd: GameData,
  variants: BuildVariant[],
  me: LivePlayer | null
): BuildVariant | null {
  if (!me) return null
  // (objet qui a évolué : sa forme achetée, Étreinte du séraphin → Bâton de l'archange.)
  const owned = me.items
    .map((i) => gd.items.get(baseItemId(gd, i.itemID)))
    .filter((i): i is ItemInfo => !!i)
  const ownedNames = new Set(owned.map((i) => norm(i.name)))
  // 1. Le premier objet de la famille est possédé.
  const byKey = variants.find((v) => ownedNames.has(norm(v.key)))
  if (byKey) return byKey
  // 2. Un autre objet du cœur est possédé (ordre d'achat différent).
  const byCore = variants
    .map((v) => ({ v, n: v.core.filter((c) => ownedNames.has(norm(c))).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)[0]
  if (byCore) return byCore.v
  // 3. Un composant cher du premier objet est acheté.
  const components = owned.filter((i) => !i.isLegendary && !i.isBoots && i.total >= 700)
  return (
    variants.find((v) => {
      const first = gd.itemsByName.get(norm(v.key))
      return first && components.some((c) => buildsFrom(gd, first, c.id))
    }) ?? null
  )
}

/** Nom affiché d'un objet (langue de l'app). */
export const itemLabel = (gd: GameData, name: string): string =>
  gd.itemsByName.get(norm(name))?.label ?? name

const asBuild = (build: JunglerBuild, v: BuildVariant): JunglerBuild => ({
  ...build,
  archetype: v.archetype,
  pet: v.pet,
  boots: v.boots,
  core: v.core,
  options: v.options,
  skills: v.skills || build.skills,
  runes: v.runes,
  games: v.games,
  winRate: v.winRate
})

export function chooseVariant(
  gd: GameData,
  build: JunglerBuild,
  threat: ThreatProfile,
  me: LivePlayer | null,
  counters?: ItemCounters,
  tuning?: EngineTuning,
  priors: Priors = DEFAULT_PRIORS
): VariantChoice {
  const variants = build.variants ?? []
  if (variants.length < 2) return { build, chosen: null, options: [], locked: false, reason: null }

  const prior = build.winRate ?? 0.5
  const weights = contextWeights(threat)
  const allyAp = threat.allyDamage?.ap ?? null
  const reasons = new Map<BuildVariant, string>()
  const topShare = Math.max(0.01, ...variants.map((v) => v.share))

  const options = variants
    .map((v) => {
      // Écart de la famille, lissé avec la force mesurée par la collecte (voir stats.ts) ; a priori,
      // la famille la plus jouée est un peu meilleure (lien popularité → victoire mesuré).
      const mu = priors.slope.item * Math.log2(Math.max(v.share, 0.01) / topShare)
      const base =
        prior +
        mu +
        tw(tuning, 'famBase') * (bayes(v.games, v.winRate - mu, prior, priors.fam) - prior)
      // Contextes adverses de la partie.
      let sum = 0
      let weightSum = 0
      let bestCtx: { label: string; rate: number; value: number } | null = null
      for (const [ctx, w] of Object.entries(weights) as [SituationContext, number][]) {
        const cell = v.contexts[ctx]
        if (!cell || w <= 0) continue
        const rate = bayes(cell[0], cell[1], base, priors.famCtx)
        sum += w * (rate - base)
        weightSum += w
        const label = CONTEXT_LABEL[ctx]
        if (label && w * (rate - base) > (bestCtx?.value ?? 0.002))
          bestCtx = { label: tr(label[0], label[1]), rate: cell[1], value: w * (rate - base) }
      }
      let estimate = base + (tw(tuning, 'famCtx') * sum) / Math.max(1, weightSum)

      // Objets du cœur face aux adversaires présents.
      const counter = v.core.reduce((s, item) => s + counterLift(item, threat, counters).lift, 0)
      estimate += (0.5 * tw(tuning, 'counter') * counter) / v.core.length

      // Dégâts qui manquent à l'équipe.
      const coreItems = v.core
        .map((n) => gd.itemsByName.get(norm(n)))
        .filter((i): i is ItemInfo => !!i)
      const apItems = coreItems.filter((i) => (i.stats.FlatMagicDamageMod ?? 0) > 0).length
      const apShare = coreItems.length ? apItems / coreItems.length : 0.5
      if (allyAp !== null) {
        if ((allyAp < 0.3 && apShare >= 0.67) || (allyAp > 0.7 && apShare <= 0.34)) estimate += 0.01
        else if ((allyAp < 0.3 && apShare <= 0.34) || (allyAp > 0.7 && apShare >= 0.67))
          estimate -= 0.005
      }

      reasons.set(
        v,
        bestCtx
          ? `${tr('meilleur', 'best')} ${bestCtx.label} (${fmtPct(bestCtx.rate, 1)})`
          : `${fmtPct(v.winRate, 1)} ${tr('sur', 'over')} ${v.games} ${tr('parties', 'games')}`
      )
      return { variant: v, estimate }
    })
    .sort((a, b) => b.estimate - a.estimate)

  const started = startedVariant(gd, variants, me)
  if (started) {
    const chosen = options.find((o) => o.variant === started)!
    return {
      build: asBuild(build, started),
      chosen,
      options,
      locked: true,
      reason: tr(
        `build commencé (${itemLabel(gd, started.key)})`,
        `build already started (${itemLabel(gd, started.key)})`
      )
    }
  }
  const chosen = options[0]
  return {
    build: asBuild(build, chosen.variant),
    chosen,
    options,
    locked: false,
    reason: reasons.get(chosen.variant) ?? null
  }
}
