import type { ItemSetPayload, LivePlayer } from '../../../shared/types'
import {
  ANTI_HEAL,
  ARCHETYPE_POOLS,
  BOOTS,
  ITEM_RULES,
  POTION,
  UNIQUE_GROUPS,
  type Archetype,
  type Metric
} from '../data/items'
import type { JunglerBuild, SituationContext } from '../data/junglers'
import type { ItemCounters } from './catalog'
import { baseItemId, type GameData, type ItemInfo } from './gameData'
import { norm } from './normalize'
import type { ThreatProfile } from './threat'
import { contextWeights, counterLift, stateWeights } from './variants'
import {
  DEFAULT_NEXT_MODEL,
  nextContexts,
  nextEstimate,
  nextScore,
  type NextEstimate,
  type NextModel
} from './nextItems'
import { fmtNumber, fmtPct, gold, tr } from '../../../shared/i18n'

export type StepKind = 'starter' | 'core' | 'boots' | 'antiheal' | 'situational' | 'owned'

export interface BuildStep {
  item: ItemInfo
  kind: StepKind
  owned: boolean
  /** Explication courte (« vs Syndra fed », « anti-soins »...). */
  reason?: string
  /** L'objet a remplacé un objet du cœur à cause de la partie. */
  swapped?: boolean
}

export interface NextBuy {
  item: ItemInfo
  remaining: number
  affordable: boolean
  /** Composant le plus cher achetable maintenant si l'objet complet ne l'est pas. */
  component: ItemInfo | null
  /** Inventaire plein : objet à vendre pour faire de la place. */
  sellHint?: string
  /**
   * Build terminé : échange conseillé (vendre `sell`, puis acheter l'objet), quand la partie a
   * changé au point qu'un autre objet vaut nettement plus que celui-ci, revente comprise.
   */
  swap?: { sell: ItemInfo; refund: number; reason?: string }
}

/** 6 emplacements : bottes + 5 objets légendaires (le familier se vend en fin de partie). */
const MAX_LEGENDARIES = 5

/** Élixir à acheter une fois le build terminé. */
const ELIXIR: Record<Archetype, string> = {
  AD_FIGHTER: 'Elixir of Wrath',
  AD_ASSASSIN: 'Elixir of Wrath',
  AD_CARRY: 'Elixir of Wrath',
  AP_FIGHTER: 'Elixir of Sorcery',
  AP_BURST: 'Elixir of Sorcery',
  TANK: 'Elixir of Iron',
  ENCHANTER: 'Elixir of Sorcery'
}

export interface ItemPlan {
  starter: ItemInfo[]
  steps: BuildStep[]
  /** Autres bons choix si la partie évolue. */
  alternatives: BuildStep[]
  next: NextBuy | null
  unresolved: string[]
}

// Un objet peut appartenir à plusieurs groupes (ex. Rappel mortel : pénétration + anti-soins).
const groupsOf = new Map<string, number[]>()
UNIQUE_GROUPS.forEach((g, i) =>
  g.forEach((name) => groupsOf.set(norm(name), [...(groupsOf.get(norm(name)) ?? []), i]))
)

function conflicts(a: ItemInfo, b: ItemInfo): boolean {
  if (a.id === b.id || norm(a.name) === norm(b.name)) return true
  const ga = groupsOf.get(norm(a.name)) ?? []
  const gb = groupsOf.get(norm(b.name)) ?? []
  return ga.some((g) => gb.includes(g))
}

const METRIC_LABEL: Partial<Record<Metric, [string, string]>> = {
  ap: ['dégâts magiques', 'magic damage'],
  ad: ['dégâts physiques', 'physical damage'],
  mixed: ['dégâts mixtes', 'mixed damage'],
  tanky: ['adversaires résistants', 'tanky enemies'],
  armorStack: ['armure adverse', 'enemy armor'],
  mrStack: ['RM adverse', 'enemy MR'],
  cc: ['contrôles', 'crowd control'],
  heal: ['anti-soins', 'anti-heal'],
  shield: ['boucliers', 'shields'],
  burst: ['burst adverse', 'enemy burst'],
  crit: ['critiques adverses', 'enemy crits'],
  aa: ['attaques de base', 'auto attacks'],
  ahead: ['avance', 'ahead'],
  behind: ['retard', 'behind']
}
const metricLabel = (m: Metric): string | undefined => {
  const l = METRIC_LABEL[m]
  return l ? tr(l[0], l[1]) : undefined
}

interface Scored {
  item: ItemInfo
  score: number
  reason?: string
  defensive: boolean
}

const CONTEXT_LABEL: Record<SituationContext, [string, string]> = {
  all: ['souvent construit', 'often built'],
  ap: ['construit vs AP', 'built vs AP'],
  ad: ['construit vs AD', 'built vs AD'],
  heal: ['construit vs soins', 'built vs healing'],
  tank: ['construit vs tanks', 'built vs tanks'],
  cc: ['construit vs contrôles', 'built vs CC'],
  allyAp: ['construit avec alliés AP', 'built with AP allies'],
  allyAd: ['construit avec alliés AD', 'built with AD allies'],
  ahead: ['construit en avance', 'built when ahead'],
  behind: ['construit en retard', 'built when behind']
}

/**
 * Score appris de la méta pour ce champion : dans les contextes qui ressemblent à la partie
 * (composition adverse, avance ou retard), à quel point les joueurs construisent cet objet (part
 * des parties) et son écart de taux de victoire par rapport aux autres objets achetés au même rang
 * et dans le même état de la partie (déjà lissé par la collecte).
 *
 * La part d'un objet dans un contexte est le signal le plus fiable : ce que les meilleurs joueurs
 * construisent davantage face à ce type d'équipe ou dans cette situation.
 */
function dataScore(
  item: ItemInfo,
  situational: JunglerBuild['situational'],
  threat: ThreatProfile
): { score: number; reason?: string } | null {
  if (!situational) return null
  const weights: Partial<Record<SituationContext, number>> = {
    all: 0.6,
    ...contextWeights(threat),
    ...stateWeights(threat)
  }
  const key = norm(item.name)
  const usual = situational.all?.items.find((x) => norm(x.item) === key)?.share ?? 0
  let sum = 0
  let weightSum = 0
  let best: { ctx: SituationContext; share: number; value: number } | null = null
  for (const [ctx, w] of Object.entries(weights) as [SituationContext, number][]) {
    const stats = situational[ctx]
    if (!stats || w <= 0) continue
    const entry = stats.items.find((x) => norm(x.item) === key)
    // Objet quasiment jamais construit dans ce contexte : léger malus.
    const value = entry ? entry.share * 0.9 + entry.lift * 6 : -0.05
    sum += w * value
    weightSum += w
    // Raison : nettement plus construit dans ce contexte que d'habitude.
    if (entry && ctx !== 'all' && entry.share >= 0.08 && entry.share - usual >= 0.04) {
      const gain = w * (entry.share - usual)
      if (!best || gain > best.value) best = { ctx, share: entry.share, value: gain }
    }
  }
  if (weightSum === 0) return null
  const reason = best
    ? `${tr(...CONTEXT_LABEL[best.ctx])} (${fmtPct(best.share)} ${tr('des parties', 'of games')})`
    : undefined
  return { score: sum / weightSum, reason }
}

/** Ajustement personnel d'un objet, appris de vos propres parties (voir engine/learning.ts). */
export type PersonalItemBonus = (itemName: string) => { bonus: number; reason?: string } | null

/** Parts du score d'un objet qui ne dépendent pas des données de la méta. */
interface ScoreParts {
  /** Règles : base + besoins de la partie (dégâts adverses, soins, contrôles, avance…). */
  rule: number
  ruleReason?: string
  /** Malus d'un objet anti-soins face à une équipe qui soigne peu. */
  healPenalty: number
  /** Face à ces adversaires précis et à leurs objets (déjà borné). */
  counter: number
  counterReason?: string
  personal: number
  personalReason?: string
  defensive: boolean
}

function scoreParts(
  item: ItemInfo,
  threat: ThreatProfile,
  personal?: PersonalItemBonus,
  counters?: ItemCounters,
  counterWeight = 1
): ScoreParts {
  const rule =
    ITEM_RULES[item.name] ??
    Object.entries(ITEM_RULES).find(([k]) => norm(k) === norm(item.name))?.[1]
  const m = threat.metrics
  // Objets défensifs : le besoin d'armure ou de résistance magique tient compte de ce que tu as
  // déjà (voir threat.defense), pas seulement de la part des dégâts adverses.
  const need: Record<Metric, number> =
    rule?.role === 'defense' ? { ...m, ad: threat.defense.ad, ap: threat.defense.ap } : m
  let score = rule ? rule.base : 0.1
  let bestMetric: Metric | null = null
  let bestContribution = 0
  if (rule) {
    for (const [metric, weight] of Object.entries(rule.w) as [Metric, number][]) {
      const c = weight * need[metric]
      score += c
      if (c > bestContribution) {
        bestContribution = c
        bestMetric = metric
      }
    }
  }
  let ruleReason: string | undefined
  if (bestMetric && bestContribution >= 0.3) {
    ruleReason = metricLabel(bestMetric)
    if ((bestMetric === 'fedAp' || bestMetric === 'fedAd') && (threat.fed ?? threat.focus))
      ruleReason = `vs ${(threat.fed ?? threat.focus)!.champ.label}`
  }
  // Face à ces adversaires précis et à leurs objets (mesuré en Master+, tous junglers confondus).
  // counterWeight : coefficient réglé par le pipeline de méta (1 sans réglage).
  const c = counterLift(item.name, threat, counters)
  // Raison affichée seulement si l'effet repose sur assez de parties (sinon il compte, sans plus).
  // (écarts déjà lissés par la collecte : 0,6 point est un effet établi.)
  const counterReason =
    c.best && c.lift >= 0.006 && c.best.lift >= 0.006 && c.best.games >= 100
      ? `vs ${c.best.foe} (+${fmtPct(c.best.lift, 1)})`
      : undefined
  // Vos résultats avec cet objet (bonus ou malus limité : les règles et la méta restent la base).
  const mine = personal?.(item.name)
  return {
    rule: score,
    ruleReason,
    // Un objet anti-soins n'a de sens que si l'adversaire soigne vraiment.
    healPenalty: rule?.w.heal && rule.w.heal >= 1 && m.heal < 0.45 ? -1 : 0,
    counter: Math.max(-0.6, Math.min(0.6, 6 * counterWeight * c.lift)),
    counterReason,
    personal: mine?.bonus ?? 0,
    personalReason: mine?.reason,
    defensive: rule?.role === 'defense' || rule?.role === 'utility'
  }
}

/** Raison finale : règle, puis donnée de la méta, puis adversaire précis, puis vos parties. */
function reasonOf(p: ScoreParts, learned?: string): string | undefined {
  let reason = p.ruleReason
  if (learned && !(reason && reason.startsWith('vs '))) reason = learned
  if (p.counterReason) reason = p.counterReason
  if (p.personalReason && !(reason && reason.startsWith('vs '))) reason = p.personalReason
  return reason
}

function scoreItem(
  item: ItemInfo,
  threat: ThreatProfile,
  optionIndex: number,
  situational?: JunglerBuild['situational'],
  personal?: PersonalItemBonus,
  counters?: ItemCounters,
  counterWeight = 1
): Scored {
  const p = scoreParts(item, threat, personal, counters, counterWeight)
  const m = threat.metrics
  let score = p.rule
  const learned = dataScore(item, situational, threat)
  const optionBonus = optionIndex >= 0 ? Math.max(0.1, 0.45 - optionIndex * 0.07) : 0
  if (learned) {
    // Données Master+ disponibles : elles pèsent autant que les règles. En cas d'urgence en partie
    // (adversaire très en avance, retard), les règles défensives reprennent le dessus.
    const emergency = Math.max(m.fedAp, m.fedAd, m.behind)
    const ruleWeight = 0.5 + 0.5 * emergency
    score = ruleWeight * score + 1.4 * learned.score + 0.4 * optionBonus
  } else {
    score += optionBonus
  }
  score += p.healPenalty + p.counter + p.personal
  return { item, score, reason: reasonOf(p, learned?.reason), defensive: p.defensive }
}

/** Mesures de l'objet suivant utilisables (assez de parties de ce champion à ce stade). */
const NEXT_MIN_GAMES = 100
/** Écart de score (en victoires) → points du plan : 4 points d'écart ≈ un besoin net des règles. */
const NEXT_SCALE = 25
const NEXT_CAP = 1.2
/**
 * Écart de score pour remplacer le 3e objet du cœur (≈ 1,6 point de victoire mesuré). Abaissé de
 * 0,5 à 0,4 le 20 novembre 2026, une fois l'objet suivant vérifié sur plus de 365 000 achats.
 */
const NEXT_SWAP = 0.4
/** Un objet se revend 70 % de son prix. */
const SELL_RATIO = 0.7
/**
 * Écart de score pour conseiller un échange en fin de build : bien plus que pour un achat, la
 * revente coûtant 30 % de l'objet (un anti-soins face à une équipe qui ne soigne pas, par exemple).
 */
const SWAP_MIN = 0.8
/** Objets à charges : la revente perd leur progression, ils ne sont jamais proposés à la vente. */
const KEEP_ON_SELL = new Set(["Mejai's Soulstealer", 'Heartsteel', 'Hubris'].map(norm))

/**
 * Explication d'un choix fondé sur les mesures de l'objet suivant (écarts corrigés par la pente
 * mesurée ; aucune explication tirée des données si elles ne se vérifient pas le lendemain).
 */
function nextReason(gd: GameData, e: NextEstimate, model: NextModel): string | undefined {
  if (model.slope < 0.3) return undefined
  const pt = (x: number): string => `+${fmtNumber(x * 100, 1)} ${tr('pt', 'pts')}`
  if (e.best && e.best.value * model.slope >= 0.006) {
    const label = gd.itemsByName.get(norm(e.best.item))?.label ?? e.best.item
    return tr(`va avec ${label}`, `pairs with ${label}`)
  }
  if (e.lift * model.slope >= 0.006)
    return tr(
      `${pt(e.lift * model.slope)} de victoires à or égal`,
      `${pt(e.lift * model.slope)} win rate at equal gold`
    )
  if (e.share >= 0.3)
    return tr(
      `pris par ${fmtPct(e.share)} des joueurs après ces objets`,
      `${fmtPct(e.share)} of players take it after these items`
    )
  return undefined
}

function chooseBoots(
  gd: GameData,
  defaultBoots: ItemInfo | undefined,
  archetype: Archetype,
  threat: ThreatProfile,
  measured = false
): { item: ItemInfo | undefined; reason?: string } {
  const m = threat.metrics
  const steel = gd.itemsByName.get(norm(BOOTS.steelcaps))
  const merc = gd.itemsByName.get(norm(BOOTS.mercury))
  if (threat.enemies.length === 0) return { item: defaultBoots }
  // Bottes déjà choisies d'après les parties de ce contexte (avantage établi par les données) : les
  // règles ne reprennent la main que face à un adversaire très en avance.
  if (measured && Math.max(m.fedAp, m.fedAd) < 0.5) return { item: defaultBoots }
  // Besoin d'armure ou de résistance magique compte tenu de ce que tu as déjà (threat.defense).
  const steelNeed = threat.defense.ad * 0.8 + m.aa * 0.5 + m.crit * 0.3 + m.fedAd * 0.5
  const mercNeed = threat.defense.ap * 0.8 + m.cc * 0.7 + m.fedAp * 0.5
  const defaultIsDefensive =
    !!defaultBoots &&
    (norm(defaultBoots.name) === norm(BOOTS.steelcaps) ||
      norm(defaultBoots.name) === norm(BOOTS.mercury))
  // Les champions qui jouent des bottes offensives ne les changent que face à une menace nette.
  const canSwap =
    defaultIsDefensive || ['AD_FIGHTER', 'TANK', 'AD_CARRY', 'AP_FIGHTER'].includes(archetype)
  const threshold = defaultIsDefensive ? 0 : 1.0
  if (!canSwap) return { item: defaultBoots }
  if (mercNeed > steelNeed && mercNeed >= threshold && merc)
    return {
      item: merc,
      reason:
        m.cc >= 0.6 ? tr('contrôles + magie', 'CC + magic') : tr('dégâts magiques', 'magic damage')
    }
  if (steelNeed >= mercNeed && steelNeed >= threshold && steel)
    return {
      item: steel,
      reason:
        m.aa >= 0.5
          ? tr('attaques de base', 'auto attacks')
          : tr('dégâts physiques', 'physical damage')
    }
  return { item: defaultBoots }
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

/** Composant anti-soins (Blessures graves) dans la recette d'un objet. */
function antiHealComponentOf(gd: GameData, item: ItemInfo): ItemInfo | undefined {
  const queue = [...item.from]
  while (queue.length) {
    const comp = gd.items.get(queue.shift()!)
    if (!comp) continue
    if (comp.grievous && !comp.isLegendary) return comp
    queue.push(...comp.from)
  }
  return undefined
}

/** Valeur de composants déjà possédés pour un objet (consomme l'inventaire). */
function ownedComponentValue(gd: GameData, item: ItemInfo, inventory: Map<number, number>): number {
  let value = 0
  for (const compId of item.from) {
    const comp = gd.items.get(compId)
    if (!comp) continue
    const n = inventory.get(compId) ?? 0
    if (n > 0) {
      inventory.set(compId, n - 1)
      value += comp.total
    } else value += ownedComponentValue(gd, comp, inventory)
  }
  return value
}

/**
 * Composant à acheter quand l'objet complet n'est pas abordable : le plus cher, mais celui qui
 * protège de la menace du moment passe devant (RM face à un mage en avance, armure face à un AD,
 * anti-soins face aux soins).
 */
function bestComponent(
  gd: GameData,
  item: ItemInfo,
  gold: number,
  inventory: Map<number, number>,
  threat?: ThreatProfile
): ItemInfo | null {
  const m = threat?.metrics
  const value = (c: ItemInfo): number => {
    let v = c.total
    if (!m) return v
    if ((c.stats.FlatSpellBlockMod ?? 0) > 0 && (m.fedAp >= 0.4 || m.ap >= 0.65)) v += 350
    if ((c.stats.FlatArmorMod ?? 0) > 0 && (m.fedAd >= 0.4 || m.ad >= 0.65)) v += 350
    if (c.grievous && m.heal >= 0.55) v += 350
    return v
  }
  let best: ItemInfo | null = null
  const visit = (it: ItemInfo): void => {
    for (const compId of it.from) {
      const comp = gd.items.get(compId)
      if (!comp) continue
      if ((inventory.get(compId) ?? 0) > 0) continue
      if (comp.total <= gold && (!best || value(comp) > value(best))) best = comp
      visit(comp)
    }
  }
  visit(item)
  return best
}

export function buildItemPlan(
  gd: GameData,
  build: JunglerBuild,
  threat: ThreatProfile,
  me: LivePlayer | null,
  currentGold: number,
  personal?: PersonalItemBonus,
  counters?: ItemCounters,
  counterWeight = 1,
  nextModel: NextModel = DEFAULT_NEXT_MODEL
): ItemPlan {
  const unresolved: string[] = []
  const resolve = (name: string): ItemInfo | undefined => {
    const it = gd.itemsByName.get(norm(name))
    if (!it) unresolved.push(name)
    return it
  }
  const m = threat.metrics

  // Inventaire en partie. Un objet qui a évolué (Bâton de l'archange → Étreinte du séraphin,
  // Manamune → Muramana, Approche de l'hiver → Fimbulwinter…) compte sous sa forme achetée : le
  // plan ne le croit pas vendu et ne libère pas sa place. Il s'affiche sous sa forme actuelle.
  const inventory = new Map<number, number>()
  const evolved = new Map<number, ItemInfo>()
  for (const it of me?.items ?? []) {
    const id = baseItemId(gd, it.itemID)
    if (id !== it.itemID) {
      const now = gd.items.get(it.itemID)
      if (now) evolved.set(id, now)
    }
    inventory.set(id, (inventory.get(id) ?? 0) + Math.max(1, it.count))
  }
  const ownsId = (id: number): boolean => (inventory.get(id) ?? 0) > 0
  const ownedItems = [...inventory.keys()]
    .map((id) => gd.items.get(id))
    .filter((i): i is ItemInfo => !!i)
  const ownedLegendaries = ownedItems.filter((i) => i.isLegendary)
  const ownedBoots = ownedItems.find((i) => i.isBoots)

  // Départ : celui de la méta (ou du poste), sinon familier + potion en jungle.
  const starter = (
    build.start?.length
      ? build.start.map(resolve)
      : [build.pet ? resolve(build.pet) : undefined, gd.itemsByName.get(norm(POTION))]
  ).filter((i): i is ItemInfo => !!i)

  const core = build.core.map(resolve).filter((i): i is ItemInfo => !!i)
  const optionNames = build.options.map(norm)
  const pool = new Map<number, ItemInfo>()
  // Objets réellement construits par les joueurs Master+ dans au moins un contexte (≥ 8 %).
  const learnedNames = Object.values(build.situational ?? {}).flatMap((ctx) =>
    (ctx?.items ?? []).filter((x) => x.share >= 0.08).map((x) => x.item)
  )
  for (const name of [
    ...ARCHETYPE_POOLS[build.archetype],
    ...build.options,
    ...learnedNames,
    ANTI_HEAL[build.archetype].final
  ]) {
    const it = gd.itemsByName.get(norm(name))
    if (it && it.isLegendary) pool.set(it.id, it)
    else if (!it && build.options.includes(name)) unresolved.push(name)
  }
  for (const c of core) pool.delete(c.id)
  // Objet suivant mesuré pour ce champion : les objets réellement achetés du 3e au 6e rang.
  const nextStats = build.next && build.next.n >= NEXT_MIN_GAMES ? build.next : undefined
  const nextKey = new Map<string, string>()
  if (nextStats) {
    for (const k of [
      ...Object.keys(nextStats.base),
      ...Object.keys(nextStats.after),
      ...Object.values(nextStats.after).flatMap((g) => Object.keys(g.i))
    ])
      nextKey.set(norm(k), k)
    for (const k of Object.keys(nextStats.base)) {
      const it = gd.itemsByName.get(norm(k))
      if (it && it.isLegendary && !core.some((c) => c.id === it.id)) pool.set(it.id, it)
    }
  }

  // Composants importants déjà achetés : on privilégie les objets qui les terminent (l'or investi
  // n'est pas perdu et le plan ne change pas de direction en cours de partie).
  const startedComponents = ownedItems.filter(
    (i) =>
      !i.isLegendary &&
      !i.isBoots &&
      i.total >= 700 &&
      !i.tags.includes('Consumable') &&
      !i.tags.includes('Jungle') &&
      !i.tags.includes('Trinket')
  )
  const scored = [...pool.values()]
    .map((it) => {
      const sc = scoreItem(
        it,
        threat,
        optionNames.indexOf(norm(it.name)),
        build.situational,
        personal,
        counters,
        counterWeight
      )
      const started = startedComponents.find((c) => buildsFrom(gd, it, c.id))
      if (started) {
        sc.score += 0.5
        sc.reason = `${tr('termine', 'completes')} ${started.label}`
      }
      return sc
    })
    .sort((a, b) => b.score - a.score)

  // Objet suivant mesuré (3e au 6e objet) : classement des candidats après les objets `taken`
  // (et ceux possédés hors plan), selon la partie, corrigé par les règles, les adversaires précis
  // et tes parties. `extra` : candidats en plus de la réserve (le 3e objet du cœur).
  const contexts = nextContexts(threat)
  const emergency = Math.max(m.fedAp, m.fedAd, m.behind)
  // Poids des règles écrites à la main : faible en partie calme (les mesures, vérifiées chaque
  // nuit, décident ; 0,25 avant le 20 novembre 2026), entier en cas d'urgence.
  const ruleWeight = 0.15 + 0.85 * emergency
  const parts = new Map<number, ScoreParts>()
  const partsOf = (it: ItemInfo): ScoreParts => {
    let p = parts.get(it.id)
    if (!p) parts.set(it.id, (p = scoreParts(it, threat, personal, counters, counterWeight)))
    return p
  }
  const keyOf = (it: ItemInfo): string => nextKey.get(norm(it.name)) ?? it.name
  // `free` : objet possédé qu'on envisage de revendre (fin de build) : il redevient candidat.
  const rankNext = (
    taken: ItemInfo[],
    extra: ItemInfo[] = [],
    free: ItemInfo | null = null
  ): Scored[] => {
    const owned = free ? ownedLegendaries.filter((o) => o.id !== free.id) : ownedLegendaries
    const offPlan = owned.filter((o) => !taken.some((t) => t.id === o.id))
    const have = [...new Set([...offPlan, ...taken].map(keyOf))]
    const avail = [...pool.values(), ...extra.filter((x) => !pool.has(x.id))].filter(
      (c) =>
        (!ownsId(c.id) || c.id === free?.id) &&
        !taken.some((t) => conflicts(t, c)) &&
        !owned.some((o) => conflicts(o, c))
    )
    const est = new Map<number, NextEstimate>()
    for (const c of avail) {
      const e = nextEstimate(nextStats, keyOf(c), have, contexts)
      if (e) est.set(c.id, e)
    }
    const usable = avail.filter((c) => !est.get(c.id)?.excluded)
    const values = usable
      .filter((c) => est.has(c.id))
      .map((c) => nextScore(est.get(c.id)!, nextModel))
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
    // Objet jamais acheté à ce stade par ce champion : derrière tous les objets mesurés.
    const floor = values.length ? NEXT_SCALE * (Math.min(...values) - mean) - 0.2 : 0
    return usable
      .map((c) => {
        const p = partsOf(c)
        const e = est.get(c.id)
        const part = e
          ? Math.max(-NEXT_CAP, Math.min(NEXT_CAP, NEXT_SCALE * (nextScore(e, nextModel) - mean)))
          : Math.max(-NEXT_CAP, floor)
        const startedComp = startedComponents.find((x) => buildsFrom(gd, c, x.id))
        const score =
          ruleWeight * p.rule +
          part +
          p.healPenalty +
          p.counter +
          p.personal +
          (startedComp ? 0.5 : 0)
        const reason = startedComp
          ? `${tr('termine', 'completes')} ${startedComp.label}`
          : reasonOf(p, e ? nextReason(gd, e, nextModel) : undefined)
        return { item: c, score, reason, defensive: p.defensive }
      })
      .sort((a, b) => b.score - a.score)
  }

  // Cœur, avec remplacement du 3e objet si la partie l'exige vraiment.
  const coreSteps: BuildStep[] = core.map((item) => ({ item, kind: 'core' as const, owned: false }))
  // - le 3e objet est offensif et un objet défensif devient indispensable ;
  // - ou le 3e objet est défensif mais protège mal contre la menace réelle (ex. Danse de la mort
  //   face à une équipe presque entièrement AP).
  // Avec l'objet suivant mesuré : le 3e objet n'est remplacé que si un autre gagne nettement plus
  // après les deux premiers, dans cette partie (adversaire très en avance, composition…).
  if (nextStats && coreSteps.length === 3 && !ownsId(coreSteps[2].item.id)) {
    const third = coreSteps[2].item
    const ranked = rankNext(core.slice(0, 2), [third])
    const best = ranked[0]
    const thirdScore = ranked.find((s) => s.item.id === third.id)?.score ?? -Infinity
    if (best && best.item.id !== third.id && best.score - thirdScore >= NEXT_SWAP) {
      coreSteps[2] = {
        item: best.item,
        kind: 'core',
        owned: false,
        reason: best.reason,
        swapped: true
      }
      pool.delete(best.item.id)
      pool.set(third.id, third)
    }
  }
  const urgent = nextStats
    ? undefined
    : scored.find(
        (s) => s.defensive && s.score >= 1.15 && !core.slice(0, 2).some((c) => conflicts(c, s.item))
      )
  if (urgent && coreSteps.length === 3) {
    const third = coreSteps[2].item
    const thirdRule = ITEM_RULES[third.name]
    const thirdOwned = ownsId(third.id)
    const thirdScore = scoreItem(
      third,
      threat,
      -1,
      build.situational,
      personal,
      counters,
      counterWeight
    ).score
    const thirdIsDamage = !thirdRule || thirdRule.role === 'damage'
    if (!thirdOwned && (thirdIsDamage || urgent.score - thirdScore >= 0.45)) {
      coreSteps[2] = {
        item: urgent.item,
        kind: 'core',
        owned: false,
        reason: urgent.reason,
        swapped: true
      }
      scored.splice(scored.indexOf(urgent), 1)
      scored.unshift({ item: third, score: 1, defensive: false })
      pool.delete(urgent.item.id)
      pool.set(third.id, third)
    }
  }

  // Bottes.
  const boots = chooseBoots(gd, resolve(build.boots), build.archetype, threat, !!build.bootsLocked)
  const steps: BuildStep[] = []
  // Familier de jungle : premier achat de la partie.
  const pet = build.pet ? gd.itemsByName.get(norm(build.pet)) : undefined
  if (pet)
    steps.push({
      item: pet,
      kind: 'starter',
      owned: false,
      reason: tr('familier de jungle', 'jungle pet')
    })
  // Hors jungle : départ (anneau de Doran, larme…), avec ses potions.
  if (!pet && starter.length) {
    const main = starter.find((i) => !i.tags.includes('Consumable')) ?? starter[0]
    const extras = new Map<string, number>()
    for (const i of starter) if (i !== main) extras.set(i.label, (extras.get(i.label) ?? 0) + 1)
    const extra = [...extras].map(([label, n]) => (n > 1 ? `${n} × ${label}` : label)).join(', ')
    steps.push({
      item: main,
      kind: 'starter',
      owned: false,
      reason: extra ? `+ ${extra}` : undefined
    })
  }
  // Bottes : au moment le plus courant pour ce champion (mesuré, voir engine/choices), après le
  // 1er objet par défaut.
  const bootsStep: BuildStep | null = ownedBoots
    ? { item: ownedBoots, kind: 'boots', owned: true }
    : boots.item
      ? { item: boots.item, kind: 'boots', owned: false, reason: boots.reason }
      : null
  const timing = build.bootsTiming ?? 'first'
  if (bootsStep && timing === 'early') steps.push(bootsStep)
  if (coreSteps[0]) steps.push(coreSteps[0])
  if (bootsStep && timing === 'first') steps.push(bootsStep)
  if (coreSteps[1]) steps.push(coreSteps[1])
  if (bootsStep && timing === 'later') steps.push(bootsStep)
  steps.push(...coreSteps.slice(2))

  // Situationnels : on complète jusqu'à 5 légendaires en tenant compte de l'inventaire.
  const legendaryInPlan = (): ItemInfo[] =>
    steps.filter((s) => s.item.isLegendary).map((s) => s.item)
  const situational: BuildStep[] = []
  const alternatives: BuildStep[] = []
  if (nextStats) {
    // Objet par objet : le suivant est celui qui gagne le plus, à or égal, après les objets déjà
    // prévus ou possédés (mesuré chaque nuit, et vérifié sur les parties du lendemain), corrigé
    // par les besoins de la partie (règles, adversaires précis, tes parties).
    for (;;) {
      const taken = [...legendaryInPlan(), ...situational.map((x) => x.item)]
      if (taken.length >= MAX_LEGENDARIES) break
      const best = rankNext(taken)[0]
      if (!best) break
      situational.push({ item: best.item, kind: 'situational', owned: false, reason: best.reason })
    }
    // Autres bons choix : ceux qui suivraient le mieux le build prévu.
    const planned = [...legendaryInPlan(), ...situational.map((x) => x.item)]
    for (const s of rankNext(situational.length ? planned.slice(0, -1) : planned))
      if (alternatives.length < 4 && !planned.some((t) => conflicts(t, s.item)))
        alternatives.push({ item: s.item, kind: 'situational', owned: false, reason: s.reason })
  } else {
    for (const s of scored) {
      const taken = [...legendaryInPlan(), ...situational.map((x) => x.item)]
      if (taken.some((t) => conflicts(t, s.item))) continue
      if (ownedLegendaries.some((o) => conflicts(o, s.item) && o.id !== s.item.id)) continue
      const step: BuildStep = { item: s.item, kind: 'situational', owned: false, reason: s.reason }
      if (taken.length < MAX_LEGENDARIES) situational.push(step)
      else if (alternatives.length < 4) alternatives.push(step)
    }
  }

  // Anti-soins : un seul objet complet, cohérent avec ce qui a déjà été acheté.
  // - un composant anti-soins est déjà dans l'inventaire → on termine l'objet qu'il construit ;
  // - sinon, beaucoup de soins adverses et rien de prévu → l'objet anti-soins de l'archétype.
  const plannedLegendaries = (): ItemInfo[] => [
    ...legendaryInPlan(),
    ...situational.map((x) => x.item)
  ]
  const ownsGrievousLegendary = ownedLegendaries.some((i) => i.grievous)
  const ownedGrievousComp = ownedItems.find((i) => i.grievous && !i.isLegendary)
  let antiHealTarget: ItemInfo | undefined
  let antiHealReason = tr('anti-soins', 'anti-heal')
  if (!ownsGrievousLegendary && ownedGrievousComp) {
    const completions = [...gd.items.values()].filter(
      (i) =>
        i.isLegendary &&
        i.grievous &&
        gd.itemsByName.get(norm(i.name)) === i &&
        buildsFrom(gd, i, ownedGrievousComp.id)
    )
    antiHealTarget =
      completions.find((i) => plannedLegendaries().some((p) => p.id === i.id)) ??
      completions.find((i) => norm(i.name) === norm(ANTI_HEAL[build.archetype].final)) ??
      completions[0]
    antiHealReason = `${tr('termine', 'completes')} ${ownedGrievousComp.label}`
  } else if (
    !ownsGrievousLegendary &&
    m.heal >= 0.55 &&
    !plannedLegendaries().some((i) => i.grievous)
  ) {
    const target = gd.itemsByName.get(norm(ANTI_HEAL[build.archetype].final))
    // Objet anti-soins imposé face aux soins, sauf si la mesure le contredit : pour ce champion,
    // il gagne moins face aux équipes qui soignent (et la mesure se vérifie le lendemain).
    const measured =
      target && nextStats && nextModel.slope >= 0.3
        ? (nextStats.ctx.heal?.[keyOf(target)]?.[1] ?? 0)
        : 0
    if (measured > -0.003) antiHealTarget = target
  }
  if (
    antiHealTarget &&
    !ownedLegendaries.some((o) => conflicts(o, antiHealTarget!)) &&
    !legendaryInPlan().some((i) => conflicts(i, antiHealTarget!))
  ) {
    const target = antiHealTarget
    // Un seul anti-soins : les autres objets anti-soins prévus passent en alternatives.
    for (let i = situational.length - 1; i >= 0; i--) {
      if (
        situational[i].item.id !== target.id &&
        (situational[i].item.grievous || conflicts(situational[i].item, target))
      )
        alternatives.unshift(...situational.splice(i, 1))
    }
    const existing = situational.findIndex((x) => x.item.id === target.id)
    if (existing >= 0) situational.splice(existing, 1)
    if (plannedLegendaries().length >= MAX_LEGENDARIES) {
      const idx = situational.map((x) => ownsId(x.item.id)).lastIndexOf(false)
      if (idx >= 0) alternatives.unshift(...situational.splice(idx, 1))
    }
    if (plannedLegendaries().length < MAX_LEGENDARIES) {
      situational.unshift({
        item: target,
        kind: 'situational',
        owned: false,
        reason: antiHealReason
      })
    }
  }

  // Composant anti-soins tôt (avant le 2e objet légendaire) : toujours celui de l'objet anti-soins
  // prévu, pour que l'or investi serve plus tard.
  if (m.heal >= 0.5 && ownedLegendaries.length < 2 && !ownedItems.some((i) => i.grievous)) {
    const plannedAntiHeal = [...plannedLegendaries()].find((i) => i.grievous)
    const comp = plannedAntiHeal ? antiHealComponentOf(gd, plannedAntiHeal) : undefined
    if (comp && plannedAntiHeal) {
      const bootsIdx = steps.findIndex((x) => x.kind === 'boots')
      const at = bootsIdx >= 0 ? bootsIdx + 1 : Math.min(steps.length, 2)
      steps.splice(at, 0, {
        item: comp,
        kind: 'antiheal',
        owned: false,
        reason: `${tr('anti-soins tôt', 'early anti-heal')} → ${plannedAntiHeal.label}`
      })
    }
  }
  alternatives.splice(4)
  steps.push(...situational)

  // Objets légendaires achetés hors plan : ils prennent la place des derniers situationnels.
  const planIds = new Set(steps.map((s) => s.item.id))
  for (const extra of ownedLegendaries.filter((o) => !planIds.has(o.id))) {
    const conflictIdx = steps.findIndex(
      (s) => !s.owned && s.item.isLegendary && conflicts(s.item, extra)
    )
    // On remplace le dernier situationnel prévu, en gardant l'anti-soins si l'adversaire soigne.
    const replaceable = (s: BuildStep, keepAntiHeal: boolean): boolean =>
      s.kind === 'situational' && !ownsId(s.item.id) && !(keepAntiHeal && s.item.grievous)
    let lastSit = [...steps].reverse().findIndex((s) => replaceable(s, m.heal >= 0.55))
    if (lastSit < 0) lastSit = [...steps].reverse().findIndex((s) => replaceable(s, false))
    const idx = conflictIdx >= 0 ? conflictIdx : lastSit >= 0 ? steps.length - 1 - lastSit : -1
    const owned: BuildStep = {
      item: extra,
      kind: 'owned',
      owned: true,
      reason: tr('acheté', 'bought')
    }
    if (idx >= 0) steps.splice(idx, 1, owned)
    else steps.push(owned)
  }

  // Possédé : même identifiant, ou même nom (le familier change d'identifiant en évoluant).
  const ownedNames = new Set(ownedItems.map((i) => norm(i.name)))
  for (const s of steps) if (ownsId(s.item.id) || ownedNames.has(norm(s.item.name))) s.owned = true
  // Familier vendu en fin de partie (ou jamais acheté) : inutile de le proposer une fois le build lancé.
  for (const s of steps) if (s.kind === 'starter' && ownedLegendaries.length > 0) s.owned = true
  // Départ hors jungle : acquis dès qu'un objet durable est en inventaire (partie commencée).
  const started = ownedItems.some(
    (i) =>
      !i.tags.includes('Consumable') && !i.tags.includes('Trinket') && !i.tags.includes('Jungle')
  )
  for (const s of steps) if (s.kind === 'starter' && !pet && started) s.owned = true
  // Le composant anti-soins est considéré acquis si un objet à Blessures graves est possédé.
  for (const s of steps)
    if (s.kind === 'antiheal' && ownedItems.some((i) => i.grievous || i.from.includes(s.item.id)))
      s.owned = true

  // Objet acheté qui a évolué : affiché sous sa forme actuelle.
  for (const s of steps) if (s.owned && evolved.has(s.item.id)) s.item = evolved.get(s.item.id)!

  // Affichage : ce qui est déjà acheté d'abord, puis la suite dans l'ordre conseillé.
  const ordered = [...steps.filter((s) => s.owned), ...steps.filter((s) => !s.owned)]
  steps.splice(0, steps.length, ...ordered)

  // Échange en fin de build : pour chaque objet possédé (hors deux premiers objets du cœur, objets
  // à charges et objets qui ont évolué), le meilleur objet qui pourrait le remplacer, classé comme
  // un objet suivant après les autres objets possédés. Proposé seulement si l'écart couvre
  // largement la perte de la revente (30 % du prix).
  const swapOf = (): { sell: ItemInfo; buy: ItemInfo; reason?: string } | null => {
    const keep = new Set(core.slice(0, 2).map((c) => c.id))
    let best: { sell: ItemInfo; buy: Scored; gain: number } | null = null
    for (const o of ownedLegendaries) {
      if (keep.has(o.id) || evolved.has(o.id) || KEEP_ON_SELL.has(norm(o.name))) continue
      const others = ownedLegendaries.filter((x) => x.id !== o.id)
      const ranked = nextStats
        ? rankNext(others, [o], o)
        : [...pool.values(), ...(pool.has(o.id) ? [] : [o])]
            .filter((c) => (c.id === o.id || !ownsId(c.id)) && !others.some((t) => conflicts(t, c)))
            .map((c) =>
              scoreItem(
                c,
                threat,
                optionNames.indexOf(norm(c.name)),
                build.situational,
                personal,
                counters,
                counterWeight
              )
            )
            .sort((a, b) => b.score - a.score)
      const mine = ranked.find((x) => x.item.id === o.id)
      const top = ranked.find((x) => x.item.id !== o.id)
      if (!mine || !top) continue
      const gain = top.score - mine.score
      if (!best || gain > best.gain) best = { sell: o, buy: top, gain }
    }
    if (best && best.gain >= SWAP_MIN) {
      // Pourquoi revendre : anti-soins face à une équipe qui soigne peu, sinon la raison de l'achat.
      const useless = partsOf(best.sell).healPenalty < 0
      return {
        sell: best.sell,
        buy: best.buy.item,
        reason: useless
          ? tr('peu de soins en face', 'little enemy healing')
          : (best.buy.reason ?? tr('mieux adapté à la partie', 'better suited to this game'))
      }
    }
    // Bottes : défensives face à un adversaire très en avance, si celles achetées ne protègent pas.
    if (
      ownedBoots &&
      boots.item &&
      boots.item.id !== ownedBoots.id &&
      boots.reason &&
      Math.max(m.fedAp, m.fedAd) >= 0.5
    )
      return { sell: ownedBoots, buy: boots.item, reason: boots.reason }
    return null
  }

  // Prochain achat.
  let next: NextBuy | null = null
  const pending = steps.find((s) => !s.owned)
  if (pending && me) {
    const inv = new Map(inventory)
    const remaining = Math.max(0, pending.item.total - ownedComponentValue(gd, pending.item, inv))
    const affordable = currentGold >= remaining
    next = {
      item: pending.item,
      remaining,
      affordable,
      component: affordable
        ? null
        : bestComponent(gd, pending.item, currentGold, new Map(inventory), threat)
    }
    // Inventaire plein (6 emplacements hors balise) et aucun composant à compléter : il faut vendre.
    const slotsUsed = (me.items ?? []).filter((it) => it.slot < 6).length
    if (slotsUsed >= 6 && remaining === pending.item.total) {
      // Objets des 6 emplacements seulement (la balise a son propre emplacement et ne se vend pas
      // pour faire de la place) : familier, puis composants les moins chers, consommables en dernier.
      const rank = (i: ItemInfo): number =>
        i.tags.includes('Jungle') ? 0 : i.tags.includes('Consumable') ? 2 : 1
      const sellable = (me.items ?? [])
        .filter((it) => it.slot < 6)
        .map((it) => gd.items.get(it.itemID))
        .filter(
          (i): i is ItemInfo => !!i && !i.isLegendary && !i.isBoots && !i.tags.includes('Trinket')
        )
        .sort((a, b) => rank(a) - rank(b) || a.total - b.total)[0]
      next.sellHint = sellable
        ? tr(`Inventaire plein : vends ${sellable.label}`, `Inventory full: sell ${sellable.label}`)
        : tr(
            'Inventaire plein : vends un objet pour faire de la place',
            'Inventory full: sell an item to make room'
          )
    }
  } else if (pending) {
    next = { item: pending.item, remaining: pending.item.total, affordable: false, component: null }
  } else if (me && ownedLegendaries.length >= MAX_LEGENDARIES) {
    // Build terminé : si la partie a changé au point qu'un objet ne sert plus (anti-soins face à
    // une équipe qui ne soigne pas, objet offensif face à un adversaire très en avance…), échange
    // conseillé, revente comprise ; sinon l'or restant sert à un élixir.
    const swap = swapOf()
    if (swap) {
      const refund = Math.round(SELL_RATIO * swap.sell.total)
      const remaining = Math.max(0, swap.buy.total - refund)
      const shown = evolved.get(swap.sell.id) ?? swap.sell
      next = {
        item: swap.buy,
        remaining,
        affordable: currentGold >= remaining,
        component: null,
        swap: { sell: shown, refund, reason: swap.reason },
        sellHint: tr(
          `Remplace ${shown.label} : vends-le (+${gold(refund)}), puis achète ${swap.buy.label}`,
          `Replace ${shown.label}: sell it (+${gold(refund)}), then buy ${swap.buy.label}`
        )
      }
    } else {
      const elixir = gd.itemsByName.get(norm(ELIXIR[build.archetype]))
      if (elixir && !ownsId(elixir.id))
        next = {
          item: elixir,
          remaining: elixir.total,
          affordable: currentGold >= elixir.total,
          component: null
        }
    }
  }

  return { starter, steps, alternatives, next, unresolved: Array.from(new Set(unresolved)) }
}

export interface PurchaseAlert {
  /** Objet ou composant à acheter maintenant. */
  item: ItemInfo
  /** Objet complet visé quand l'alerte porte sur un composant. */
  target: ItemInfo | null
  /** Build terminé : objet à revendre d'abord (échange conseillé). */
  sell?: ItemInfo
}

/**
 * Alerte d'achat (édition personnelle) : le joueur est à la base (mort, ou début de partie) et
 * peut acheter le prochain objet du plan, ou au moins un composant utile.
 */
export function purchaseAlert(
  plan: ItemPlan | null,
  me: LivePlayer | null,
  gameTime: number
): PurchaseAlert | null {
  const next = plan?.next
  if (!next || !me) return null
  const atBase = me.isDead || gameTime < 75
  if (!atBase) return null
  // Échange en fin de build : vendre puis acheter, quand la revente suffit à le payer.
  if (next.swap)
    return next.affordable ? { item: next.item, target: null, sell: next.swap.sell } : null
  if (next.sellHint) return null
  if (next.affordable) return { item: next.item, target: null }
  if (next.component && next.component.total >= 300)
    return { item: next.component, target: next.item }
  return null
}

/** Set d'items envoyé au client : il apparaît dans la boutique en jeu. */
export function toItemSet(
  championId: number,
  champName: string,
  plan: ItemPlan,
  /** Carte du set (11 Faille, 12 Abîme hurlant ; 0 : toutes). */
  map = 11
): ItemSetPayload {
  const block = (type: string, items: ItemInfo[]): ItemSetPayload['blocks'][number] => ({
    type,
    items: items.map((i) => ({ id: String(i.id), count: 1 }))
  })
  const core = plan.steps
    .filter((s) => s.kind !== 'situational' && s.kind !== 'starter')
    .map((s) => s.item)
  const sit = plan.steps.filter((s) => s.kind === 'situational').map((s) => s.item)
  return {
    title: champName,
    championId,
    map,
    blocks: [
      block(tr('Départ', 'Starting items'), plan.starter),
      block(tr('Cœur (ordre d’achat)', 'Core (buy order)'), core),
      block(
        tr('Situationnels (adaptés à la composition)', 'Situational (adapted to the enemy team)'),
        sit
      ),
      block(
        tr('Alternatives', 'Alternatives'),
        plan.alternatives.map((s) => s.item)
      )
    ].filter((b) => b.items.length > 0)
  }
}
