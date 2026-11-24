import { Activity } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import { champIcon } from '../engine/gameData'
import { Card, Chip, Meter } from './ui'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'

export function AnalysisTab({ t }: { t: TactiqueState }): ReactElement | null {
  const { gd, threat } = t
  if (!gd || !threat) return null
  if (threat.enemies.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        {tr('Aucun adversaire connu pour l’instant.', 'No enemy known yet.')}
        <br />
        <span className="text-[11px] text-slate-500">
          {tr(
            'L’analyse se remplit au fil des choix adverses, puis en partie.',
            'The analysis fills in as enemies lock in, then during the game.'
          )}
        </span>
      </p>
    )
  }
  const m = threat.metrics
  const v = gd.version
  // Menace : adversaire très en avance, sinon celui qui cause la plupart de tes morts. Ce que le
  // build en fait dépend de ce que la collecte a mesuré (défense prioritaire seulement si elle gagne).
  const main = threat.fed ?? threat.focus
  const kind = main && main.ap >= 0.5 ? 'fedAp' : 'fedAd'
  const proof = t.catalog.defense?.[kind]
  const trusted = (t.catalog.nextModel?.defense ?? { fedAp: 1, fedAd: 1, behind: 1 })[kind] > 0
  const defenseLine = !trusted
    ? tr(
        'Le build prend les objets qui gagnent le plus dans ces parties ; la défense ne s’y est pas montrée plus gagnante.',
        'The build takes the items that win most in these games; defense has not proven to win more there.'
      )
    : proof
      ? tr(
          `La défense contre ses dégâts passe en priorité : elle gagne dans ces parties (+${fmtNumber(proof.gain * 100, 1)} pt).`,
          `Defense against their damage comes first: it wins in these games (+${fmtNumber(proof.gain * 100, 1)} pts).`
        )
      : tr(
          'Le build donne la priorité à la défense contre lui.',
          'The build prioritizes defense against them.'
        )
  return (
    <div className="flex flex-col gap-3">
      {main && (
        <div className="flex items-center gap-2 rounded border border-red-400/40 bg-red-500/10 p-2">
          <Activity size={16} className="shrink-0 animate-pulse text-red-400" />
          <img src={champIcon(v, main.champ.id)} className="h-7 w-7 rounded-full" alt="" />
          <div className="text-[11px] leading-snug text-red-200">
            {threat.fed
              ? tr(
                  `${main.champ.label} est la menace principale (${main.kda}, ${fmtNumber(main.itemGold)} d'objets, nettement plus que son équipe).`,
                  `${main.champ.label} is the main threat (${main.kda}, ${fmtNumber(main.itemGold)} of items, well above their team).`
                )
              : tr(
                  `${main.champ.label} cause la plupart de tes morts récentes.`,
                  `${main.champ.label} causes most of your recent deaths.`
                )}{' '}
            {defenseLine}
          </div>
        </div>
      )}

      <Card
        title={
          threat.live
            ? tr('Menace en partie (pondérée par l’avance)', 'In-game threat (weighted by lead)')
            : tr('Composition adverse', 'Enemy team comp')
        }
      >
        <div className="mb-2 flex h-2 overflow-hidden rounded">
          <div className="bg-sky-400" style={{ width: `${m.ap * 100}%` }} />
          <div className="bg-orange-400" style={{ width: `${m.ad * 100}%` }} />
        </div>
        <div className="mb-3 flex justify-between text-[10px]">
          <span className="text-sky-300">
            {tr('Magique', 'Magic')} {fmtPct(m.ap)}
          </span>
          <span className="text-orange-300">
            {tr('Physique', 'Physical')} {fmtPct(m.ad)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Meter label={tr('Résistance', 'Tankiness')} value={m.tanky} />
          <Meter label={tr('Contrôles', 'Crowd control')} value={m.cc} />
          <Meter label={tr('Soins', 'Healing')} value={m.heal} tone="orange" />
          <Meter label="Burst" value={m.burst} tone="red" />
          <Meter label={tr('Critiques', 'Crits')} value={m.crit} />
          <Meter label={tr('Attaques de base', 'Auto attacks')} value={m.aa} />
          <Meter label={tr('Boucliers', 'Shields')} value={m.shield} />
          {threat.live && <Meter label={tr('Avance de l’équipe', 'Team lead')} value={m.ahead} />}
          {threat.live && (
            <Meter label={tr('Retard de l’équipe', 'Team deficit')} value={m.behind} tone="red" />
          )}
        </div>
      </Card>

      <Card title={tr('Lecture tactique', 'Tactical read')}>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-snug text-slate-300">
          {threat.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>

      <Card title={tr('Adversaires', 'Enemies')}>
        <ul className="flex flex-col gap-1.5">
          {threat.enemies.map((e) => (
            <li key={e.champ.id} className="flex items-center gap-2 text-[11px]">
              <img src={champIcon(v, e.champ.id)} className="h-6 w-6 rounded" alt="" />
              <span className="flex-1 truncate text-slate-200">{e.champ.label}</span>
              {threat.live && <span className="tabular-nums text-slate-400">{e.kda}</span>}
              {threat.live && (
                <span className="w-12 text-right tabular-nums text-gold">
                  {(e.itemGold / 1000).toFixed(1)}k
                </span>
              )}
              <Chip tone={e.ap >= 0.6 ? 'blue' : e.ap <= 0.4 ? 'orange' : 'slate'}>
                {e.ap >= 0.6 ? 'AP' : e.ap <= 0.4 ? 'AD' : tr('Mixte', 'Mixed')}
              </Chip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
