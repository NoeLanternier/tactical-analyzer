import type { RecommendedRunePage, RunePagePayload, RuneSource } from '../../../shared/types'
import type { JunglerBuild, RuneSpec } from '../data/junglers'
import type { GameData, RuneInfo, RuneTree } from './gameData'
import { norm } from './normalize'
import type { ThreatProfile } from './threat'
import { tr } from '../../../shared/i18n'

// Fragments de runes (identifiants fixes, absents de runesReforged.json).
export const SHARDS = {
  adaptive: 5008,
  attackSpeed: 5005,
  abilityHaste: 5007,
  moveSpeed: 5010,
  healthScaling: 5001,
  health: 5011,
  tenacity: 5013
}
const OFFENSE: Record<string, number> = { AF: 5008, AS: 5005, AH: 5007 }
const FLEX: Record<string, number> = { AF: 5008, MS: 5010, HS: 5001 }
const DEFENSE: Record<string, number> = { HP: 5011, TN: 5013, HS: 5001 }
const SHARD_ROWS = [
  [5008, 5005, 5007],
  [5008, 5010, 5001],
  [5011, 5013, 5001]
]
const SHARD_NAMES: Record<number, [string, string]> = {
  5008: ['Force adaptative', 'Adaptive Force'],
  5005: ["Vitesse d'attaque", 'Attack Speed'],
  5007: ['Accélération de compétence', 'Ability Haste'],
  5010: ['Vitesse de déplacement', 'Move Speed'],
  5001: ['PV évolutifs', 'Health Scaling'],
  5011: ['PV', 'Health'],
  5013: ['Ténacité et résistance aux ralentissements', 'Tenacity and Slow Resist']
}

/** Nom d'un fragment de rune dans la langue de l'application. */
export function shardName(id: number): string {
  const n = SHARD_NAMES[id]
  return n ? tr(n[0], n[1]) : String(id)
}

export interface ResolvedRunePage {
  payload: RunePagePayload
  source: 'tactique' | 'riot'
  primaryTree: RuneTree
  subTree: RuneTree
  runes: RuneInfo[]
  shards: number[]
  reasons: string[]
  /** Corrections appliquées parce qu'un nom de rune n'existe plus. */
  repairs: string[]
}

/** Résout une page de la base tactique en identifiants, en réparant les runes disparues. */
export function resolveSpec(
  gd: GameData,
  spec: RuneSpec
): {
  runes: RuneInfo[]
  primary: RuneTree
  sub: RuneTree
  shards: number[]
  repairs: string[]
} | null {
  const repairs: string[] = []
  const keystone = gd.runesByName.get(norm(spec.keystone))
  if (!keystone || keystone.row !== 0) return null
  const primary = gd.runeTrees.find((t) => t.id === keystone.treeId)
  const sub = gd.treesByName.get(norm(spec.secondaryTree))
  if (!primary || !sub || sub.id === primary.id) return null

  const runes: RuneInfo[] = [keystone]
  spec.primary.forEach((name, i) => {
    const row = i + 1
    const found = gd.runesByName.get(norm(name))
    if (found && found.treeId === primary.id && found.row === row) runes.push(found)
    else {
      const fallback = primary.slots[row]?.[0]
      if (!fallback) return
      repairs.push(`${name} → ${fallback.name}`)
      runes.push(fallback)
    }
  })

  const usedRows = new Set<number>()
  for (const name of spec.secondary) {
    const found = gd.runesByName.get(norm(name))
    if (found && found.treeId === sub.id && found.row > 0 && !usedRows.has(found.row)) {
      usedRows.add(found.row)
      runes.push(found)
    }
  }
  // Complète la partie secondaire si une rune a disparu.
  for (let row = 1; runes.length < 6 && row < sub.slots.length; row++) {
    if (usedRows.has(row) || !sub.slots[row]?.[0]) continue
    usedRows.add(row)
    runes.push(sub.slots[row][0])
    repairs.push(`${tr('secondaire', 'secondary')} → ${sub.slots[row][0].name}`)
  }
  if (runes.length !== 6) return null

  const shards = [
    OFFENSE[spec.shards[0]] ?? SHARDS.adaptive,
    FLEX[spec.shards[1]] ?? SHARDS.adaptive,
    DEFENSE[spec.shards[2]] ?? SHARDS.healthScaling
  ]
  return { runes, primary, sub, shards, repairs }
}

/** Convertit une page recommandée par Riot. */
function resolveRiot(
  gd: GameData,
  page: RecommendedRunePage
): { runes: RuneInfo[]; primary: RuneTree; sub: RuneTree; shards: number[] } | null {
  const primary = gd.runeTrees.find((t) => t.id === page.primaryStyleId)
  const sub = gd.runeTrees.find((t) => t.id === page.subStyleId)
  if (!primary || !sub) return null
  const runes = page.perkIds.map((id) => gd.runes.get(id)).filter((r): r is RuneInfo => !!r)
  const shards = page.perkIds.filter((id) => !gd.runes.has(id))
  if (runes.length !== 6 || shards.length !== 3) return null
  return { runes, primary, sub, shards }
}

// Familles de clés de voûte, pour choisir entre plusieurs pages recommandées par Riot.
const SUSTAINED = ['Conqueror', 'Lethal Tempo', 'Grasp of the Undying', 'Press the Attack']
const BURST = ['Electrocute', 'Dark Harvest', 'Hail of Blades', 'First Strike', 'Arcane Comet']
const TANKY = ['Aftershock', 'Guardian']

function keystoneFit(name: string, threat: ThreatProfile): number {
  const m = threat.metrics
  if (SUSTAINED.includes(name)) return m.tanky * 0.6
  if (BURST.includes(name)) return (1 - m.tanky) * 0.4
  if (TANKY.includes(name)) return m.burst * 0.3 + m.cc * 0.2
  return 0.1
}

/** Les patchs "16.21.1" et "16.21" correspondent. */
export function samePatch(version: string, patch: string): boolean {
  return version.split('.').slice(0, 2).join('.') === patch
}

/**
 * Construit la page de runes finale.
 * Source : base tactique (patch à jour) ou pages recommandées par Riot (toujours à jour),
 * puis adaptation des fragments défensifs à la composition adverse.
 */
export function buildRunePage(
  gd: GameData,
  champName: string,
  build: JunglerBuild | null,
  metaPatch: string,
  riotPages: RecommendedRunePage[],
  preference: RuneSource,
  threat: ThreatProfile
): ResolvedRunePage | null {
  const reasons: string[] = []
  const tactique = build ? resolveSpec(gd, build.runes) : null
  const riotSorted = riotPages
    .map((p) => resolveRiot(gd, p))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p, index) => ({ p, score: keystoneFit(p.runes[0].name, threat) - index * 0.05 }))
    .sort((a, b) => b.score - a.score)
  const riot = riotSorted[0]?.p ?? null

  const upToDate = samePatch(gd.version, metaPatch)
  const order: ('tactique' | 'riot')[] =
    preference === 'tactique' || (preference === 'auto' && upToDate)
      ? ['tactique', 'riot']
      : ['riot', 'tactique']
  const chosen = order.find((s) => (s === 'tactique' ? tactique : riot)) ?? null
  if (!chosen) return null

  const base = chosen === 'tactique' ? tactique! : riot!
  if (chosen === 'tactique')
    reasons.push(
      upToDate
        ? `${tr('Méta', 'Meta')} patch ${metaPatch}`
        : `${tr('Base', 'Database')} patch ${metaPatch}`
    )
  else
    reasons.push(
      `${tr('Recommandation Riot', 'Riot recommendation')} (patch ${gd.version.split('.').slice(0, 2).join('.')})`
    )
  if (chosen === 'riot' && riotSorted.length > 1)
    reasons.push(
      tr('Clé de voûte choisie selon la composition adverse', 'Keystone picked for the enemy team')
    )

  // Adaptation des fragments.
  const shards = [...base.shards]
  const m = threat.metrics
  const isTank = build?.archetype === 'TANK'
  if (threat.enemies.length > 0) {
    if (m.cc >= 0.6 && shards[2] !== SHARDS.tenacity) {
      shards[2] = SHARDS.tenacity
      reasons.push(
        tr(
          'Fragment ténacité : beaucoup de contrôles adverses',
          'Tenacity shard: lots of enemy crowd control'
        )
      )
    } else if (m.burst >= 0.6 && !isTank && shards[2] === SHARDS.healthScaling) {
      shards[2] = SHARDS.health
      reasons.push(
        tr(
          'Fragment PV : dégâts explosifs adverses en début de partie',
          'Health shard: heavy enemy early burst'
        )
      )
    }
  }
  // Sécurité : chaque fragment doit appartenir à sa ligne.
  for (let i = 0; i < 3; i++) if (!SHARD_ROWS[i].includes(shards[i])) shards[i] = SHARD_ROWS[i][0]

  return {
    payload: {
      name: champName,
      primaryStyleId: base.primary.id,
      subStyleId: base.sub.id,
      selectedPerkIds: [...base.runes.map((r) => r.id), ...shards]
    },
    source: chosen,
    primaryTree: base.primary,
    subTree: base.sub,
    runes: base.runes,
    shards,
    reasons,
    repairs: chosen === 'tactique' ? tactique!.repairs : []
  }
}
