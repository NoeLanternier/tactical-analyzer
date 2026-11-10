import type { Archetype } from './items'

// Base de builds jungle — builds les plus joués et performants en classé (Émeraude+),
// relevés pour le patch 26.21 (Data Dragon 16.21) sur OP.GG, puis vérifiés contre la liste
// officielle des runes et des objets de ce patch.
//
// Cette base sert de point de départ : le moteur l'adapte ensuite à la composition adverse
// (avant la partie) puis à son déroulement (pendant la partie). Quand le patch du jeu change,
// l'application bascule automatiquement sur les pages de runes recommandées par Riot (toujours à
// jour) et garde ces builds d'objets, qui restent vérifiés au démarrage.
// Pour mettre la base à jour sans recompiler : réglage « URL de méta » (même format JSON).

export const META_PATCH = '16.21'

export type OffenseShard = 'AF' | 'AS' | 'AH' // Force adaptative | Vitesse d'attaque | Accélération
export type FlexShard = 'AF' | 'MS' | 'HS' // Force adaptative | Vitesse de déplacement | PV évolutifs
export type DefenseShard = 'HP' | 'TN' | 'HS' // PV | Ténacité/résistance aux ralentissements | PV évolutifs

export interface RuneSpec {
  keystone: string
  primary: [string, string, string]
  secondaryTree: string
  secondary: [string, string]
  shards: [OffenseShard, FlexShard, DefenseShard]
}

export type Pet = 'Gustwalker Hatchling' | 'Mosstomper Seedling' | 'Scorchclaw Pup'

/** Départ : objets achetés avant 1 min 30 (anneau de Doran + 2 potions…). */
export interface StartOption {
  items: string[]
  games: number
  share: number
  winRate: number
}

export interface JunglerBuild {
  /** Identifiant Data Dragon. */
  id: string
  archetype: Archetype
  /** Familier de jungle (null hors jungle). */
  pet: Pet | null
  boots: string
  /** Objets de départ (méta distante ; absent : familier + potion en jungle, Doran… sinon). */
  start?: string[]
  /** Départs courants à ce poste (au moins 8 % des parties), avec leur part et leur taux. */
  startOptions?: StartOption[]
  /** Trois premiers objets légendaires, dans l'ordre d'achat. */
  core: [string, string, string]
  /** Objets 4 à 6 les plus joués, par ordre de popularité. */
  options: string[]
  /** Ordre de montée des compétences. */
  skills: string
  runes: RuneSpec
  /** Patch des données (méta distante). Absent : patch de la base intégrée. */
  patch?: string
  /** Nombre de parties analysées et taux de victoire (méta distante calculée par l'API Riot). */
  games?: number
  winRate?: number
  /** Niveau de jeu des parties (méta distante) : Master+ ou Or à Émeraude. */
  bracket?: 'master' | 'gold'
  /** Objets les plus construits et leur effet sur la victoire, par contexte adverse (méta distante). */
  situational?: Partial<Record<SituationContext, SituationalStats>>
  /** Familles de build jouées en Master+ (même premier objet), si plusieurs ressortent. */
  variants?: BuildVariant[]
  /** Options courantes mesurées par contexte adverse (runes, bottes, familier, compétences). */
  choices?: BuildChoices
}

/** Une option mesurée : parties, taux de victoire, part des parties et taux par contexte. */
export interface ChoiceStats {
  games: number
  winRate: number
  share: number
  contexts: Partial<Record<SituationContext, [number, number]>>
}
export type RuneChoice = ChoiceStats & { runes: RuneSpec }
export type NamedChoice = ChoiceStats & { name: string }
/** Familier : aussi selon le jungler adverse ([parties, taux]). */
export type PetChoice = NamedChoice & { vs: Record<string, [number, number]> }
export type SkillChoice = ChoiceStats & { value: string }

export interface BuildChoices {
  runes?: RuneChoice[]
  boots?: NamedChoice[]
  pet?: PetChoice[]
  skills?: SkillChoice[]
}

/** Une famille de build d'un champion : tout ce qui change selon le premier objet. */
export interface BuildVariant {
  /** Premier objet légendaire, qui identifie la famille (nom anglais). */
  key: string
  archetype: Archetype
  pet: Pet | null
  boots: string
  core: [string, string, string]
  options: string[]
  skills: string
  runes: RuneSpec
  games: number
  winRate: number
  /** Part des parties du champion jouées avec cette famille. */
  share: number
  /** [parties, taux de victoire] par contexte adverse. */
  contexts: Partial<Record<SituationContext, [number, number]>>
  /** Pages de runes courantes de cette famille, mesurées par contexte. */
  runeChoices?: RuneChoice[]
}

/** Contextes adverses mesurés par le pipeline : tous, très AP, très AD, soins, tanky, contrôles. */
export type SituationContext = 'all' | 'ap' | 'ad' | 'heal' | 'tank' | 'cc'

export interface SituationalStats {
  /** Nombre de parties du champion dans ce contexte. */
  games: number
  /** lift : écart de taux de victoire face aux autres objets achetés au même rang ;
   * minute : minute moyenne d'achat. */
  items: { item: string; share: number; lift: number; games: number; minute?: number }[]
}

const G: Pet = 'Gustwalker Hatchling'
const M: Pet = 'Mosstomper Seedling'
const S: Pet = 'Scorchclaw Pup'

function r(
  keystone: string,
  primary: [string, string, string],
  secondaryTree: string,
  secondary: [string, string],
  shards: [OffenseShard, FlexShard, DefenseShard]
): RuneSpec {
  return { keystone, primary, secondaryTree, secondary, shards }
}

function j(
  id: string,
  archetype: Archetype,
  pet: Pet,
  boots: string,
  core: [string, string, string],
  options: string[],
  skills: string,
  runes: RuneSpec
): JunglerBuild {
  return { id, archetype, pet, boots, core, options, skills, runes }
}

// Pages de runes fréquentes
const CONQ_ALAC_COUP = ['Triumph', 'Legend: Alacrity', 'Coup de Grace'] as [string, string, string]
const CONQ_ALAC_LAST = ['Triumph', 'Legend: Alacrity', 'Last Stand'] as [string, string, string]
const CONQ_HASTE_COUP = ['Triumph', 'Legend: Haste', 'Coup de Grace'] as [string, string, string]
const CONQ_HASTE_LAST = ['Triumph', 'Legend: Haste', 'Last Stand'] as [string, string, string]
const INSP_FOOT_COSMIC = ['Magical Footwear', 'Cosmic Insight'] as [string, string]
const INSP_FOOT_APPROACH = ['Magical Footwear', 'Approach Velocity'] as [string, string]
const DOM_IMPACT_TH = ['Sudden Impact', 'Treasure Hunter'] as [string, string]
const DH_IMPACT = ['Sudden Impact', 'Grisly Mementos', 'Treasure Hunter'] as [
  string,
  string,
  string
]
const DH_CHEAP_ULT = ['Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter'] as [
  string,
  string,
  string
]
const PREC_TRI_ALAC = ['Triumph', 'Legend: Alacrity'] as [string, string]
const STORM_PRIMARY = ['Nimbus Cloak', 'Celerity', 'Waterwalking'] as [string, string, string]

export const JUNGLE_BUILDS: JunglerBuild[] = [
  j(
    'Ambessa',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Profane Hydra', 'Voltaic Cyclosword', "Death's Dance"],
    ['Endless Hunger', 'Guardian Angel', 'Maw of Malmortius', "Serpent's Fang"],
    'Q>E>W',
    r('Conqueror', CONQ_HASTE_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HP'])
  ),
  j(
    'Amumu',
    'TANK',
    M,
    'Plated Steelcaps',
    ["Liandry's Torment", 'Sunfire Aegis', 'Abyssal Mask'],
    ["Jak'Sho, The Protean", 'Thornmail', "Randuin's Omen", 'Frozen Heart', 'Kaenic Rookern'],
    'E>Q>W',
    r(
      'Conqueror',
      CONQ_HASTE_LAST,
      'Domination',
      ['Cheap Shot', 'Ultimate Hunter'],
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Belveth',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Kraken Slayer', 'Blade of the Ruined King', "Death's Dance"],
    ['Terminus', "Wit's End", "Jak'Sho, The Protean", "Randuin's Omen", 'Guardian Angel'],
    'Q>E>W',
    r(
      'Lethal Tempo',
      CONQ_ALAC_COUP,
      'Inspiration',
      ['Cash Back', 'Triple Tonic'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Brand',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ["Liandry's Torment", "Rylai's Crystal Scepter", "Zhonya's Hourglass"],
    ['Shadowflame', "Bloodletter's Curse", "Rabadon's Deathcap", 'Void Staff', "Banshee's Veil"],
    'W>Q>E',
    r(
      'Deathfire Touch',
      ['Manaflow Band', 'Transcendence', 'Scorch'],
      'Precision',
      ['Presence of Mind', 'Cut Down'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Briar',
    'AD_CARRY',
    M,
    'Plated Steelcaps',
    ['The Collector', 'Titanic Hydra', "Lord Dominik's Regards"],
    ['Guardian Angel', 'Infinity Edge', "Death's Dance", 'Spirit Visage', 'Endless Hunger'],
    'W>Q>E',
    r('Press the Attack', CONQ_ALAC_COUP, 'Domination', DOM_IMPACT_TH, ['AF', 'AF', 'HS'])
  ),
  j(
    'Chogath',
    'TANK',
    G,
    'Boots of Swiftness',
    ['Heartsteel', "Dead Man's Plate", 'Force of Nature'],
    ['Thornmail', "Jak'Sho, The Protean", "Randuin's Omen", 'Unending Despair'],
    'E>Q>W',
    r('Hail of Blades', DH_CHEAP_ULT, 'Sorcery', ['Axiom Arcanist', 'Celerity'], ['AF', 'MS', 'HS'])
  ),
  j(
    'Diana',
    'AP_FIGHTER',
    S,
    "Sorcerer's Shoes",
    ['Dusk and Dawn', 'Riftmaker', "Zhonya's Hourglass"],
    ["Rabadon's Deathcap", 'Shadowflame', 'Void Staff', "Liandry's Torment"],
    'Q>W>E',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'DrMundo',
    'TANK',
    G,
    'Boots of Swiftness',
    ['Heartsteel', "Dead Man's Plate", 'Spirit Visage'],
    [
      'Titanic Hydra',
      'Thornmail',
      "Randuin's Omen",
      "Overlord's Bloodmail",
      "Jak'Sho, The Protean"
    ],
    'Q>E>W',
    r('Fleet Footwork', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_APPROACH, ['AS', 'HS', 'HS'])
  ),
  j(
    'Ekko',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Dusk and Dawn', 'Shadowflame', "Rabadon's Deathcap"],
    ["Zhonya's Hourglass", 'Void Staff', "Mejai's Soulstealer", "Banshee's Veil"],
    'Q>E>W',
    r('Dark Harvest', DH_IMPACT, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HS'])
  ),
  j(
    'Elise',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Lich Bane', 'Shadowflame', "Zhonya's Hourglass"],
    ["Rabadon's Deathcap", 'Void Staff', "Banshee's Veil", "Mejai's Soulstealer"],
    'Q>W>E',
    r(
      'Dark Harvest',
      ['Cheap Shot', 'Grisly Mementos', 'Relentless Hunter'],
      'Precision',
      ['Triumph', 'Coup de Grace'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Evelynn',
    'AP_BURST',
    G,
    "Sorcerer's Shoes",
    ['Lich Bane', "Rabadon's Deathcap", 'Shadowflame'],
    ["Mejai's Soulstealer", 'Void Staff', "Banshee's Veil", "Zhonya's Hourglass"],
    'Q>E>W',
    r(
      'Electrocute',
      DH_IMPACT,
      'Sorcery',
      ['Absolute Focus', 'Gathering Storm'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Fiddlesticks',
    'AP_BURST',
    G,
    "Sorcerer's Shoes",
    ['Malignance', "Liandry's Torment", "Zhonya's Hourglass"],
    ["Rabadon's Deathcap", 'Void Staff', 'Shadowflame', "Banshee's Veil", 'Morellonomicon'],
    'W>Q>E',
    r(
      'Electrocute',
      DH_CHEAP_ULT,
      'Sorcery',
      ['Axiom Arcanist', 'Transcendence'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Gragas',
    'AP_BURST',
    G,
    "Sorcerer's Shoes",
    ['Lich Bane', 'Shadowflame', "Zhonya's Hourglass"],
    ["Rabadon's Deathcap", 'Void Staff', "Mejai's Soulstealer", "Banshee's Veil"],
    'Q>E>W',
    r('Dark Harvest', DH_IMPACT, 'Sorcery', ['Transcendence', 'Waterwalking'], ['AF', 'AF', 'HS'])
  ),
  j(
    'Graves',
    'AD_CARRY',
    S,
    'Plated Steelcaps',
    ['Hubris', 'The Collector', "Lord Dominik's Regards"],
    [
      'Infinity Edge',
      'Immortal Shieldbow',
      'Mortal Reminder',
      'Maw of Malmortius',
      'Guardian Angel',
      'Bloodthirster'
    ],
    'Q>E>W',
    r('Dark Harvest', DH_IMPACT, 'Precision', PREC_TRI_ALAC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Gwen',
    'AP_FIGHTER',
    S,
    "Sorcerer's Shoes",
    ['Dusk and Dawn', 'Shadowflame', "Rabadon's Deathcap"],
    ['Void Staff', "Zhonya's Hourglass", 'Riftmaker', "Banshee's Veil", 'Stormsurge'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Hecarim',
    'AD_FIGHTER',
    G,
    'Ionian Boots of Lucidity',
    ['Spear of Shojin', "Death's Dance", 'Endless Hunger'],
    ['Maw of Malmortius', 'Black Cleaver', "Serylda's Grudge", "Sterak's Gage", 'Guardian Angel'],
    'Q>W>E',
    r(
      "Stormraider's Surge",
      STORM_PRIMARY,
      'Precision',
      ['Triumph', 'Legend: Haste'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Ivern',
    'ENCHANTER',
    G,
    'Ionian Boots of Lucidity',
    ['Redemption', 'Moonstone Renewer', 'Ardent Censer'],
    ['Dawncore', "Shurelya's Battlesong", 'Staff of Flowing Water', "Mejai's Soulstealer"],
    'E>Q>W',
    r(
      'Summon Aery',
      ['Nimbus Cloak', 'Transcendence', 'Waterwalking'],
      'Inspiration',
      ['Cash Back', 'Cosmic Insight'],
      ['AH', 'MS', 'HS']
    )
  ),
  j(
    'JarvanIV',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Profane Hydra', 'Voltaic Cyclosword', 'Bastionbreaker'],
    ['Guardian Angel', "Death's Dance", 'Edge of Night', 'Maw of Malmortius', 'Black Cleaver'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Jax',
    'AD_FIGHTER',
    G,
    "Mercury's Treads",
    ['Trinity Force', 'Sundered Sky', "Zhonya's Hourglass"],
    ["Death's Dance", "Sterak's Gage", 'Riftmaker', "Wit's End", 'Guardian Angel'],
    'W>E>Q',
    r('Lethal Tempo', CONQ_ALAC_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Karthus',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Blackfire Torch', 'Shadowflame', "Rabadon's Deathcap"],
    ['Void Staff', "Zhonya's Hourglass", "Liandry's Torment", "Mejai's Soulstealer", 'Stormsurge'],
    'Q>E>W',
    r(
      'Dark Harvest',
      DH_CHEAP_ULT,
      'Sorcery',
      ['Axiom Arcanist', 'Gathering Storm'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Kayn',
    'AD_ASSASSIN',
    S,
    'Ionian Boots of Lucidity',
    ['Voltaic Cyclosword', 'Black Cleaver', "Death's Dance"],
    [
      'Edge of Night',
      "Serylda's Grudge",
      "Lord Dominik's Regards",
      'Spirit Visage',
      'Guardian Angel'
    ],
    'Q>W>E',
    r('Dark Harvest', DH_IMPACT, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HS'])
  ),
  j(
    'Khazix',
    'AD_ASSASSIN',
    G,
    'Ionian Boots of Lucidity',
    ['Umbral Glaive', 'Voltaic Cyclosword', 'Bastionbreaker'],
    [
      "Serylda's Grudge",
      'Edge of Night',
      "Serpent's Fang",
      "Lord Dominik's Regards",
      'Guardian Angel'
    ],
    'Q>W>E',
    r(
      'First Strike',
      ['Cash Back', 'Triple Tonic', 'Cosmic Insight'],
      'Domination',
      DOM_IMPACT_TH,
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Kindred',
    'AD_CARRY',
    S,
    'Plated Steelcaps',
    ['Kraken Slayer', 'The Collector', "Lord Dominik's Regards"],
    ['Infinity Edge', 'Hexoptics C44', 'Rapid Firecannon', 'Guardian Angel'],
    'Q>W>E',
    r('Press the Attack', CONQ_ALAC_COUP, 'Domination', DOM_IMPACT_TH, ['AS', 'AF', 'HS'])
  ),
  j(
    'LeeSin',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Eclipse', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', 'Maw of Malmortius', 'Edge of Night', "Sterak's Gage"],
    'Q>W>E',
    r(
      'Conqueror',
      CONQ_ALAC_COUP,
      'Inspiration',
      ['Magical Footwear', 'Cosmic Insight'],
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Lillia',
    'AP_FIGHTER',
    G,
    "Sorcerer's Shoes",
    ["Liandry's Torment", 'Riftmaker', "Zhonya's Hourglass"],
    ["Rylai's Crystal Scepter", "Rabadon's Deathcap", "Mejai's Soulstealer", "Bloodletter's Curse"],
    'Q>W>E',
    r('Conqueror', CONQ_HASTE_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HS'])
  ),
  j(
    'Maokai',
    'TANK',
    S,
    'Ionian Boots of Lucidity',
    ["Liandry's Torment", 'Imperial Mandate', "Bloodletter's Curse"],
    [
      'Spirit Visage',
      'Unending Despair',
      'Protoplasm Harness',
      'Thornmail',
      "Randuin's Omen",
      "Jak'Sho, The Protean"
    ],
    'Q>W>E',
    r(
      'First Strike',
      ['Magical Footwear', 'Triple Tonic', 'Cosmic Insight'],
      'Domination',
      ['Cheap Shot', 'Ultimate Hunter'],
      ['AH', 'HS', 'HS']
    )
  ),
  j(
    'MasterYi',
    'AD_CARRY',
    G,
    "Berserker's Greaves",
    ['Kraken Slayer', 'The Collector', "Lord Dominik's Regards"],
    ["Death's Dance", 'Infinity Edge', 'Immortal Shieldbow', "Wit's End", 'Guardian Angel'],
    'Q>E>W',
    r('Hail of Blades', DH_IMPACT, 'Precision', PREC_TRI_ALAC, ['AS', 'AF', 'HS'])
  ),
  j(
    'MonkeyKing',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Trinity Force', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', 'Maw of Malmortius', "Sterak's Gage", 'Sundered Sky'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Mordekaiser',
    'AP_FIGHTER',
    G,
    'Plated Steelcaps',
    ["Rylai's Crystal Scepter", 'Riftmaker', "Liandry's Torment"],
    ['Spirit Visage', 'Thornmail', "Randuin's Omen", "Jak'Sho, The Protean", "Zhonya's Hourglass"],
    'Q>E>W',
    r('Conqueror', CONQ_HASTE_LAST, 'Resolve', ['Bone Plating', 'Revitalize'], ['AS', 'AF', 'HS'])
  ),
  j(
    'Morgana',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Blackfire Torch', "Liandry's Torment", "Zhonya's Hourglass"],
    [
      "Rabadon's Deathcap",
      "Rylai's Crystal Scepter",
      'Morellonomicon',
      'Shadowflame',
      "Mejai's Soulstealer"
    ],
    'W>Q>E',
    r(
      'Dark Harvest',
      ['Cheap Shot', 'Grisly Mementos', 'Treasure Hunter'],
      'Inspiration',
      INSP_FOOT_COSMIC,
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Naafiri',
    'AD_ASSASSIN',
    S,
    'Ionian Boots of Lucidity',
    ['Voltaic Cyclosword', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', 'Edge of Night', "Serylda's Grudge", "Serpent's Fang", 'Maw of Malmortius'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Nidalee',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Lich Bane', 'Hextech Rocketbelt', "Zhonya's Hourglass"],
    ["Mejai's Soulstealer", 'Shadowflame', "Rabadon's Deathcap", 'Void Staff', "Banshee's Veil"],
    'Q>E>W',
    r('Dark Harvest', DH_IMPACT, 'Sorcery', ['Transcendence', 'Waterwalking'], ['AS', 'AF', 'HS'])
  ),
  j(
    'Nocturne',
    'AD_ASSASSIN',
    S,
    'Plated Steelcaps',
    ['Profane Hydra', 'Axiom Arc', 'Voltaic Cyclosword'],
    [
      'Guardian Angel',
      "Lord Dominik's Regards",
      "Death's Dance",
      'Black Cleaver',
      'Maw of Malmortius'
    ],
    'Q>E>W',
    r(
      'Hail of Blades',
      ['Sudden Impact', 'Grisly Mementos', 'Ultimate Hunter'],
      'Precision',
      PREC_TRI_ALAC,
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Nunu',
    'TANK',
    G,
    "Sorcerer's Shoes",
    ["Liandry's Torment", "Dead Man's Plate", 'Spirit Visage'],
    ["Zhonya's Hourglass", 'Thornmail', 'Shadowflame', "Jak'Sho, The Protean", "Randuin's Omen"],
    'Q>E>W',
    r(
      'Dark Harvest',
      ['Cheap Shot', 'Grisly Mementos', 'Relentless Hunter'],
      'Sorcery',
      ['Celerity', 'Waterwalking'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Olaf',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Stridebreaker', 'Experimental Hexplate', "Death's Dance"],
    [
      "Sterak's Gage",
      'Maw of Malmortius',
      "Lord Dominik's Regards",
      "Randuin's Omen",
      'Spirit Visage'
    ],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_LAST, 'Inspiration', INSP_FOOT_APPROACH, ['AS', 'AF', 'HS'])
  ),
  j(
    'Pantheon',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Eclipse', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', 'Maw of Malmortius', "Serpent's Fang", 'Edge of Night'],
    'Q>W>E',
    r('Conqueror', CONQ_HASTE_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Poppy',
    'TANK',
    G,
    'Plated Steelcaps',
    ['Sundered Sky', "Dead Man's Plate", 'Force of Nature'],
    ['Thornmail', "Randuin's Omen", "Jak'Sho, The Protean", 'Iceborn Gauntlet', 'Kaenic Rookern'],
    'Q>E>W',
    r("Stormraider's Surge", STORM_PRIMARY, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Qiyana',
    'AD_ASSASSIN',
    G,
    'Ionian Boots of Lucidity',
    ['Voltaic Cyclosword', 'Bastionbreaker', 'Edge of Night'],
    ["Serylda's Grudge", "Lord Dominik's Regards", "Serpent's Fang", 'Axiom Arc', 'Guardian Angel'],
    'Q>W>E',
    r(
      'First Strike',
      ['Magical Footwear', 'Triple Tonic', 'Cosmic Insight'],
      'Domination',
      ['Sudden Impact', 'Ultimate Hunter'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Rammus',
    'TANK',
    G,
    'Plated Steelcaps',
    ['Thornmail', 'Sunfire Aegis', "Jak'Sho, The Protean"],
    [
      "Dead Man's Plate",
      'Protoplasm Harness',
      'Kaenic Rookern',
      "Randuin's Omen",
      'Force of Nature',
      'Frozen Heart'
    ],
    'Q>E>W',
    r('Aftershock', ['Font of Life', 'Conditioning', 'Unflinching'], 'Precision', PREC_TRI_ALAC, [
      'AS',
      'HS',
      'HS'
    ])
  ),
  j(
    'RekSai',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Stridebreaker', 'Spear of Shojin', "Sterak's Gage"],
    ['Guardian Angel', "Death's Dance", 'Black Cleaver', 'Spirit Visage'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Rengar',
    'AD_ASSASSIN',
    G,
    'Ionian Boots of Lucidity',
    ['Umbral Glaive', 'Profane Hydra', "Lord Dominik's Regards"],
    ['Edge of Night', 'Infinity Edge', "Serpent's Fang", 'Voltaic Cyclosword'],
    'Q>E>W',
    r(
      'Fleet Footwork',
      ['Triumph', 'Legend: Alacrity', 'Cut Down'],
      'Domination',
      ['Sudden Impact', 'Ultimate Hunter'],
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Rumble',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ["Liandry's Torment", 'Shadowflame', "Zhonya's Hourglass"],
    [
      "Rabadon's Deathcap",
      'Void Staff',
      "Bloodletter's Curse",
      "Mejai's Soulstealer",
      'Morellonomicon'
    ],
    'Q>E>W',
    r(
      'Dark Harvest',
      DH_CHEAP_ULT,
      'Sorcery',
      ['Axiom Arcanist', 'Transcendence'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Sejuani',
    'TANK',
    M,
    'Plated Steelcaps',
    ['Heartsteel', 'Unending Despair', 'Thornmail'],
    ["Jak'Sho, The Protean", 'Kaenic Rookern', "Randuin's Omen", 'Frozen Heart'],
    'W>Q>E',
    r('Aftershock', ['Font of Life', 'Conditioning', 'Overgrowth'], 'Precision', PREC_TRI_ALAC, [
      'AS',
      'HS',
      'HS'
    ])
  ),
  j(
    'Sett',
    'AD_FIGHTER',
    G,
    'Boots of Swiftness',
    ['Stridebreaker', "Overlord's Bloodmail", "Sterak's Gage"],
    ['Black Cleaver', 'Spear of Shojin', "Warmog's Armor", 'Force of Nature'],
    'Q>W>E',
    r('Conqueror', CONQ_ALAC_LAST, 'Resolve', ['Second Wind', 'Unflinching'], ['AS', 'AF', 'HS'])
  ),
  j(
    'Shaco',
    'AP_BURST',
    G,
    'Ionian Boots of Lucidity',
    ['Blackfire Torch', "Liandry's Torment", 'Imperial Mandate'],
    ['Cryptbloom', 'Shadowflame', "Rabadon's Deathcap", "Zhonya's Hourglass"],
    'E>Q>W',
    r(
      'Hail of Blades',
      ['Sudden Impact', 'Grisly Mementos', 'Relentless Hunter'],
      'Precision',
      ['Legend: Alacrity', 'Coup de Grace'],
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Shyvana',
    'AD_FIGHTER',
    S,
    'Plated Steelcaps',
    ['Trinity Force', 'Spear of Shojin', "Death's Dance"],
    ["Jak'Sho, The Protean", "Sterak's Gage", "Randuin's Omen", 'Thornmail'],
    'Q>W>E',
    r('Press the Attack', CONQ_HASTE_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Skarner',
    'TANK',
    M,
    'Plated Steelcaps',
    ['Heartsteel', 'Unending Despair', 'Spirit Visage'],
    ["Jak'Sho, The Protean", 'Thornmail', "Randuin's Omen", 'Protoplasm Harness'],
    'Q>W>E',
    r(
      'Grasp of the Undying',
      ['Shield Bash', 'Conditioning', 'Overgrowth'],
      'Inspiration',
      INSP_FOOT_APPROACH,
      ['AH', 'HS', 'HS']
    )
  ),
  j(
    'Sylas',
    'AP_FIGHTER',
    S,
    "Sorcerer's Shoes",
    ['Hextech Rocketbelt', 'Riftmaker', "Zhonya's Hourglass"],
    [
      "Rabadon's Deathcap",
      'Shadowflame',
      "Mejai's Soulstealer",
      "Bloodletter's Curse",
      'Void Staff'
    ],
    'W>Q>E',
    r('Conqueror', CONQ_HASTE_LAST, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HS'])
  ),
  j(
    'Taliyah',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ['Blackfire Torch', 'Shadowflame', "Zhonya's Hourglass"],
    ["Rabadon's Deathcap", "Banshee's Veil", 'Cryptbloom', 'Void Staff', "Mejai's Soulstealer"],
    'Q>E>W',
    r(
      'Dark Harvest',
      ['Cheap Shot', 'Sixth Sense', 'Treasure Hunter'],
      'Precision',
      ['Legend: Haste', 'Coup de Grace'],
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Talon',
    'AD_ASSASSIN',
    G,
    'Boots of Swiftness',
    ['Umbral Glaive', 'Bastionbreaker', 'Voltaic Cyclosword'],
    [
      "Lord Dominik's Regards",
      'Edge of Night',
      "Serylda's Grudge",
      "Serpent's Fang",
      "Death's Dance"
    ],
    'W>Q>E',
    r('Fleet Footwork', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AF', 'AF', 'HS'])
  ),
  j(
    'Trundle',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Trinity Force', "Dead Man's Plate", 'Spirit Visage'],
    ["Randuin's Omen", 'Thornmail', 'Blade of the Ruined King', "Jak'Sho, The Protean"],
    'Q>W>E',
    r('Press the Attack', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_APPROACH, ['AS', 'AF', 'HS'])
  ),
  j(
    'Udyr',
    'AD_FIGHTER',
    G,
    'Boots of Swiftness',
    ['Spear of Shojin', 'Experimental Hexplate', "Death's Dance"],
    [
      'Spirit Visage',
      "Dead Man's Plate",
      "Randuin's Omen",
      "Sterak's Gage",
      "Jak'Sho, The Protean"
    ],
    'Q>E>W',
    r('Press the Attack', CONQ_HASTE_COUP, 'Inspiration', INSP_FOOT_APPROACH, ['AF', 'AF', 'HS'])
  ),
  j(
    'Vi',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Trinity Force', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', 'Infinity Edge', "Sterak's Gage", 'Maw of Malmortius'],
    'Q>E>W',
    r('Conqueror', CONQ_HASTE_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Viego',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Kraken Slayer', 'The Collector', 'Immortal Shieldbow'],
    ["Lord Dominik's Regards", 'Infinity Edge', "Death's Dance", 'Guardian Angel'],
    'Q>E>W',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Volibear',
    'AD_FIGHTER',
    G,
    "Mercury's Treads",
    ['Dusk and Dawn', 'Navori Flickerblade', 'Spirit Visage'],
    ['Thornmail', "Randuin's Omen", "Dead Man's Plate", 'Unending Despair', "Jak'Sho, The Protean"],
    'Q>W>E',
    r(
      'Lethal Tempo',
      CONQ_HASTE_LAST,
      'Inspiration',
      ['Magical Footwear', 'Jack Of All Trades'],
      ['AS', 'AF', 'HS']
    )
  ),
  j(
    'Warwick',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Stridebreaker', 'Blade of the Ruined King', "Death's Dance"],
    ['Spirit Visage', 'Thornmail', "Sterak's Gage", "Jak'Sho, The Protean"],
    'W>Q>E',
    r('Lethal Tempo', CONQ_ALAC_LAST, 'Sorcery', ['Celerity', 'Waterwalking'], ['AS', 'AF', 'HS'])
  ),
  j(
    'XinZhao',
    'AD_FIGHTER',
    G,
    'Plated Steelcaps',
    ['Titanic Hydra', 'Black Cleaver', "Death's Dance"],
    ['Guardian Angel', "Sterak's Gage", 'Maw of Malmortius', 'Spirit Visage', "Randuin's Omen"],
    'W>E>Q',
    r('Conqueror', CONQ_ALAC_COUP, 'Inspiration', INSP_FOOT_COSMIC, ['AS', 'AF', 'HS'])
  ),
  j(
    'Zac',
    'TANK',
    S,
    'Ionian Boots of Lucidity',
    ['Hextech Rocketbelt', 'Sunfire Aegis', 'Spirit Visage'],
    [
      'Thornmail',
      "Randuin's Omen",
      "Jak'Sho, The Protean",
      'Unending Despair',
      "Mejai's Soulstealer"
    ],
    'E>W>Q',
    r(
      'Aftershock',
      ['Font of Life', 'Conditioning', 'Revitalize'],
      'Precision',
      ['Triumph', 'Legend: Haste'],
      ['AH', 'AF', 'HS']
    )
  ),
  j(
    'Zed',
    'AD_ASSASSIN',
    S,
    'Ionian Boots of Lucidity',
    ['Voltaic Cyclosword', 'Bastionbreaker', 'Axiom Arc'],
    [
      'Edge of Night',
      "Serylda's Grudge",
      "Lord Dominik's Regards",
      "Serpent's Fang",
      'Endless Hunger'
    ],
    'Q>E>W',
    r(
      'First Strike',
      ['Cash Back', 'Triple Tonic', 'Cosmic Insight'],
      'Domination',
      DOM_IMPACT_TH,
      ['AF', 'AF', 'HS']
    )
  ),
  j(
    'Zyra',
    'AP_BURST',
    S,
    "Sorcerer's Shoes",
    ["Liandry's Torment", 'Shadowflame', "Zhonya's Hourglass"],
    ["Rylai's Crystal Scepter", "Rabadon's Deathcap", 'Void Staff', 'Morellonomicon'],
    'Q>E>W',
    r(
      'Electrocute',
      ['Cheap Shot', 'Sixth Sense', 'Treasure Hunter'],
      'Precision',
      ['Legend: Haste', 'Cut Down'],
      ['AF', 'AF', 'HS']
    )
  )
]
