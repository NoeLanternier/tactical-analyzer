import {
  Ban,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  CircleHelp,
  Minus
} from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import {
  pickVerdict,
  type BanAdvice,
  type PickAdvice,
  type PickFactor,
  type PickVerdict
} from '../engine/draftAdvice'
import { levelName } from '../engine/metaLevel'
import { roleLabel } from '../engine/role'
import { champIcon } from '../engine/gameData'
import { Card, Chip } from './ui'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'

const pct = (x: number): string => fmtPct(x, 1)
const pts = (x: number): string => `${x >= 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`

function factorLabel(kind: PickFactor['kind'], enemyJungler: string | null): string {
  switch (kind) {
    case 'meta':
      return tr('méta', 'meta')
    case 'vs':
      return enemyJungler ? `vs ${enemyJungler}` : tr('adversaire direct', 'direct opponent')
    case 'allies':
      return tr('alliés', 'allies')
    case 'enemies':
      return tr('adversaires', 'enemies')
    case 'comp':
      return tr('compo adverse', 'enemy comp')
    case 'blind':
      return tr('contre-pick', 'counter-pick')
    case 'team':
      return tr('équipe', 'team')
    case 'mastery':
      return tr('maîtrise', 'mastery')
    case 'personal':
      return tr('tes parties', 'your games')
    case 'data':
      return tr('peu de données', 'little data')
  }
}

/** Effet d'un critère en points de taux de victoire (« compo +1,8 »). */
function FactorChips({
  factors,
  enemyJungler,
  max = 6
}: {
  factors: PickFactor[]
  enemyJungler: string | null
  max?: number
}): ReactElement | null {
  const shown = [...factors]
    .filter((f) => Math.abs(f.points) >= 0.003)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, max)
  if (!shown.length) return null
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {shown.map((f) => (
        <span
          key={f.kind}
          className={`rounded px-1 text-[9px] tabular-nums ${f.points > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-orange-500/10 text-orange-300'}`}
        >
          {factorLabel(f.kind, enemyJungler)} {f.points > 0 ? '+' : '−'}
          {fmtNumber(Math.abs(f.points) * 100, 1)}
        </span>
      ))}
    </div>
  )
}

function WinRate({ p }: { p: PickAdvice }): ReactElement {
  return (
    <span
      title={
        p.lowData
          ? tr(
              'Peu de parties ce patch : estimation incertaine.',
              'Few games this patch: uncertain estimate.'
            )
          : undefined
      }
      className={`shrink-0 text-xs font-bold tabular-nums ${p.lowData ? 'text-slate-500' : p.winRate >= 0.51 ? 'text-emerald-300' : p.winRate <= 0.49 ? 'text-orange-300' : 'text-slate-300'}`}
    >
      {p.lowData ? '≈ ' : ''}
      {pct(p.winRate)}
    </span>
  )
}

function PickRow({
  p,
  v,
  enemyJungler,
  mine
}: {
  p: PickAdvice
  v: string
  enemyJungler: string | null
  mine: boolean
}): ReactElement {
  return (
    <li
      className={`flex items-start gap-2 ${mine ? 'rounded bg-lolblue/10 p-1 ring-1 ring-lolblue/40' : ''}`}
    >
      <span className="w-5 shrink-0 pt-2 text-right text-[10px] tabular-nums text-slate-500">
        {p.rank}
      </span>
      <img
        src={champIcon(v, p.champ.id)}
        alt=""
        className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-lolblue/60"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-slate-100">{p.champ.label}</span>
          {!p.inPool && (
            <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-gold">
              <Sparkles size={10} /> {tr('hors de tes champions', 'outside your pool')}
            </span>
          )}
          {p.blind === 'risky' && (
            <span className="shrink-0 rounded bg-orange-500/15 px-1 text-[9px] text-orange-300">
              {tr('risqué si choisi tôt', 'risky to pick early')}
            </span>
          )}
          {p.blind === 'safe' && (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-300">
              {tr('sûr si choisi tôt', 'safe to pick early')}
            </span>
          )}
        </div>
        <div className="line-clamp-2 text-[10px] leading-snug text-slate-400">
          {p.reasons.join(' · ')}
        </div>
        <FactorChips factors={p.factors} enemyJungler={enemyJungler} />
      </div>
      <WinRate p={p} />
    </li>
  )
}

/** Ligne compacte du classement complet. */
function RankRow({
  p,
  v,
  enemyJungler,
  mine
}: {
  p: PickAdvice
  v: string
  enemyJungler: string | null
  mine: boolean
}): ReactElement {
  return (
    <li
      className={`flex items-center gap-1.5 py-0.5 ${mine ? 'rounded bg-lolblue/10 ring-1 ring-lolblue/40' : ''}`}
    >
      <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
        {p.rank}
      </span>
      <img src={champIcon(v, p.champ.id)} alt="" className="h-5 w-5 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            className={`truncate text-[11px] ${p.inPool ? 'font-semibold text-slate-100' : 'text-slate-300'}`}
          >
            {p.champ.label}
          </span>
          <span className="shrink-0 text-[9px] text-slate-500">
            {fmtNumber(p.games)} {tr('p.', 'g.')}
          </span>
        </div>
        <FactorChips factors={p.factors} enemyJungler={enemyJungler} max={3} />
      </div>
      <WinRate p={p} />
    </li>
  )
}

function BanRow({ b, v }: { b: BanAdvice; v: string }): ReactElement {
  return (
    <li className="flex items-center gap-2">
      <Ban size={13} className="shrink-0 text-red-400" />
      <img src={champIcon(v, b.champ.id)} alt="" className="h-7 w-7 rounded" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-slate-100">{b.champ.label}</div>
        <div className="line-clamp-2 text-[10px] leading-snug text-slate-400">
          {b.reasons.join(' · ') || tr('fort ce patch', 'strong this patch')}
        </div>
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{pct(b.winRate)}</span>
    </li>
  )
}

function Toggle({
  open,
  onClick,
  label
}: {
  open: boolean
  onClick: () => void
  label: string
}): ReactElement {
  return (
    <button
      onClick={onClick}
      className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-white/5 py-1 text-[10px] text-slate-300 hover:bg-white/10"
    >
      {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {label}
    </button>
  )
}

const VERDICT: Record<
  PickVerdict['level'],
  { label: [string, string]; tone: string; Icon: typeof ThumbsUp }
> = {
  best: {
    label: ['Recommandé', 'Recommended'],
    tone: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300',
    Icon: ThumbsUp
  },
  good: {
    label: ['Bon choix', 'Good pick'],
    tone: 'border-emerald-400/30 bg-emerald-500/5 text-emerald-200',
    Icon: ThumbsUp
  },
  ok: {
    label: ['Jouable', 'Playable'],
    tone: 'border-slate-400/30 bg-white/5 text-slate-200',
    Icon: Minus
  },
  bad: {
    label: ['Déconseillé', 'Not recommended'],
    tone: 'border-orange-400/50 bg-orange-500/10 text-orange-300',
    Icon: ThumbsDown
  },
  unknown: {
    label: ['Hors méta du poste', 'Off-meta for this role'],
    tone: 'border-orange-400/40 bg-orange-500/5 text-orange-200',
    Icon: CircleHelp
  }
}

/**
 * Champion survolé (pas encore verrouillé) : recommandé ou non dans cette draft, comparé aux
 * autres choix possibles, avec l'effet des alliés et adversaires déjà choisis.
 */
export function PickVerdictCard({ t }: { t: TactiqueState }): ReactElement | null {
  const { advice, gd, champ } = t
  if (!advice || !gd || !champ) return null
  const verdict = pickVerdict(advice, champ)
  const { pick, best, better, level } = verdict
  const v = gd.version
  const ej = advice.enemyJungler?.label ?? null
  const style =
    verdict.total === 0
      ? { ...VERDICT.unknown, label: ['Pas encore de données', 'No data yet'] as [string, string] }
      : VERDICT[level]
  const source = `${roleLabel(t.role)} · ${levelName(t.catalog.statsBracket)}`
  return (
    <section className={`rounded-lg border p-3 ${style.tone}`}>
      <div className="flex items-center gap-3">
        <img
          src={champIcon(v, champ.id)}
          alt={champ.label}
          className="h-11 w-11 shrink-0 rounded-full border-2 border-white/20"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-cinzel text-base font-bold text-white">
              {champ.label}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              {tr('survolé', 'hovered')}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold">
            <style.Icon size={13} /> {tr(...style.label)}
          </div>
        </div>
        {pick && <WinRate p={pick} />}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-300">
        {pick && best
          ? level === 'best'
            ? tr(
                `${pick.rank}ᵉ sur ${verdict.total} dans cette draft${pick.rank > 1 ? ` (${pts(-verdict.gap)} pt vs ${best.champ.label})` : ''}.`,
                `#${pick.rank} of ${verdict.total} in this draft${pick.rank > 1 ? ` (${pts(-verdict.gap)} pt vs ${best.champ.label})` : ''}.`
              )
            : tr(
                `${pick.rank}ᵉ sur ${verdict.total} dans cette draft, ${pts(-verdict.gap)} pt par rapport au meilleur choix (${best.champ.label}).`,
                `#${pick.rank} of ${verdict.total} in this draft, ${pts(-verdict.gap)} pt behind the best pick (${best.champ.label}).`
              )
          : verdict.total === 0
            ? tr(
                `Statistiques ${source} pas encore disponibles : avis impossible pour l’instant.`,
                `${source} stats not available yet: no verdict for now.`
              )
            : tr(
                `Pas ou trop peu de parties ${source} pour ce champion : rarement joué à ce poste.`,
                `No or too few ${source} games for this champion: rarely played in this role.`
              )}
      </p>
      {pick && (
        <>
          {pick.reasons.length > 0 && (
            <p className="mt-1 text-[10px] leading-snug text-slate-400">
              {pick.reasons.join(' · ')}
            </p>
          )}
          <FactorChips factors={pick.factors} enemyJungler={ej} max={8} />
          {pick.lowData && (
            <p className="mt-1 text-[10px] text-slate-500">
              {tr(
                `Moins de 200 parties ce patch : estimation incertaine.`,
                `Fewer than 200 games this patch: uncertain estimate.`
              )}
            </p>
          )}
        </>
      )}
      {better.length > 0 && level !== 'best' && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-500">
            {tr('Mieux dans cette draft', 'Better in this draft')}
          </div>
          <ul className="flex flex-col gap-1">
            {better.map((b) => (
              <li key={b.champ.id} className="flex items-center gap-2">
                <img src={champIcon(v, b.champ.id)} alt="" className="h-6 w-6 rounded" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-100">
                  {b.champ.label}
                  {!b.inPool && (
                    <span className="ml-1 text-[9px] text-gold">
                      {tr('hors de tes champions', 'outside your pool')}
                    </span>
                  )}
                </span>
                {pick && (
                  <span className="text-[10px] tabular-nums text-emerald-300">
                    {pts(b.score - pick.score)} pt
                  </span>
                )}
                <WinRate p={b} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[9px] text-slate-500">
        {tr(
          `Stats ${source}. Runes et objets du champion affichés une fois verrouillé.`,
          `${source} stats. The champion's runes and items show once locked in.`
        )}
      </p>
    </section>
  )
}

/** Conseils de pick et de ban pendant la sélection des champions. */
export function AdviceCard({ t }: { t: TactiqueState }): ReactElement | null {
  const { advice, gd, draft } = t
  const [allBans, setAllBans] = useState(false)
  const [allPicks, setAllPicks] = useState(false)
  const [filter, setFilter] = useState('')
  if (!advice || !gd) return null
  const showBans = draft.banTurn || draft.timerPhase === 'PLANNING'
  const v = gd.version
  const noStats = !t.catalog.junglerStats
  const ej = advice.enemyJungler?.label ?? null
  const myKey = advice.myPick?.champ.key

  if (advice.ranking.length === 0 && (!showBans || advice.banRanking.length === 0)) return null

  const q = filter.trim().toLowerCase()
  const fullList = advice.ranking.filter(
    (p) => !q || p.champ.label.toLowerCase().includes(q) || p.champ.id.toLowerCase().includes(q)
  )

  return (
    <div className="flex flex-col gap-3">
      {showBans && advice.bans.length > 0 && (
        <Card
          title={tr('Bans conseillés', 'Suggested bans')}
          right={
            draft.banTurn ? (
              <Chip tone="red">{tr('à toi de bannir', 'your turn to ban')}</Chip>
            ) : undefined
          }
        >
          <ul className="flex flex-col gap-2">
            {(allBans ? advice.banRanking.slice(0, 15) : advice.bans).map((b) => (
              <BanRow key={b.champ.id} b={b} v={v} />
            ))}
          </ul>
          {advice.banRanking.length > advice.bans.length && (
            <Toggle
              open={allBans}
              onClick={() => setAllBans(!allBans)}
              label={
                allBans
                  ? tr('Moins de bans', 'Fewer bans')
                  : tr(
                      `Voir plus (${Math.min(15, advice.banRanking.length)})`,
                      `Show more (${Math.min(15, advice.banRanking.length)})`
                    )
              }
            />
          )}
        </Card>
      )}

      {advice.ranking.length > 0 && (
        <Card
          title={tr('Conseils de pick', 'Pick suggestions')}
          right={
            advice.enemyJungler ? (
              <span className="text-[10px] text-slate-400">vs {advice.enemyJungler.label}</span>
            ) : draft.pickTurn ? (
              <Chip tone="blue">{tr('à toi de choisir', 'your turn to pick')}</Chip>
            ) : undefined
          }
        >
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            {advice.known.allies + advice.known.enemies === 0
              ? tr(
                  'Aucun champion choisi : conseils sur la méta seule, affinés à chaque choix.',
                  'No champion picked yet: advice from the meta alone, refined with each pick.'
                )
              : tr(
                  `D’après ${advice.known.allies}/4 alliés et ${advice.known.enemies}/5 adversaires choisis. Chiffres colorés : effet de chaque critère, en points de victoire.`,
                  `Based on ${advice.known.allies}/4 allies and ${advice.known.enemies}/5 enemies picked. Colored numbers: effect of each criterion, in win-rate points.`
                )}
          </p>
          {advice.myPick && (
            <p className="mb-2 rounded bg-lolblue/10 px-2 py-1 text-[10px] text-slate-300">
              {tr('Ton choix', 'Your pick')}{' '}
              <b className="text-slate-100">{advice.myPick.champ.label}</b>{' '}
              {tr(
                `: ${advice.myPick.rank}ᵉ sur ${advice.ranking.length} dans cette draft (${pct(advice.myPick.winRate)}).`,
                `: #${advice.myPick.rank} of ${advice.ranking.length} in this draft (${pct(advice.myPick.winRate)}).`
              )}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {advice.picks.map((p) => (
              <PickRow
                key={p.champ.id}
                p={p}
                v={v}
                enemyJungler={ej}
                mine={p.champ.key === myKey}
              />
            ))}
          </ul>
          <Toggle
            open={allPicks}
            onClick={() => setAllPicks(!allPicks)}
            label={
              allPicks
                ? tr('Masquer le classement complet', 'Hide the full ranking')
                : tr(
                    `Classement complet (${advice.ranking.length} champions)`,
                    `Full ranking (${advice.ranking.length} champions)`
                  )
            }
          />
          {allPicks && (
            <div className="mt-2">
              <input
                className="mb-1.5 w-full rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px]"
                placeholder={tr('Chercher un champion…', 'Search a champion…')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="flex flex-col">
                {fullList.map((p) => (
                  <RankRow
                    key={p.champ.id}
                    p={p}
                    v={v}
                    enemyJungler={ej}
                    mine={p.champ.key === myKey}
                  />
                ))}
              </ul>
            </div>
          )}
          {noStats && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              {tr(
                'Branche la méta distante (Réglages) pour des conseils basés sur les parties classées.',
                'Set up the remote meta (Settings) for advice based on ranked games.'
              )}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
