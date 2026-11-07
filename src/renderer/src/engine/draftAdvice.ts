import type { ChampionPool, DraftState } from '../../../shared/types'
import type { Catalog, JunglerStat } from './catalog'
import type { ChampInfo, GameData } from './gameData'
import { analyzeThreat, profileOf } from './threat'
import { CONTEXT_LABEL, contextWeights } from './variants'
import type { SituationContext } from '../data/junglers'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'
import { tw } from './tuning'

// Conseils de pick et de ban pour la jungle, à partir des statistiques Master+ du patch :
// - taux de victoire de chaque jungler ;
// - affrontement avec le jungler adverse, s'il est connu ;
// - taux de victoire avec chaque allié et contre chaque adversaire déjà choisis (la draft est
//   souvent incomplète quand on choisit : seuls les champions visibles comptent) ;
// - risque d'être contré quand le jungler adverse n'est pas encore choisi ;
// - équilibre de la composition, maîtrise du joueur et ses propres résultats (bilans).

/** Effet d'un critère sur le taux de victoire estimé d'un pick, en points (0,01 = 1 point). */
export interface PickFactor {
  kind: 'meta' | 'vs' | 'allies' | 'enemies' | 'comp' | 'blind' | 'team' | 'mastery' | 'personal'
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
  score: number
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

const bayes = (games: number, wr: number, prior: number, k: number): number =>
  (wr * games + prior * k) / (games + k)
const logit = (p: number): number => Math.log(p / (1 - p))
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
const pct = (x: number): string => fmtPct(x, 1)
const pts = (x: number): string => `${x > 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`

/** Lissage des paires (allié / adversaire) : il faut beaucoup de parties pour s'écarter du global. */
const PAIR_K = 40
/** Effet cumulé maximal des alliés et adversaires, en log-odds (≈ ±6 points). */
const PAIR_CAP = 0.25
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

  // Junglers connus : statistiques du patch, sinon base de builds.
  const jungleIds = new Set([...Object.keys(stats), ...catalog.builds.keys()])
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
  const baseOf = (j: JunglerStat): number => bayes(j.games, j.winRate, 0.5, 60)
  const generalEffect = (champ: ChampInfo, side: 'with' | 'against'): number => {
    let weight = 0
    let sum = 0
    for (const j of Object.values(stats)) {
      const pair = j[side][champ.id]
      if (!pair) continue
      weight += pair[0]
      sum += pair[0] * pairDelta(pair, baseOf(j), PAIR_K)
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
  const ctxWeights =
    otherEnemies.length + (enemyJungler ? 1 : 0) >= 2
      ? contextWeights(analyzeThreat(gd, draft.enemyIds, [], null, null, catalog.profiles))
      : {}
  const compShift = (s: JunglerStat, base: number): { shift: number; best: string | null } => {
    let sum = 0
    let weightSum = 0
    let best: { label: string; value: number } | null = null
    for (const [ctx, w] of Object.entries(ctxWeights) as [SituationContext, number][]) {
      const cell = s.contexts?.[ctx]
      if (!cell || w <= 0) continue
      const rate = bayes(cell[0], cell[1], base, 60)
      sum += w * (rate - base)
      weightSum += w
      const label = CONTEXT_LABEL[ctx]
      if (label && Math.abs(w * (rate - base)) > (best ? Math.abs(best.value) : 0.008))
        best = {
          label: `${tr(label[0], label[1])} ${pct(cell[1])}`,
          value: w * (rate - base)
        }
    }
    return { shift: clamp(sum / Math.max(1, weightSum), -0.04, 0.04), best: best?.label ?? null }
  }

  const scorePick = (c: ChampInfo): PickAdvice => {
    const s: JunglerStat | undefined = stats[c.id]
    const reasons: string[] = []
    const factors: PickFactor[] = []
    const base = s ? bayes(s.games, s.winRate, 0.5, 60) : 0.5
    // Poids des critères réglés par le pipeline de méta (1 sans réglage).
    let z = tw(catalog.tuning, 'pick') * logit(base)
    // Chaque critère est noté par son effet en points de taux de victoire.
    let last = sigmoid(z)
    const factor = (kind: PickFactor['kind']): void => {
      const now = sigmoid(z)
      if (Math.abs(now - last) >= 0.002) factors.push({ kind, points: now - last })
      last = now
    }
    if (Math.abs(last - 0.5) >= 0.002) factors.push({ kind: 'meta', points: last - 0.5 })
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
      z += tw(catalog.tuning, 'vs') * pairDelta(s.vs[enemyJungler.id], base, 25)
      factor('vs')
      if (g >= 8)
        reasons.push(
          tr(
            `${pct(vsWr)} contre ${enemyJungler.label} (${g} parties)`,
            `${pct(vsWr)} vs ${enemyJungler.label} (${g} games)`
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
        const delta = pairDelta(pair, base, PAIR_K) - (general.get(`${side}:${champ.id}`) ?? 0)
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
        .filter((x) => x.games >= 30 && Math.abs(x.points) >= 0.01)
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

      // Jungler adverse pas encore choisi : risque qu'il prenne un contre.
      if (openEnemyJunglers.length) {
        const known = openEnemyJunglers
          .filter((e) => e.id !== c.id && (s.vs[e.id]?.[0] ?? 0) >= 15)
          .map((e) => ({ e, wr: bayes(s.vs[e.id][0], s.vs[e.id][1], base, 25) }))
        const coverage =
          known.reduce((t, x) => t + (stats[x.e.id]?.games ?? 0), 0) /
          openEnemyJunglers.reduce((t, e) => t + (stats[e.id]?.games ?? 0), 0)
        const counters = known.filter((x) => x.wr <= base - 0.02).sort((a, b) => a.wr - b.wr)
        if (counters.length) {
          const worst = counters.slice(0, 3)
          const loss = base - worst.reduce((t, x) => t + x.wr, 0) / worst.length
          z = logit(clamp(sigmoid(z) - COUNTER_PICK_RATE * loss, 0.05, 0.95))
          factor('blind')
          if (loss >= 0.03) {
            blind = 'risky'
            const names = counters
              .slice(0, 2)
              .map((x) => x.e.label)
              .join(', ')
            reasons.push(tr(`contré par ${names}`, `countered by ${names}`))
          }
        } else if (coverage >= 0.6) {
          blind = 'safe'
          reasons.push(tr('peu de contres', 'few counters'))
        }
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

    // Tes propres résultats sur ce champion (léger : peu de parties).
    let mine = 0
    const rec = personal?.get(c.id)
    if (rec && rec.games >= 3) {
      const est = sigmoid(z)
      mine = 0.5 * (bayes(rec.games, rec.wins / rec.games, est, 10) - est)
      if (rec.games >= 5)
        reasons.push(
          tr(
            `tes parties : ${rec.wins} V – ${rec.games - rec.wins} D`,
            `your games: ${rec.wins} W – ${rec.games - rec.wins} L`
          )
        )
    }

    const mastery = masteryOf.get(c.key) ?? 0
    const comfort = mastery > 0 ? Math.min(0.015, Math.log10(mastery) / 400) : 0
    if (mastery >= 50000)
      reasons.push(
        tr(
          `${Math.round(mastery / 1000)} k points de maîtrise`,
          `${Math.round(mastery / 1000)}k mastery points`
        )
      )
    const winRate = sigmoid(z)
    if (Math.abs(fit) >= 0.002) factors.push({ kind: 'team', points: fit })
    if (comfort >= 0.002) factors.push({ kind: 'mastery', points: comfort })
    if (Math.abs(mine) >= 0.002) factors.push({ kind: 'personal', points: mine })
    return {
      champ: c,
      winRate,
      score: winRate + fit + comfort + mine,
      reasons,
      factors,
      inPool: poolIds.has(c.key),
      blind,
      lowData: (s?.games ?? 0) < 200,
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
  const fromPool = ranking.filter((x) => x.inPool).slice(0, 5)
  const bestMine = fromPool[0]?.winRate ?? 0
  const outside = ranking
    .filter((x) => !x.inPool && x.games >= 150 && x.winRate - bestMine >= 0.01)
    .slice(0, 3)
  const picks = fromPool.length
    ? [...fromPool, ...outside].sort((a, b) => b.score - a.score)
    : ranking.slice(0, 8)

  // Bans : junglers forts et fréquents (et souvent bannis), ceux qui battent ton champion choisi
  // ou tes champions principaux, ceux qui sont forts contre tes alliés déjà choisis et avec les
  // adversaires déjà choisis. On ne propose jamais de bannir un de tes propres champions.
  const myPick = draft.localChampId ? gd.champions.get(draft.localChampId) : undefined
  const myTop = byMastery.filter((c) => c.key !== myPick?.key).slice(0, 3)
  const targets: { champ: ChampInfo; weight: number }[] = [
    ...(myPick ? [{ champ: myPick, weight: 1.5 }] : []),
    ...myTop.map((champ, rank) => ({ champ, weight: [1, 0.6, 0.4][rank] * (myPick ? 0.5 : 1) }))
  ]
  const generalCache = new Map<string, number>()
  const generalOf = (champ: ChampInfo, side: 'with' | 'against'): number => {
    const k = `${side}:${champ.id}`
    if (!generalCache.has(k)) generalCache.set(k, generalEffect(champ, side))
    return generalCache.get(k)!
  }
  const banRanking: BanAdvice[] = junglers
    .filter((c) => !taken.has(c.key) && !poolIds.has(c.key) && c.key !== myPick?.key)
    .filter((c) => (stats[c.id]?.games ?? 0) >= 50)
    .map((c) => {
      const s = stats[c.id]
      const reasons: string[] = []
      const base = baseOf(s)
      const strength = base - 0.5
      const presence = Math.sqrt(s.games / totalGames)
      let score = strength * (0.5 + 3 * presence)
      if (strength > 0.01)
        reasons.push(
          tr(
            `${pct(s.winRate)} sur ${fmtNumber(s.games)} parties`,
            `${pct(s.winRate)} over ${fmtNumber(s.games)} games`
          )
        )
      // Souvent banni à ce niveau : les joueurs le jugent pénible à affronter.
      if (s.banRate !== undefined) {
        score += 0.02 * Math.min(1, s.banRate / 0.3)
        if (s.banRate >= 0.1)
          reasons.push(
            tr(`banni dans ${pct(s.banRate)} des parties`, `banned in ${pct(s.banRate)} of games`)
          )
      }
      for (const { champ: mine, weight } of targets) {
        // Affrontement vu de ton champion, sinon vu de l'adversaire (inversé).
        const theirs = s.vs[mine.id]
        const vs: [number, number] | undefined =
          stats[mine.id]?.vs[c.id] ?? (theirs ? [theirs[0], 1 - theirs[1]] : undefined)
        if (vs && vs[0] >= 8) {
          const delta = 0.5 - bayes(vs[0], vs[1], 0.5, 20)
          score += delta * 0.8 * weight
          if (vs[1] < 0.47)
            reasons.push(
              tr(
                `bat ${mine.label} (${pct(vs[1])} pour toi)`,
                `beats ${mine.label} (${pct(vs[1])} for you)`
              )
            )
        }
      }
      // Fort contre tes alliés déjà choisis, ou avec les adversaires déjà choisis.
      let draftSum = 0
      let bestPair: { champ: ChampInfo; points: number; ally: boolean } | null = null
      const pair = (champ: ChampInfo, side: 'with' | 'against', ally: boolean): void => {
        const cell = s[side][champ.id]
        if (!cell) return
        const general = generalOf(champ, side)
        const d = pairDelta(cell, base, PAIR_K) - general
        draftSum += d
        const points = sigmoid(logit(base) + d) - base
        if (cell[0] >= 30 && points >= 0.01 && (!bestPair || points > bestPair.points))
          bestPair = { champ, points, ally }
      }
      for (const a of allies) pair(a, 'against', true)
      for (const e of otherEnemies) pair(e, 'with', false)
      score += 0.25 * (sigmoid(clamp(draftSum, -PAIR_CAP, PAIR_CAP)) - 0.5)
      const bp = bestPair as { champ: ChampInfo; points: number; ally: boolean } | null
      if (bp)
        reasons.push(
          bp.ally
            ? tr(
                `fort contre ton allié ${bp.champ.label} (${pts(bp.points)} pts)`,
                `strong vs your ally ${bp.champ.label} (${pts(bp.points)} pts)`
              )
            : tr(
                `bon avec ${bp.champ.label} (adverse, ${pts(bp.points)} pts)`,
                `good with enemy ${bp.champ.label} (${pts(bp.points)} pts)`
              )
        )
      return { champ: c, score, reasons, banRate: s.banRate ?? null, winRate: s.winRate }
    })
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
  const best = advice.ranking[0] ?? null
  const total = advice.ranking.length
  if (!pick || !best) {
    const better = advice.picks.slice(0, 3)
    return { champ, pick: null, level: 'unknown', gap: 0, best, better, total }
  }
  const gap = Math.max(0, best.score - pick.score)
  const level: PickVerdict['level'] =
    pick.rank <= 3 || gap <= VERDICT_GAPS.best
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
