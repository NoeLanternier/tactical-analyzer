import type { ReactElement } from 'react'
import type { NextBacktest, NextGain } from '../engine/catalog'
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
 * Preuve hors échantillon de l'objet suivant (4e au 6e objet) : conseils de la méta de la veille
 * jugés sur les parties Master+ du lendemain, à or égal (voir tactique-meta, src/nextItems.mjs).
 */
export function NextProof({
  bt,
  model,
  compact = false
}: {
  bt?: NextBacktest
  model?: NextModel
  compact?: boolean
}): ReactElement | null {
  const g = bt ? usedGain(bt, model) : null
  if (!bt || !g) {
    if (compact) return null
    return (
      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        {tr(
          'Objet suivant (4e au 6e objet) : la vérification sur les parties du lendemain commence après deux collectes.',
          'Next item (4th to 6th item): checking against the next day’s games starts after two collections.'
        )}
      </p>
    )
  }
  const total = g.followed + g.other
  if (compact)
    return (
      <div className="text-[10px] leading-snug text-slate-400">
        {tr(
          `Objets 4 à 6, vérifiés sur les parties collectées du lendemain (${fmtNumber(total)} achats) : suivre le conseil donne `,
          `Items 4 to 6, checked on the next day’s collected games (${fmtNumber(total)} purchases): following the advice gives `
        )}
        <b className={tone(g)}>{pts(g.gain)}</b>
        {tr(' de victoires à or égal.', ' win rate at equal gold.')}
      </div>
    )
  return (
    <div className="mb-2 text-[10px] leading-snug text-slate-400">
      <p className="mb-1 text-slate-500">
        {tr(
          `Objet suivant (4e au 6e objet) : conseils de la veille jugés sur ${fmtNumber(bt.decisions)} achats du lendemain, à or égal (victoires en plus de ce que l’avance ou le retard laissait attendre).`,
          `Next item (4th to 6th item): the previous day’s advice judged on ${fmtNumber(bt.decisions)} purchases from the next day, at equal gold (wins above what the lead or deficit predicted).`
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
