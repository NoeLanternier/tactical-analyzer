import type { ReactElement } from 'react'
import {
  harmful,
  proven,
  swapsHelp,
  type ChoiceProof,
  type DefenseProof,
  type NextBacktest,
  type NextGain,
  type ProvenChoice,
  type SwapBacktest
} from '../engine/catalog'
import type { NextModel } from '../engine/nextItems'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'

/** Points de victoire (0,012 → « +1,2 pt »). */
const pts = (x: number): string =>
  `${x >= 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)} ${tr('pt', 'pts')}`

/** Couleur : vert si l'écart dépasse nettement le hasard (2 erreurs types), orange s'il est négatif. */
const tone = (g: NextGain): string =>
  g.gain - 2 * g.se > 0
    ? 'text-emerald-300'
    : g.gain + 2 * g.se < 0
      ? 'text-orange-300'
      : 'text-slate-300'

/** Conseil retenu : le poids de popularité du modèle, sinon le meilleur mesuré. */
function usedGain(bt: NextBacktest, model?: NextModel): NextGain | null {
  const full = bt.gammas.filter((g): g is NextGain & { gamma: number } => g.gain !== undefined)
  const used = model?.measured ? full.find((g) => g.gamma === model.gamma) : undefined
  return used ?? full.sort((a, b) => b.gain - a.gain)[0] ?? null
}

/**
 * Preuve hors échantillon de l'objet suivant (3e au 6e objet) : conseils de la méta de la veille
 * jugés sur les parties Master+ du lendemain, à or égal (voir tactique-meta, src/nextItems.mjs).
 */
const CHOICE_LABEL: Record<ProvenChoice, [string, string]> = {
  runes: ['Runes', 'Runes'],
  boots: ['Bottes', 'Boots'],
  start: ['Départ', 'Start'],
  skills: ['Compétences', 'Skills'],
  pet: ['Familier', 'Pet'],
  bootsT: ['Moment des bottes', 'Boots timing'],
  spells: ['Sorts', 'Spells']
}
const DEFENSE_LABEL: Record<keyof DefenseProof, [string, string]> = {
  fedAp: ['RM face à une menace magique', 'MR vs a magic threat'],
  fedAd: ['armure face à une menace physique', 'armor vs a physical threat'],
  behind: ['défense quand l’équipe est en retard', 'defense when the team is behind']
}

/** Gain mesuré en ligne courte : « +1,2 pt (± 0,8) ». */
function GainText({ g }: { g: NextGain }): ReactElement {
  return (
    <>
      <b className={tone(g)}>{pts(g.gain)}</b>
      {` (± ${fmtNumber(2 * g.se * 100, 1)})`}
    </>
  )
}

export function NextProof({
  bt,
  model,
  swap,
  choices,
  defense,
  compact = false
}: {
  bt?: NextBacktest
  model?: NextModel
  /** Échanges en fin de build conseillés, jugés de la même façon. */
  swap?: SwapBacktest
  /** Runes, bottes, départ… : option conseillée suivie ou non (backtest.choices). */
  choices?: Partial<Record<ProvenChoice, ChoiceProof>>
  /** Défense face à une menace, mesurée à avance égale (meta.defense). */
  defense?: DefenseProof
  compact?: boolean
}): ReactElement | null {
  const g = bt ? usedGain(bt, model) : null
  if (!bt || !g) {
    if (compact) return null
    return (
      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        {tr(
          'Objet suivant (3e au 6e objet) : la vérification sur les parties du lendemain commence après deux collectes.',
          'Next item (3rd to 6th item): checking against the next day’s games starts after two collections.'
        )}
      </p>
    )
  }
  const total = g.followed + g.other
  if (compact)
    return (
      <div className="text-[10px] leading-snug text-slate-400">
        {tr(
          `Objets 3 à 6, vérifiés sur les parties collectées du lendemain (${fmtNumber(total)} achats) : suivre le conseil donne `,
          `Items 3 to 6, checked on the next day’s collected games (${fmtNumber(total)} purchases): following the advice gives `
        )}
        <b className={tone(g)}>{pts(g.gain)}</b>
        {tr(' de victoires à or égal.', ' win rate at equal gold.')}
      </div>
    )
  return (
    <div className="mb-2 text-[10px] leading-snug text-slate-400">
      <p className="mb-1 text-slate-500">
        {tr(
          `Objet suivant (3e au 6e objet) : conseils de la veille jugés sur ${fmtNumber(bt.decisions)} achats du lendemain, à or égal (victoires en plus de ce que l’avance ou le retard laissait attendre).`,
          `Next item (3rd to 6th item): the previous day’s advice judged on ${fmtNumber(bt.decisions)} purchases from the next day, at equal gold (wins above what the lead or deficit predicted).`
        )}
      </p>
      <p>
        {tr('Conseil suivi ', 'Advice followed ')}
        <b className={tone(g)}>{pts(g.gain)}</b>
        {tr(
          ` (± ${fmtNumber(2 * g.se * 100, 1)}) · ${fmtNumber(g.followed)} achats conformes, ${fmtNumber(g.other)} autres`,
          ` (± ${fmtNumber(2 * g.se * 100, 1)}) · ${fmtNumber(g.followed)} matching purchases, ${fmtNumber(g.other)} others`
        )}
      </p>
      {bt.old && (
        <p>
          {tr('Ancien conseil (objets les plus construits) ', 'Old advice (most built items) ')}
          <b className={tone(bt.old)}>{pts(bt.old.gain)}</b>
        </p>
      )}
      {bt.calibration && (
        <p>
          {tr(
            `Écarts prévus retrouvés à ${fmtPct(Math.max(0, bt.calibration.slope))} (100 % : prévisions exactes)`,
            `Predicted gaps found at ${fmtPct(Math.max(0, bt.calibration.slope))} (100%: exact predictions)`
          )}
        </p>
      )}
      {bt.ranks?.['1'] && (
        <p>
          {tr('2e objet ', '2nd item ')}
          <GainText g={bt.ranks['1']} />
          {model?.second
            ? tr(' : peut remplacer celui du cœur.', ': may replace the core one.')
            : tr(
                ' : celui du cœur reste tant que ce n’est pas nettement gagnant.',
                ': the core one stays until this clearly wins.'
              )}
        </p>
      )}
      {choices && Object.keys(choices).length > 0 && (
        <p>
          {tr(
            'Choix de début de partie conseillés, suivis : ',
            'Suggested start-of-game choices, followed: '
          )}
          {(Object.keys(choices) as ProvenChoice[]).map((k, i) => (
            <span key={k}>
              {i > 0 && ' · '}
              {tr(CHOICE_LABEL[k][0], CHOICE_LABEL[k][1])} <GainText g={choices[k]!} />
              {harmful(choices[k], 1000) && tr(' → option la plus jouée', ' → most played option')}
            </span>
          ))}
        </p>
      )}
      {defense && Object.keys(defense).length > 0 && (
        <p>
          {tr(
            'Défense en situation de menace (à or égal) : ',
            'Defense under threat (at equal gold): '
          )}
          {(Object.keys(defense) as (keyof DefenseProof)[]).map((k, i) => (
            <span key={k}>
              {i > 0 && ' · '}
              {tr(DEFENSE_LABEL[k][0], DEFENSE_LABEL[k][1])} <GainText g={defense[k]!} />
              {proven(defense[k], 100)
                ? tr(' → prioritaire', ' → prioritized')
                : tr(' → pas prioritaire', ' → not prioritized')}
            </span>
          ))}
        </p>
      )}
      {swap?.gain && (
        <p>
          {tr(
            `Échanges de fin de build conseillés (${fmtNumber(swap.followed + swap.kept)} parties) : échange fait `,
            `Suggested end-of-build swaps (${fmtNumber(swap.followed + swap.kept)} games): swap made `
          )}
          <b className={tone(swap.gain)}>{pts(swap.gain.gain)}</b>
          {tr(
            ` par rapport à rien changer (± ${fmtNumber(2 * swap.gain.se * 100, 1)})`,
            ` vs no change (± ${fmtNumber(2 * swap.gain.se * 100, 1)})`
          )}
          {!swapsHelp(swap) &&
            tr(
              ' : pas proposés tant qu’ils ne font pas nettement gagner.',
              ': not suggested until they clearly win more.'
            )}
        </p>
      )}
      <p className="text-slate-500">
        {model?.measured
          ? tr(
              `Réglage appliqué : popularité ×${fmtNumber(model.gamma, 2)}, écarts ×${fmtNumber(model.slope, 2)}.`,
              `Applied setting: popularity ×${fmtNumber(model.gamma, 2)}, gaps ×${fmtNumber(model.slope, 2)}.`
            )
          : tr(
              'Réglage par défaut tant que moins de 1 000 achats sont vérifiés.',
              'Default setting until 1,000 purchases are checked.'
            )}
      </p>
    </div>
  )
}
