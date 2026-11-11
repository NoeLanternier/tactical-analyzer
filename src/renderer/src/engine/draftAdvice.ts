import type { ChampionPool, DraftState } from '../../../shared/types'
import type { Catalog, JunglerStat } from './catalog'
import type { ChampInfo, GameData } from './gameData'
import { analyzeThreat, profileOf } from './threat'
import { CONTEXT_LABEL, contextWeights } from './variants'
import type { SituationContext } from '../data/junglers'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'
import { tw } from './tuning'
import { DEFAULT_PRIORS, clamp, logit, shrunk as bayes, sigmoid } from './stats'

// Conseils de pick et de ban pour le poste joué, à partir des statistiques du patch :
// - taux de victoire de chaque champion à ce poste ;
// - affrontement avec l'adversaire direct, s'il est connu ;
// - taux de victoire avec chaque allié et contre chaque adversaire déjà choisis ;
// - composition adverse, risque d'être contré quand l'adversaire direct n'est pas encore choisi ;
// - équilibre de la composition, maîtrise du joueur et ses propres résultats (bilans).
//
// Chaque écart est lissé avec la force mesurée par la collecte pour ce type de statistique (voir
// stats.ts) : un affrontement à 44 % sur 60 parties ne vaut pas −6 points mais environ −0,4. Les
// synergies entre deux champions précis, que les données ne permettent pas de distinguer du hasard
// à ce volume de parties, ne pèsent presque rien tant que cela reste vrai.

/** Effet d'un critère sur le taux de victoire estimé d'un pick, en points (0,01 = 1 point). */
export interface PickFactor {
  kind:
    | 'meta'
    | 'vs'
    | 'allies'
    | 'enemies'
    | 'comp'
    | 'blind'
    | 'team'
    | 'mastery'
    | 'personal'
    | 'data'
  points: number
}

export interface PickAdvice {
  champ: ChampInfo
  /** Taux de victoire estimé dans cette draft (lissé). */
  winRate: number
  score: number
  /** Raisons, la première étant le taux de victoire global du champion. */
  reasons: string[]
  inPool: boolean
  /** Jungler adverse inconnu : sûr ou risqué de le choisir maintenant (null = rien à signaler). */
  blind: 'safe' | 'risky' | null
  /** Moins de 200 parties ce patch : estimation peu fiable. */
  lowData: boolean
  /** Effet de chaque critère. */
  factors: PickFactor[]
  /** Parties du patch et part des parties jungle. */
  games: number
  pickRate: number
  /** Rang dans le classement complet (1 = meilleur). */
  rank: number
}

export interface BanAdvice {
  champ: ChampInfo
  /** Gain de taux de victoire attendu du ban (0,001 = 0,1 point) : chance × cost. */
  score: number
  /** Probabilité que l'adversaire le prenne (à ton poste, ou ailleurs si c'est ce qui compte). */
  chance: number
  /** Ce qu'il te coûte quand l'adversaire le prend (0,01 = 1 point de taux de victoire). */
  cost: number
  reasons: string[]
  banRate: number | null
  winRate: number
}

export interface DraftAdvice {
  /** Sélection : tes champions et les meilleurs choix hors de tes champions. */
  picks: PickAdvice[]
  /** Classement complet des junglers jouables dans cette draft. */
  ranking: PickAdvice[]
  bans: BanAdvice[]
  banRanking: BanAdvice[]
  /** Ton champion survolé ou choisi, et son rang (null si aucun). */
  myPick: PickAdvice | null
  /** Jungler adverse supposé parmi les choix adverses (null tant qu'il n'est pas choisi). */
  enemyJungler: ChampInfo | null
  /** Nombre d'alliés (sur 4) et d'adversaires (sur 5) déjà choisis. */
  known: { allies: number; enemies: number }
}

/** Résultats du joueur par champion (bilans d'après-partie). */
export type PersonalRecord = Map<string, { games: number; wins: number }>

const pct = (x: number): string => fmtPct(x, 1)
const pts = (x: number): string => `${x > 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`

/**
 * Lissage du taux de victoire d'un champion à ce poste (bayésien empirique) : les écarts réels entre
 * champions sont petits (≈ 1,5 point d'écart-type) face au hasard de quelques dizaines de parties.
 * Le nombre de parties « a priori » est mesuré sur la méta (méthode des moments), borné ici.
 */
export function shrinkPrior(stats: Record<string, JunglerStat>): { mean: number; k: number } {
  const rows = Object.values(stats).filter((s) => s.games >= 100)
  const total = rows.reduce((t, s) => t + s.games, 0)
  if (rows.length < 10 || total === 0) return { mean: 0.5, k: 600 }
  const mean = rows.reduce((t, s) => t + s.games * s.winRate, 0) / total
  const observed = rows.reduce((t, s) => t + s.games * (s.winRate - mean) ** 2, 0) / total
  const noise = (rows.length * mean * (1 - mean)) / total
  const between = Math.max(observed - noise, 0.0001)
  return { mean, k: clamp((mean * (1 - mean)) / between, 200, 2500) }
}

/**
 * Effet de la maîtrise sur le taux de victoire, en points : un champion jamais joué coûte environ
 * 2 points, un champion très joué en rapporte jusqu'à 1,5 (règle générale, non mesurée ici : les
 * parties collectées ne donnent pas la maîtrise des joueurs).
 */
export function masteryEffect(points: number): number {
  if (points <= 0) return -0.02
  return clamp(0.0075 * Math.log10(points / 10000), -0.02, 0.015)
}
/** Force du lissage de tes propres résultats sur un champion (parties a priori). */
const PERSONAL_K = 120
/** En dessous : estimation peu fiable, pick moins sûr. */
const LOW_DATA_GAMES = 200
/** Effet maximal de la composition adverse (toute l'équipe connue), en points. */
const COMP_CAP = 0.025
/** Effet cumulé maximal des alliés et adversaires, en log-odds (≈ ±6 points). */
const PAIR_CAP = 0.25
/** Part de la valeur d'un ban hors de ton poste (un coéquipier aurait pu prendre ce champion). */
const OTHER_ROLE_BAN = 0.25
/** Part des parties où l'adversaire choisit un contre quand on se dévoile tôt. */
const COUNTER_PICK_RATE = 0.35

/** Part des parties d'un champion jouées en jungle (null si inconnue). */
function jungleShare(catalog: Catalog, c: ChampInfo): number | null {
  const jungle = catalog.junglerStats?.[c.id]?.games ?? 0
  const all = catalog.profiles?.[c.id]?.games ?? 0
  if (all < 50) return null
  return Math.min(1, jungle / all)
}

/**
 * Jungler adverse parmi les champions adverses visibles : celui qui joue le plus souvent jungle.
 * Tant qu'aucun d'eux n'est un jungler habituel, il est considéré comme pas encore choisi.
 */
export function findEnemyJungler(catalog: Catalog, enemies: ChampInfo[]): ChampInfo | null {
  const stats = catalog.junglerStats ?? {}
  const candidates = enemies.filter((c) => (stats[c.id]?.games ?? 0) >= 100)
  if (!candidates.length) return null
  const shares = candidates.map((c) => ({ c, share: jungleShare(catalog, c) }))
  if (shares.some((x) => x.share !== null)) {
    const best = shares
      .filter((x) => x.share !== null && x.share >= 0.35)
      .sort((a, b) => b.share! - a.share!)[0]
    return best?.c ?? null
  }
  return candidates.sort((a, b) => (stats[b.id]?.games ?? 0) - (stats[a.id]?.games ?? 0))[0]
}

interface PairEffect {
  champ: ChampInfo
  ally: boolean
  /** Écart propre à ce jungler (lissé, en log-odds), effet général du champion retiré. */
  delta: number
  games: number
}

/** Effet d'une paire [parties, taux] sur le taux du jungler, en log-odds. */
function pairDelta(pair: [number, number] | undefined, base: number, k: number): number {
  if (!pair) return 0
  return logit(bayes(pair[0], pair[1], base, k)) - logit(base)
}

export function computeDraftAdvice(
  gd: GameData,
  catalog: Catalog,
  draft: DraftState,
  pool: ChampionPool | null,
  personal: PersonalRecord | null = null
): DraftAdvice {
  const stats = catalog.junglerStats ?? {}
  const taken = new Set([...draft.allyIds, ...draft.enemyIds, ...draft.bannedIds])
  const owned = new Set(pool?.owned ?? [])
  const masteryOf = new Map((pool?.mastery ?? []).map((m) => [m.championId, m.points]))
  const totalGames = Object.values(stats).reduce((s, j) => s + j.games, 0) || 1

  // Champions du poste : statistiques du patch (un champion sans statistiques à ce poste n'est pas
  // classé), sinon base de builds (méta absente).
  const statIds = Object.keys(stats)
  const jungleIds = new Set(statIds.length >= 20 ? statIds : [...statIds, ...catalog.builds.keys()])
  const junglers = [...jungleIds]
    .map((id) => gd.championsById.get(id))
    .filter((c): c is ChampInfo => !!c)

  const toChamps = (ids: number[]): ChampInfo[] =>
    ids.map((k) => gd.champions.get(k)).filter((c): c is ChampInfo => !!c)
  const enemies = toChamps(draft.enemyIds)
  const allies = toChamps(draft.allyIds)
  const enemyJungler = findEnemyJungler(catalog, enemies)
  const otherEnemies = enemies.filter((c) => c !== enemyJungler)

  // Équilibre de dégâts et ligne de front de l'équipe alliée.
  const allyProfiles = allies.map((c) => profileOf(c, catalog.profiles))
  const allyAp = allyProfiles.length
    ? allyProfiles.reduce((s, p) => s + p.ap, 0) / allyProfiles.length
    : 0.5
  const allyFront = allyProfiles.reduce((s, p) => s + p.tank, 0)

  // Junglers adverses encore possibles (ni choisis ni bannis), avec leur fréquence.
  const openEnemyJunglers =
    enemyJungler || enemies.length >= 5
      ? []
      : junglers.filter((c) => !taken.has(c.key) && (stats[c.id]?.games ?? 0) >= 150)

  // Effet « général » d'un allié ou d'un adversaire, commun à tous les junglers (un champion fort
  // fait gagner son équipe quel que soit le jungler) : il est retiré pour ne garder que l'effet
  // propre à chaque jungler (synergie, affrontement).
  const prior = shrinkPrior(stats)
  const P = catalog.priors ?? DEFAULT_PRIORS
  const baseOf = (j: JunglerStat): number => bayes(j.games, j.winRate, prior.mean, prior.k)
  const generalEffect = (champ: ChampInfo, side: 'with' | 'against'): number => {
    let weight = 0
    let sum = 0
    for (const j of Object.values(stats)) {
      const pair = j[side][champ.id]
      if (!pair) continue
      weight += pair[0]
      sum += pair[0] * pairDelta(pair, baseOf(j), P.pair)
    }
    return weight > 0 ? sum / weight : 0
  }
  const general = new Map<string, number>()
  for (const a of allies) general.set(`with:${a.id}`, generalEffect(a, 'with'))
  for (const e of otherEnemies) general.set(`against:${e.id}`, generalEffect(e, 'against'))

  // Pool du joueur : ses junglers les plus maîtrisés.
  const playable = junglers.filter(
    (c) => (owned.size === 0 || owned.has(c.key)) && !taken.has(c.key)
  )
  const byMastery = junglers
    .filter((c) => (masteryOf.get(c.key) ?? 0) > 0)
    .sort((a, b) => (masteryOf.get(b.key) ?? 0) - (masteryOf.get(a.key) ?? 0))
    .slice(0, 8)
  const poolIds = new Set(byMastery.map((c) => c.key))

  // Composition adverse visible (profils mesurés) : poids des contextes « équipe très AP, très AD,
  // soins, résistante, contrôles » pour le taux de victoire de chaque jungler dans ces contextes.
  const knownEnemies = otherEnemies.length + (enemyJungler ? 1 : 0)
  const ctxWeights =
    knownEnemies >= 2
      ? contextWeights(analyzeThreat(gd, draft.enemyIds, [], null, null, catalog.profiles))
      : {}
  // Écart moyen de tous les champions dans chaque contexte : certains contextes sont liés à l'issue
  // de la partie (une équipe adverse qui soigne beaucoup est souvent une équipe qui gagne), et tous
  // les champions y ont un taux bas. Seul l'écart propre au champion compte.
  const ctxMean: Partial<Record<SituationContext, number>> = {}
  for (const ctx of Object.keys(ctxWeights) as SituationContext[]) {
    let w = 0
    let sum = 0
    for (const j of Object.values(stats)) {
      const cell = j.contexts?.[ctx]
      if (!cell) continue
      const base = baseOf(j)
      w += cell[0]
      sum += cell[0] * (bayes(cell[0], cell[1], base, P.comp) - base)
    }
    ctxMean[ctx] = w > 0 ? sum / w : 0
  }
  const compShift = (s: JunglerStat, base: number): { shift: number; best: string | null } => {
    let sum = 0
    let weightSum = 0
    let best: { label: string; value: number } | null = null
    for (const [ctx, w] of Object.entries(ctxWeights) as [SituationContext, number][]) {
      const cell = s.contexts?.[ctx]
      if (!cell || w <= 0) continue
      const own = bayes(cell[0], cell[1], base, P.comp) - base - (ctxMean[ctx] ?? 0)
      sum += w * own
      weightSum += w
      const label = CONTEXT_LABEL[ctx]
      if (label && Math.abs(w * own) > (best ? Math.abs(best.value) : 0.008))
        best = { label: `${tr(label[0], label[1])} (${pts(own)} pts)`, value: w * own }
    }
    // Équipe adverse incomplète : effet proportionnel aux adversaires connus.
    const shift = (sum / Math.max(1, weightSum)) * Math.min(1, knownEnemies / 5)
    return { shift: clamp(shift, -COMP_CAP, COMP_CAP), best: best?.label ?? null }
  }

  // Risque d'être contré quand l'adversaire direct n'est pas encore choisi : perte moyenne face à
  // ses trois pires affrontements connus, et part des adversaires possibles dont l'affrontement est
  // connu. Un champion peu joué n'a presque aucun affrontement mesuré : il prend le risque moyen du
  // poste plutôt qu'aucun risque.
  const blindOf = (
    c: ChampInfo,
    s: JunglerStat | undefined,
    base: number
  ): { loss: number; coverage: number; counters: ChampInfo[] } => {
    if (!openEnemyJunglers.length) return { loss: 0, coverage: 1, counters: [] }
    const known = s
      ? openEnemyJunglers
          .filter((e) => e.id !== c.id && (s.vs[e.id]?.[0] ?? 0) >= 15)
          .map((e) => ({ e, wr: bayes(s.vs[e.id][0], s.vs[e.id][1], base, P.vs) }))
      : []
    const coverage =
      known.reduce((t, x) => t + (stats[x.e.id]?.games ?? 0), 0) /
      Math.max(
        1,
        openEnemyJunglers.reduce((t, e) => t + (stats[e.id]?.games ?? 0), 0)
      )
    const counters = known.filter((x) => x.wr <= base - 0.008).sort((a, b) => a.wr - b.wr)
    const worst = counters.slice(0, 3)
    const loss = worst.length ? base - worst.reduce((t, x) => t + x.wr, 0) / worst.length : 0
    return { loss, coverage, counters: counters.map((x) => x.e) }
  }
  const covered = openEnemyJunglers.length
    ? junglers
        .map((c) => {
          const s = stats[c.id]
          return s && s.games >= 300 ? blindOf(c, s, baseOf(s)) : null
        })
        .filter((x): x is NonNullable<typeof x> => !!x && x.coverage >= 0.6)
    : []
  const meanBlindLoss = covered.length
    ? covered.reduce((t, x) => t + x.loss, 0) / covered.length
    : 0

  const scorePick = (c: ChampInfo): PickAdvice => {
    const s: JunglerStat | undefined = stats[c.id]
    const reasons: string[] = []
    const factors: PickFactor[] = []
    const base = s ? baseOf(s) : prior.mean
    // Force du champion : déjà ramenée vers la moyenne selon le nombre de parties (lissage
    // bayésien empirique), d'où pas de coefficient du pipeline ici (mesuré avec un lissage faible).
    let z = logit(base)
    // Chaque critère est noté par son effet en points de taux de victoire.
    let last = sigmoid(z)
    const factor = (kind: PickFactor['kind']): void => {
      const now = sigmoid(z)
      if (Math.abs(now - last) >= 0.002) factors.push({ kind, points: now - last })
      last = now
    }
    if (Math.abs(last - prior.mean) >= 0.002)
      factors.push({ kind: 'meta', points: last - prior.mean })
    last = sigmoid(z)
    reasons.push(
      s
        ? tr(
            `${pct(s.winRate)} sur ${fmtNumber(s.games)} parties`,
            `${pct(s.winRate)} over ${fmtNumber(s.games)} games`
          )
        : tr('pas de statistiques ce patch', 'no stats this patch')
    )

    // Jungler adverse connu : affrontement direct.
    if (s && enemyJungler && s.vs[enemyJungler.id]) {
      const [g, vsWr] = s.vs[enemyJungler.id]
      const before = sigmoid(z)
      z += tw(catalog.tuning, 'vs') * pairDelta(s.vs[enemyJungler.id], base, P.vs)
      factor('vs')
      // L'effet retenu (lissé) et le taux observé qui le fonde.
      const effect = sigmoid(z) - before
      if (g >= 20 && Math.abs(effect) >= 0.003)
        reasons.push(
          tr(
            `contre ${enemyJungler.label} : ${pts(effect)} pt (${pct(vsWr)} sur ${g} parties)`,
            `vs ${enemyJungler.label}: ${pts(effect)} pt (${pct(vsWr)} over ${g} games)`
          )
        )
    }

    // Alliés et adversaires déjà choisis.
    let blind: PickAdvice['blind'] = null
    if (s) {
      const effects: PairEffect[] = []
      const effect = (champ: ChampInfo, side: 'with' | 'against'): void => {
        const pair = s[side][champ.id]
        if (!pair) return
        const delta = pairDelta(pair, base, P.pair) - (general.get(`${side}:${champ.id}`) ?? 0)
        effects.push({ champ, ally: side === 'with', delta, games: pair[0] })
      }
      for (const a of allies) effect(a, 'with')
      for (const e of otherEnemies) effect(e, 'against')
      const withSum = effects.filter((x) => x.ally).reduce((t, x) => t + x.delta, 0)
      const againstSum = effects.filter((x) => !x.ally).reduce((t, x) => t + x.delta, 0)
      // Effet cumulé plafonné, réparti entre alliés et adversaires.
      const sum = withSum + againstSum
      const capped = clamp(sum, -PAIR_CAP, PAIR_CAP)
      const scale = sum !== 0 ? capped / sum : 0
      z += tw(catalog.tuning, 'pairs') * withSum * scale
      factor('allies')
      z += tw(catalog.tuning, 'pairs') * againstSum * scale
      factor('enemies')
      const notable = effects
        .map((x) => ({ ...x, points: sigmoid(logit(base) + x.delta) - base }))
        .filter((x) => x.games >= 30 && Math.abs(x.points) >= 0.005)
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, 3)
      for (const x of notable) {
        const p = pts(x.points)
        reasons.push(
          x.ally
            ? x.points > 0
              ? tr(`bon avec ${x.champ.label} (${p} pts)`, `good with ${x.champ.label} (${p} pts)`)
              : tr(
                  `moins bon avec ${x.champ.label} (${p} pts)`,
                  `weaker with ${x.champ.label} (${p} pts)`
                )
            : x.points > 0
              ? tr(
                  `fort contre ${x.champ.label} (${p} pts)`,
                  `strong vs ${x.champ.label} (${p} pts)`
                )
              : tr(
                  `souffre contre ${x.champ.label} (${p} pts)`,
                  `struggles vs ${x.champ.label} (${p} pts)`
                )
        )
      }

      // Composition adverse : taux de victoire mesuré face à ce type d'équipe.
      const comp = compShift(s, base)
      if (comp.shift !== 0) {
        z = logit(clamp(sigmoid(z) + comp.shift, 0.05, 0.95))
        factor('comp')
        if (comp.best && Math.abs(comp.shift) >= 0.006) reasons.push(comp.best)
      }
    }

    // Adversaire direct pas encore choisi : risque qu'il prenne un contre (risque moyen du poste
    // pour la part des affrontements inconnus).
    if (openEnemyJunglers.length) {
      const risk = blindOf(c, s, base)
      const cov = Math.min(1, risk.coverage / 0.6)
      const loss = cov * risk.loss + (1 - cov) * meanBlindLoss
      if (loss > 0) {
        z = logit(clamp(sigmoid(z) - COUNTER_PICK_RATE * loss, 0.05, 0.95))
        factor('blind')
      }
      if (risk.counters.length && risk.loss >= 0.012) {
        blind = 'risky'
        const names = risk.counters
          .slice(0, 2)
          .map((x) => x.label)
          .join(', ')
        reasons.push(tr(`contré par ${names}`, `countered by ${names}`))
      } else if (risk.coverage >= 0.6 && risk.loss < 0.004) {
        blind = 'safe'
        reasons.push(tr('peu de contres', 'few counters'))
      }
    }

    // Composition de l'équipe (dégâts, ligne de front).
    let fit = 0
    const p = profileOf(c, catalog.profiles)
    if (allies.length >= 2) {
      if (allyAp < 0.3 && p.ap >= 0.6) {
        fit += 0.012
        reasons.push(
          tr('apporte les dégâts magiques qui manquent', 'adds the missing magic damage')
        )
      } else if (allyAp > 0.7 && p.ap <= 0.4) {
        fit += 0.012
        reasons.push(
          tr('apporte les dégâts physiques qui manquent', 'adds the missing physical damage')
        )
      } else if ((allyAp < 0.3 && p.ap <= 0.3) || (allyAp > 0.7 && p.ap >= 0.7)) {
        fit -= 0.008
      }
      if (allyFront < 0.6 && p.tank >= 0.6) {
        fit += 0.008
        reasons.push(tr('ligne de front pour l’équipe', 'frontline for the team'))
      }
    }

    // Tes propres résultats sur ce champion à ce poste, lissés : 10 victoires sur 16 parties valent
    // environ +1,5 point, pas +12.
    let mine = 0
    const rec = personal?.get(c.id)
    if (rec && rec.games >= 3) {
      const est = sigmoid(z)
      mine = bayes(rec.games, rec.wins / rec.games, est, PERSONAL_K) - est
      if (rec.games >= 5)
        reasons.push(
          tr(
            `tes parties : ${rec.wins} V – ${rec.games - rec.wins} D`,
            `your games: ${rec.wins} W – ${rec.games - rec.wins} L`
          )
        )
    }

    // Maîtrise : seulement si celle du joueur est connue (client connecté).
    const mastery = masteryOf.get(c.key) ?? 0
    const comfort = masteryOf.size > 0 ? masteryEffect(mastery) : 0
    if (mastery >= 50000)
      reasons.push(
        tr(
          `${Math.round(mastery / 1000)} k points de maîtrise`,
          `${Math.round(mastery / 1000)}k mastery points`
        )
      )
    const winRate = sigmoid(z)
    // Peu de parties à ce poste : pick moins sûr (jusqu'à −1 point sous 200 parties).
    const games = s?.games ?? 0
    const unsure = games < LOW_DATA_GAMES ? -0.01 * (1 - games / LOW_DATA_GAMES) : 0
    if (unsure <= -0.002) factors.push({ kind: 'data', points: unsure })
    if (Math.abs(fit) >= 0.002) factors.push({ kind: 'team', points: fit })
    if (Math.abs(comfort) >= 0.002) factors.push({ kind: 'mastery', points: comfort })
    if (Math.abs(mine) >= 0.002) factors.push({ kind: 'personal', points: mine })
    return {
      champ: c,
      winRate,
      score: winRate + fit + comfort + mine + unsure,
      reasons,
      factors,
      inPool: poolIds.has(c.key),
      blind,
      lowData: games < LOW_DATA_GAMES,
      games: s?.games ?? 0,
      pickRate: s ? s.games / totalGames : 0,
      rank: 0
    }
  }

  // Classement complet des junglers jouables dans cette draft.
  const ranking = playable
    .map(scorePick)
    .sort((a, b) => b.score - a.score)
    .map((x, i) => ({ ...x, rank: i + 1 }))
  // Sélection : tes champions (jusqu'à 5), puis les meilleurs choix de la draft hors de tes
  // champions s'ils dépassent ton meilleur choix (jusqu'à 3).
  // (comparés sur le score, qui tient compte de ta maîtrise : un champion que tu ne joues pas doit
  // être nettement meilleur pour être proposé.)
  const fromPool = ranking.filter((x) => x.inPool).slice(0, 5)
  const bestMine = fromPool[0]?.score ?? 0
  const outside = ranking
    .filter((x) => !x.inPool && x.games >= 150 && x.score - bestMine >= 0.005)
    .slice(0, 3)
  const picks = fromPool.length
    ? [...fromPool, ...outside].sort((a, b) => b.score - a.score)
    : ranking.slice(0, 8)

  // Bans. Bannir un champion le retire aux deux équipes : le ban ne rapporte que si l'adversaire
  // l'aurait pris et pas ton équipe. D'où :
  // - à ton poste (c'est toi qui joues ce poste dans ton équipe, et tu ne le prendras pas) : les
  //   champions souvent joués, forts, et surtout ceux qui battent ton champion ou tes champions
  //   principaux ;
  // - aux autres postes : les champions très présents et forts, comptés pour une part seulement
  //   (un coéquipier aurait pu le prendre aussi).
  // La valeur d'un ban est le gain de taux de victoire attendu : probabilité que l'adversaire le
  // prenne × ce qu'il te coûte. On ne propose jamais de bannir un de tes propres champions.
  const myPick = draft.localChampId ? gd.champions.get(draft.localChampId) : undefined
  const myTop = byMastery.filter((c) => c.key !== myPick?.key).slice(0, 3)
  const targets: { champ: ChampInfo; weight: number }[] = [
    ...(myPick ? [{ champ: myPick, weight: 1 }] : []),
    ...myTop.map((champ, rank) => ({ champ, weight: [0.5, 0.3, 0.2][rank] * (myPick ? 0.4 : 1) }))
  ]
  const targetWeight = targets.reduce((t, x) => t + x.weight, 0) || 1
  const threats = catalog.threats ?? {}
  const threatGames = catalog.threatGames ?? 0
  const banCandidates = new Set([
    ...junglers.filter((c) => (stats[c.id]?.games ?? 0) >= 50).map((c) => c.id),
    ...Object.keys(threats)
  ])
  const banRanking: BanAdvice[] = [...banCandidates]
    .map((id) => gd.championsById.get(id))
    .filter((c): c is ChampInfo => !!c)
    .filter((c) => !taken.has(c.key) && !poolIds.has(c.key) && c.key !== myPick?.key)
    .map((c) => {
      const s: JunglerStat | undefined = stats[c.id]
      const threat = threats[c.id]
      const reasons: string[] = []
      const banRate = threat?.[2] ?? s?.banRate ?? null
      // Champion souvent banni par les autres : quand il passe, il est pris plus souvent.
      const open = 1 / (1 - Math.min(0.6, banRate ?? 0))

      // À ton poste : probabilité de l'affronter, sa force, et ce qu'il fait à tes champions.
      let laneValue = 0
      let laneCost = 0
      const laneShare = s && s.games >= 50 ? Math.min(0.6, (s.games / totalGames) * open) : 0
      if (s && laneShare > 0) {
        const strength = baseOf(s) - prior.mean
        let matchup = 0
        let worst: { mine: ChampInfo; effect: number; cell: [number, number] } | null = null
        for (const { champ: mine, weight } of targets) {
          // Affrontement vu de ton champion, sinon vu de l'adversaire (inversé).
          const theirs = s.vs[mine.id]
          const mineStat = stats[mine.id]
          const cell: [number, number] | undefined =
            mineStat?.vs[c.id] ?? (theirs ? [theirs[0], 1 - theirs[1]] : undefined)
          if (!cell) continue
          const mineBase = mineStat ? baseOf(mineStat) : prior.mean
          // Ce que cet adversaire coûte à ton champion, au-delà de sa force habituelle.
          const effect = mineBase - bayes(cell[0], cell[1], mineBase, P.vs) - strength
          matchup += (weight / targetWeight) * effect
          if (cell[0] >= 20 && effect >= 0.004 && (!worst || effect > worst.effect))
            worst = { mine, effect, cell }
        }
        laneCost = Math.max(0, strength + matchup)
        laneValue = laneShare * laneCost
        if (laneShare >= 0.03 || strength >= 0.01)
          reasons.push(
            tr(
              `${pct(s.games / totalGames)} des parties à ton poste · ${pct(baseOf(s))} estimé`,
              `${pct(s.games / totalGames)} of games in your role · ${pct(baseOf(s))} estimated`
            )
          )
        const w = worst as { mine: ChampInfo; effect: number; cell: [number, number] } | null
        if (w)
          reasons.push(
            tr(
              `bat ${w.mine.label} : ${pts(-w.effect)} pt (${pct(w.cell[1])} pour toi sur ${w.cell[0]} parties)`,
              `beats ${w.mine.label}: ${pts(-w.effect)} pt (${pct(w.cell[1])} for you over ${w.cell[0]} games)`
            )
          )
      }

      // Tous postes : présence dans l'équipe adverse et force (hors ton poste, déjà compté).
      let otherValue = 0
      let otherChance = 0
      let otherCost = 0
      if (threat && threatGames > 0) {
        const presence = Math.min(0.8, (threat[0] / threatGames) * open)
        const strength = bayes(threat[0], threat[1], 0.5, prior.k) - 0.5
        const elsewhere = Math.max(0, presence - laneShare)
        otherChance = elsewhere
        otherCost = Math.max(0, strength)
        otherValue = OTHER_ROLE_BAN * otherChance * otherCost
        if (elsewhere >= 0.05 && strength >= 0.008)
          reasons.push(
            tr(
              `dans ${pct(threat[0] / threatGames)} des équipes adverses, tous postes · ${pct(0.5 + strength)}`,
              `in ${pct(threat[0] / threatGames)} of enemy teams, all roles · ${pct(0.5 + strength)}`
            )
          )
      }
      if (banRate !== null && banRate >= 0.1)
        reasons.push(
          tr(`banni dans ${pct(banRate)} des parties`, `banned in ${pct(banRate)} of games`)
        )
      const winRate = s && s.games >= 50 ? baseOf(s) : threat ? threat[1] : prior.mean
      // À valeur égale (ou nulle), les champions les plus joués à ton poste d'abord.
      const tieBreak = 1e-4 * (s && s.games >= 50 ? s.games / totalGames : 0)
      const lane = laneValue >= otherValue
      return {
        champ: c,
        score: laneValue + otherValue + tieBreak,
        chance: lane ? laneShare : otherChance,
        cost: lane ? laneCost : otherCost,
        reasons,
        banRate,
        winRate
      }
    })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score)
  const bans = banRanking.slice(0, 5)

  return {
    picks,
    ranking,
    bans,
    banRanking,
    myPick: myPick ? (ranking.find((x) => x.champ.key === myPick.key) ?? null) : null,
    enemyJungler,
    known: { allies: Math.min(4, allies.length), enemies: Math.min(5, enemies.length) }
  }
}

/** Avis sur le champion survolé, comparé aux autres choix possibles dans cette draft. */
export interface PickVerdict {
  champ: ChampInfo
  /** Évaluation du champion dans cette draft (null : pas de statistiques à ce poste). */
  pick: PickAdvice | null
  /**
   * best : parmi les meilleurs choix ; good : proche du meilleur ; ok : jouable ; bad : nettement
   * moins bon que d'autres choix ; unknown : champion (presque) jamais joué à ce poste.
   */
  level: 'best' | 'good' | 'ok' | 'bad' | 'unknown'
  /** Écart avec le meilleur choix (points de taux de victoire estimé, ≥ 0). */
  gap: number
  /** Meilleur choix de la draft. */
  best: PickAdvice | null
  /** Choix nettement meilleurs, tes champions d'abord (3 au plus). */
  better: PickAdvice[]
  total: number
}

/** Écarts (en points de taux de victoire estimé) qui séparent les niveaux d'avis. */
export const VERDICT_GAPS = { best: 0.005, good: 0.015, ok: 0.03 }

export function pickVerdict(advice: DraftAdvice, champ: ChampInfo): PickVerdict {
  const pick = advice.ranking.find((x) => x.champ.key === champ.key) ?? null
  // Référence : le meilleur choix assez joué (un champion à 40 parties peut être en tête par hasard).
  const best = advice.ranking.find((x) => !x.lowData) ?? advice.ranking[0] ?? null
  const total = advice.ranking.length
  if (!pick || !best) {
    const better = advice.picks.slice(0, 3)
    return { champ, pick: null, level: 'unknown', gap: 0, best, better, total }
  }
  const gap = Math.max(0, best.score - pick.score)
  const level: PickVerdict['level'] =
    gap <= VERDICT_GAPS.best
      ? 'best'
      : gap <= VERDICT_GAPS.good
        ? 'good'
        : gap <= VERDICT_GAPS.ok && pick.winRate >= 0.485
          ? 'ok'
          : 'bad'
  // Alternatives nettement meilleures (≥ 1 point), de préférence parmi tes champions.
  const ahead = advice.ranking.filter((x) => x.score - pick.score >= 0.01 && !x.lowData)
  const better = [...ahead.filter((x) => x.inPool), ...ahead.filter((x) => !x.inPool)].slice(0, 3)
  return { champ, pick, level, gap, best, better, total }
}
