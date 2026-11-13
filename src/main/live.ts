import { EventEmitter } from 'events'
import * as https from 'https'
import type { LiveGameData, LivePlayer } from '../shared/types'
import { RIOT_ROOT_CERT } from './riotCert'
import { debugLog } from './logger'
import { LiveProbe } from './liveProbe'
import { RIOT_COMPLIANT } from '../shared/edition'

/* eslint-disable @typescript-eslint/no-explicit-any */

// API Live Client Data de Riot (disponible uniquement pendant une partie, sur la machine locale).
// La connexion est vérifiée avec le certificat racine de Riot. Le nom d'hôte n'est pas contrôlé car
// le certificat est émis pour "localhost" alors que l'API est appelée sur 127.0.0.1.
const verifiedAgent = new https.Agent({ ca: RIOT_ROOT_CERT, checkServerIdentity: () => undefined })
// Secours si Riot change de certificat : uniquement pour 127.0.0.1, rien ne sort de la machine.
const localFallbackAgent = new https.Agent({ rejectUnauthorized: false })

function getJson(path: string, agent: https.Agent): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path, agent, timeout: 1500 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

const isCertError = (e: any): boolean =>
  typeof e?.code === 'string' && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(e.code)

let useFallback = false

async function fetchAllGameData(): Promise<any> {
  try {
    return await getJson(
      '/liveclientdata/allgamedata',
      useFallback ? localFallbackAgent : verifiedAgent
    )
  } catch (e) {
    if (!useFallback && isCertError(e)) {
      useFallback = true
      debugLog('live', { certFallback: String((e as Error).message) })
      return getJson('/liveclientdata/allgamedata', localFallbackAgent)
    }
    throw e
  }
}

function normalize(raw: any): LiveGameData | null {
  if (!raw || !Array.isArray(raw.allPlayers)) return null
  const ap = raw.activePlayer
  const players: LivePlayer[] = raw.allPlayers.map((p: any) => ({
    championName: String(p.championName ?? ''),
    rawChampionName: String(p.rawChampionName ?? ''),
    position: String(p.position ?? ''),
    riotId: String(
      p.riotId ?? (p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagLine ?? ''}` : '')
    ),
    summonerName: String(p.summonerName ?? ''),
    team: String(p.team ?? ''),
    level: Number(p.level ?? 1),
    isDead: Boolean(p.isDead),
    items: Array.isArray(p.items)
      ? p.items.map((it: any) => ({
          itemID: Number(it.itemID),
          count: Number(it.count ?? 1),
          slot: Number(it.slot ?? 0)
        }))
      : [],
    scores: {
      kills: Number(p.scores?.kills ?? 0),
      deaths: Number(p.scores?.deaths ?? 0),
      assists: Number(p.scores?.assists ?? 0),
      creepScore: Number(p.scores?.creepScore ?? 0),
      wardScore: Number(p.scores?.wardScore ?? 0)
    }
  }))
  const events: any[] = Array.isArray(raw.events?.Events) ? raw.events.Events : []
  const kills = events
    .filter((e) => e?.EventName === 'ChampionKill')
    .map((e) => ({
      t: Number(e.EventTime ?? 0),
      killer: String(e.KillerName ?? ''),
      victim: String(e.VictimName ?? ''),
      assisters: Array.isArray(e.Assisters) ? e.Assisters.map(String) : []
    }))
  return {
    gameTime: Number(raw.gameData?.gameTime ?? 0),
    gameMode: String(raw.gameData?.gameMode ?? ''),
    mapNumber: Number(raw.gameData?.mapNumber ?? 0) || 0,
    kills,
    // En mode spectateur, il n'y a pas de joueur actif.
    activePlayer:
      ap && (ap.riotId || ap.summonerName)
        ? {
            riotId: String(
              ap.riotId ??
                (ap.riotIdGameName ? `${ap.riotIdGameName}#${ap.riotIdTagLine ?? ''}` : '')
            ),
            summonerName: String(ap.summonerName ?? ''),
            currentGold: Number(ap.currentGold ?? 0),
            level: Number(ap.level ?? 1),
            ...(ap.championStats && Number(ap.championStats.maxHealth) > 0
              ? {
                  stats: {
                    armor: Number(ap.championStats.armor ?? 0),
                    magicResist: Number(ap.championStats.magicResist ?? 0),
                    maxHealth: Number(ap.championStats.maxHealth ?? 0)
                  }
                }
              : {})
          }
        : null,
    allPlayers: players
  }
}

/**
 * Interroge l'API en jeu : toutes les 2 s pendant une partie, toutes les 8 s sinon
 * (pour détecter une partie même si le client n'est pas connecté).
 */
export class LivePoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private inGame = false
  private hadData = false

  constructor(private readonly isGamePhase: () => boolean) {
    super()
  }

  /** Relevé des champs de l'API hors Faille (édition personnelle, voir liveProbe.ts). */
  private probe: LiveProbe | null = RIOT_COMPLIANT
    ? null
    : new LiveProbe((p) => getJson(p, useFallback ? localFallbackAgent : verifiedAgent))

  start(): void {
    const tick = async (): Promise<void> => {
      let data: LiveGameData | null
      try {
        const raw = await fetchAllGameData()
        data = normalize(raw)
        if (data) this.probe?.observe(raw)
      } catch {
        data = null
      }
      if (data) {
        this.hadData = true
        this.emit('update', data)
      } else if (this.hadData) {
        this.hadData = false
        this.emit('update', null)
      }
      this.inGame = data !== null || this.isGamePhase()
      this.timer = setTimeout(tick, this.inGame ? 2000 : 8000)
    }
    void tick()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
