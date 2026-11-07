import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  EMPTY_DRAFT,
  type DraftState,
  type GamePhase,
  type LcuStatus,
  type LiveGameData,
  type LivePlayer,
  type ChampionPool,
  type RecommendedRunePage,
  type Settings
} from '../../../shared/types'
import {
  computeDraftAdvice,
  findEnemyJungler,
  type DraftAdvice,
  type PersonalRecord
} from '../engine/draftAdvice'
import {
  adaptChoices,
  junglerMatchup,
  type ChoiceNote,
  type JunglerMatchup
} from '../engine/choices'
import {
  defaultCatalog,
  getBuild,
  roleBaseCatalog,
  mergeOverride,
  validateCatalog,
  type Catalog
} from '../engine/catalog'
import { champFromLive, loadGameData, type ChampInfo, type GameData } from '../engine/gameData'
import {
  buildItemPlan,
  purchaseAlert,
  toItemSet,
  type ItemPlan,
  type PurchaseAlert
} from '../engine/items'
import { RIOT_COMPLIANT } from '../../../shared/edition'
import { buildRunePage, type ResolvedRunePage } from '../engine/runes'
import { chooseVariant, type VariantChoice } from '../engine/variants'
import { tw } from '../engine/tuning'
import { analyzeThreat, findMe, type ThreatProfile } from '../engine/threat'
import { META_PATCH, type JunglerBuild } from '../data/junglers'
import { liveNudges, type Nudge } from '../engine/learning'
import { DEFAULT_BENCH_BY_ROLE } from '../engine/postgame'
import { useReview, type ReviewState } from './useReview'
import { useRemoteMeta } from './useRemoteMeta'
import {
  clientPosition,
  defaultStart,
  detectRole,
  readRole,
  roleLabel,
  roleMetaUrl,
  saveRole,
  type Role
} from '../engine/role'
import { appendDraftLog } from '../engine/selfCheck'
import {
  GOLD_MIN_GAMES,
  metaAgeDays,
  metaLevelFor,
  readTier,
  saveTier,
  type MetaLevel
} from '../engine/metaLevel'
import { fmtNumber, getLang, setLang, tr, type Lang } from '../../../shared/i18n'

export type SyncState =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ok'; at: number }
  | { state: 'error'; message: string }
  | { state: 'disabled' }

export interface TactiqueState {
  /** Langue effective de l'application. */
  lang: Lang
  gd: GameData | null
  loadError: string | null
  catalog: Catalog
  catalogNote: string | null
  /** Niveau des données utilisé (Master+, ou Or à Émeraude par-dessus Master+). */
  metaLevel: MetaLevel
  /** La méta Or à Émeraude est-elle réellement utilisée ? */
  goldActive: boolean
  /** Rang classé du joueur (dernier connu). */
  rankTier: string | null
  /** Âge de la méta en jours quand elle a plus de 2 jours (collecte en panne ?). */
  metaStaleDays: number | null
  validation: string[]
  settings: Settings
  saveSettings: (s: Settings) => Promise<void>
  lcuStatus: LcuStatus
  phase: GamePhase
  draft: DraftState
  live: LiveGameData | null
  /** Joueur local dans les données de partie. */
  me: LivePlayer | null

  champ: ChampInfo | null
  build: JunglerBuild | null
  genericBuild: boolean
  /** Famille de build choisie quand le champion en a plusieurs en Master+. */
  variant: VariantChoice | null
  /** Runes, bottes, familier ou compétences adaptés à la partie (et pourquoi). */
  choiceNotes: ChoiceNote[]
  /** Jungler adverse : combats par période et début de partie habituel (avant la partie). */
  matchup: JunglerMatchup | null
  threat: ThreatProfile | null
  runePage: ResolvedRunePage | null
  plan: ItemPlan | null
  currentGold: number
  runeSync: SyncState
  itemSetSync: SyncState
  /** Poste joué (réglage, poste attribué en sélection ou détecté en partie). */
  role: Role
  /** Conseils de pick et de ban (pendant la sélection, avant le verrouillage). */
  advice: DraftAdvice | null
  /** Bilans d'après-partie et apprentissage. */
  review: ReviewState
  /** Rappels en partie tirés de vos points faibles récurrents. */
  nudges: Nudge[]
  /** Alerte d'achat à la base (édition personnelle). */
  purchase: PurchaseAlert | null
}

const INJECT_DELAY = 700
const ITEMSET_DELAY = 1500
const RESET_PHASES = ['None', 'Lobby', 'Matchmaking']

/** État d'un envoi au client, rattaché à la version de la page/du set qu'il concerne. */
interface KeyedSync {
  key: string
  sync: SyncState
}

export function useTactique(): TactiqueState {
  const [gd, setGd] = useState<GameData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lang, setLangState] = useState<Lang>(getLang())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [lcuStatus, setLcuStatus] = useState<LcuStatus>('disconnected')
  const [phase, setPhase] = useState<GamePhase>('None')
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [live, setLive] = useState<LiveGameData | null>(null)
  const [riot, setRiot] = useState<{ key: number; pages: RecommendedRunePage[] }>({
    key: 0,
    pages: []
  })
  const [runeState, setRuneState] = useState<KeyedSync>({ key: '', sync: { state: 'idle' } })
  const [itemSetState, setItemSetState] = useState<KeyedSync>({ key: '', sync: { state: 'idle' } })
  const [pool, setPool] = useState<ChampionPool | null>(null)
  const appliedRunes = useRef('')
  const appliedItemSet = useRef('')

  // Données Riot (avec nouvel essai si le réseau n'est pas encore prêt).
  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = (): void => {
      loadGameData()
        .then((data) => {
          if (cancelled) return
          setGd(data)
          setLoadError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setLoadError(String(err?.message ?? err))
          retry = setTimeout(load, 10000)
        })
    }
    load()
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
    }
  }, [])

  // Connexion au processus principal.
  useEffect(() => {
    const api = window.api
    const onPhase = (p: GamePhase): void => {
      // Nouvelle file / nouveau salon : les prochains envois repartent de zéro.
      if (RESET_PHASES.includes(p)) {
        appliedRunes.current = ''
        appliedItemSet.current = ''
      }
      setPhase(p)
    }
    void api.getSettings().then(setSettings)
    // La langue est appliquée au module i18n avant le nouveau rendu : tous les textes calculés
    // (moteur, interface) suivent alors la langue choisie.
    const onLang = (l: Lang): void => {
      setLang(l)
      setLangState(l)
    }
    void api.getInitialState().then((s) => {
      if (s.lang) onLang(s.lang)
      setLcuStatus(s.status)
      onPhase(s.phase)
      setDraft(s.draft)
    })
    const offs = [
      api.onLcuStatus(setLcuStatus),
      api.onPhaseUpdate(onPhase),
      api.onDraftUpdate(setDraft),
      api.onLiveUpdate(setLive),
      api.onLangUpdate(onLang)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Rang classé du joueur (méta Or à Émeraude ou Master+ en mode automatique).
  const [tier, setTier] = useState<string | null>(() => readTier())
  useEffect(() => {
    if (lcuStatus !== 'connected' || phase === 'InProgress') return
    let cancelled = false
    void window.api.getRankedTier().then((t) => {
      if (cancelled || !t) return
      setTier(t)
      saveTier(t)
    })
    return () => {
      cancelled = true
    }
  }, [lcuStatus, phase])
  const metaLevel = metaLevelFor(settings.metaLevel, tier)

  // Poste joué : chaque poste a sa méta (builds, draft, repères).
  const liveMe = useMemo(() => (gd ? findMe(gd, live, null) : null), [gd, live])
  const role = detectRole({
    setting: settings.role,
    assigned: draft.position,
    live: liveMe?.position || null,
    hasSmite: draft.hasSmite,
    last: readRole()
  })
  useEffect(() => saveRole(role), [role])
  const jungle = role === 'jungle'

  // Méta distante du poste : Master+, et Or à Émeraude par-dessus pour les joueurs de ces rangs
  // (les champions qui n'y ont pas encore assez de parties gardent les données Master+).
  const masterUrl = settings.metaUrl ? roleMetaUrl(settings.metaUrl, role, false) : null
  const master = useRemoteMeta(masterUrl, jungle)
  const goldUrl = metaLevel === 'gold' ? roleMetaUrl(settings.metaUrl, role, true) : null
  const gold = useRemoteMeta(goldUrl, jungle)
  const goldReady = !!gold?.catalog && (gold.info?.sampleGames ?? 0) >= GOLD_MIN_GAMES
  const catalog = useMemo(() => {
    const base = master?.catalog ?? (jungle ? defaultCatalog() : roleBaseCatalog())
    return goldReady && gold ? mergeOverride(base, gold.data).catalog : base
  }, [master, gold, goldReady, jungle])
  // Méta vieille de plus de 2 jours : la collecte nocturne a sans doute échoué.
  const metaStaleDays = useMemo(() => {
    const age = metaAgeDays((goldReady ? gold : master)?.info?.generatedAt)
    return age !== null && age > 2 ? Math.floor(age) : null
  }, [master, gold, goldReady])
  const catalogNote = useMemo(() => {
    if (!master) return null
    if (master.error || !master.catalog || !master.info)
      return tr(
        `URL de méta inaccessible (${master.error}) : base intégrée utilisée.`,
        `Meta URL unreachable (${master.error}): built-in database used.`
      )
    const i = master.info
    const date = i.generatedAt
      ? new Date(i.generatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR')
      : null
    const patch = master.catalog.patch
    const offline = i.cachedAt
      ? tr(
          ' Copie locale : la version en ligne n’a pas encore répondu.',
          ' Local copy: the online version has not answered yet.'
        )
      : ''
    const levelNote =
      metaLevel !== 'gold'
        ? ''
        : goldReady && gold?.info
          ? tr(
              ` Données Or à Émeraude (${fmtNumber(gold.info.sampleGames ?? 0)} parties) pour les builds, la draft et le bilan, Master+ pour le reste.`,
              ` Gold to Emerald data (${fmtNumber(gold.info.sampleGames ?? 0)} games) for builds, draft and review, Master+ for the rest.`
            )
          : tr(
              ' Données Or à Émeraude pas encore disponibles : Master+ utilisé.',
              ' Gold to Emerald data not available yet: Master+ used.'
            )
    const tuned = catalog.tuning
      ? tr(
          ` Moteur réglé automatiquement sur ${fmtNumber(catalog.tuning.games)} parties.`,
          ` Engine auto-tuned on ${fmtNumber(catalog.tuning.games)} games.`
        )
      : ''
    const stale = metaStaleDays
      ? tr(
          ` ⚠ Méta vieille de ${metaStaleDays} jours : la collecte nocturne a peut-être échoué (onglet Actions de tactique-meta).`,
          ` ⚠ Meta is ${metaStaleDays} days old: the nightly collection may have failed (tactique-meta Actions tab).`
        )
      : ''
    return (
      `${roleLabel(role)} — ` +
      (lang === 'en'
        ? `Remote meta patch ${patch}: ${i.accepted} builds` +
          (i.sampleGames ? ` computed from ${fmtNumber(i.sampleGames)} games` : '') +
          (date ? ` (updated ${date})` : '') +
          (i.rejected ? `, ${i.rejected} ignored (invalid format)` : '') +
          '.'
        : `Méta distante patch ${patch} : ${i.accepted} builds` +
          (i.sampleGames ? ` calculés sur ${fmtNumber(i.sampleGames)} parties` : '') +
          (date ? ` (mise à jour du ${date})` : '') +
          (i.rejected ? `, ${i.rejected} ignorés (format invalide)` : '') +
          '.') +
      levelNote +
      tuned +
      stale +
      offline
    )
  }, [master, gold, goldReady, metaLevel, catalog, metaStaleDays, role, lang])

  const validation = useMemo(
    () => (gd ? validateCatalog(gd, catalog).issues : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, catalog, lang]
  )

  // Champion local : sélection, sinon données de partie (app lancée pendant la partie).
  const champ = useMemo<ChampInfo | null>(() => {
    if (!gd) return null
    if (draft.localChampId) return gd.champions.get(draft.localChampId) ?? null
    const me = findMe(gd, live, null)
    return me ? (champFromLive(gd, me.rawChampionName, me.championName) ?? null) : null
  }, [gd, draft.localChampId, live])

  const { baseBuild, genericBuild } = useMemo(() => {
    if (!champ) return { baseBuild: null, genericBuild: false }
    const res = getBuild(catalog, champ, jungle)
    // Hors jungle, sans départ dans la méta : départ habituel du poste (Doran…).
    const build =
      jungle || res.build.start?.length
        ? res.build
        : { ...res.build, start: defaultStart(res.build.archetype, role) }
    return { baseBuild: build, genericBuild: res.generic }
  }, [catalog, champ, jungle, role])

  // Pages de runes recommandées par Riot pour ce champion.
  const champKey = champ?.key ?? 0
  useEffect(() => {
    if (!champKey || lcuStatus !== 'connected' || riot.key === champKey) return
    const timer = setTimeout(() => {
      void window.api
        .getRecommendedRunes(champKey, draft.position || clientPosition(role))
        .then((pages) => setRiot({ key: champKey, pages }))
        .catch(() => setRiot({ key: champKey, pages: [] }))
    }, 300)
    return () => clearTimeout(timer)
  }, [champKey, lcuStatus, draft.position, riot.key, role])

  // Champions du joueur (maîtrise), relus à chaque nouvelle sélection.
  useEffect(() => {
    if (lcuStatus !== 'connected' || phase !== 'ChampSelect') return
    let cancelled = false
    void window.api.getChampionPool().then((p) => {
      if (!cancelled) setPool(p)
    })
    return () => {
      cancelled = true
    }
  }, [lcuStatus, phase])

  const threat = useMemo(
    () =>
      gd
        ? analyzeThreat(
            gd,
            draft.enemyIds,
            draft.allyIds,
            live,
            champ?.id ?? null,
            catalog.profiles
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, draft.enemyIds, draft.allyIds, live, champ, catalog.profiles, lang]
  )
  const me = useMemo(() => (gd ? findMe(gd, live, champ?.id ?? null) : null), [gd, live, champ])

  // Famille de build (ex. crit ou létalité) : choisie selon la partie, puis suivie une fois commencée.
  const variant = useMemo(
    () =>
      gd && baseBuild && threat
        ? chooseVariant(gd, baseBuild, threat, me, catalog.itemCounters, catalog.tuning)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, baseBuild, threat, me, catalog.itemCounters, catalog.tuning, lang]
  )
  // Jungler adverse (sélection ou partie) et adaptation des runes, bottes, familier et compétences.
  // Adversaire direct : en partie, l'adversaire au même poste (quand le jeu le donne) ; sinon celui
  // qui joue le plus souvent ce poste parmi les adversaires visibles.
  const enemyJungler = useMemo(() => {
    if (!threat || !gd) return null
    const myPos = liveMe?.position
    if (live && myPos && liveMe) {
      const foe = live.allPlayers.find((p) => p.team !== liveMe.team && p.position === myPos)
      const champ = foe ? champFromLive(gd, foe.rawChampionName, foe.championName) : null
      if (champ) return champ
    }
    return findEnemyJungler(
      catalog,
      threat.enemies.map((e) => e.champ)
    )
  }, [catalog, threat, gd, live, liveMe])
  const adapted = useMemo(() => {
    const b = variant?.build ?? baseBuild
    if (!b) return null
    if (!threat || genericBuild) return { build: b, notes: [] }
    return adaptChoices(
      b,
      threat,
      enemyJungler,
      variant?.chosen?.variant.runeChoices,
      catalog.tuning
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
  }, [variant, baseBuild, threat, genericBuild, enemyJungler, catalog.tuning, lang])
  const build = adapted?.build ?? null
  // Affrontement de junglers : seulement avant la partie (statistiques, rien de ce qui se passe en jeu).
  // Édition publique : avant la partie seulement (rien de ce qui se passe en jeu).
  const matchup = useMemo(
    () =>
      (!live || !RIOT_COMPLIANT) && champ && enemyJungler && enemyJungler.id !== champ.id
        ? junglerMatchup(catalog, champ, enemyJungler)
        : null,
    [live, champ, enemyJungler, catalog]
  )
  const currentGold = live?.activePlayer?.currentGold ?? 0

  const runePage = useMemo(() => {
    if (!gd || !champ || !threat) return null
    const pages = riot.key === champ.key ? riot.pages : []
    // Chaque build porte son propre patch : un build d'un ancien patch laisse la place aux runes Riot.
    const buildPatch = build?.patch ?? META_PATCH
    return buildRunePage(
      gd,
      champ.label,
      genericBuild ? null : build,
      buildPatch,
      pages,
      settings.runeSource,
      threat
    )
  }, [gd, champ, threat, riot, genericBuild, build, settings.runeSource])

  const review = useReview(
    gd,
    catalog,
    role,
    { url: settings.metaUrl, level: metaLevel },
    settings.autoReview,
    lang
  )

  // Résultats du joueur par champion (bilans), pour les conseils de pick.
  const personalRecord = useMemo(() => {
    const m: PersonalRecord = new Map()
    for (const r of review.reports) {
      if (!r.champ) continue
      const rec = m.get(r.champ.id) ?? { games: 0, wins: 0 }
      rec.games++
      if (r.win) rec.wins++
      m.set(r.champ.id, rec)
    }
    return m
  }, [review.reports])

  const advice = useMemo(
    () =>
      gd && phase === 'ChampSelect' && !draft.isLocked
        ? computeDraftAdvice(
            gd,
            catalog,
            draft,
            pool,
            settings.personalLearning ? personalRecord : null
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, phase, draft, catalog, pool, personalRecord, settings.personalLearning, lang]
  )
  // Journal de draft : ton champion au moment du verrouillage et son rang dans le classement de
  // l'app (comparé ensuite à tes résultats, onglet Bilan).
  const lastAdvice = useRef<DraftAdvice | null>(null)
  const wasLocked = useRef(false)
  useEffect(() => {
    if (advice) lastAdvice.current = advice
  }, [advice])
  useEffect(() => {
    const locked = phase === 'ChampSelect' && draft.isLocked
    if (locked && !wasLocked.current) {
      const a = lastAdvice.current
      const mine = a?.myPick
      if (a && mine && mine.champ.key === draft.localChampId)
        appendDraftLog({
          t: Date.now(),
          champ: mine.champ.id,
          rank: mine.rank,
          total: a.ranking.length,
          winRate: mine.winRate,
          bestWinRate: a.ranking[0]?.winRate ?? mine.winRate,
          known: a.known
        })
    }
    wasLocked.current = locked
    if (phase !== 'ChampSelect') lastAdvice.current = null
  }, [phase, draft.isLocked, draft.localChampId])
  const personal = useMemo(
    () =>
      settings.personalLearning && review.learning.games > 0
        ? review.learning.bonusFor(champ?.id ?? null)
        : undefined,
    [settings.personalLearning, review.learning, champ]
  )

  const plan = useMemo(
    () =>
      gd && build && threat
        ? buildItemPlan(
            gd,
            build,
            threat,
            me,
            currentGold,
            personal,
            catalog.itemCounters,
            tw(catalog.tuning, 'counter')
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, build, threat, me, currentGold, personal, catalog.itemCounters, catalog.tuning, lang]
  )

  const bench =
    (champ && catalog.benchmarks?.[champ.id]) ??
    catalog.benchmarks?.['_all'] ??
    DEFAULT_BENCH_BY_ROLE[role]
  // Alerte d'achat à la base : édition personnelle seulement.
  const purchase = useMemo(
    () => (RIOT_COMPLIANT ? null : purchaseAlert(plan, me, live?.gameTime ?? 0)),
    [plan, me, live?.gameTime]
  )

  // Rappels selon la partie : édition personnelle seulement.
  const nudges = useMemo(
    () => (RIOT_COMPLIANT ? [] : liveNudges(review.learning, live, me, plan, bench, role)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [review.learning, live, me, plan, bench, role, lang]
  )

  // Injection des runes pendant la sélection (avec délai pour ne pas spammer au survol).
  const runeKey = runePage
    ? `${runePage.payload.name}:${runePage.payload.primaryStyleId}:${runePage.payload.selectedPerkIds.join(',')}`
    : ''
  const runePayload = runePage?.payload
  useEffect(() => {
    if (!settings.autoRunes || phase !== 'ChampSelect' || !runePayload || lcuStatus !== 'connected')
      return
    if (appliedRunes.current === runeKey) return
    const timer = setTimeout(() => {
      setRuneState({ key: runeKey, sync: { state: 'pending' } })
      void window.api.applyRunes(runePayload).then((res) => {
        if (res.success) appliedRunes.current = runeKey
        setRuneState({
          key: runeKey,
          sync: res.success
            ? { state: 'ok', at: Date.now() }
            : { state: 'error', message: res.error ?? 'Erreur inconnue' }
        })
      })
    }, INJECT_DELAY)
    return () => clearTimeout(timer)
    // runePayload change à chaque calcul ; runeKey suffit à détecter un vrai changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runeKey, phase, settings.autoRunes, lcuStatus])

  // Set d'items pour la boutique en jeu, une fois le champion verrouillé.
  const itemSetKey =
    plan && champ ? `${champ.key}:${plan.steps.map((s) => s.item.id).join(',')}` : ''
  useEffect(() => {
    if (!settings.autoItemSet || phase !== 'ChampSelect' || !draft.isLocked || !plan || !champ)
      return
    if (lcuStatus !== 'connected' || appliedItemSet.current === itemSetKey) return
    const payload = toItemSet(champ.key, champ.label, plan)
    const timer = setTimeout(() => {
      setItemSetState({ key: itemSetKey, sync: { state: 'pending' } })
      void window.api.applyItemSet(payload).then((res) => {
        if (res.success) appliedItemSet.current = itemSetKey
        setItemSetState({
          key: itemSetKey,
          sync: res.success
            ? { state: 'ok', at: Date.now() }
            : { state: 'error', message: res.error ?? 'Erreur inconnue' }
        })
      })
    }, ITEMSET_DELAY)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSetKey, phase, draft.isLocked, settings.autoItemSet, lcuStatus])

  const runeSync: SyncState = !settings.autoRunes
    ? { state: 'disabled' }
    : runeState.key === runeKey
      ? runeState.sync
      : { state: 'idle' }
  const itemSetSync: SyncState = !settings.autoItemSet
    ? { state: 'disabled' }
    : itemSetState.key === itemSetKey
      ? itemSetState.sync
      : { state: 'idle' }

  const saveSettings = async (s: Settings): Promise<void> => {
    setSettings(await window.api.saveSettings(s))
  }

  return {
    lang,
    gd,
    loadError,
    catalog,
    catalogNote,
    metaLevel,
    goldActive: metaLevel === 'gold' && goldReady,
    rankTier: tier,
    metaStaleDays,
    validation,
    settings,
    saveSettings,
    lcuStatus,
    phase,
    draft,
    live,
    champ,
    build,
    genericBuild,
    variant,
    choiceNotes: adapted?.notes ?? [],
    matchup,
    me,
    threat,
    runePage,
    plan,
    currentGold,
    runeSync,
    itemSetSync,
    role,
    advice,
    review,
    nudges,
    purchase
  }
}
