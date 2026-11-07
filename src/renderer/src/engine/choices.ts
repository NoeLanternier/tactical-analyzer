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
import { fmtPct, tr } from '../../../shared/i18n'

// Runes, bottes, familier et ordre des compétences choisis selon la partie, à partir des options
// courantes mesurées en Master+ (méta distante). Le choix du build reste la référence : une autre
// option ne le remplace que si elle gagne nettement plus dans des parties qui ressemblent à
// celle-ci (contextes adverses, jungler adverse pour le familier) et repose sur assez de parties.

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

const bayes = (games: number, wr: number, prior: number, k: number): number =>
  (wr * games + prior * k) / (games + k)

/** Écart minimal (taux estimé) pour remplacer l'option du build. */
const MIN_GAIN = 0.01
const MIN_GAMES = 40

interface Scored<T> {
  choice: T
  estimate: number
  bestCtx: { label: string; rate: number } | null
}

/** Taux estimé d'une option dans cette partie (contextes adverses, et un bonus éventuel). */
function score<T extends ChoiceStats>(
  choice: T,
  weights: Partial<Record<SituationContext, number>>,
  prior: number,
  extra: (base: number) => number = () => 0,
  tuning?: EngineTuning
): Scored<T> {
  // Poids des critères réglés par le pipeline de méta (1 sans réglage).
  const base =
    prior + tw(tuning, 'choiceBase') * (bayes(choice.games, choice.winRate, prior, 40) - prior)
  let sum = 0
  let weightSum = 0
  let bestCtx: Scored<T>['bestCtx'] = null
  let bestValue = 0.003
  for (const [ctx, w] of Object.entries(weights) as [SituationContext, number][]) {
    const cell = choice.contexts[ctx]
    if (!cell || w <= 0) continue
    const rate = bayes(cell[0], cell[1], base, 30)
    sum += w * (rate - base)
    weightSum += w
    const label = CONTEXT_LABEL[ctx]
    if (label && w * (rate - base) > bestValue) {
      bestValue = w * (rate - base)
      bestCtx = { label: tr(label[0], label[1]), rate: cell[1] }
    }
  }
  const shift = sum / Math.max(1, weightSum) + extra(base)
  return { choice, estimate: base + tw(tuning, 'choiceCtx') * shift, bestCtx }
}

/** Option à retenir : celle du build, sauf si une autre gagne nettement plus ici. */
function pick<T extends ChoiceStats>(
  list: T[] | undefined,
  isCurrent: (c: T) => boolean,
  weights: Partial<Record<SituationContext, number>>,
  prior: number,
  extra?: (c: T, base: number) => number,
  tuning?: EngineTuning
): Scored<T> | null {
  if (!list || list.length < 2) return null
  const scored = list.map((c) => score(c, weights, prior, (b) => extra?.(c, b) ?? 0, tuning))
  const current = scored.find((s) => isCurrent(s.choice))
  const best = [...scored].sort((a, b) => b.estimate - a.estimate)[0]
  if (!best || best === current || best.choice.games < MIN_GAMES) return null
  if (current && best.estimate - current.estimate < MIN_GAIN) return null
  return best
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
  tuning?: EngineTuning
): AdaptedBuild {
  const choices = build.choices
  const weights = contextWeights(threat)
  const prior = build.winRate ?? 0.5
  const notes: ChoiceNote[] = []
  const next: JunglerBuild = { ...build }

  const runes = pick(
    runeChoices ?? choices?.runes,
    (c) => sameRunes(c.runes, build.runes),
    weights,
    prior,
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
    undefined,
    tuning
  )
  if (boots) {
    next.boots = boots.choice.name
    notes.push({ kind: 'boots', label: boots.choice.name, reason: why(boots) })
  }

  // Familier : aussi selon le jungler adverse.
  const vsBonus = (c: PetChoice, base: number): number => {
    const cell = enemyJungler ? c.vs[enemyJungler.id] : undefined
    return cell ? bayes(cell[0], cell[1], base, 30) - base : 0
  }
  const pet = pick<PetChoice>(
    choices?.pet,
    (c) => norm(c.name) === norm(build.pet ?? ''),
    weights,
    prior,
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
        cell && enemyJungler && vsBonus(pet.choice, pet.estimate) > 0.005
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
