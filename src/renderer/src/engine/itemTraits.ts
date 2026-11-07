// Caractéristiques des objets adverses qui changent la valeur des nôtres (mêmes règles que le
// pipeline de méta, qui mesure leur effet sur la victoire) : anti-soins, dégâts en % des PV,
// boucliers, protections contre les contrôles et le burst, pénétration, résistances, vol de vie.

export type FoeTrait =
  | 'antiheal'
  | 'pctHp'
  | 'shield'
  | 'antiCc'
  | 'armorPen'
  | 'magicPen'
  | 'armor'
  | 'mr'
  | 'lifesteal'

/** Nombre d'objets adverses à partir duquel la caractéristique compte (comme le pipeline). */
export const FOE_TRAIT_MIN: Record<FoeTrait, number> = {
  antiheal: 1,
  pctHp: 2,
  shield: 2,
  antiCc: 2,
  armorPen: 2,
  magicPen: 2,
  armor: 3,
  mr: 3,
  lifesteal: 2
}

export const FOE_TRAIT_LABEL: Record<FoeTrait, [string, string]> = {
  antiheal: ['anti-soins adverses', 'enemy anti-heal'],
  pctHp: ['dégâts en % PV adverses', 'enemy % health damage'],
  shield: ['boucliers adverses', 'enemy shields'],
  antiCc: ['stase / anti-sorts adverses', 'enemy stasis / spell shields'],
  armorPen: ['pénétration d’armure adverse', 'enemy armor penetration'],
  magicPen: ['pénétration magique adverse', 'enemy magic penetration'],
  armor: ['armure adverse', 'enemy armor'],
  mr: ['RM adverse', 'enemy MR'],
  lifesteal: ['vol de vie adverse', 'enemy lifesteal']
}

/** Caractéristiques d'un objet d'après sa description anglaise (Data Dragon) et ses stats. */
export function itemTraits(description: string, stats: Record<string, number>): FoeTrait[] {
  const desc = description.replace(/<[^>]+>/g, ' ').toLowerCase()
  const t: FoeTrait[] = []
  const offensive =
    (stats.FlatPhysicalDamageMod ?? 0) > 0 ||
    (stats.FlatMagicDamageMod ?? 0) > 0 ||
    (stats.PercentAttackSpeedMod ?? 0) > 0
  if (/grievous wounds/.test(desc)) t.push('antiheal')
  if (offensive && /damage/.test(desc) && /(max(imum)?|current|missing) health/.test(desc))
    t.push('pctHp')
  if (/shield/.test(desc) && !/spell ?shield/.test(desc)) t.push('shield')
  if (/stasis|spell ?shield|remove all crowd control|cleanse|untargetable/.test(desc))
    t.push('antiCc')
  if (/lethality|armor penetration/.test(desc)) t.push('armorPen')
  if (/magic penetration/.test(desc)) t.push('magicPen')
  if ((stats.FlatArmorMod ?? 0) >= 40) t.push('armor')
  if ((stats.FlatSpellBlockMod ?? 0) >= 40) t.push('mr')
  if ((stats.PercentLifeStealMod ?? 0) > 0 || /omnivamp|life ?steal/.test(desc)) t.push('lifesteal')
  return t
}

/** Caractéristiques présentes chez l'adversaire, à partir des traits de ses objets légendaires. */
export function foeTraitsOf(foeItemTraits: FoeTrait[][]): FoeTrait[] {
  const count = new Map<FoeTrait, number>()
  for (const traits of foeItemTraits) for (const t of traits) count.set(t, (count.get(t) ?? 0) + 1)
  return (Object.keys(FOE_TRAIT_MIN) as FoeTrait[]).filter(
    (t) => (count.get(t) ?? 0) >= FOE_TRAIT_MIN[t]
  )
}
