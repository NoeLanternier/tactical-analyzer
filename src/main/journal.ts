import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { GameJournal, LiveGameData } from '../shared/types'
import { debugLog } from './logger'
import { playerKey, slotsOf } from '../shared/journalSlots'

// Journal de partie : l'historique du client ne contient ni les achats d'objets ni les balises de
// contrôle. On les relève donc nous-mêmes pendant la partie avec l'API en jeu (inventaire de chaque
// joueur, or du joueur local), puis on les rattache au bilan d'après-partie.

const GOLD_EVERY = 5

function file(): string {
  return path.join(app.getPath('userData'), 'journal-derniere-partie.json')
}

export class JournalRecorder {
  private current: GameJournal | null = null
  /** Inventaire précédent de chaque place du journal. */
  private counts: Map<number, number>[] = []
  /** Clé de chaque joueur (Riot ID) → place dans le journal. */
  private slots = new Map<string, number>()
  private last: GameJournal | null = null

  constructor() {
    try {
      this.last = JSON.parse(fs.readFileSync(file(), 'utf-8'))
    } catch {
      this.last = null
    }
  }

  /** Journal de la partie en cours ou de la dernière partie terminée. */
  latest(): GameJournal | null {
    return this.current ?? this.last
  }

  update(d: LiveGameData | null): void {
    if (!d || d.allPlayers.length === 0) {
      if (this.current) this.finish()
      return
    }
    const t = Math.max(0, Math.round(d.gameTime))
    const j = this.current
    // Joueurs suivis par leur Riot ID : l'ordre de allPlayers peut changer d'un relevé à l'autre.
    let places = j ? slotsOf(d.allPlayers, this.slots, j.players) : []
    const sameGame =
      j &&
      t + 30 >= j.lastTime &&
      j.players.length === d.allPlayers.length &&
      places.filter((s) => s >= 0).length >= d.allPlayers.length - 1
    if (!sameGame) {
      if (this.current) this.finish()
      this.start(d, t)
      places = d.allPlayers.map((_, i) => i)
    }
    const cur = this.current!
    d.allPlayers.forEach((p, i) => {
      const idx = places[i]
      if (idx < 0) return
      // Viego qui possède un adversaire : l'API montre l'inventaire du champion possédé. On attend
      // la fin de la possession (l'inventaire précédent est gardé), sinon ces objets seraient
      // comptés comme des achats.
      const startRaw = cur.players[idx]?.raw
      if (startRaw && p.rawChampionName && p.rawChampionName !== startRaw) return
      const next = new Map<number, number>()
      for (const it of p.items)
        next.set(it.itemID, (next.get(it.itemID) ?? 0) + Math.max(1, it.count))
      const prev = this.counts[idx] ?? new Map<number, number>()
      for (const id of new Set([...prev.keys(), ...next.keys()])) {
        const delta = (next.get(id) ?? 0) - (prev.get(id) ?? 0)
        for (let k = 0; k < Math.abs(delta); k++) cur.items.push([t, idx, id, delta > 0 ? 1 : 0])
      }
      this.counts[idx] = next
    })
    const gold = d.activePlayer?.currentGold
    const lastGold = cur.gold[cur.gold.length - 1]
    if (typeof gold === 'number' && (!lastGold || t - lastGold[0] >= GOLD_EVERY))
      cur.gold.push([t, Math.round(gold)])
    cur.lastTime = t
  }

  private start(d: LiveGameData, t: number): void {
    const ap = d.activePlayer
    const me = d.allPlayers.findIndex(
      (p) =>
        (ap?.riotId && p.riotId === ap.riotId) ||
        (ap?.summonerName && p.summonerName === ap.summonerName)
    )
    this.current = {
      startedAt: Date.now() - t * 1000,
      from: t,
      lastTime: t,
      me,
      players: d.allPlayers.map((p) => ({
        champ: p.championName,
        raw: p.rawChampionName,
        team: p.team
      })),
      items: [],
      gold: []
    }
    this.counts = []
    this.slots = new Map(d.allPlayers.map((p, i) => [playerKey(p), i]))
  }

  private finish(): void {
    this.last = this.current
    this.current = null
    this.counts = []
    this.slots = new Map()
    try {
      fs.writeFileSync(file(), JSON.stringify(this.last))
    } catch (error) {
      debugLog('journal', { saveError: String(error) })
    }
  }
}
