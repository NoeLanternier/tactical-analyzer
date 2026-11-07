// Connaissances sur les objets utilisées par le moteur de build adaptatif.
// Les noms sont en anglais (comme dans Data Dragon en_US) et sont convertis en identifiants au
// démarrage : un nom inconnu (objet retiré par Riot) est simplement ignoré et signalé.

export type Archetype =
  'AD_FIGHTER' | 'AD_ASSASSIN' | 'AD_CARRY' | 'AP_FIGHTER' | 'AP_BURST' | 'TANK' | 'ENCHANTER'

/** Indicateurs de situation, tous entre 0 et 1 (voir engine/threat.ts). */
export type Metric =
  | 'ap' // part de dégâts magiques adverses
  | 'ad' // part de dégâts physiques adverses
  | 'mixed' // dégâts adverses équilibrés
  | 'tanky' // équipe adverse résistante
  | 'armorStack' // armure adverse accumulée (en partie)
  | 'mrStack' // résistance magique adverse accumulée (en partie)
  | 'cc' // contrôles lourds
  | 'heal' // soins / vol de vie adverses
  | 'shield' // boucliers adverses
  | 'burst' // dégâts explosifs (assassins, mages burst)
  | 'crit' // dégâts critiques
  | 'aa' // dépendance aux attaques de base / vitesse d'attaque
  | 'fedAp' // un adversaire AP a pris beaucoup d'avance
  | 'fedAd' // un adversaire AD a pris beaucoup d'avance
  | 'ahead' // mon équipe mène en or
  | 'behind' // mon équipe est en retard

export type ItemRole = 'damage' | 'defense' | 'utility'

export interface ItemRule {
  role: ItemRole
  /** Priorité de base, avant prise en compte de la partie. */
  base: number
  /** Poids de chaque indicateur de situation. */
  w: Partial<Record<Metric, number>>
  /** Raison affichée quand l'indicateur principal est élevé. */
  why?: string
}

export const ITEM_RULES: Record<string, ItemRule> = {
  // --- Défensifs physiques ---
  "Death's Dance": {
    role: 'defense',
    base: 0.3,
    w: { ad: 0.5, burst: 0.2, fedAd: 0.5 },
    why: 'dégâts physiques'
  },
  "Randuin's Omen": {
    role: 'defense',
    base: 0,
    w: { crit: 0.9, aa: 0.3, ad: 0.2, fedAd: 0.2 },
    why: 'coups critiques'
  },
  'Frozen Heart': {
    role: 'defense',
    base: 0,
    w: { aa: 0.6, ad: 0.3, fedAd: 0.2 },
    why: 'attaques de base'
  },
  Thornmail: {
    role: 'defense',
    base: 0.05,
    w: { heal: 0.7, aa: 0.4, ad: 0.2 },
    why: 'soins + attaques'
  },
  "Dead Man's Plate": { role: 'defense', base: 0.1, w: { ad: 0.3, cc: 0.1 } },
  'Iceborn Gauntlet': { role: 'defense', base: 0, w: { aa: 0.3, ad: 0.3 } },
  // --- Défensifs magiques ---
  'Maw of Malmortius': {
    role: 'defense',
    base: 0.05,
    w: { ap: 0.7, fedAp: 0.6, burst: 0.1 },
    why: 'dégâts magiques'
  },
  'Kaenic Rookern': {
    role: 'defense',
    base: 0.05,
    w: { ap: 0.7, fedAp: 0.5, burst: 0.2 },
    why: 'dégâts magiques'
  },
  'Force of Nature': {
    role: 'defense',
    base: 0.05,
    w: { ap: 0.7, fedAp: 0.5 },
    why: 'dégâts magiques'
  },
  'Spirit Visage': { role: 'defense', base: 0.1, w: { ap: 0.4, fedAp: 0.2 } },
  'Abyssal Mask': { role: 'defense', base: 0.1, w: { ap: 0.5 } },
  'Hollow Radiance': { role: 'defense', base: 0, w: { ap: 0.5 } },
  "Banshee's Veil": {
    role: 'defense',
    base: 0.05,
    w: { ap: 0.6, cc: 0.3, fedAp: 0.3 },
    why: 'sorts adverses'
  },
  "Wit's End": { role: 'defense', base: 0, w: { ap: 0.5, aa: 0.1 } },
  'Mercurial Scimitar': {
    role: 'defense',
    base: 0,
    w: { cc: 0.6, fedAp: 0.2 },
    why: 'contrôles lourds'
  },
  "Mikael's Blessing": { role: 'utility', base: 0, w: { cc: 0.8 }, why: 'contrôles lourds' },
  // --- Défensifs mixtes / survie ---
  "Jak'Sho, The Protean": {
    role: 'defense',
    base: 0.2,
    w: { mixed: 0.4, tanky: 0.1 },
    why: 'dégâts mixtes'
  },
  'Unending Despair': { role: 'defense', base: 0.2, w: { mixed: 0.2 } },
  'Protoplasm Harness': { role: 'defense', base: 0.1, w: { burst: 0.3 } },
  "Warmog's Armor": { role: 'defense', base: 0.05, w: { behind: 0.1 } },
  'Sunfire Aegis': { role: 'defense', base: 0.1, w: { ad: 0.1 } },
  'Guardian Angel': {
    role: 'defense',
    base: 0.2,
    w: { burst: 0.3, behind: 0.2, fedAd: 0.05, fedAp: 0.05 },
    why: 'survie'
  },
  "Sterak's Gage": {
    role: 'defense',
    base: 0.25,
    w: { burst: 0.4, cc: 0.1, ad: 0.1 },
    why: 'burst adverse'
  },
  'Immortal Shieldbow': { role: 'defense', base: 0.1, w: { burst: 0.5 }, why: 'burst adverse' },
  "Zhonya's Hourglass": {
    role: 'defense',
    base: 0.3,
    w: { ad: 0.4, burst: 0.4, fedAd: 0.5 },
    why: 'burst physique'
  },
  'Edge of Night': {
    role: 'defense',
    base: 0.15,
    w: { cc: 0.4, burst: 0.3 },
    why: 'contrôles / burst'
  },
  'Locket of the Iron Solari': { role: 'utility', base: 0, w: { burst: 0.6 } },
  'Endless Hunger': { role: 'damage', base: 0.15, w: { cc: 0.3, ahead: 0.1 } },
  // --- Anti-soins ---
  'Chempunk Chainsword': { role: 'utility', base: 0, w: { heal: 1.1 }, why: 'anti-soins' },
  'Mortal Reminder': {
    role: 'utility',
    base: 0,
    w: { heal: 1.0, armorStack: 0.2 },
    why: 'anti-soins'
  },
  Morellonomicon: { role: 'utility', base: 0, w: { heal: 1.1 }, why: 'anti-soins' },
  // --- Pénétration / anti-tank ---
  'Black Cleaver': {
    role: 'damage',
    base: 0.25,
    w: { tanky: 0.5, armorStack: 0.4 },
    why: 'adversaires résistants'
  },
  "Serylda's Grudge": {
    role: 'damage',
    base: 0.15,
    w: { armorStack: 0.6, tanky: 0.3 },
    why: 'armure adverse'
  },
  "Lord Dominik's Regards": {
    role: 'damage',
    base: 0.2,
    w: { tanky: 0.5, armorStack: 0.5 },
    why: 'adversaires résistants'
  },
  'Void Staff': {
    role: 'damage',
    base: 0.15,
    w: { mrStack: 0.6, tanky: 0.4 },
    why: 'résistance magique adverse'
  },
  Cryptbloom: { role: 'damage', base: 0.05, w: { mrStack: 0.5, tanky: 0.2 } },
  "Bloodletter's Curse": { role: 'damage', base: 0.05, w: { tanky: 0.4, mrStack: 0.3 } },
  "Liandry's Torment": {
    role: 'damage',
    base: 0.15,
    w: { tanky: 0.5 },
    why: 'adversaires résistants'
  },
  'Blade of the Ruined King': { role: 'damage', base: 0.1, w: { tanky: 0.4 } },
  Terminus: { role: 'damage', base: 0.1, w: { mixed: 0.2, tanky: 0.2 } },
  "Serpent's Fang": { role: 'utility', base: 0, w: { shield: 0.8 }, why: 'boucliers adverses' },
  // --- Dégâts purs (montent quand on mène) ---
  "Rabadon's Deathcap": { role: 'damage', base: 0.3, w: { ahead: 0.3 } },
  Shadowflame: { role: 'damage', base: 0.2, w: { ahead: 0.1 } },
  "Mejai's Soulstealer": { role: 'damage', base: 0.05, w: { ahead: 0.5 } },
  'Infinity Edge': { role: 'damage', base: 0.3, w: { ahead: 0.2 } },
  Bloodthirster: { role: 'damage', base: 0.1, w: { ahead: 0.2 } },
  "Youmuu's Ghostblade": { role: 'damage', base: 0.1, w: { ahead: 0.2 } },
  'Titanic Hydra': { role: 'damage', base: 0.1, w: { tanky: 0.2 } },
  'Spear of Shojin': { role: 'damage', base: 0.15, w: { ahead: 0.1 } },
  'Sundered Sky': { role: 'damage', base: 0.15, w: { ahead: 0.1 } },
  'Trinity Force': { role: 'damage', base: 0.1, w: {} },
  "Overlord's Bloodmail": { role: 'damage', base: 0.1, w: { behind: 0.1 } },
  Riftmaker: { role: 'damage', base: 0.1, w: { tanky: 0.2 } }
}

/** Objets situationnels envisagés pour chaque archétype (en plus des options du champion). */
export const ARCHETYPE_POOLS: Record<Archetype, string[]> = {
  AD_FIGHTER: [
    "Death's Dance",
    "Sterak's Gage",
    'Maw of Malmortius',
    'Guardian Angel',
    'Spirit Visage',
    'Black Cleaver',
    "Serylda's Grudge",
    'Chempunk Chainsword',
    "Randuin's Omen",
    'Frozen Heart',
    'Kaenic Rookern',
    "Jak'Sho, The Protean",
    'Endless Hunger',
    "Serpent's Fang",
    'Edge of Night'
  ],
  AD_ASSASSIN: [
    'Edge of Night',
    "Serylda's Grudge",
    "Serpent's Fang",
    "Death's Dance",
    'Maw of Malmortius',
    'Guardian Angel',
    'Chempunk Chainsword',
    "Youmuu's Ghostblade",
    'Black Cleaver',
    "Lord Dominik's Regards"
  ],
  AD_CARRY: [
    'Infinity Edge',
    "Lord Dominik's Regards",
    'Mortal Reminder',
    'Guardian Angel',
    'Immortal Shieldbow',
    'Maw of Malmortius',
    "Death's Dance",
    'Bloodthirster',
    "Wit's End",
    'Blade of the Ruined King',
    'Mercurial Scimitar',
    "Serpent's Fang"
  ],
  AP_FIGHTER: [
    "Zhonya's Hourglass",
    "Rabadon's Deathcap",
    'Void Staff',
    'Cryptbloom',
    "Bloodletter's Curse",
    "Banshee's Veil",
    'Morellonomicon',
    "Liandry's Torment",
    'Shadowflame',
    'Kaenic Rookern',
    'Spirit Visage'
  ],
  AP_BURST: [
    "Zhonya's Hourglass",
    "Rabadon's Deathcap",
    'Void Staff',
    'Cryptbloom',
    "Banshee's Veil",
    'Shadowflame',
    'Morellonomicon',
    "Mejai's Soulstealer",
    "Liandry's Torment"
  ],
  TANK: [
    'Thornmail',
    "Randuin's Omen",
    'Frozen Heart',
    "Dead Man's Plate",
    'Force of Nature',
    'Kaenic Rookern',
    'Spirit Visage',
    "Jak'Sho, The Protean",
    'Unending Despair',
    'Abyssal Mask',
    'Protoplasm Harness',
    "Warmog's Armor",
    'Sunfire Aegis',
    'Hollow Radiance'
  ],
  ENCHANTER: [
    'Redemption',
    'Moonstone Renewer',
    'Ardent Censer',
    "Shurelya's Battlesong",
    'Dawncore',
    'Staff of Flowing Water',
    "Mikael's Blessing",
    'Locket of the Iron Solari',
    "Mejai's Soulstealer"
  ]
}

/** Composant anti-soins à acheter tôt et objet final correspondant, par archétype. */
export const ANTI_HEAL: Record<Archetype, { component: string; final: string }> = {
  AD_FIGHTER: { component: "Executioner's Calling", final: 'Chempunk Chainsword' },
  AD_ASSASSIN: { component: "Executioner's Calling", final: 'Chempunk Chainsword' },
  AD_CARRY: { component: "Executioner's Calling", final: 'Mortal Reminder' },
  AP_FIGHTER: { component: 'Oblivion Orb', final: 'Morellonomicon' },
  AP_BURST: { component: 'Oblivion Orb', final: 'Morellonomicon' },
  TANK: { component: 'Bramble Vest', final: 'Thornmail' },
  ENCHANTER: { component: 'Oblivion Orb', final: 'Morellonomicon' }
}

/** Objets à effet unique : on n'en garde qu'un par groupe. */
export const UNIQUE_GROUPS: string[][] = [
  ["Sterak's Gage", 'Maw of Malmortius', 'Immortal Shieldbow', 'Protoplasm Harness'], // Lifeline
  ["Lord Dominik's Regards", 'Mortal Reminder', "Serylda's Grudge"], // pénétration d'armure
  ['Ravenous Hydra', 'Titanic Hydra', 'Profane Hydra', 'Stridebreaker'], // Hydra
  ['Trinity Force', 'Lich Bane', 'Iceborn Gauntlet', 'Essence Reaver', 'Dusk and Dawn'], // Spellblade
  ['Void Staff', 'Cryptbloom', "Bloodletter's Curse"], // Blight
  ["Banshee's Veil", 'Edge of Night'], // Annul
  ['Sunfire Aegis', 'Hollow Radiance'], // Immolate
  ['Chempunk Chainsword', 'Mortal Reminder', 'Morellonomicon', 'Thornmail'] // un seul anti-soins
]

export const BOOTS = {
  steelcaps: 'Plated Steelcaps',
  mercury: "Mercury's Treads"
}

export const POTION = 'Health Potion'
