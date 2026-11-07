import { getLang, tr } from '../../../shared/i18n'
import { itemTraits, type FoeTrait } from './itemTraits'
import { norm } from './normalize'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Données officielles Riot (Data Dragon), chargées au démarrage pour la version en cours.
// Tout ce que l'app affiche ou envoie au client est résolu ici : identifiants, noms français,
// icônes, prix et statistiques des objets.

const DDRAGON = 'https://ddragon.leagueoflegends.com'

export interface ChampInfo {
  key: number
  id: string
  /** Nom français (utilisé aussi pour retrouver le champion). */
  name: string
  nameEn: string
  /** Nom affiché dans la langue de l'application. */
  readonly label: string
  tags: string[]
  info: { attack: number; defense: number; magic: number }
}

export interface RuneInfo {
  id: number
  key: string
  name: string
  nameFr: string
  /** Nom affiché dans la langue de l'application. */
  readonly label: string
  icon: string
  treeId: number
  /** 0 = clé de voûte, 1..3 = lignes suivantes. */
  row: number
}

export interface RuneTree {
  id: number
  key: string
  name: string
  nameFr: string
  readonly label: string
  icon: string
  slots: RuneInfo[][]
}

export interface ItemInfo {
  id: number
  /** Nom anglais officiel (sert d'identifiant dans les données de build). */
  name: string
  nameFr: string
  /** Nom affiché dans la langue de l'application. */
  readonly label: string
  total: number
  from: number[]
  into: number[]
  tags: string[]
  stats: Record<string, number>
  description: string
  isBoots: boolean
  isLegendary: boolean
  /** Objet dont l'effet réduit les soins adverses (Blessures graves). */
  grievous: boolean
  /** Caractéristiques qui comptent face à lui (voir itemTraits.ts). */
  traits: FoeTrait[]
}

export interface GameData {
  version: string
  champions: Map<number, ChampInfo>
  championsById: Map<string, ChampInfo>
  championsByName: Map<string, ChampInfo>
  runeTrees: RuneTree[]
  runes: Map<number, RuneInfo>
  runesByName: Map<string, RuneInfo>
  treesByName: Map<string, RuneTree>
  items: Map<number, ItemInfo>
  itemsByName: Map<string, ItemInfo>
}

export interface RawGameData {
  version: string
  championsFr: any
  championsEn: any
  runesEn: any[]
  runesFr: any[]
  itemsEn: any
  itemsFr: any
}

/** Construit les index à partir des JSON Data Dragon (fonction pure, testable). */
export function buildGameData(raw: RawGameData): GameData {
  const champions = new Map<number, ChampInfo>()
  const championsById = new Map<string, ChampInfo>()
  const championsByName = new Map<string, ChampInfo>()
  const enById: Record<string, any> = raw.championsEn?.data ?? {}
  for (const c of Object.values<any>(raw.championsFr?.data ?? {})) {
    const info: ChampInfo = {
      key: Number(c.key),
      id: c.id,
      name: c.name,
      nameEn: enById[c.id]?.name ?? c.name,
      get label() {
        return getLang() === 'en' ? this.nameEn : this.name
      },
      tags: Array.isArray(c.tags) ? c.tags : [],
      info: {
        attack: Number(c.info?.attack ?? 5),
        defense: Number(c.info?.defense ?? 5),
        magic: Number(c.info?.magic ?? 5)
      }
    }
    champions.set(info.key, info)
    championsById.set(info.id, info)
    for (const n of [info.id, info.name, info.nameEn]) championsByName.set(norm(n), info)
  }

  const runeTrees: RuneTree[] = []
  const runes = new Map<number, RuneInfo>()
  const runesByName = new Map<string, RuneInfo>()
  const treesByName = new Map<string, RuneTree>()
  const frRune = new Map<number, string>()
  const frTree = new Map<number, string>()
  for (const tree of raw.runesFr ?? []) {
    frTree.set(tree.id, tree.name)
    for (const slot of tree.slots ?? []) for (const r of slot.runes ?? []) frRune.set(r.id, r.name)
  }
  for (const tree of raw.runesEn ?? []) {
    const t: RuneTree = {
      id: tree.id,
      key: tree.key,
      name: tree.name,
      nameFr: frTree.get(tree.id) ?? tree.name,
      get label() {
        return getLang() === 'en' ? this.name : this.nameFr
      },
      icon: tree.icon,
      slots: []
    }
    ;(tree.slots ?? []).forEach((slot: any, row: number) => {
      const list: RuneInfo[] = (slot.runes ?? []).map((r: any) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        nameFr: frRune.get(r.id) ?? r.name,
        get label() {
          return getLang() === 'en' ? this.name : this.nameFr
        },
        icon: r.icon,
        treeId: tree.id,
        row
      }))
      t.slots.push(list)
      for (const ri of list) {
        runes.set(ri.id, ri)
        runesByName.set(norm(ri.name), ri)
        runesByName.set(norm(ri.key), ri)
      }
    })
    runeTrees.push(t)
    treesByName.set(norm(t.name), t)
    treesByName.set(norm(t.key), t)
  }

  const items = new Map<number, ItemInfo>()
  const itemsByName = new Map<string, ItemInfo>()
  const frItems: Record<string, any> = raw.itemsFr?.data ?? {}
  const candidates: { item: ItemInfo; rank: number }[] = []
  for (const [idStr, it] of Object.entries<any>(raw.itemsEn?.data ?? {})) {
    const id = Number(idStr)
    const onRift = Boolean(it.maps?.['11'])
    const purchasable = it.gold?.purchasable !== false && it.inStore !== false
    const tags: string[] = Array.isArray(it.tags) ? it.tags : []
    const into: number[] = Array.isArray(it.into) ? it.into.map(Number) : []
    const total = Number(it.gold?.total ?? 0)
    const description = String(it.description ?? '')
    const item: ItemInfo = {
      id,
      name: it.name,
      nameFr: frItems[idStr]?.name ?? it.name,
      get label() {
        return getLang() === 'en' ? this.name : this.nameFr
      },
      total,
      from: Array.isArray(it.from) ? it.from.map(Number) : [],
      into,
      tags,
      stats: it.stats ?? {},
      description,
      isBoots: tags.includes('Boots') && total >= 900,
      isLegendary:
        onRift &&
        into.length === 0 &&
        total >= 2000 &&
        !tags.includes('Consumable') &&
        !tags.includes('Boots'),
      grievous: /grievous|blessures graves/i.test(description),
      traits: itemTraits(description, it.stats ?? {})
    }
    items.set(id, item)
    // On privilégie la version achetable sur la Faille (Arena/ARAM ont des doublons de noms).
    const rank =
      (onRift ? 4 : 0) + (purchasable ? 2 : 0) + (it.requiredChampion || it.requiredAlly ? -8 : 0)
    candidates.push({ item, rank })
  }
  candidates.sort((a, b) => b.rank - a.rank || a.item.id - b.item.id)
  for (const { item } of candidates) {
    const k = norm(item.name)
    if (!itemsByName.has(k)) itemsByName.set(k, item)
  }

  return {
    version: raw.version,
    champions,
    championsById,
    championsByName,
    runeTrees,
    runes,
    runesByName,
    treesByName,
    items,
    itemsByName
  }
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${tr('sur', 'on')} ${url}`)
  return res.json()
}

export async function loadGameData(): Promise<GameData> {
  const versions: string[] = await getJson(`${DDRAGON}/api/versions.json`)
  const version = versions[0]
  const base = `${DDRAGON}/cdn/${version}/data`
  const [championsFr, championsEn, runesEn, runesFr, itemsEn, itemsFr] = await Promise.all([
    getJson(`${base}/fr_FR/champion.json`),
    getJson(`${base}/en_US/champion.json`),
    getJson(`${base}/en_US/runesReforged.json`),
    getJson(`${base}/fr_FR/runesReforged.json`),
    getJson(`${base}/en_US/item.json`),
    getJson(`${base}/fr_FR/item.json`)
  ])
  return buildGameData({ version, championsFr, championsEn, runesEn, runesFr, itemsEn, itemsFr })
}

export const champIcon = (version: string, id: string): string =>
  `${DDRAGON}/cdn/${version}/img/champion/${id}.png`
export const itemIcon = (version: string, id: number): string =>
  `${DDRAGON}/cdn/${version}/img/item/${id}.png`
export const runeIcon = (icon: string): string => `${DDRAGON}/cdn/img/${icon}`

/** Retrouve le champion d'un joueur de l'API en jeu. */
export function champFromLive(
  gd: GameData,
  rawChampionName: string,
  championName: string
): ChampInfo | undefined {
  const rawId = rawChampionName.split('_').pop() ?? ''
  return (
    gd.championsById.get(rawId) ??
    gd.championsByName.get(norm(rawId)) ??
    gd.championsByName.get(norm(championName))
  )
}

/** Valeur en or d'un inventaire. */
export function inventoryValue(gd: GameData, items: { itemID: number; count: number }[]): number {
  let total = 0
  for (const it of items) {
    const info = gd.items.get(it.itemID)
    if (info && !info.tags.includes('Consumable') && !info.tags.includes('Trinket'))
      total += info.total * Math.max(1, it.count)
  }
  return total
}
