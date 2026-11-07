import { Coins, LoaderCircle, TriangleAlert, Check, Info, Lightbulb } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TactiqueState, SyncState } from '../hooks/useTactique'
import { champIcon, type ItemInfo } from '../engine/gameData'
import { norm } from '../engine/normalize'
import { shardName } from '../engine/runes'
import { fmtNumber, fmtPct, gold, tr } from '../../../shared/i18n'
import { Card, Chip, ItemIcon, RuneIcon } from './ui'
import { AdviceCard } from './AdviceCard'
import { levelName } from '../engine/metaLevel'
import { roleLabel } from '../engine/role'

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

  return (
    <div className="flex flex-col gap-3">
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
                {tr(`parties ${levelName(build.bracket)}`, `${levelName(build.bracket)} games`)}
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

      <VariantCard t={t} />
      <ChoiceNotes t={t} />
      {/* Avant la partie (et en partie dans l'édition personnelle, voir t.matchup). */}
      <MatchupCard t={t} />

      {!inGame && !t.draft.isLocked && <AdviceCard t={t} />}
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

      {/* Runes */}
      {runePage ? (
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
