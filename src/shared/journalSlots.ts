// Identité des joueurs dans le journal de partie. L'API en jeu ne garantit pas l'ordre de
// allPlayers d'un relevé à l'autre : chaque joueur est donc suivi par son Riot ID (ou nom
// d'invocateur), et non par sa position dans la liste. Sinon, si deux joueurs échangent leur place,
// les objets de l'un sont comptés comme des achats de l'autre.

export interface SlotPlayer {
  riotId: string
  summonerName: string
  rawChampionName: string
  team: string
}

/** Clé stable d'un joueur pendant la partie. */
export function playerKey(p: SlotPlayer): string {
  const name = p.riotId || p.summonerName
  // Sans nom (bots, noms masqués) : équipe + champion, unique en partie classée.
  return name ? `id:${name}` : `champ:${p.team}:${p.rawChampionName}`
}

/**
 * Place de chaque joueur du relevé dans le journal (players du début de partie), ou -1 si on ne
 * le reconnaît pas. `slots` : clé → place, établi au début de la partie.
 */
export function slotsOf(
  players: SlotPlayer[],
  slots: Map<string, number>,
  start: { raw: string; team: string }[]
): number[] {
  const used = new Set<number>()
  const out = players.map((p) => {
    const s = slots.get(playerKey(p))
    if (s === undefined || used.has(s)) return -1
    used.add(s)
    return s
  })
  // Repli : même équipe et même champion (ex. clé changée en cours de partie).
  players.forEach((p, i) => {
    if (out[i] >= 0) return
    const s = start.findIndex(
      (x, k) => !used.has(k) && x.team === p.team && x.raw === p.rawChampionName
    )
    if (s >= 0) {
      used.add(s)
      out[i] = s
    }
  })
  return out
}
