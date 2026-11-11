import { CHAMPION_PROFILES } from '../data/champions'
import { foeTraitsOf, type FoeTrait } from './itemTraits'
import type { Metric } from '../data/items'
import type { LiveGameData, LivePlayer } from '../../../shared/types'
import { champFromLive, inventoryValue, type ChampInfo, type GameData } from './gameData'
import { clamp01 } from './normalize'
import { fmtPct, gold, tr } from '../../../shared/i18n'

/** Profil mesuré dans les vraies parties (méta distante) : rangs centiles entre 0 et 1. */
export interface MeasuredProfile {
  ap: number
  tank: number
  cc: number
  heal: number
  shield: number
  crit: number
  aa: number
  games: number
}

export interface ChampProfile {
  ap: number
  flags: string
  /** Intensités entre 0 et 1. */
  tank: number
  cc: number
  heal: number
  shield: number
  burst: number
  crit: number
  aa: number
  /** Profil issu des parties réelles (true) ou de la table manuelle / des tags Riot (false). */
  measured: boolean
}

export type MeasuredProfiles = Record<string, MeasuredProfile>

/** Un rang centile devient une intensité : la moitié basse ne compte pas, le top 10 % vaut 1. */
const high = (p: number): number => clamp01((p - 0.45) / 0.45)

/**
 * Profil d'un champion : mesuré dans les parties Master+ du patch quand c'est possible, sinon table
 * manuelle, sinon déduit des données Riot (tags + info.attack/info.magic).
 */
export function profileOf(champ: ChampInfo, measured?: MeasuredProfiles): ChampProfile {
  const known = CHAMPION_PROFILES[champ.id]
  let ap: number
  let flags: string
  if (known) {
    ap = known[0]
    flags = known[1]
  } else {
    const { attack, magic } = champ.info
    ap = attack + magic > 0 ? magic / (attack + magic) : 0.5
    const tags = champ.tags
    if (tags.includes('Mage')) ap = Math.max(ap, 0.75)
    if (tags.includes('Marksman')) ap = Math.min(ap, 0.3)
    flags = ''
    if (tags.includes('Tank')) flags += 'T'
    if (tags.includes('Fighter')) flags += 'B'
    if (tags.includes('Assassin')) flags += 'A'
    if (tags.includes('Marksman')) flags += 'MO'
    if (tags.includes('Mage')) flags += 'G'
    if (tags.includes('Support')) flags += 'E'
  }
  const f = (x: string): boolean => flags.includes(x)
  const burst = f('A') ? 1 : f('G') ? 0.4 : 0
  const m = measured?.[champ.id]
  if (m && m.games >= 30) {
    return {
      ap: clamp01(m.ap),
      flags,
      tank: high(m.tank),
      cc: high(m.cc),
      heal: high(m.heal),
      shield: high(m.shield),
      burst,
      crit: clamp01(m.crit),
      aa: clamp01(Math.max(m.aa, f('M') ? 0.6 : 0)),
      measured: true
    }
  }
  return {
    ap: clamp01(ap),
    flags,
    tank: f('T') ? 1 : f('B') ? 0.35 : 0,
    cc: f('C') ? 1 : 0,
    heal: f('H') ? 1 : 0,
    shield: f('S') ? 1 : 0,
    burst,
    crit: f('K') ? 0.7 : 0,
    aa: f('M') ? 1 : f('O') ? 0.7 : 0,
    measured: false
  }
}

export interface EnemyThreat {
  champ: ChampInfo
  ap: number
  flags: string
  profile: ChampProfile
  /** Poids relatif dans la partie (1 avant la partie, selon l'or et le score ensuite). */
  power: number
  /**
   * Part de tes morts récentes causées par cet adversaire (0 à 1, en partie) : ses dégâts comptent
   * davantage dans le choix des objets défensifs.
   */
  focus: number
  itemGold: number
  bonusArmor: number
  bonusMr: number
  kda: string
}

export interface ThreatProfile {
  metrics: Record<Metric, number>
  enemies: EnemyThreat[]
  /** Adversaire qui a pris le plus d'avance (en partie). */
  fed: EnemyThreat | null
  /** Adversaire qui cause le plus tes morts récentes (en partie). */
  focus: EnemyThreat | null
  /** Notes lisibles expliquant l'analyse. */
  notes: string[]
  allyDamage: { ap: number; ad: number } | null
  live: boolean
  /** Différence d'or des objets (équipe alliée − adverse), en partie. */
  goldDiff: number
  /**
   * Besoins défensifs, compte tenu de tes résistances actuelles : part de la valeur d'un point
   * d'armure (`ad`) et d'un point de résistance magique (`ap`), total 1. Avant la partie, c'est la
   * part des dégâts physiques et magiques adverses ; en partie, l'armure que tu as déjà rend la
   * résistance magique plus rentable, et inversement.
   */
  defense: { ad: number; ap: number; armor: number; mr: number }
  /** Caractéristiques des objets adverses (anti-soins, % PV, boucliers…), en partie. */
  foeTraits: FoeTrait[]
}

/**
 * Armure et résistance magique du joueur : valeurs de l'API en jeu si elles sont là, sinon une
 * estimation (valeurs de base d'un champion moyen à ce niveau + objets).
 */
export function myResists(
  gd: GameData,
  live: LiveGameData | null,
  me: LivePlayer | null
): { armor: number; mr: number } {
  const stats = live?.activePlayer?.stats
  if (stats && stats.maxHealth > 0) return { armor: stats.armor, mr: stats.magicResist }
  const level = me?.level ?? 1
  let armor = 32 + 4.4 * (level - 1)
  let mr = 31 + 1.7 * (level - 1)
  for (const it of me?.items ?? []) {
    const info = gd.items.get(it.itemID)
    armor += info?.stats.FlatArmorMod ?? 0
    mr += info?.stats.FlatSpellBlockMod ?? 0
  }
  return { armor, mr }
}

/**
 * Valeur relative d'un point d'armure et d'un point de résistance magique face à des dégâts
 * adverses `physical` / `magic` (parts, total 1). Le gain de points de vie effectifs d'un point
 * d'armure vaut (part des dégâts physiques subis après réduction) / (100 + armure) : plus tu as
 * d'armure, moins les dégâts physiques comptent dans ce que tu subis et moins un point de plus
 * rapporte.
 */
export function defenseNeeds(
  physical: number,
  magic: number,
  armor: number,
  mr: number
): { ad: number; ap: number } {
  const p = physical / (1 + Math.max(0, armor) / 100)
  const m = magic / (1 + Math.max(0, mr) / 100)
  if (p + m <= 0) return { ad: 0.5, ap: 0.5 }
  const vArmor = p / (p + m) / (100 + Math.max(0, armor))
  const vMr = m / (p + m) / (100 + Math.max(0, mr))
  return { ad: vArmor / (vArmor + vMr), ap: vMr / (vArmor + vMr) }
}

/** Statistiques offensives/défensives tirées des objets d'un joueur en partie. */
interface ItemStats {
  ap: number
  ad: number
  crit: number
  as: number
  armor: number
  mr: number
  vamp: number
}

function itemStats(gd: GameData, p: LivePlayer): ItemStats {
  let ap = 0
  let ad = 0
  let crit = 0
  let as = 0
  let armor = 0
  let mr = 0
  let vamp = 0
  for (const it of p.items) {
    const info = gd.items.get(it.itemID)
    if (!info) continue
    const s = info.stats
    ap += s.FlatMagicDamageMod ?? 0
    ad += s.FlatPhysicalDamageMod ?? 0
    crit += s.FlatCritChanceMod ?? 0
    as += s.PercentAttackSpeedMod ?? 0
    armor += s.FlatArmorMod ?? 0
    mr += s.FlatSpellBlockMod ?? 0
    vamp += s.PercentLifeStealMod ?? 0
    if (/omnivamp|vol de vie|life ?steal|heal/i.test(info.description) && info.isLegendary)
      vamp += 0.03
  }
  return { ap, ad, crit, as, armor, mr, vamp }
}

/**
 * Analyse la composition adverse. Sans données de partie : profils des champions.
 * Avec les données de partie : chaque adversaire est pondéré par son avance (or des objets,
 * niveau, score) et ses vrais objets corrigent son profil (AP/AD, armure, RM, critique, soins).
 */
export function analyzeThreat(
  gd: GameData,
  enemyKeys: number[],
  allyKeys: number[],
  live: LiveGameData | null,
  myChampId: string | null,
  measured?: MeasuredProfiles
): ThreatProfile {
  const notes: string[] = []
  const enemies: EnemyThreat[] = []
  let livePlayers: { me: LivePlayer | null; allies: LivePlayer[]; foes: LivePlayer[] } | null = null

  const me = findMe(gd, live, myChampId)
  if (live && me) {
    livePlayers = {
      me,
      allies: live.allPlayers.filter((p) => p.team === me.team),
      foes: live.allPlayers.filter((p) => p.team !== me.team)
    }
  }

  // Extra pour le score d'avance, en partie.
  const extra = { crit: 0, aa: 0, heal: 0, armor: 0, mr: 0 }
  const foeItemTraits: FoeTrait[][] = []
  const focusOf = livePlayers?.me && live ? deathFocus(live, livePlayers.me) : null

  if (livePlayers) {
    for (const p of livePlayers.foes) {
      const champ = champFromLive(gd, p.rawChampionName, p.championName)
      if (!champ) continue
      const prof = profileOf(champ, measured)
      const st = itemStats(gd, p)
      const itemGold = inventoryValue(gd, p.items)
      // Correction AP/AD à partir des objets achetés (valeur en or approximative des stats).
      const apVal = st.ap * 20
      const adVal = st.ad * 35 + st.crit * 4000 + st.as * 2500
      let apShare = prof.ap
      if (apVal + adVal > 1200) apShare = 0.5 * prof.ap + 0.5 * (apVal / (apVal + adVal))
      const power = Math.max(
        0.3,
        1 + itemGold / 3500 + p.level * 0.04 + (p.scores.kills - 0.5 * p.scores.deaths) * 0.12
      )
      enemies.push({
        champ,
        ap: apShare,
        flags: prof.flags,
        profile: prof,
        power,
        itemGold,
        bonusArmor: st.armor,
        bonusMr: st.mr,
        kda: `${p.scores.kills}/${p.scores.deaths}/${p.scores.assists}`,
        focus: focusOf ? focusOf(p) : 0
      })
      for (const it of p.items) {
        const info = gd.items.get(it.itemID)
        if (info?.isLegendary) foeItemTraits.push(info.traits)
      }
      extra.crit += st.crit
      extra.aa += st.as
      extra.heal += st.vamp
      extra.armor += st.armor
      extra.mr += st.mr
    }
  } else {
    for (const key of enemyKeys) {
      const champ = gd.champions.get(key)
      if (!champ) continue
      const prof = profileOf(champ, measured)
      enemies.push({
        champ,
        ap: prof.ap,
        flags: prof.flags,
        profile: prof,
        power: 1,
        itemGold: 0,
        bonusArmor: 0,
        bonusMr: 0,
        kda: '',
        focus: 0
      })
    }
  }

  const n = enemies.length
  const totalPower = enemies.reduce((s, e) => s + e.power, 0) || 1
  // Poids de chaque adversaire : son avance, et sa part dans tes morts récentes.
  const weightOf = (e: EnemyThreat): number => threatWeight(e)
  const totalWeight = enemies.reduce((s, e) => s + weightOf(e), 0) || 1
  const weighted = (fn: (e: EnemyThreat) => number): number =>
    enemies.reduce((s, e) => s + fn(e) * weightOf(e), 0) / totalWeight
  // Somme des intensités, pondérée par l'avance de chaque adversaire.
  const mean = totalPower / Math.max(n, 1)
  const meanWeight = totalWeight / Math.max(n, 1)
  const total = (dim: 'tank' | 'cc' | 'heal' | 'shield' | 'burst' | 'crit' | 'aa'): number =>
    enemies.reduce((s, e) => s + e.profile[dim] * (weightOf(e) / meanWeight), 0)

  const ap = n > 0 ? weighted((e) => e.ap) : 0.5
  const tankScore =
    total('tank') + enemies.reduce((s, e) => s + (e.bonusArmor + e.bonusMr) / 250, 0)
  const metrics: Record<Metric, number> = {
    ap: clamp01(ap),
    ad: clamp01(1 - ap),
    mixed: clamp01(1 - Math.abs(ap - 0.5) * 2.2),
    tanky: clamp01(tankScore / 3),
    armorStack: n > 0 && livePlayers ? clamp01(extra.armor / n / 90) : clamp01(tankScore / 4),
    mrStack: n > 0 && livePlayers ? clamp01(extra.mr / n / 80) : clamp01(tankScore / 4.5),
    cc: clamp01(total('cc') / 3),
    heal: clamp01(total('heal') / 2.5 + extra.heal * 2),
    shield: clamp01(total('shield') / 3),
    burst: clamp01(total('burst') / 2.5),
    crit: clamp01(total('crit') / 2 + extra.crit / 1.0),
    aa: clamp01(total('aa') / 2 + extra.aa / 1.5),
    fedAp: 0,
    fedAd: 0,
    ahead: 0,
    behind: 0
  }

  let fed: EnemyThreat | null = null
  let focus: EnemyThreat | null = null
  let goldDiff = 0
  if (livePlayers && n > 0) {
    const top = [...enemies].sort((a, b) => b.power - a.power)[0]
    const fedness = clamp01((top.power / mean - 1.15) / 0.6)
    if (fedness > 0 && top.itemGold >= 2500) {
      fed = top
      metrics.fedAp = clamp01(fedness * top.ap * 1.3)
      metrics.fedAd = clamp01(fedness * (1 - top.ap) * 1.3)
      notes.push(
        tr(
          `${top.champ.label} a pris de l'avance (${top.kda}, ${gold(top.itemGold)} d'objets) — dégâts ${top.ap >= 0.5 ? 'magiques' : 'physiques'}.`,
          `${top.champ.label} is ahead (${top.kda}, ${gold(top.itemGold)} of items) — ${top.ap >= 0.5 ? 'magic' : 'physical'} damage.`
        )
      )
    }
    // Adversaire qui cause la plupart de tes morts récentes : protection contre ses dégâts, même
    // s'il n'est pas le plus en avance de son équipe.
    const killer = [...enemies].sort((a, b) => b.focus - a.focus)[0]
    if (killer && killer.focus >= 0.5) {
      focus = killer
      metrics.fedAp = Math.max(metrics.fedAp, clamp01(killer.focus * killer.ap * 0.9))
      metrics.fedAd = Math.max(metrics.fedAd, clamp01(killer.focus * (1 - killer.ap) * 0.9))
      if (killer !== fed)
        notes.push(
          tr(
            `${killer.champ.label} cause la plupart de tes morts récentes — dégâts ${killer.ap >= 0.5 ? 'magiques' : 'physiques'} : le build en tient compte.`,
            `${killer.champ.label} causes most of your recent deaths — ${killer.ap >= 0.5 ? 'magic' : 'physical'} damage: the build accounts for it.`
          )
        )
    }
    const allyGold = livePlayers.allies.reduce((s, p) => s + inventoryValue(gd, p.items), 0)
    const foeGold = livePlayers.foes.reduce((s, p) => s + inventoryValue(gd, p.items), 0)
    goldDiff = allyGold - foeGold
    const rel = goldDiff / Math.max(foeGold, 3000)
    metrics.ahead = clamp01(rel / 0.25)
    metrics.behind = clamp01(-rel / 0.25)
    // Ton propre retard (objets plus faibles que la moyenne adverse) compte aussi, un peu moins
    // que celui de l'équipe : c'est toi qui dois survivre aux combats.
    const myGold = inventoryValue(gd, livePlayers.me?.items ?? [])
    const foeAvg = foeGold / Math.max(1, livePlayers.foes.length)
    if (foeAvg >= 2500) {
      const mine = clamp01((foeAvg - myGold) / (foeAvg * 0.35))
      if (mine * 0.8 > metrics.behind) {
        metrics.behind = mine * 0.8
        if (mine >= 0.6)
          notes.push(
            tr(
              `Tes objets valent ${gold(foeAvg - myGold)} de moins que la moyenne adverse : survie prioritaire.`,
              `Your items are worth ${gold(foeAvg - myGold)} less than the enemy average: survival first.`
            )
          )
      }
      if (myGold > foeAvg * 1.25) metrics.ahead = Math.max(metrics.ahead, 0.5)
    }
    if (metrics.ahead > 0.5)
      notes.push(
        tr(
          `Votre équipe mène (+${gold(goldDiff)}) : build plus offensif.`,
          `Your team is ahead (+${gold(goldDiff)}): more offensive build.`
        )
      )
    if (metrics.behind > 0.5)
      notes.push(
        tr(
          `Votre équipe est en retard (${gold(goldDiff)}) : survie prioritaire.`,
          `Your team is behind (${gold(goldDiff)}): survival first.`
        )
      )
  }

  if (n > 0) {
    if (metrics.ap >= 0.62)
      notes.push(
        tr(
          `Dégâts adverses surtout magiques (${fmtPct(metrics.ap)}).`,
          `Mostly magic enemy damage (${fmtPct(metrics.ap)}).`
        )
      )
    else if (metrics.ad >= 0.62)
      notes.push(
        tr(
          `Dégâts adverses surtout physiques (${fmtPct(metrics.ad)}).`,
          `Mostly physical enemy damage (${fmtPct(metrics.ad)}).`
        )
      )
    else notes.push(tr('Dégâts adverses mixtes.', 'Mixed enemy damage.'))
    if (metrics.tanky >= 0.5)
      notes.push(
        tr(
          'Équipe adverse résistante : pénétration et dégâts sur la durée.',
          'Tanky enemy team: penetration and sustained damage.'
        )
      )
    if (metrics.cc >= 0.6)
      notes.push(
        tr(
          'Beaucoup de contrôles adverses : ténacité utile.',
          'Lots of enemy crowd control: tenacity helps.'
        )
      )
    if (metrics.heal >= 0.5)
      notes.push(
        tr(
          'Soins adverses importants : anti-soins conseillés.',
          'Strong enemy healing: anti-heal advised.'
        )
      )
    if (metrics.burst >= 0.6)
      notes.push(
        tr(
          'Dégâts explosifs adverses : objets de survie conseillés.',
          'Heavy enemy burst: defensive items advised.'
        )
      )
  }

  // Composition alliée (information).
  let allyDamage: ThreatProfile['allyDamage'] = null
  const allyChamps = livePlayers
    ? livePlayers.allies
        .map((p) => champFromLive(gd, p.rawChampionName, p.championName))
        .filter((c): c is ChampInfo => !!c && c.id !== myChampId)
    : allyKeys.map((k) => gd.champions.get(k)).filter((c): c is ChampInfo => !!c)
  if (allyChamps.length >= 2) {
    const allyAp = allyChamps.reduce((s, c) => s + profileOf(c, measured).ap, 0) / allyChamps.length
    allyDamage = { ap: allyAp, ad: 1 - allyAp }
    if (allyAp < 0.25)
      notes.push(
        tr(
          'Alliés très AD : vos dégâts magiques sont précieux.',
          'Very AD allies: your magic damage matters.'
        )
      )
    if (allyAp > 0.75)
      notes.push(
        tr(
          'Alliés très AP : vos dégâts physiques sont précieux.',
          'Very AP allies: your physical damage matters.'
        )
      )
  }

  // Besoins défensifs selon tes résistances actuelles.
  const resists = myResists(gd, live, livePlayers?.me ?? null)
  const needs = n > 0 ? defenseNeeds(metrics.ad, metrics.ap, resists.armor, resists.mr) : null
  const defense = {
    ad: needs?.ad ?? metrics.ad,
    ap: needs?.ap ?? metrics.ap,
    armor: resists.armor,
    mr: resists.mr
  }
  if (livePlayers && needs) {
    if (needs.ap - metrics.ap >= 0.15)
      notes.push(
        tr(
          `Tu as déjà ${Math.round(resists.armor)} d'armure : la résistance magique te protège davantage maintenant.`,
          `You already have ${Math.round(resists.armor)} armor: magic resist protects you more now.`
        )
      )
    else if (needs.ad - metrics.ad >= 0.15)
      notes.push(
        tr(
          `Tu as déjà ${Math.round(resists.mr)} de résistance magique : l'armure te protège davantage maintenant.`,
          `You already have ${Math.round(resists.mr)} magic resist: armor protects you more now.`
        )
      )
  }

  return {
    metrics,
    enemies,
    fed,
    focus,
    notes,
    allyDamage,
    live: livePlayers !== null,
    goldDiff,
    defense,
    foeTraits: foeTraitsOf(foeItemTraits)
  }
}

/** Poids d'un adversaire dans les besoins défensifs : son avance et sa part dans tes morts. */
export const threatWeight = (e: EnemyThreat): number => e.power * (1 + 0.6 * e.focus)

/** Noms sous lesquels un joueur apparaît dans les événements (Riot ID avec ou sans tag). */
function namesOf(p: LivePlayer): Set<string> {
  const out = new Set<string>()
  for (const n of [p.riotId, p.summonerName]) {
    if (!n) continue
    out.add(n.toLowerCase())
    out.add(n.split('#')[0].toLowerCase())
  }
  return out
}

/**
 * Part de tes morts récentes causées par chaque adversaire : 1 pour le tueur, 0,5 par assistance,
 * les morts anciennes comptant moins (demi-vie d'environ 10 minutes). Il faut l'équivalent de deux
 * morts pour atteindre 1.
 */
export function deathFocus(live: LiveGameData, me: LivePlayer): (p: LivePlayer) => number {
  const mine = namesOf(me)
  const deaths = (live.kills ?? []).filter((k) => mine.has(k.victim.toLowerCase()))
  if (!deaths.length) return () => 0
  const recency = (t: number): number => Math.pow(0.5, Math.max(0, live.gameTime - t) / 600)
  const total = deaths.reduce((s, k) => s + recency(k.t), 0)
  return (p) => {
    const names = namesOf(p)
    let w = 0
    for (const k of deaths) {
      if (names.has(k.killer.toLowerCase())) w += recency(k.t)
      else if (k.assisters.some((a) => names.has(a.toLowerCase()))) w += 0.5 * recency(k.t)
    }
    return clamp01(w / Math.max(total, 2))
  }
}

/** Trouve le joueur local dans les données de partie. */
export function findMe(
  gd: GameData,
  live: LiveGameData | null,
  myChampId: string | null
): LivePlayer | null {
  if (!live) return null
  const ap = live.activePlayer
  return (
    live.allPlayers.find(
      (p) =>
        (ap?.riotId && p.riotId === ap.riotId) ||
        (ap?.summonerName &&
          (p.summonerName === ap.summonerName || p.riotId.startsWith(ap.summonerName + '#')))
    ) ??
    (myChampId
      ? live.allPlayers.find(
          (p) => champFromLive(gd, p.rawChampionName, p.championName)?.id === myChampId
        )
      : undefined) ??
    null
  )
}
