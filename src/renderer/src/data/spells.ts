import { tr } from '../../../shared/i18n'

/** Sorts d'invocateur (identifiants Riot), noms affichés et clé Data Dragon de leur icône. */
export const SUMMONER_SPELLS: Record<number, { key: string; fr: string; en: string }> = {
  1: { key: 'SummonerBoost', fr: 'Purge', en: 'Cleanse' },
  3: { key: 'SummonerExhaust', fr: 'Fatigue', en: 'Exhaust' },
  4: { key: 'SummonerFlash', fr: 'Saut éclair', en: 'Flash' },
  6: { key: 'SummonerHaste', fr: 'Fantôme', en: 'Ghost' },
  7: { key: 'SummonerHeal', fr: 'Soins', en: 'Heal' },
  11: { key: 'SummonerSmite', fr: 'Châtiment', en: 'Smite' },
  12: { key: 'SummonerTeleport', fr: 'Téléportation', en: 'Teleport' },
  13: { key: 'SummonerMana', fr: 'Clarté', en: 'Clarity' },
  14: { key: 'SummonerDot', fr: 'Embrasement', en: 'Ignite' },
  21: { key: 'SummonerBarrier', fr: 'Barrière', en: 'Barrier' },
  32: { key: 'SummonerSnowball', fr: 'Marque', en: 'Mark' }
}

/** Nom affiché d'un sort d'invocateur (langue de l'app). */
export function spellName(id: number): string {
  const s = SUMMONER_SPELLS[id]
  return s ? tr(s.fr, s.en) : `#${id}`
}
