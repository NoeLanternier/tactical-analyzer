import type { RiotStartBundles } from '../../../shared/types'
import type { JunglerBuild } from '../data/junglers'
import type { GameData } from './gameData'
import { norm } from './normalize'
import { clientPosition, defaultStart, type Role } from './role'

// Objets de départ hors jungle (la jungle commence par son familier) : les départs proposés par
// la boutique du jeu quand on les connaît (édition personnelle), sinon les départs courants des
// joueurs du poste (méta), sinon le départ habituel du poste (Doran…).

export interface StartChoice {
  items: string[]
  /** Proposé par la boutique du jeu. */
  riot: boolean
  /** Part des parties et taux de victoire des joueurs du poste (méta), s'ils sont connus. */
  share: number | null
  winRate: number | null
  games: number | null
}

export interface StartPlan {
  chosen: StartChoice
  /** Autres départs possibles (dans l'ordre de la boutique, sinon du plus joué au moins joué). */
  others: StartChoice[]
  source: 'riot' | 'meta' | 'default'
}

/** Clé d'un départ, indépendante de l'ordre des objets. */
const keyOf = (items: string[]): string => items.map(norm).sort().join('+')

/** Départs de la boutique pour ce poste : ceux du poste s'il en a, sinon ceux de tous les postes. */
export function riotBundlesFor(data: RiotStartBundles | null, role: Role): number[][] {
  if (!data?.length) return []
  const pos = clientPosition(role).toLowerCase()
  const alias = role === 'support' ? 'support' : role === 'bot' ? 'adc' : role
  const own = data.find((d) => {
    const p = d.position?.toLowerCase()
    return p === pos || p === alias || p === role
  })
  return (own ?? data.find((d) => d.position === null))?.bundles ?? []
}

export function chooseStart(
  gd: GameData,
  build: JunglerBuild,
  role: Role,
  riot: RiotStartBundles | null
): StartPlan {
  const stats = new Map((build.startOptions ?? []).map((o) => [keyOf(o.items), o]))
  const withStats = (items: string[], fromRiot: boolean): StartChoice => {
    const o = stats.get(keyOf(items))
    return {
      items,
      riot: fromRiot,
      share: o?.share ?? null,
      winRate: o?.winRate ?? null,
      games: o?.games ?? null
    }
  }
  const riotItems = riotBundlesFor(riot, role)
    .map((ids) => ids.map((id) => gd.items.get(id)?.name).filter((n): n is string => !!n))
    .filter((b) => b.length > 0)
  let source: StartPlan['source']
  let list: StartChoice[]
  if (riotItems.length) {
    source = 'riot'
    list = riotItems.map((b) => withStats(b, true))
  } else if (build.startOptions?.length) {
    source = 'meta'
    list = build.startOptions.map((o) => withStats(o.items, false))
  } else {
    source = build.start?.length ? 'meta' : 'default'
    list = [
      withStats(build.start?.length ? build.start : defaultStart(build.archetype, role), false)
    ]
  }
  // Choix : le meilleur taux de victoire parmi les départs assez joués (15 % des parties et
  // 30 parties), sinon le premier (celui que la boutique met en avant, ou le plus joué).
  const solid = list.filter((c) => (c.share ?? 0) >= 0.15 && (c.games ?? 0) >= 30)
  const chosen = solid.length
    ? solid.reduce((a, b) => ((b.winRate ?? 0) > (a.winRate ?? 0) ? b : a))
    : list[0]
  return { chosen, others: list.filter((c) => c !== chosen), source }
}
