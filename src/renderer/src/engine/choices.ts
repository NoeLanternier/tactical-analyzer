import type {
  ChoiceStats,
  JunglerBuild,
  NamedChoice,
  PetChoice,
  RuneChoice,
  RuneSpec,
  SituationContext,
  SkillChoice
} from '../data/junglers'
import type { Pet } from '../data/junglers'
import type { Catalog, DuelPeriod } from './catalog'
import type { ChampInfo } from './gameData'
import { norm } from './normalize'
import type { ThreatProfile } from './threat'
import { CONTEXT_LABEL, contextWeights } from './variants'
import { tw, type EngineTuning } from './tuning'
import { DEFAULT_PRIORS, shrunk as bayes, type Priors } from './stats'
import { fmtPct, tr } from '../../../shared/i18n'

// Runes, bottes, familier et ordre des compétences choisis selon la partie, à partir des options
// courantes mesurées par la collecte (méta distante). Le choix du build reste la référence : une
// autre option ne le remplace que si son avantage dans des parties qui ressemblent à celle-ci
// (contextes adverses, jungler adverse pour le familier) est établi. Chaque écart est lissé avec la
// force mesurée pour ce type de choix (voir stats.ts) : tant que les données ne distinguent pas
// l'effet d'un contexte du hasard, le choix habituel est gardé.

export interface ChoiceNote {
  kind: 'runes' | 'boots' | 'pet' | 'skills'
  /** Option retenue (nom affichable). */
  label: string
  reason: string
}

export interface AdaptedBuild {
  build: JunglerBuild
  notes: ChoiceNote[]
}

/** Écart minimal (taux estimé, déjà lissé) pour remplacer l'option du build : 0,3 point. */
const MIN_GAIN = 0.003
const MIN_GAMES = 40

interface Scored<T> {
  choice: T
  /** Taux estimé hors contexte, et écart dû aux contextes de cette partie. */
  base: number
  shift: number
  estimate: number
  bestCtx: { label: string; rate: number } | null
}

/** Taux estimé d'une option dans cette partie (contextes adverses, et un bonus éventuel). */
function score<T extends ChoiceStats>(
  choice: T,
  weights: Partial<Record<SituationContext, number>>,
  prior: number,
  k: { base: number; ctx: number },
  extra: (base: number) => number = () => 0,
  tuning?: EngineTuning
): Scored<T> {
  // Poids des critères réglés par le pipeline de méta (1 sans réglage).
  const base =
    prior + tw(tuning, 'choiceBase') * (bayes(choice.games, choice.winRate, prior, k.base) - prior)
  let sum = 0
  let weightSum = 0
  let bestCtx: Scored<T>['bestCtx'] = null
  let bestValue = 0.002
  for (const [ctx, w] of Object.entries(weights) as [SituationContext, number][]) {
    const cell = choice.contexts[ctx]
    if (!cell || w <= 0) continue
    const rate = bayes(cell[0], cell[1], base, k.ctx)
    sum += w * (rate - base)
    weightSum += w
    const label = CONTEXT_LABEL[ctx]
    if (label && w * (rate - base) > bestValue) {
      bestValue = w * (rate - base)
      bestCtx = { label: tr(label[0], label[1]), rate: cell[1] }
    }
  }
  const shift = tw(tuning, 'choiceCtx') * (sum / Math.max(1, weightSum) + extra(base))
  return { choice, base, shift, estimate: base + shift, bestCtx }
}

/**
 * Option à retenir : celle du build (déjà la meilleure en moyenne d'après la collecte), sauf si
 * une autre gagne nettement plus dans cette partie. Seul l'avantage dû au contexte compte : une
 * option moins bonne en moyenne doit d'abord rattraper son retard.
 */
function pick<T extends ChoiceStats>(
  list: T[] | undefined,
  isCurrent: (c: T) => boolean,
  weights: Partial<Record<SituationContext, number>>,
  prior: number,
  k: { base: number; ctx: number },
  extra?: (c: T, base: number) => number,
  tuning?: EngineTuning
): Scored<T> | null {
  if (!list || list.length < 2) return null
  const scored = list.map((c) => score(c, weights, prior, k, (b) => extra?.(c, b) ?? 0, tuning))
  const current = scored.find((s) => isCurrent(s.choice))
  if (!current) return null
  const gain = (s: Scored<T>): number =>
    Math.min(0, s.base - current.base) + (s.shift - current.shift)
  const best = scored
    .filter((s) => s !== current && s.choice.games >= MIN_GAMES)
    .sort((a, b) => gain(b) - gain(a))[0]
  return best && gain(best) >= MIN_GAIN ? best : null
}

const sameRunes = (a: RuneSpec, b: RuneSpec): boolean =>
  norm(a.keystone) === norm(b.keystone) &&
  norm(a.secondaryTree) === norm(b.secondaryTree) &&
  a.primary.every((r, i) => norm(r) === norm(b.primary[i] ?? ''))

const why = (s: Scored<unknown>, extra?: string): string =>
  extra ??
  (s.bestCtx
    ? `${tr('meilleur', 'best')} ${s.bestCtx.label} (${fmtPct(s.bestCtx.rate, 1)})`
    : `${fmtPct(s.estimate, 1)} ${tr('estimé', 'estimated')}`)

/**
 * Adapte les runes, les bottes, le familier et l'ordre des compétences du build à la partie.
 * `runeChoices` : pages de la famille de build suivie (sinon celles du champion).
 */
export function adaptChoices(
  build: JunglerBuild,
  threat: ThreatProfile,
  enemyJungler: ChampInfo | null,
  runeChoices?: RuneChoice[],
  tuning?: EngineTuning,
  priors: Priors = DEFAULT_PRIORS,
  /** Taux de victoire du champion (les options hors runes de famille se comparent à lui). */
  champRate?: number
): AdaptedBuild {
  const choices = build.choices
  const weights = contextWeights(threat)
  const prior = champRate ?? build.winRate ?? 0.5
  const notes: ChoiceNote[] = []
  const next: JunglerBuild = { ...build }
  const kOf = (base: number): { base: number; ctx: number } => ({ base, ctx: priors.choiceCtx })

  // Pages de runes d'une famille de build : comparées au taux de la famille.
  const runes = pick(
    runeChoices ?? choices?.runes,
    (c) => sameRunes(c.runes, build.runes),
    weights,
    runeChoices ? (build.winRate ?? prior) : prior,
    kOf(priors.runes),
    undefined,
    tuning
  )
  if (runes) {
    next.runes = runes.choice.runes
    notes.push({ kind: 'runes', label: runes.choice.runes.keystone, reason: why(runes) })
  }

  const boots = pick<NamedChoice>(
    choices?.boots,
    (c) => norm(c.name) === norm(build.boots),
    weights,
    prior,
    kOf(priors.boots),
    undefined,
    tuning
  )
  if (boots) {
    next.boots = boots.choice.name
    // Bottes choisies d'après les parties de ce contexte : les règles ne les changent plus.
    next.bootsLocked = true
    notes.push({ kind: 'boots', label: boots.choice.name, reason: why(boots) })
  }

  // Familier : aussi selon le jungler adverse.
  const vsBonus = (c: PetChoice, base: number): number => {
    const cell = enemyJungler ? c.vs[enemyJungler.id] : undefined
    return cell ? bayes(cell[0], cell[1], base, priors.choiceCtx) - base : 0
  }
  const pet = pick<PetChoice>(
    choices?.pet,
    (c) => norm(c.name) === norm(build.pet ?? ''),
    weights,
    prior,
    kOf(priors.pet),
    vsBonus,
    tuning
  )
  if (pet) {
    next.pet = pet.choice.name as Pet
    const cell = enemyJungler ? pet.choice.vs[enemyJungler.id] : undefined
    notes.push({
      kind: 'pet',
      label: pet.choice.name,
      reason: why(
        pet,
        cell && enemyJungler && vsBonus(pet.choice, pet.base) > 0.002
          ? `${fmtPct(cell[1], 1)} vs ${enemyJungler.label}`
          : undefined
      )
    })
  }

  const skills = pick<SkillChoice>(
    choices?.skills,
    (c) => c.value === build.skills,
    weights,
    prior,
    kOf(priors.skills),
    undefined,
    tuning
  )
  if (skills) {
    next.skills = skills.choice.value
    notes.push({
      kind: 'skills',
      label: skills.choice.value.replace(/>/g, ' > '),
      reason: why(skills)
    })
  }
  return { build: next, notes }
}

export interface JunglerMatchup {
  enemy: ChampInfo
  /** Combats contre ce jungler par période : [combats, part gagnée par toi]. */
  duels: Partial<Record<DuelPeriod, [number, number]>>
  /** Ta part de combats gagnés tous junglers confondus, par période (repère). */
  baseline: Partial<Record<DuelPeriod, [number, number]>>
  /** Début de partie habituel du jungler adverse. */
  opening: NonNullable<NonNullable<Catalog['junglerStats']>[string]['opening']> | null
}

/**
 * Affrontement de junglers avant la partie : combats gagnés par période (statistiques Master+)
 * et début de partie habituel du jungler adverse. Rien ne dépend de ce qui se passe en partie.
 */
export function junglerMatchup(
  catalog: Catalog,
  me: ChampInfo,
  enemy: ChampInfo
): JunglerMatchup | null {
  const stats = catalog.junglerStats
  if (!stats) return null
  const mine = stats[me.id]?.duels?.[enemy.id]
  // Sinon, les statistiques du point de vue de l'adversaire, inversées.
  const theirs = stats[enemy.id]?.duels?.[me.id]
  const duels: JunglerMatchup['duels'] = {}
  for (const p of ['early', 'mid', 'late'] as DuelPeriod[]) {
    if (mine?.[p]) duels[p] = mine[p]
    else if (theirs?.[p]) duels[p] = [theirs[p]![0], 1 - theirs[p]![1]]
  }
  const opening = stats[enemy.id]?.opening ?? null
  if (!Object.keys(duels).length && !opening) return null
  return { enemy, duels, baseline: stats[me.id]?.duels?._all ?? {}, opening }
}
