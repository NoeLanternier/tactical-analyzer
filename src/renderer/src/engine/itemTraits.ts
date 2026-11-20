// Caractéristiques des objets adverses qui changent la valeur des nôtres (mêmes règles que le
// pipeline de méta, qui mesure leur effet sur la victoire) : anti-soins, dégâts en % des PV,
// boucliers, protections contre les contrôles et le burst, pénétration, résistances, vol de vie,
// critiques.

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
  | 'crit'
  // Sorts d'invocateur et clés de voûte adverses (voir setupTraitsOf).
  | 'cleanse'
  | 'exhaust'
  | 'ignite'
  | 'ksHeal'
  | 'ksAs'
  | 'ksBurst'
  | 'ksTank'

/** Caractéristiques tirées des objets (les autres viennent des sorts et des clés de voûte). */
type ItemTrait = Exclude<FoeTrait, SetupTrait>
type SetupTrait = 'cleanse' | 'exhaust' | 'ignite' | 'ksHeal' | 'ksAs' | 'ksBurst' | 'ksTank'

/** Nombre d'objets adverses à partir duquel la caractéristique compte (comme le pipeline). */
export const FOE_TRAIT_MIN: Record<ItemTrait, number> = {
  antiheal: 1,
  pctHp: 2,
  shield: 2,
  antiCc: 2,
  armorPen: 2,
  magicPen: 2,
  armor: 3,
  mr: 3,
  lifesteal: 2,
  crit: 3
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
  lifesteal: ['vol de vie adverse', 'enemy lifesteal'],
  crit: ['critiques adverses', 'enemy crits'],
  cleanse: ['Purge adverse', 'enemy Cleanse'],
  exhaust: ['Fatigue adverse', 'enemy Exhaust'],
  ignite: ['Embrasement adverse', 'enemy Ignite'],
  ksHeal: ['clés de voûte de soins adverses', 'enemy sustain keystones'],
  ksAs: ['clés de voûte de vitesse d’attaque adverses', 'enemy attack speed keystones'],
  ksBurst: ['clés de voûte de burst adverses', 'enemy burst keystones'],
  ksTank: ['clés de voûte de résistance adverses', 'enemy tank keystones']
}

/** Sorts adverses mesurés (clé Data Dragon → caractéristique), comme la collecte. */
const SETUP_SPELLS: Record<string, SetupTrait> = {
  SummonerBoost: 'cleanse',
  SummonerExhaust: 'exhaust',
  SummonerDot: 'ignite'
}
/** Clés de voûte adverses, par effet (mêmes groupes que la collecte). */
const KEYSTONE_TRAITS: Record<number, SetupTrait[]> = {
  8010: ['ksHeal'],
  8021: ['ksHeal'],
  8437: ['ksHeal', 'ksTank'],
  8008: ['ksAs'],
  9923: ['ksAs'],
  8005: ['ksAs'],
  8112: ['ksBurst'],
  8128: ['ksBurst'],
  8229: ['ksBurst'],
  8369: ['ksBurst'],
  8439: ['ksTank'],
  8465: ['ksTank']
}
/** Nombre d'adversaires à partir duquel le sort ou la clé de voûte compte. */
const SETUP_MIN: Record<SetupTrait, number> = {
  cleanse: 1,
  exhaust: 1,
  ignite: 2,
  ksHeal: 2,
  ksAs: 1,
  ksBurst: 2,
  ksTank: 2
}

/** Sorts d'invocateur et clés de voûte adverses (API en jeu), mesurés comme les objets adverses. */
export function setupTraitsOf(foes: { spells?: string[]; keystone?: number }[]): FoeTrait[] {
  const count = new Map<SetupTrait, number>()
  for (const f of foes) {
    const seen = new Set<SetupTrait>()
    for (const s of f.spells ?? []) if (SETUP_SPELLS[s]) seen.add(SETUP_SPELLS[s])
    for (const t of KEYSTONE_TRAITS[f.keystone ?? 0] ?? []) seen.add(t)
    for (const t of seen) count.set(t, (count.get(t) ?? 0) + 1)
  }
  return (Object.keys(SETUP_MIN) as SetupTrait[]).filter((t) => (count.get(t) ?? 0) >= SETUP_MIN[t])
}

/** Caractéristiques d'un objet d'après sa description anglaise (Data Dragon) et ses stats. */
export function itemTraits(description: string, stats: Record<string, number>): FoeTrait[] {
  const desc = description.replace(/<[^>]+>/g, ' ').toLowerCase()
  const t: ItemTrait[] = []
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
  if ((stats.FlatCritChanceMod ?? 0) > 0) t.push('crit')
  return t
}

/** Caractéristiques présentes chez l'adversaire, à partir des traits de ses objets légendaires. */
export function foeTraitsOf(foeItemTraits: FoeTrait[][]): FoeTrait[] {
  const count = new Map<FoeTrait, number>()
  for (const traits of foeItemTraits) for (const t of traits) count.set(t, (count.get(t) ?? 0) + 1)
  return (Object.keys(FOE_TRAIT_MIN) as ItemTrait[]).filter(
    (t) => (count.get(t) ?? 0) >= FOE_TRAIT_MIN[t]
  )
}
