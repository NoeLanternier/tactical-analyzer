import { Coins, LoaderCircle, TriangleAlert, Check, Info, Lightbulb } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { TactiqueState, SyncState } from '../hooks/useTactique'
import { champIcon, type ItemInfo } from '../engine/gameData'
import { norm } from '../engine/normalize'
import { shardName } from '../engine/runes'
import { fmtNumber, fmtPct, gold, tr } from '../../../shared/i18n'
import { Card, Chip, ItemIcon, RuneIcon } from './ui'
import { AdviceCard, PickVerdictCard } from './AdviceCard'
import { levelName } from '../engine/metaLevel'
import { isMode, roleLabel } from '../engine/role'
import { MODES } from '../../../shared/modes'
import { RIOT_COMPLIANT } from '../../../shared/edition'
import {
  AUGMENT_LEVELS,
  RARITY_ORDER,
  augmentDesc,
  augmentIconUrl,
  augmentName,
  type AugmentPick,
  type Rarity
} from '../engine/augments'

const ARCHETYPE_LABEL: Record<string, [string, string]> = {
  AD_FIGHTER: ['Combattant AD', 'AD Fighter'],
  AD_ASSASSIN: ['Assassin AD', 'AD Assassin'],
  AD_CARRY: ['Carry AD', 'AD Carry'],
  AP_FIGHTER: ['Combattant AP', 'AP Fighter'],
  AP_BURST: ['Mage / burst AP', 'AP Mage / Burst'],
  TANK: ['Tank', 'Tank'],
  ENCHANTER: ['Soutien', 'Support']
}
const archetypeLabel = (a: string): string => (ARCHETYPE_LABEL[a] ? tr(...ARCHETYPE_LABEL[a]) : a)

const KIND_LABEL: Record<string, [string, string]> = {
  starter: ['Départ', 'Starter'],
  core: ['Cœur', 'Core'],
  boots: ['Bottes', 'Boots'],
  antiheal: ['Anti-soins', 'Anti-heal'],
  situational: ['Situationnel', 'Situational'],
  owned: ['Acheté', 'Bought']
}

const RARITY_LABEL: Record<Rarity, [string, string]> = {
  silver: ['Argent', 'Silver'],
  gold: ['Or', 'Gold'],
  prismatic: ['Prismatique', 'Prismatic']
}
const RARITY_TONE: Record<Rarity, string> = {
  silver: 'text-slate-300',
  gold: 'text-gold',
  prismatic: 'text-fuchsia-300'
}

/** Note d'un augment : écart mesuré en points, sinon simple appréciation (affinités, tes parties). */
function scoreTone(score: number): string {
  return score >= 0.004 ? 'text-emerald-300' : score <= -0.012 ? 'text-red-300' : 'text-slate-400'
}

function AugmentChip({ p, measured }: { p: AugmentPick; measured: boolean }): ReactElement {
  const url = augmentIconUrl(p.info)
  const desc = augmentDesc(p.info)
  const title = [augmentName(p.info), desc, ...p.reasons].filter(Boolean).join('\n')
  return (
    <span
      title={title}
      className="flex items-center gap-1 rounded bg-white/5 px-1 py-0.5 text-[10px] text-slate-200"
    >
      {url && <img src={url} alt="" className="h-4 w-4" />}
      <span className="max-w-[110px] truncate">{augmentName(p.info)}</span>
      {measured ? (
        <span className={p.lift >= 0 ? 'text-emerald-300' : 'text-red-300'}>
          {p.lift >= 0 ? '+' : '−'}
          {fmtNumber(Math.abs(p.lift) * 100, 1)}
        </span>
      ) : (
        <span className={scoreTone(p.score)}>{p.score >= 0 ? '▲' : '▼'}</span>
      )}
    </span>
  )
}

/**
 * ARAM Mayhem : augments conseillés pour ce champion, par rareté (le jeu propose trois augments
 * d'une même rareté à chaque palier). Statistiques collectées s'il y en a ; sinon (Riot ne publie
 * pas les parties de ce mode) : ce qu'ils renforcent comparé au build, et tes parties. Édition
 * publique : seulement avec des statistiques collectées, avant la partie.
 */
function AugmentCard({ t, inGame }: { t: TactiqueState; inGame: boolean }): ReactElement | null {
  const mode = isMode(t.role) ? MODES[t.role] : null
  if (!mode || !(t.catalog.features?.augments ?? mode.augments)) return null
  // En partie : la saisie des augments proposés prend le relais (édition personnelle).
  if (inGame) return null
  const advice = t.augments.advice
  if (RIOT_COMPLIANT && !advice?.measured) return null
  return (
    <Card
      title={tr('Augments conseillés', 'Suggested augments')}
      right={
        advice?.measured && advice.games ? (
          <span className="text-[10px] text-slate-400">
            {fmtNumber(advice.games)} {tr('parties', 'games')}
          </span>
        ) : undefined
      }
    >
      {!advice ? (
        <p className="text-[11px] text-slate-400">
          {tr(
            'Liste des augments pas encore disponible (prochaine collecte).',
            'Augment list not available yet (next collection).'
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {RARITY_ORDER.map((r) => {
            const { best, avoid } = advice.byRarity[r]
            if (!best.length && !avoid.length) return null
            return (
              <div key={r}>
                <div className={`mb-1 text-[10px] uppercase tracking-wider ${RARITY_TONE[r]}`}>
                  {tr(...RARITY_LABEL[r])}
                </div>
                <div className="flex flex-wrap gap-1">
                  {best.map((p) => (
                    <AugmentChip key={p.info.id} p={p} measured={advice.measured} />
                  ))}
                </div>
                {avoid.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[9px] text-slate-500">{tr('À éviter', 'Avoid')}</span>
                    {avoid.map((p) => (
                      <AugmentChip key={p.info.id} p={p} measured={advice.measured} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <p className="text-[9px] leading-snug text-slate-500">
            {advice.measured
              ? tr(
                  'Écart de victoire des joueurs qui l’ont pris avec ce champion, par rapport aux autres augments (lissé).',
                  'Win-rate gap of players who took it with this champion, versus other augments (smoothed).'
                )
              : tr(
                  'Riot ne publie pas les parties de ce mode : augments classés selon ce qu’ils renforcent comparé au build de ton champion, et selon tes parties. Survole un augment pour le détail.',
                  'Riot does not publish this mode’s games: augments ranked by what they boost compared with your champion’s build, and by your games. Hover an augment for details.'
                )}
          </p>
        </div>
      )}
    </Card>
  )
}

/**
 * ARAM Mayhem, en partie (édition personnelle) : le jeu ne donne pas les augments proposés à l'app.
 * Tu cliques les trois proposés ; l'app les classe pour ton champion et tes augments déjà pris,
 * puis adapte le build à celui que tu prends.
 */
function AugmentPicker({ t }: { t: TactiqueState }): ReactElement | null {
  const [rarity, setRarity] = useState<Rarity>('silver')
  const [query, setQuery] = useState('')
  const mode = isMode(t.role) ? MODES[t.role] : null
  const info = t.catalog.augmentInfo
  if (!mode || RIOT_COMPLIANT || !t.live || !info) return null
  if (!(t.catalog.features?.augments ?? mode.augments)) return null
  const { offered, chosen, ranked } = t.augments
  const level = t.live.activePlayer?.level ?? 1
  const next = AUGMENT_LEVELS[chosen.length]
  const due = next !== undefined && level >= next
  const q = query.trim().toLowerCase()
  const list = Object.values(info)
    .filter((a) => a.rarity === rarity && !chosen.includes(a.id))
    .filter(
      (a) => !q || augmentName(a).toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    )
    .sort((a, b) => augmentName(a).localeCompare(augmentName(b)))
  const toggle = (id: number): void =>
    t.augments.setOffered(
      offered.includes(id) ? offered.filter((x) => x !== id) : [...offered, id].slice(-3)
    )
  return (
    <Card
      title={tr('Augments', 'Augments')}
      right={
        <span className={`text-[10px] ${due ? 'text-gold' : 'text-slate-400'}`}>
          {next === undefined
            ? tr('tous choisis', 'all picked')
            : due
              ? tr(`palier ${chosen.length + 1} : à choisir`, `tier ${chosen.length + 1}: pick now`)
              : tr(`prochain au niveau ${next}`, `next at level ${next}`)}
        </span>
      }
    >
      {chosen.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            {tr('Pris', 'Picked')}
          </span>
          {chosen.map((id) =>
            info[id] ? (
              <button
                key={id}
                type="button"
                title={tr('Retirer', 'Remove')}
                onClick={() => t.augments.remove(id)}
                className="rounded bg-lolblue/15 px-1 py-0.5 text-[10px] text-lolblue hover:bg-red-500/20 hover:text-red-200"
              >
                {augmentName(info[id])} ×
              </button>
            ) : null
          )}
        </div>
      )}
      {next !== undefined && (
        <>
          <p className="mb-1.5 text-[10px] leading-snug text-slate-500">
            {tr(
              'Clique les augments proposés (le jeu ne les donne pas à l’app) : ils sont classés pour ton champion et tes augments déjà pris, puis le build s’adapte à ton choix.',
              'Click the offered augments (the game does not give them to the app): they are ranked for your champion and your picked augments, then the build adapts to your choice.'
            )}
          </p>
          <div className="mb-1.5 flex items-center gap-1">
            {RARITY_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRarity(r)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${r === rarity ? `bg-white/15 ${RARITY_TONE[r]}` : 'text-slate-500 hover:bg-white/5'}`}
              >
                {tr(...RARITY_LABEL[r])}
              </button>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('Rechercher…', 'Search…')}
              className="ml-auto w-24 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-[10px]"
            />
          </div>
          <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto pr-1">
            {list.map((a) => {
              const url = augmentIconUrl(a)
              const on = offered.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  title={augmentDesc(a) || undefined}
                  onClick={() => toggle(a.id)}
                  className={`flex items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] ${on ? 'bg-lolblue/25 text-white ring-1 ring-lolblue/60' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                >
                  {url && <img src={url} alt="" className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{augmentName(a)}</span>
                </button>
              )
            })}
          </div>
          {ranked.length > 0 && (
            <ol className="mt-2 flex flex-col gap-1.5 border-t border-white/5 pt-2">
              {ranked.map((o) => (
                <li key={o.pick.info.id} className="flex items-start gap-2">
                  <span className="w-4 pt-0.5 text-right text-[10px] tabular-nums text-slate-500">
                    {o.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      title={augmentDesc(o.pick.info) || undefined}
                      className={`truncate text-xs font-semibold ${o.rank === 1 ? 'text-gold' : 'text-slate-100'}`}
                    >
                      {augmentName(o.pick.info)}
                    </div>
                    <div className="text-[10px] leading-snug text-slate-400">
                      {o.reasons.join(' · ')}
                    </div>
                  </div>
                  {o.pick.games > 0 && (
                    <span
                      className={`pt-0.5 text-[11px] tabular-nums ${o.score >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                    >
                      {o.score >= 0 ? '+' : '−'}
                      {fmtNumber(Math.abs(o.score) * 100, 1)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => t.augments.choose(o.pick.info.id)}
                    className="rounded bg-lolblue/20 px-1.5 py-0.5 text-[10px] text-lolblue hover:bg-lolblue/30"
                  >
                    {tr('Pris', 'Picked')}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  )
}

/** Famille de build suivie (quand le champion en a plusieurs en Master+) et les autres choix. */
function VariantCard({ t }: { t: TactiqueState }): ReactElement | null {
  const choice = t.variant
  if (!choice?.chosen || !t.gd || t.genericBuild) return null
  const gd = t.gd
  const item = (name: string): ItemInfo | undefined => gd.itemsByName.get(norm(name))
  const chosen = choice.chosen.variant
  const first = item(chosen.key)
  const others = choice.options.filter((o) => o.variant !== chosen)
  return (
    <div className="flex items-center gap-2 rounded border border-lolblue/30 bg-lolblue/10 p-2">
      {first && <ItemIcon item={first} version={gd.version} size={28} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-slate-100">
          {tr('Build', 'Build')} <b>{first?.label ?? chosen.key}</b>{' '}
          <span className="text-slate-400">
            · {fmtPct(chosen.share)}{' '}
            {tr(
              `des parties ${levelName(t.build?.bracket)}`,
              `of ${levelName(t.build?.bracket)} games`
            )}{' '}
            ({fmtNumber(chosen.games)})
          </span>
        </div>
        <div className="truncate text-[10px] text-slate-400">
          {choice.reason}
          {others.length > 0 &&
            ` · ${tr('autre choix', 'other option')} : ${others
              .map((o) => `${item(o.variant.key)?.label ?? o.variant.key} ${fmtPct(o.estimate, 1)}`)
              .join(', ')}`}
        </div>
      </div>
      {choice.locked && <Chip tone="green">{tr('suivi', 'locked')}</Chip>}
      {!choice.locked && chosen.games < 150 && (
        <span
          title={tr(
            'Moins de 150 parties pour cette famille : choix encore incertain.',
            'Fewer than 150 games for this build: choice still uncertain.'
          )}
          className="rounded bg-slate-500/20 px-1 text-[9px] text-slate-400"
        >
          {tr('peu de données', 'little data')}
        </span>
      )}
    </div>
  )
}

const CHOICE_LABEL: Record<string, [string, string]> = {
  runes: ['Runes', 'Runes'],
  boots: ['Bottes', 'Boots'],
  pet: ['Familier', 'Pet'],
  skills: ['Compétences', 'Skills']
}

/** Runes, bottes, familier ou compétences changés pour cette partie, et pourquoi. */
function ChoiceNotes({ t }: { t: TactiqueState }): ReactElement | null {
  if (!t.choiceNotes.length || !t.gd) return null
  const gd = t.gd
  const label = (kind: string, value: string): string =>
    kind === 'boots' || kind === 'pet' ? (gd.itemsByName.get(norm(value))?.label ?? value) : value
  return (
    <div className="rounded border border-white/10 bg-white/5 p-2 text-[10px] leading-snug text-slate-400">
      <span className="text-slate-300">
        {tr('Adapté à cette partie', 'Adapted to this game')} :
      </span>{' '}
      {t.choiceNotes
        .map((n) => `${tr(...CHOICE_LABEL[n.kind])} ${label(n.kind, n.label)} (${n.reason})`)
        .join(' · ')}
    </div>
  )
}

const PERIOD_LABEL: Record<string, [string, string]> = {
  early: ['Avant 6 min', 'Before 6 min'],
  mid: ['6 à 14 min', '6 to 14 min'],
  late: ['Après 14 min', 'After 14 min']
}
const LANE_LABEL: Record<string, [string, string]> = {
  top: ['en haut', 'top'],
  mid: ['au milieu', 'mid'],
  bot: ['en bas', 'bot'],
  jungle: ['dans la jungle', 'in the jungle']
}
const minuteText = (m: number): string =>
  `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`

/**
 * Jungler adverse, avant la partie : part des combats gagnés contre lui selon la période, et son
 * début de partie habituel (statistiques Master+, rien de la partie en cours).
 */
function MatchupCard({ t }: { t: TactiqueState }): ReactElement | null {
  const m = t.matchup
  if (!m || !t.gd) return null
  const periods = (['early', 'mid', 'late'] as const).filter((p) => m.duels[p])
  const o = m.opening
  const lanes = o
    ? Object.entries(o.firstLanes).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]
    : undefined
  return (
    <Card
      title={`${t.role === 'jungle' ? tr('Jungler adverse', 'Enemy jungler') : tr('Adversaire direct', 'Lane opponent')} : ${m.enemy.label}`}
    >
      {periods.length > 0 && (
        <ul className="flex flex-col gap-1">
          {periods.map((p) => {
            const [n, share] = m.duels[p]!
            const base = m.baseline[p]?.[1]
            const tone =
              share >= 0.55
                ? 'text-emerald-300'
                : share <= 0.45
                  ? 'text-orange-300'
                  : 'text-slate-200'
            return (
              <li key={p} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-400">{tr(...PERIOD_LABEL[p])}</span>
                <span
                  title={
                    base !== undefined
                      ? tr(
                          `Tous adversaires confondus : ${fmtPct(base)}`,
                          `Against all opponents: ${fmtPct(base)}`
                        )
                      : undefined
                  }
                >
                  <b className={tone}>{fmtPct(share)}</b>{' '}
                  <span className="text-slate-500">
                    {tr('des combats gagnés', 'of fights won')} ({fmtNumber(n)})
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {o && (
        <p className="mt-2 text-[10px] leading-snug text-slate-400">
          {tr(
            `Commence du côté de la voie du haut dans ${fmtPct(o.top)} des parties`,
            `Starts on the top-lane side in ${fmtPct(o.top)} of games`
          )}
          {o.firstMinute !== null &&
            tr(
              ` · 1re élimination vers ${minuteText(o.firstMinute)}`,
              ` · first takedown around ${minuteText(o.firstMinute)}`
            )}
          {lanes &&
            lanes[1] !== undefined &&
            tr(
              `, surtout ${LANE_LABEL[lanes[0]][0]} (${fmtPct(lanes[1])})`,
              `, mostly ${LANE_LABEL[lanes[0]][1]} (${fmtPct(lanes[1])})`
            )}
          .
        </p>
      )}
    </Card>
  )
}

/** Départs possibles hors jungle : celui conseillé et les autres, avec les stats des joueurs. */
function StartNote({ t }: { t: TactiqueState }): ReactElement | null {
  const sp = t.startPlan
  const gd = t.gd
  if (!sp || !gd) return null
  const label = (items: string[]): string => {
    const counts = new Map<string, number>()
    for (const n of items) {
      const l = gd.itemsByName.get(norm(n))?.label ?? n
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    return [...counts].map(([l, n]) => (n > 1 ? `${n} × ${l}` : l)).join(' + ')
  }
  const stat = (c: (typeof sp.others)[number]): string =>
    c.share !== null
      ? ` (${fmtPct(c.share)} ${tr('des parties', 'of games')}${c.winRate !== null ? `, ${fmtPct(c.winRate, 1)} ${tr('V', 'WR')}` : ''})`
      : ''
  const source =
    sp.source === 'riot'
      ? tr('proposé par la boutique du jeu', 'suggested by the in-game shop')
      : sp.source === 'meta'
        ? tr(
            `le plus efficace ${levelName(t.build?.bracket)}`,
            `most effective ${levelName(t.build?.bracket)}`
          )
        : tr('départ habituel du poste', 'usual start for the role')
  return (
    <div className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-snug text-slate-400">
      <div>
        <span className="text-slate-200">
          {tr('Départ', 'Start')} : {label(sp.chosen.items)}
        </span>{' '}
        · {source}
        {stat(sp.chosen)}
      </div>
      {sp.others.length > 0 && (
        <div className="mt-0.5">
          {tr('Autres départs', 'Other starts')} :{' '}
          {sp.others.map((c) => `${label(c.items)}${stat(c)}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function SyncBadge({ sync, okText }: { sync: SyncState; okText: string }): ReactElement | null {
  switch (sync.state) {
    case 'pending':
      return (
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <LoaderCircle size={11} className="animate-spin" /> {tr('envoi…', 'sending…')}
        </span>
      )
    case 'ok':
      return (
        <span className="flex items-center gap-1 text-[10px] text-emerald-300">
          <Check size={11} /> {okText}
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-[10px] text-red-300" title={sync.message}>
          <TriangleAlert size={11} /> {tr('échec', 'failed')}
        </span>
      )
    case 'disabled':
      return <span className="text-[10px] text-slate-500">{tr('auto désactivé', 'auto off')}</span>
    default:
      return null
  }
}

/** Rappels tirés des bilans : avant la partie (points faibles) et pendant (situations à risque). */
function CoachCard({ t, inGame }: { t: TactiqueState; inGame: boolean }): ReactElement | null {
  if (inGame) {
    if (t.nudges.length === 0) return null
    return (
      <Card title="Coach">
        <ul className="flex flex-col gap-1">
          {t.nudges.map((n) => (
            <li
              key={n.id}
              className={`flex gap-1.5 text-[11px] ${n.tone === 'orange' ? 'text-orange-200' : 'text-slate-200'}`}
            >
              <Lightbulb size={12} className="mt-0.5 shrink-0 text-gold" /> {n.text}
            </li>
          ))}
        </ul>
      </Card>
    )
  }
  const recurring = t.review.learning.recurring.slice(0, 3)
  if (recurring.length === 0) return null
  return (
    <Card title={tr('Rappels de vos dernières parties', 'Reminders from your last games')}>
      <ul className="flex flex-col gap-1.5">
        {recurring.map((r) => (
          <li key={r.id} className="flex gap-1.5">
            <Lightbulb size={12} className="mt-0.5 shrink-0 text-gold" />
            <div className="min-w-0">
              <div className="text-[11px] text-orange-200">
                {r.label}{' '}
                <span className="text-slate-500">
                  ({r.count}/{r.of})
                </span>
              </div>
              {r.tip && <div className="text-[10px] text-slate-400">{r.tip}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Partie qui ne compte pas (personnalisée, contre l'IA…) ou mesurée à part (Swiftplay) : le dire
 * avant la partie, pour qu'aucun chiffre du bilan ne surprenne.
 */
function QueueNotice({ t }: { t: TactiqueState }): ReactElement | null {
  const k = t.queueKind
  const text =
    k === 'custom' || k === 'bots' || k === 'small'
      ? tr(
          `${k === 'bots' ? 'Partie contre l’IA' : k === 'small' ? 'Partie à moins de 5 contre 5' : 'Partie personnalisée'} : les conseils restent actifs, mais elle ne comptera ni dans le bilan ni dans tes statistiques.`,
          `${k === 'bots' ? 'Game against AI' : k === 'small' ? 'Smaller than 5v5' : 'Custom game'}: advice stays on, but it won’t count in the review or your stats.`
        )
      : t.gameType === 'swift'
        ? tr(
            'Swiftplay : partie accélérée. Le bilan la compare aux joueurs de tes parties Swiftplay, à part des classées et des normales.',
            'Swiftplay: accelerated game. The review compares it with players of your Swiftplay games, separately from ranked and normal games.'
          )
        : null
  if (!text) return null
  return (
    <p className="rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-slate-400">{text}</p>
  )
}

export function BuildTab({ t }: { t: TactiqueState }): ReactElement | null {
  const { gd, champ, build, runePage, plan, live } = t
  if (!gd) return null

  if (!champ || !build) {
    if (t.advice && (t.advice.picks.length > 0 || t.advice.bans.length > 0)) {
      return <AdviceCard t={t} />
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-slate-400">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-lolblue border-t-transparent" />
        <p className="text-sm">
          {t.lcuStatus === 'connected'
            ? tr('Survolez un champion en sélection…', 'Hover a champion in champ select…')
            : tr(
                'En attente du client League of Legends…',
                'Waiting for the League of Legends client…'
              )}
        </p>
        <p className="max-w-[260px] text-[11px] text-slate-500">
          {tr(
            'Les runes et l’ordre d’objets s’adaptent automatiquement à la composition adverse, puis au déroulé de la partie.',
            'Runes and item order adapt automatically to the enemy team, then to how the game unfolds.'
          )}
        </p>
      </div>
    )
  }

  const v = gd.version
  const inGame = live !== null
  const modeInfo = isMode(t.role) ? MODES[t.role] : null
  const runesOff = !!modeInfo && !(t.catalog.features?.runes ?? modeInfo.runes)

  // Champion seulement survolé : avis sur ce choix dans la draft et autres choix possibles. La fiche
  // (runes, objets) s'affiche au verrouillage ; la page de runes est quand même préparée.
  if (!inGame && !t.draft.isLocked && t.advice) {
    return (
      <div className="flex flex-col gap-3">
        <QueueNotice t={t} />
        <PickVerdictCard t={t} />
        <AdviceCard t={t} />
        <CoachCard t={t} inGame={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <QueueNotice t={t} />
      {/* Champion */}
      <div className="flex items-center gap-3">
        <img
          src={champIcon(v, champ.id)}
          alt={champ.label}
          className="h-12 w-12 rounded-full border-2 border-lolblue"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-cinzel text-lg font-bold text-white">{champ.label}</h1>
          <div className="flex flex-wrap items-center gap-1">
            <Chip tone="blue">{archetypeLabel(build.archetype)}</Chip>
            {build.skills && (
              <Chip>
                {tr('Montée', 'Skills')} {build.skills.replace(/>/g, ' > ')}
              </Chip>
            )}
            {build.games && !t.genericBuild && (
              <Chip tone="green">
                {fmtNumber(build.games)}{' '}
                {isMode(t.role)
                  ? tr(`parties ${roleLabel(t.role)}`, `${roleLabel(t.role)} games`)
                  : tr(`parties ${levelName(build.bracket)}`, `${levelName(build.bracket)} games`)}
                {build.winRate ? ` · ${fmtPct(build.winRate, 1)} ${tr('V', 'WR')}` : ''}
                {build.patch ? ` · patch ${build.patch}` : ''}
              </Chip>
            )}
            {inGame && (
              <Chip tone="green">
                {tr('En partie', 'In game')} {formatTime(live.gameTime)}
              </Chip>
            )}
            {!inGame && t.draft.isLocked && (
              <Chip tone="green">{tr('Verrouillé', 'Locked in')}</Chip>
            )}
          </div>
        </div>
      </div>

      {/* Modes tirés au hasard : banc et relance jusqu'à la fin de la sélection. */}
      {!inGame && t.phase === 'ChampSelect' && t.advice?.mode && <AdviceCard t={t} />}

      <VariantCard t={t} />
      <ChoiceNotes t={t} />
      {/* Avant la partie (et en partie dans l'édition personnelle, voir t.matchup). */}
      <MatchupCard t={t} />

      {!inGame && <CoachCard t={t} inGame={false} />}

      {t.genericBuild && (
        <p className="flex gap-1.5 rounded border border-orange-400/30 bg-orange-500/10 p-2 text-[11px] text-orange-200">
          <Info size={13} className="mt-0.5 shrink-0" />{' '}
          {tr(
            `Champion absent de la méta ${roleLabel(t.role)} : build générique (${archetypeLabel(build.archetype)}) et runes recommandées par Riot.`,
            `Champion not in the ${roleLabel(t.role)} meta: generic build (${archetypeLabel(build.archetype)}) and Riot recommended runes.`
          )}
        </p>
      )}

      {/* Prochain achat (en partie) */}
      {inGame && plan?.next && (
        <Card
          title={tr('Prochain achat', 'Next buy')}
          right={
            <span className="flex items-center gap-1 text-[11px] text-gold">
              <Coins size={12} /> {gold(Math.floor(t.currentGold))}
            </span>
          }
        >
          <div className="flex items-center gap-3">
            <ItemIcon item={plan.next.item} version={v} size={40} highlight />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                {plan.next.item.label}
              </div>
              {plan.next.affordable ? (
                <div className="text-[11px] text-emerald-300">
                  {tr('Achetable maintenant', 'Affordable now')} ({gold(plan.next.remaining)})
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">
                  {gold(Math.max(0, Math.ceil(plan.next.remaining - t.currentGold)))}{' '}
                  {tr('manquants', 'missing')}
                  {plan.next.component && (
                    <>
                      {' '}
                      · {tr('achetez', 'buy')}{' '}
                      <span className="text-slate-200">{plan.next.component.label}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {plan.next.component && <ItemIcon item={plan.next.component} version={v} size={28} />}
          </div>
          {plan.next.sellHint && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-orange-300">
              <TriangleAlert size={12} className="shrink-0" /> {plan.next.sellHint}
            </p>
          )}
        </Card>
      )}

      {inGame && <CoachCard t={t} inGame />}

      <AugmentPicker t={t} />
      <AugmentCard t={t} inGame={inGame} />

      {/* Runes */}
      {runesOff ? (
        <Card title="Runes">
          <p className="text-[11px] text-slate-400">
            {tr(
              `Pas de runes en ${roleLabel(t.role)} : les augments les remplacent.`,
              `No runes in ${roleLabel(t.role)}: augments replace them.`
            )}
          </p>
        </Card>
      ) : runePage ? (
        <Card
          title="Runes"
          right={
            !inGame ? (
              <SyncBadge sync={t.runeSync} okText={tr('page envoyée', 'page sent')} />
            ) : (
              <Chip>{tr('verrouillées en partie', 'locked in game')}</Chip>
            )
          }
        >
          <div className="flex items-center gap-2">
            <RuneIcon rune={runePage.runes[0]} size={38} keystone />
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-1">
                {runePage.runes.slice(1, 4).map((r) => (
                  <RuneIcon key={r.id} rune={r} />
                ))}
                <span className="mx-1 h-4 w-px bg-white/15" />
                {runePage.runes.slice(4, 6).map((r) => (
                  <RuneIcon key={r.id} rune={r} size={18} />
                ))}
              </div>
              <div className="text-[10px] text-slate-400">
                {runePage.runes[0].label} · {runePage.primaryTree.label} / {runePage.subTree.label}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] leading-relaxed text-slate-400">
            {tr('Fragments', 'Shards')}: {runePage.shards.map((s) => shardName(s)).join(' · ')}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {runePage.reasons.map((r) => (
              <Chip
                key={r}
                tone={/^(Fragment|Tenacity shard|Health shard)/.test(r) ? 'orange' : 'slate'}
              >
                {r}
              </Chip>
            ))}
          </div>
          {t.runeSync.state === 'error' && (
            <p className="mt-2 text-[10px] leading-snug text-red-300">{t.runeSync.message}</p>
          )}
        </Card>
      ) : (
        <Card title="Runes">
          <p className="text-[11px] text-slate-400">
            {tr(
              'Aucune page disponible pour ce champion (client non connecté ?).',
              'No rune page available for this champion (client not connected?).'
            )}
          </p>
        </Card>
      )}

      {/* Objets */}
      {plan && (
        <Card
          title={
            inGame
              ? tr('Build adapté à la partie', 'Build adapted to the game')
              : tr('Ordre d’objets adaptatif', 'Adaptive item order')
          }
          right={
            !inGame ? (
              <SyncBadge sync={t.itemSetSync} okText={tr('dans la boutique', 'in the shop')} />
            ) : undefined
          }
        >
          {plan.steps.some((s) => s.kind === 'starter' && !s.owned) && <StartNote t={t} />}
          <ol className="flex flex-col gap-1.5">
            {plan.steps.map((s, i) => {
              const isNext = inGame && plan.next?.item.id === s.item.id && !s.owned
              return (
                <li
                  key={`${s.item.id}-${i}`}
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${isNext ? 'bg-lolblue/10' : ''}`}
                >
                  <span className="w-4 text-right text-[10px] tabular-nums text-slate-500">
                    {i + 1}
                  </span>
                  <ItemIcon
                    item={s.item}
                    version={v}
                    size={28}
                    owned={s.owned}
                    highlight={isNext}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-xs ${s.owned ? 'text-slate-500 line-through' : 'text-slate-100'}`}
                    >
                      {s.item.label}
                    </div>
                    <div className="flex gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500">
                        {KIND_LABEL[s.kind] ? tr(...KIND_LABEL[s.kind]) : s.kind}
                      </span>
                      {s.reason && (
                        <Chip tone={s.swapped ? 'red' : s.kind === 'antiheal' ? 'orange' : 'blue'}>
                          {s.swapped ? `${tr('priorité', 'priority')} · ${s.reason}` : s.reason}
                        </Chip>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {plan.alternatives.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 border-t border-white/5 pt-2">
              <span className="w-16 text-[10px] uppercase tracking-wider text-slate-500">
                {tr('Si besoin', 'If needed')}
              </span>
              {plan.alternatives.map((s) => (
                <ItemIcon
                  key={s.item.id}
                  item={s.item}
                  version={v}
                  size={24}
                  title={`${s.item.label}${s.reason ? ` — ${s.reason}` : ''}`}
                />
              ))}
            </div>
          )}
          {t.itemSetSync.state === 'error' && (
            <p className="mt-2 text-[10px] leading-snug text-red-300">
              {tr('Set d’items', 'Item set')}: {t.itemSetSync.message}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
