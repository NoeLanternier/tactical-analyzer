import type { GameJournal, LiveGameData, LivePlayer, RawPostGame } from '../../../shared/types'
import { getBuild, type AugmentInfo, type Benchmark, type Catalog } from './catalog'
import type { ChampInfo, GameData, ItemInfo } from './gameData'
import { buildItemPlan, type ItemPlan } from './items'
import { chooseVariant } from './variants'
import { adaptChoices } from './choices'
import { tw } from './tuning'
import { ROLES, defaultStart, isMode, roleFromPosition, type Lane, type Role } from './role'
import { MODES, modeOf, type ModeKey } from '../../../shared/modes'
import { analyzeThreat } from './threat'
import { fmtNumber, fmtPct, gold, tr } from '../../../shared/i18n'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Bilan d'après-partie.
//
// 1. normalizeGame : convertit l'historique du client (format Riot « V4 » ou « V5 ») en données
//    compactes (GameFacts), enregistrées sur le disque.
// 2. analyzeGame : rejoue la partie minute par minute et produit le bilan : ce qui a été bien ou
//    mal fait (farm, build, combats, objectifs, vision) et, pour chaque objet acheté, ce que
//    l'application conseillait à ce moment-là (inventaires et scores reconstitués).
//
// Les bilans sont recalculés à partir des GameFacts à chaque lancement : une amélioration du moteur
// s'applique donc aussi aux anciennes parties.

export const FACTS_VERSION = 1
const SMITE = 11
const CONTROL_WARD = 2055

export interface FactPlayer {
  pid: number
  team: number
  champ: number
  /** Poste dans la partie (absent dans les bilans enregistrés avant les postes : jungle). */
  role?: Role | null
  smite: boolean
  win: boolean
  k: number
  d: number
  a: number
  cs: number
  jcs: number
  gold: number
  level: number
  items: number[]
  phys: number
  magic: number
  heal: number
  cc: number
  vision: number
  wards: number
  controlWards: number
  /** Dégâts subis (tous types), pour les repères des modes sans voie. */
  taken?: number
  /** Augments choisis (ARAM Mayhem), dans l'ordre. */
  augments?: number[]
}

export type MonsterKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | 'atakhan'

export interface GameFacts {
  v: number
  gameId: number
  createdAt: number
  /** Durée en secondes. */
  duration: number
  queueId: number
  version: string
  me: number
  /** Poste du joueur local (absent : jungle, seul poste analysé avant). */
  role?: Role
  perks: { primary: number; sub: number; ids: number[] } | null
  players: FactPlayer[]
  /** frames[minute][pid - 1] = [or total, or en poche, sbires + monstres, niveau]. */
  frames: number[][][]
  /** [seconde, pid, objet, op] : 1 achat, 0 vente/destruction, 2 achat annulé, 3 vente annulée. */
  items: [number, number, number, number][]
  /** [seconde, tueur, victime, assistants]. */
  kills: [number, number, number, number[]][]
  /** [seconde, tueur, équipe, type]. */
  monsters: [number, number, number, MonsterKind][]
  /**
   * Origine des achats : 'live' = journal enregistré par l'app pendant la partie (minutage exact),
   * absent = inconnus (l'historique du client ne les contient pas).
   */
  itemSource?: 'live' | 'timeline'
  /** [seconde, or en poche] du joueur local (journal de partie). */
  gold?: [number, number][]
  /** Nombre de balises de contrôle connu de façon fiable (journal de partie). */
  controlWardsKnown?: boolean
}

/** Retrouve l'identifiant numérique d'un champion de l'API en jeu. */
export type ChampResolver = (rawChampionName: string, championName: string) => number | undefined

const num = (x: any): number => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0)

/** Poste d'un joueur indiqué par l'historique du client (format récent ou ancien). Peu fiable :
 * l'ancien format déduit la voie des déplacements (un top qui aide la jungle devient « JUNGLE »). */
function participantRole(p: any): Role | null {
  const direct = roleFromPosition(p.teamPosition || p.individualPosition || '')
  if (direct) return direct
  const lane = String(p.timeline?.lane ?? '').toUpperCase()
  const role = String(p.timeline?.role ?? '').toUpperCase()
  if (lane === 'BOTTOM' || lane === 'BOT')
    return role === 'DUO_SUPPORT' ? 'support' : role === 'DUO_CARRY' ? 'bot' : null
  return roleFromPosition(lane)
}

/** Zone de la carte : voie du haut, du milieu, du bas, jungle (null : base). */
type Zone = 'top' | 'mid' | 'bot' | 'jungle'
export function zoneOf(x: number, y: number): Zone | null {
  if (x + y < 5200 || x + y > 24400) return null
  if (x < 2600 || y > 12400) return 'top'
  if (y < 2600 || x > 12400) return 'bot'
  if (Math.abs(x - y) < 1700) return 'mid'
  return 'jungle'
}

/**
 * Poste de chaque joueur, du plus fiable au moins fiable : poste attribué en sélection (joueur
 * local) ou donné par l'API en jeu (journal),
 * Châtiment → jungle, présence sur les voies de 2 à 10 min (chronologie), indication de
 * l'historique si elle ne contredit rien, puis déduction (support : le moins de sbires ; un seul
 * poste manquant dans une équipe).
 */
export function assignRoles(
  players: FactPlayer[],
  fixed: Map<number, Role> = new Map(),
  zones: Map<number, Record<Zone, number>> = new Map()
): void {
  for (const team of [100, 200]) {
    const mates = players.filter((p) => p.team === team)
    const taken = new Map<Role, FactPlayer>()
    const take = (p: FactPlayer, r: Role | null): void => {
      p.role = r && !taken.has(r) ? r : null
      if (p.role) taken.set(p.role, p)
    }
    for (const p of mates) p.role = p.role ?? null
    const hints = new Map(mates.map((p) => [p.pid, p.role ?? null]))
    for (const p of mates) p.role = null
    // 1. Poste de l'API en jeu.
    for (const p of mates) if (fixed.has(p.pid)) take(p, fixed.get(p.pid)!)
    // 2. Châtiment (un seul porteur).
    const smiters = mates.filter((p) => p.smite && !p.role)
    if (smiters.length === 1) take(smiters[0], 'jungle')
    // 3. Présence sur les voies : le joueur le plus présent sur chaque voie libre.
    const zoneScore = (p: FactPlayer, z: Zone): number => {
      const v = zones.get(p.pid)
      if (!v) return 0
      const total = v.top + v.mid + v.bot + v.jungle
      return total >= 3 ? v[z] / total : 0
    }
    for (const z of ['top', 'mid', 'jungle'] as const) {
      if (taken.has(z)) continue
      const best = mates
        .filter((p) => !p.role && zoneScore(p, z) >= 0.4)
        .sort((a, b) => zoneScore(b, z) - zoneScore(a, z))[0]
      if (best) take(best, z)
    }
    const duo = mates.filter((p) => !p.role && zoneScore(p, 'bot') >= 0.4)
    if (duo.length === 2 && !taken.has('bot') && !taken.has('support')) {
      const [carry, sup] = [...duo].sort((a, b) => b.cs - a.cs)
      take(carry, 'bot')
      take(sup, 'support')
    }
    // 4. Indication de l'historique, si le poste est libre (pas de jungle sans Châtiment quand un
    //    coéquipier en a un).
    for (const p of mates) {
      if (p.role) continue
      const hint = hints.get(p.pid)
      if (hint === 'jungle' && !p.smite && mates.some((m) => m.smite && m !== p)) continue
      if (hint) take(p, hint)
    }
    // 5. Déduction.
    const unknown = (): FactPlayer[] => mates.filter((p) => !p.role)
    const missing = (): Role[] => ROLES.filter((r) => !taken.has(r))
    if (missing().includes('support') && unknown().length >= 2) {
      const sup = [...unknown()].sort((a, b) => a.cs + a.jcs - (b.cs + b.jcs))[0]
      take(sup, 'support')
    }
    if (missing().length === 1 && unknown().length === 1) take(unknown()[0], missing()[0])
  }
}

/** Convertit les données du client. Renvoie un motif si la partie ne peut pas être analysée. */
export function normalizeGame(
  raw: RawPostGame,
  resolveChamp?: ChampResolver,
  /** Poste du joueur local attribué en sélection des champions, s'il est connu. */
  myRole?: Role | null
): GameFacts | { skip: string } {
  const g: any = (raw.game as any)?.info ?? raw.game
  if (!g || !Array.isArray(g.participants))
    return { skip: tr('données illisibles', 'unreadable data') }
  const mapId = num(g.mapId)
  // Mode de la partie : la Faille (postes) ou un mode pris en charge (ARAM, ARAM Mayhem…).
  const mode = modeOf(num(g.queueId), typeof g.gameMode === 'string' ? g.gameMode : null, mapId)
  if (mode === null)
    return { skip: tr('mode de jeu non pris en charge', 'game mode not supported') }
  if (mode === 'sr' && mapId && mapId !== 11)
    return { skip: tr('pas la Faille de l’invocateur', 'not Summoner’s Rift') }
  const duration = num(g.gameDuration) > 20000 ? num(g.gameDuration) / 1000 : num(g.gameDuration)
  // Hors Faille, les parties sont plus courtes (ARAM : 15 à 20 min) : remake sous 5 min.
  if (duration < (mode === 'sr' ? 600 : 300))
    return { skip: tr('partie trop courte (remake)', 'game too short (remake)') }

  // Joueur local : puuid, sinon identifiant d'invocateur.
  let me = 0
  const identities: any[] = Array.isArray(g.participantIdentities) ? g.participantIdentities : []
  for (const id of identities) {
    const p = id?.player ?? {}
    if (
      (raw.puuid && p.puuid === raw.puuid) ||
      (raw.summonerId && num(p.summonerId) === raw.summonerId)
    )
      me = num(id.participantId)
  }
  if (!me) {
    const p = g.participants.find((x: any) => raw.puuid && x.puuid === raw.puuid)
    if (p) me = num(p.participantId)
  }
  if (!me) return { skip: tr('joueur introuvable dans la partie', 'player not found in the game') }

  const players: FactPlayer[] = g.participants.map((p: any): FactPlayer => {
    const s = p.stats ?? p
    const spells = [num(p.spell1Id ?? p.summoner1Id), num(p.spell2Id ?? p.summoner2Id)]
    const items: number[] = []
    for (let i = 0; i <= 6; i++) if (num(s[`item${i}`]) > 0) items.push(num(s[`item${i}`]))
    return {
      pid: num(p.participantId),
      team: num(p.teamId),
      champ: num(p.championId),
      smite: spells.includes(SMITE),
      win: s.win === true || s.win === 'Win',
      k: num(s.kills),
      d: num(s.deaths),
      a: num(s.assists),
      cs: num(s.totalMinionsKilled),
      jcs: num(s.neutralMinionsKilled),
      gold: num(s.goldEarned),
      level: num(s.champLevel),
      items,
      phys: num(s.physicalDamageDealtToChampions),
      magic: num(s.magicDamageDealtToChampions),
      heal: num(s.totalHeal),
      cc: num(s.timeCCingOthers),
      vision: num(s.visionScore),
      wards: num(s.wardsPlaced),
      controlWards: num(s.visionWardsBoughtInGame ?? s.detectorWardsPlaced),
      taken: num(s.totalDamageTaken),
      ...(() => {
        const aug = [1, 2, 3, 4, 5, 6]
          .map((i) => num(s[`playerAugment${i}`] ?? p[`playerAugment${i}`]))
          .filter((x) => x > 0)
        return aug.length ? { augments: aug } : {}
      })()
    }
  })
  // Poste de chaque joueur : indication de l'historique pour l'instant ; recalculé plus bas avec
  // les déplacements (chronologie) et le poste de l'API en jeu (journal).
  g.participants.forEach((p: any, i: number) => {
    players[i].role = participantRole(p)
  })

  const sm = g.participants.find((p: any) => num(p.participantId) === me)
  const st = sm?.stats ?? {}
  let perks: GameFacts['perks'] = null
  if (num(st.perk0)) {
    perks = {
      primary: num(st.perkPrimaryStyle),
      sub: num(st.perkSubStyle),
      ids: [0, 1, 2, 3, 4, 5].map((i) => num(st[`perk${i}`]))
    }
  } else if (Array.isArray(sm?.perks?.styles)) {
    const styles = sm.perks.styles
    perks = {
      primary: num(styles[0]?.style),
      sub: num(styles[1]?.style),
      ids: styles.flatMap((x: any) => (x.selections ?? []).map((y: any) => num(y.perk)))
    }
  }

  const facts: GameFacts = {
    v: FACTS_VERSION,
    gameId: num(g.gameId) || raw.gameId,
    createdAt: num(g.gameCreation),
    duration,
    queueId: num(g.queueId),
    version: String(g.gameVersion ?? ''),
    me,
    perks,
    players,
    frames: [],
    items: [],
    kills: [],
    monsters: []
  }

  const tl: any = raw.timeline
  const frames: any[] = Array.isArray(tl?.frames)
    ? tl.frames
    : Array.isArray(tl?.info?.frames)
      ? tl.info.frames
      : []
  const teamOf = new Map(players.map((p) => [p.pid, p.team]))
  const zones = new Map<number, Record<Zone, number>>()
  for (const f of frames) {
    const pf = f?.participantFrames ?? {}
    const ts = num(f?.timestamp)
    if (ts >= 110_000 && ts <= 610_000)
      for (const p of players) {
        const pos = pf[String(p.pid)]?.position
        const z = pos ? zoneOf(num(pos.x), num(pos.y)) : null
        if (!z) continue
        const v = zones.get(p.pid) ?? { top: 0, mid: 0, bot: 0, jungle: 0 }
        v[z]++
        zones.set(p.pid, v)
      }
    const row: number[][] = players.map((p) => {
      const x = pf[String(p.pid)] ?? {}
      return [
        num(x.totalGold),
        num(x.currentGold),
        num(x.minionsKilled) + num(x.jungleMinionsKilled),
        num(x.level)
      ]
    })
    facts.frames.push(row)
    for (const e of f?.events ?? []) {
      const t = Math.round(num(e.timestamp) / 1000)
      const pid = num(e.participantId)
      switch (e.type) {
        case 'ITEM_PURCHASED':
          facts.items.push([t, pid, num(e.itemId), 1])
          break
        case 'ITEM_SOLD':
        case 'ITEM_DESTROYED':
          facts.items.push([t, pid, num(e.itemId), 0])
          break
        case 'ITEM_UNDO':
          if (num(e.beforeId) > 0) facts.items.push([t, pid, num(e.beforeId), 2])
          if (num(e.afterId) > 0) facts.items.push([t, pid, num(e.afterId), 3])
          break
        case 'CHAMPION_KILL':
          facts.kills.push([
            t,
            num(e.killerId),
            num(e.victimId),
            Array.isArray(e.assistingParticipantIds) ? e.assistingParticipantIds.map(num) : []
          ])
          break
        case 'ELITE_MONSTER_KILL': {
          const type = String(e.monsterType ?? '')
          const sub = String(e.monsterSubType ?? '')
          const kind: MonsterKind | null =
            type === 'DRAGON'
              ? sub.includes('ELDER')
                ? 'elder'
                : 'dragon'
              : type === 'BARON_NASHOR'
                ? 'baron'
                : type === 'RIFTHERALD'
                  ? 'herald'
                  : type === 'HORDE'
                    ? 'grubs'
                    : type === 'ATAKHAN'
                      ? 'atakhan'
                      : null
          const killer = num(e.killerId)
          const team = num(e.killerTeamId) || teamOf.get(killer) || 0
          if (kind && team) facts.monsters.push([t, killer, team, kind])
          break
        }
      }
    }
  }
  if (facts.items.length) facts.itemSource = 'timeline'
  const fixed = new Map<number, Lane>()
  if (raw.journal && resolveChamp) attachJournal(facts, raw.journal, resolveChamp, fixed)
  // Modes sans postes : tous les joueurs jouent « le mode ».
  if (mode !== 'sr') {
    for (const p of players) p.role = mode
    facts.role = mode
    return facts
  }
  if (myRole && !isMode(myRole)) fixed.set(me, myRole)
  assignRoles(players, fixed, zones)
  const mine = players.find((p) => p.pid === me)
  if (!mine?.role) return { skip: tr('poste inconnu', 'unknown position') }
  facts.role = mine.role
  return facts
}

/**
 * Rattache le journal enregistré pendant la partie (achats, balises, or en poche), si c'est bien
 * la même partie : mêmes champions dans les mêmes équipes, enregistrée depuis le début.
 */
export function attachJournal(
  facts: GameFacts,
  j: GameJournal,
  resolve: ChampResolver,
  /** Reçoit le poste de chaque joueur selon l'API en jeu (pid → poste), si le journal en a. */
  positions?: Map<number, Role>
): boolean {
  if (!j || !Array.isArray(j.players) || !Array.isArray(j.items)) return false
  if (facts.createdAt && Math.abs(j.startedAt - facts.createdAt) > 30 * 60 * 1000) return false
  const pidOf: number[] = []
  const used = new Set<number>()
  for (const p of j.players) {
    const key = resolve(p.raw, p.champ)
    const team = p.team === 'ORDER' ? 100 : p.team === 'CHAOS' ? 200 : 0
    const match = facts.players.find(
      (x) => x.champ === key && (!team || x.team === team) && !used.has(x.pid)
    )
    pidOf.push(match ? match.pid : 0)
    if (match) used.add(match.pid)
  }
  if (used.size < facts.players.length - 1) return false
  if (j.me >= 0 && pidOf[j.me] !== facts.me) return false
  if (positions)
    j.players.forEach((p, i) => {
      const r = roleFromPosition(p.position)
      if (r && pidOf[i] > 0) positions.set(pidOf[i], r)
    })
  // Achats : seulement si la partie a été suivie (presque) en entier.
  if (j.from > 150 || j.lastTime < facts.duration * 0.8) return false
  const items = dropTransientSwaps(
    j.items
      .filter(([, idx]) => pidOf[idx] > 0)
      .map(([t, idx, id, op]) => [t, pidOf[idx], id, op] as [number, number, number, number])
  )
  // Contrôle : l'inventaire du joueur reconstitué à la fin du journal doit correspondre aux objets
  // de fin de partie de l'historique. Sinon (achats attribués au mauvais joueur), on ignore les
  // achats plutôt que d'afficher des conclusions fausses.
  if (!journalMatchesFinalItems(items, facts)) return false
  facts.items = items
  facts.itemSource = 'live'
  facts.gold = j.me >= 0 ? j.gold : undefined
  const me = facts.players.find((p) => p.pid === facts.me)!
  me.controlWards = facts.items.filter(
    ([, pid, id, op]) => pid === facts.me && id === CONTROL_WARD && op === 1
  ).length
  facts.controlWardsKnown = true
  return true
}

/** Délai maximal entre un changement d'inventaire et son retour exact à l'état précédent. */
const SWAP_WINDOW = 45

/**
 * Retire les changements d'inventaire annulés peu après, à l'identique : possession de Viego
 * (l'API montre quelques secondes l'inventaire du champion possédé), ou achat annulé. Sinon ces
 * objets passeraient pour des achats.
 */
export function dropTransientSwaps(
  items: [number, number, number, number][]
): [number, number, number, number][] {
  type Tick = { t: number; pid: number; idx: number[]; gained: number[]; lost: number[] }
  const ticks: Tick[] = []
  const byKey = new Map<string, Tick>()
  items.forEach(([t, pid, id, op], i) => {
    const key = `${t}:${pid}`
    let tick = byKey.get(key)
    if (!tick) {
      tick = { t, pid, idx: [], gained: [], lost: [] }
      byKey.set(key, tick)
      ticks.push(tick)
    }
    tick.idx.push(i)
    if (op === 1 || op === 3) tick.gained.push(id)
    else tick.lost.push(id)
  })
  const same = (a: number[], b: number[]): boolean =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
  const drop = new Set<number>()
  const used = new Set<Tick>()
  for (let a = 0; a < ticks.length; a++) {
    const A = ticks[a]
    if (used.has(A) || A.gained.length === 0) continue
    for (let b = a + 1; b < ticks.length; b++) {
      const B = ticks[b]
      if (B.t - A.t > SWAP_WINDOW) break
      if (B.pid !== A.pid || used.has(B)) continue
      if (same(A.gained, B.lost) && same(A.lost, B.gained)) {
        used.add(A)
        used.add(B)
        for (const i of [...A.idx, ...B.idx]) drop.add(i)
        break
      }
      // Autre changement du même joueur entre les deux : pas un aller-retour.
      break
    }
  }
  return items.filter((_, i) => !drop.has(i))
}

/** Objets durables (pas les consommables ni les balises) : identifiants à partir de 3000. */
const DURABLE_MIN_ID = 3000
const TRINKETS = new Set([3340, 3363, 3364, 3330])

/**
 * Les achats du journal sont-ils bien ceux du joueur local ? Objets durables en fin de journal
 * comparés aux objets de fin de partie : au plus un écart (achat ou vente dans les dernières
 * secondes, après le dernier relevé).
 */
export function journalMatchesFinalItems(
  items: [number, number, number, number][],
  facts: GameFacts
): boolean {
  const me = facts.players.find((p) => p.pid === facts.me)
  if (!me) return false
  const durable = (id: number): boolean => id >= DURABLE_MIN_ID && !TRINKETS.has(id)
  const inv = new Map<number, number>()
  for (const [, who, id, op] of items) {
    if (who !== facts.me || !durable(id)) continue
    const v = (inv.get(id) ?? 0) + (op === 1 || op === 3 ? 1 : -1)
    if (v > 0) inv.set(id, v)
    else inv.delete(id)
  }
  const final = new Set(me.items.filter(durable))
  const extra = [...inv.keys()].filter((id) => !final.has(id)).length
  const missing = [...final].filter((id) => !inv.has(id)).length
  return extra + missing <= 1
}

// --- Rejeu ------------------------------------------------------------------------------------

/** Inventaire d'un joueur à un instant donné, reconstitué à partir des achats et ventes. */
export function inventoryAt(facts: GameFacts, pid: number, t: number): Map<number, number> {
  const inv = new Map<number, number>()
  const add = (id: number, n: number): void => {
    const v = (inv.get(id) ?? 0) + n
    if (v > 0) inv.set(id, v)
    else inv.delete(id)
  }
  for (const [time, who, id, op] of facts.items) {
    if (time > t) break
    if (who !== pid) continue
    if (op === 1 || op === 3) add(id, 1)
    else add(id, -1)
  }
  return inv
}

/** Achats effectifs d'un joueur (les achats annulés sont retirés). */
export function purchasesOf(facts: GameFacts, pid: number): { t: number; id: number }[] {
  const out: { t: number; id: number }[] = []
  for (const [t, who, id, op] of facts.items) {
    if (who !== pid) continue
    if (op === 1) out.push({ t, id })
    else if (op === 2) {
      const idx = out.map((x) => x.id).lastIndexOf(id)
      if (idx >= 0) out.splice(idx, 1)
    }
  }
  return out
}

function frameAt(facts: GameFacts, t: number): number[][] | null {
  if (!facts.frames.length) return null
  return facts.frames[Math.max(0, Math.min(facts.frames.length - 1, Math.floor(t / 60)))]
}

/** Or en poche du joueur local à l'instant t (journal de partie, sinon minute la plus proche). */
function goldAt(facts: GameFacts, t: number, meIdx: number): number {
  if (facts.gold?.length) {
    let g = facts.gold[0][1]
    for (const [time, v] of facts.gold) {
      if (time > t) break
      g = v
    }
    return g
  }
  return frameAt(facts, t)?.[meIdx]?.[1] ?? 0
}

const riotIdOf = (facts: GameFacts, pid: number): string =>
  pid === facts.me ? 'moi#0' : `joueur${pid}#0`

/** Données « en jeu » reconstituées à l'instant t (même format que l'API Live Client Data). */
export function liveAt(
  gd: GameData,
  facts: GameFacts,
  t: number,
  finalItems = false
): LiveGameData {
  const frame = frameAt(facts, t)
  const score = new Map<number, { k: number; d: number; a: number }>()
  for (const p of facts.players) score.set(p.pid, { k: 0, d: 0, a: 0 })
  for (const [time, killer, victim, assists] of facts.kills) {
    if (time > t) break
    if (score.has(killer)) score.get(killer)!.k++
    if (score.has(victim)) score.get(victim)!.d++
    for (const a of assists) if (score.has(a)) score.get(a)!.a++
  }
  const players: LivePlayer[] = facts.players.map((p, idx) => {
    const champ = gd.champions.get(p.champ)
    const inv = finalItems
      ? p.items.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<number, number>())
      : inventoryAt(facts, p.pid, t)
    let slot = 0
    const items = [...inv.entries()].map(([itemID, count]) => {
      const info = gd.items.get(itemID)
      return {
        itemID,
        count,
        slot: info?.tags.includes('Trinket') ? 6 : slot++
      }
    })
    const s = score.get(p.pid)!
    return {
      championName: champ?.name ?? '',
      rawChampionName: `game_character_displayname_${champ?.id ?? ''}`,
      position: '',
      riotId: riotIdOf(facts, p.pid),
      summonerName: '',
      team: p.team === 100 ? 'ORDER' : 'CHAOS',
      level: frame?.[idx]?.[3] || 1,
      isDead: false,
      items,
      scores: {
        kills: s.k,
        deaths: s.d,
        assists: s.a,
        creepScore: frame?.[idx]?.[2] ?? 0,
        wardScore: 0
      }
    }
  })
  const meIdx = facts.players.findIndex((p) => p.pid === facts.me)
  return {
    gameTime: t,
    activePlayer: {
      riotId: riotIdOf(facts, facts.me),
      summonerName: '',
      currentGold: frame?.[meIdx]?.[1] ?? 0,
      level: frame?.[meIdx]?.[3] || 1
    },
    allPlayers: players
  }
}

// --- Bilan ------------------------------------------------------------------------------------

export type Category = 'farm' | 'build' | 'fights' | 'objectives' | 'vision'

const CATEGORY_LABEL: Record<Category, [string, string]> = {
  farm: ['Farm et avance', 'Farm & lead'],
  build: ['Build', 'Build'],
  fights: ['Combats et morts', 'Fights & deaths'],
  objectives: ['Objectifs', 'Objectives'],
  vision: ['Vision', 'Vision']
}

export function categoryLabel(c: Category, role?: Role): string {
  // Modes sans voie : pas de farm de voie, l'or et les dégâts comptent.
  if (c === 'farm' && isMode(role)) return tr('Dégâts et or', 'Damage & gold')
  return tr(...CATEGORY_LABEL[c])
}

export interface Finding {
  id: string
  cat: Category
  tone: 'good' | 'bad'
  title: string
  detail?: string
  /** Importance (0..1) pour trier les points. */
  impact: number
}

export interface PurchaseCheck {
  t: number
  item: ItemInfo
  /** follow : l'objet conseillé à ce moment ; plan : prévu plus tard ou en alternative ; off : hors plan. */
  status: 'follow' | 'plan' | 'off'
  suggested: ItemInfo | null
}

export type ObjectiveCount = Record<MonsterKind, number>

export interface GameStats {
  csPerMin: number
  cs10: number | null
  cs15: number | null
  csDiff10: number | null
  goldDiff15: number | null
  levelDiff15: number | null
  kp: number
  visionPerMin: number
  /** null : inconnu (partie jouée sans l'app ouverte). */
  controlWardsPer10: number | null
  firstItemMin: number | null
  secondItemMin: number | null
  deathsWithGold: number
  earlyDeaths: number
  unspentShare: number | null
  /** Or et dégâts aux champions par minute, part des dégâts de l'équipe, morts par 10 min. */
  goldPerMin: number
  dmgPerMin: number
  dmgShare: number
  deathsPer10: number
}

export interface GameReport {
  facts: GameFacts
  /** Poste joué. */
  role: Role
  champ: ChampInfo | null
  enemyJungler: ChampInfo | null
  win: boolean
  kda: string
  minutes: number
  scores: Partial<Record<Category, number>>
  overall: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  findings: Finding[]
  purchases: PurchaseCheck[]
  /** Part des achats conformes au conseil de l'app (null sans chronologie). */
  adherence: number | null
  objectives: { team: ObjectiveCount; enemy: ObjectiveCount; smited: number }
  stats: GameStats
  /** Objets légendaires achetés, dans l'ordre. */
  legendaries: ItemInfo[]
  bench: Benchmark
  benchSource: 'master' | 'gold' | 'défaut'
  hasTimeline: boolean
  /** Achats connus avec leur minutage (journal de partie). */
  hasItems: boolean
  /** ARAM Mayhem : augments pris, avec leur écart estimé pour ce champion (null : inconnu). */
  augments: { id: number; info: AugmentInfo | null; lift: number | null }[]
}

/** Repères d'un jungler Master+ (remplacés par les vrais chiffres de la méta distante). */
export const DEFAULT_BENCH: Benchmark = {
  games: 0,
  cs10: 68,
  cs15: 104,
  gold15: 5700,
  level15: 11.2,
  firstItem: 11.5,
  secondItem: 19.5,
  kp: 0.6,
  visionPerMin: 1.05,
  controlWardsPer10: 1.1
}

/** Repères par défaut de chaque poste (remplacés par les vrais chiffres de la méta du poste). */
export const DEFAULT_BENCH_BY_ROLE = {
  jungle: DEFAULT_BENCH,
  top: {
    ...DEFAULT_BENCH,
    cs10: 78,
    cs15: 120,
    gold15: 5800,
    level15: 12,
    firstItem: 12,
    secondItem: 20,
    kp: 0.45,
    visionPerMin: 0.6,
    controlWardsPer10: 0.6
  },
  mid: {
    ...DEFAULT_BENCH,
    cs10: 80,
    cs15: 125,
    gold15: 5900,
    level15: 12,
    firstItem: 11.5,
    secondItem: 19.5,
    kp: 0.55,
    visionPerMin: 0.65,
    controlWardsPer10: 0.6
  },
  bot: {
    ...DEFAULT_BENCH,
    cs10: 82,
    cs15: 128,
    gold15: 5900,
    level15: 11,
    firstItem: 11.5,
    secondItem: 19,
    kp: 0.55,
    visionPerMin: 0.6,
    controlWardsPer10: 0.5
  },
  support: {
    ...DEFAULT_BENCH,
    cs10: 10,
    cs15: 15,
    gold15: 4100,
    level15: 10,
    firstItem: 13,
    secondItem: 22,
    kp: 0.65,
    visionPerMin: 2.4,
    controlWardsPer10: 2.5
  }
} as Record<Role, Benchmark>

/**
 * Repères par défaut des modes sans voie (remplacés par ceux de la méta du mode) : l'or arrive plus
 * vite (or passif, combats permanents), on meurt plus souvent, pas de vision.
 */
const MODE_BENCH: Benchmark = {
  games: 0,
  cs10: 30,
  cs15: 45,
  gold15: 8000,
  level15: 16,
  firstItem: 7,
  secondItem: 12,
  kp: 0.6,
  visionPerMin: 0,
  controlWardsPer10: 0,
  goldPerMin: 560,
  dmgPerMin: 1500,
  deathsPer10: 4.5,
  dmgShare: 0.2
}
for (const m of Object.keys(MODES) as ModeKey[]) DEFAULT_BENCH_BY_ROLE[m] = MODE_BENCH

/** Poids des catégories dans la note : modes sans objectifs ni vision. */
const MODE_WEIGHTS: Record<Category, number> = {
  farm: 0.3,
  build: 0.3,
  fights: 0.4,
  objectives: 0,
  vision: 0
}

/** Poids des catégories dans la note selon le poste. */
const CATEGORY_WEIGHTS: Record<Lane, Record<Category, number>> = {
  jungle: { farm: 0.25, build: 0.2, fights: 0.25, objectives: 0.2, vision: 0.1 },
  top: { farm: 0.3, build: 0.2, fights: 0.3, objectives: 0.1, vision: 0.1 },
  mid: { farm: 0.3, build: 0.2, fights: 0.3, objectives: 0.1, vision: 0.1 },
  bot: { farm: 0.35, build: 0.2, fights: 0.25, objectives: 0.1, vision: 0.1 },
  support: { farm: 0.1, build: 0.15, fights: 0.3, objectives: 0.15, vision: 0.3 }
}

/** Conseils communs aux postes de voie (hors jungle). */
const LANE_TIPS: Record<string, [string, string]> = {
  'gold-behind': [
    'En retard en voie : farm sous la tour, ne te bats pas sans ton jungler, et garde la vision sur la rivière.',
    'Behind in lane: farm under tower, don’t fight without your jungler, and keep river vision.'
  ],
  'kp-low': [
    'Rejoins les combats autour des objectifs, et aide ton jungler quand il vient sur ta voie.',
    'Join fights around objectives, and help your jungler when they come to your lane.'
  ]
}

/** Conseils propres à un poste, à la place du conseil général. */
const ROLE_TIPS: Partial<Record<Role, Record<string, [string, string]>>> = {
  top: {
    'cs-low': [
      'Concentre-toi sur les derniers coups, surtout sous la tour : chaque vague perdue coûte ~300 or.',
      'Focus on last hits, especially under tower: each lost wave costs ~300 gold.'
    ],
    ...LANE_TIPS
  },
  mid: {
    'cs-low': [
      'Ne quitte pas ta voie sans avoir poussé la vague : farm d’abord, roam ensuite.',
      'Don’t leave lane without pushing the wave: farm first, roam after.'
    ],
    ...LANE_TIPS
  },
  bot: {
    'cs-low': [
      'Le tireur vit de son farm : derniers coups en priorité, et récupère les vagues de côté après 14 min.',
      'The ADC lives on farm: last hits first, and catch side waves after 14 min.'
    ],
    ...LANE_TIPS
  },
  support: {
    ...LANE_TIPS,
    'kp-low': [
      'Reste avec ton tireur en début de partie, puis accompagne ton jungler vers les objectifs.',
      'Stay with your ADC early, then follow your jungler to objectives.'
    ],
    'vision-low': [
      'Pose une balise à chaque fois que ta charge est pleine et achète une balise de contrôle à chaque retour.',
      'Ward every time your charge is full and buy a control ward on every back.'
    ]
  }
}

/** Conseils associés aux points faibles (affichés en rappel avant les parties suivantes). */
const TIPS: Record<string, [string, string]> = {
  'cs-low': [
    'Enchaînez les camps entre deux actions : pas de temps mort sans farm.',
    'Chain camps between plays: no idle time without farming.'
  ],
  'gold-behind': [
    'Suivez le jungler adverse : contre-gank ou contre-jungle du côté opposé.',
    'Track the enemy jungler: counter-gank or invade the opposite side.'
  ],
  'first-item-late': [
    'Visez votre 1er objet vers {first} min : farm + retour au bon moment.',
    'Aim for your 1st item around {first} min: farm + back at the right time.'
  ],
  'off-build': [
    'Suivez l’ordre d’objets conseillé, il s’adapte à la partie.',
    'Follow the suggested item order, it adapts to the game.'
  ],
  'no-antiheal': [
    'Face aux soins, achetez le composant anti-soins tôt.',
    'Against healing, buy the anti-heal component early.'
  ],
  'no-mr': [
    'Face à beaucoup de magie, prenez de la résistance magique.',
    'Against heavy magic damage, build magic resist.'
  ],
  'no-armor': [
    'Face à beaucoup de dégâts physiques, prenez de l’armure.',
    'Against heavy physical damage, build armor.'
  ],
  'deaths-gold': [
    'Rentrez dépenser votre or avant de prendre un risque.',
    'Back and spend your gold before taking a risk.'
  ],
  'unspent-gold': [
    'Rentrez dès que vous avez de quoi acheter un composant important.',
    'Back as soon as you can afford a key component.'
  ],
  'early-deaths': [
    'Avant 14 min, ne vous battez pas sans vision ni avantage de niveau.',
    'Before 14 min, don’t fight without vision or a level lead.'
  ],
  'many-deaths': [
    'Moins de morts : placez-vous derrière vos tanks en combat.',
    'Fewer deaths: position behind your tanks in fights.'
  ],
  'kp-low': [
    'Participez davantage aux actions de vos voies (ganks, contre-ganks).',
    'Join more plays in your lanes (ganks, counter-ganks).'
  ],
  'objectives-lost': [
    'Préparez les dragons 1 min avant : vision, retour, poussée des voies.',
    'Set up dragons 1 min early: vision, reset, push the lanes.'
  ],
  'grubs-lost': [
    'Les larves du Néant comptent : prenez-les quand le haut est poussé.',
    'Voidgrubs matter: take them when top lane is pushed.'
  ],
  'no-control-ward': [
    'Achetez une balise de contrôle à chaque retour.',
    'Buy a control ward on every back.'
  ],
  'vision-low': [
    'Posez vos balises et changez de totem selon la phase de jeu.',
    'Place your wards and swap trinkets as the game evolves.'
  ]
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Note 0..100 : 75 au niveau du repère, 100 à +15 %, 20 à −25 %. */
function rate(value: number, target: number, lowerIsBetter = false): number {
  if (target <= 0) return 75
  const r = lowerIsBetter ? target / Math.max(value, 0.01) : value / target
  if (r >= 1.15) return 100
  if (r >= 1) return 75 + ((r - 1) / 0.15) * 25
  if (r >= 0.75) return 20 + ((r - 0.75) / 0.25) * 55
  return Math.max(0, 20 - (0.75 - r) * 80)
}

const fmtMin = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const fr1 = (x: number): string => fmtNumber(x, 1)
const signed = (x: number): string => (x >= 0 ? `+${gold(x)}` : gold(x))
/** Niveau des repères de l'analyse en cours (Master+ ou Or à Émeraude). */
let benchLabel = 'Master+'
const bench_ = (v: string): string =>
  tr(`Repère ${benchLabel} : ${v}.`, `${benchLabel} benchmark: ${v}.`)

const OBJ_WEIGHT: Record<MonsterKind, number> = {
  dragon: 1,
  elder: 2,
  grubs: 0.35,
  herald: 1,
  baron: 1.6,
  atakhan: 1.4
}

const emptyCount = (): ObjectiveCount => ({
  dragon: 0,
  elder: 0,
  grubs: 0,
  herald: 0,
  baron: 0,
  atakhan: 0
})

export function gradeOf(score: number): GameReport['grade'] {
  return score >= 85 ? 'S' : score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 45 ? 'C' : 'D'
}

/**
 * Achats d'un bilan enregistré avant les correctifs du journal : possessions de Viego retirées, et
 * achats ignorés s'ils ne correspondent pas aux objets de fin de partie (mauvais joueur).
 */
export function cleanStoredItems(facts: GameFacts): GameFacts {
  if (facts.itemSource !== 'live') return facts
  const items = dropTransientSwaps(facts.items)
  if (journalMatchesFinalItems(items, facts)) return { ...facts, items }
  return { ...facts, items: [], itemSource: undefined, gold: undefined, controlWardsKnown: false }
}

/**
 * Postes d'un bilan enregistré avant la correction des postes : l'historique du client a pu classer
 * un joueur sans Châtiment en jungle. Recalculés avec les règles actuelles ; le poste enregistré est
 * gardé s'il ne peut pas être déterminé.
 */
export function repairStoredRoles(facts: GameFacts): GameFacts {
  if (!facts.role || !facts.players.some((p) => p.role !== undefined)) return facts
  const players = facts.players.map((p) => ({ ...p }))
  assignRoles(players)
  const role = players.find((p) => p.pid === facts.me)?.role
  if (!role) return facts
  return { ...facts, players, role }
}

export function analyzeGame(gd: GameData, catalog: Catalog, stored: GameFacts): GameReport {
  const facts = cleanStoredItems(stored)
  const me = facts.players.find((p) => p.pid === facts.me)!
  const meIdx = facts.players.indexOf(me)
  const champ = gd.champions.get(me.champ) ?? null
  const allies = facts.players.filter((p) => p.team === me.team && p.pid !== me.pid)
  const foes = facts.players.filter((p) => p.team !== me.team)
  const myRole: Role = facts.role ?? 'jungle'
  const jungle = myRole === 'jungle'
  // Modes sans voie (ARAM…) : ni adversaire direct, ni objectifs, ni vision.
  const mode = isMode(myRole) ? MODES[myRole] : null
  // Adversaire direct : le jungler adverse, ou le joueur d'en face au même poste.
  const enemyJ = mode
    ? null
    : jungle
      ? (foes.find((p) => p.smite) ?? foes.find((p) => p.role === 'jungle') ?? null)
      : (foes.find((p) => p.role === myRole) ?? null)
  const enemyJIdx = enemyJ ? facts.players.indexOf(enemyJ) : -1
  const minutes = facts.duration / 60
  const hasTimeline = facts.frames.length >= 5
  // Achats connus (journal enregistré par l'app pendant la partie) : l'historique du client ne
  // les fournit pas, sans journal on ne connaît que les objets de fin de partie.
  const hasItems = facts.items.length > 0
  const bench =
    (champ && catalog.benchmarks?.[champ.id]) ??
    catalog.benchmarks?.['_all'] ??
    DEFAULT_BENCH_BY_ROLE[myRole]
  const benchSource =
    bench === DEFAULT_BENCH_BY_ROLE[myRole]
      ? 'défaut'
      : catalog.statsBracket === 'gold'
        ? 'gold'
        : 'master'
  benchLabel = benchSource === 'gold' ? tr('Or à Émeraude', 'Gold to Emerald') : 'Master+'
  const findings: Finding[] = []
  const push = (f: Finding): void => {
    findings.push(f)
  }
  const sub: Record<Category, number[]> = {
    farm: [],
    build: [],
    fights: [],
    objectives: [],
    vision: []
  }
  const frameVal = (min: number, idx: number, k: number): number | null =>
    facts.frames.length > min && idx >= 0 ? facts.frames[min][idx][k] : null

  // --- Farm et avance sur le jungler adverse ---
  const csPerMin = (me.cs + me.jcs) / Math.max(minutes, 1)
  const cs10 = frameVal(10, meIdx, 2)
  const cs15 = frameVal(15, meIdx, 2)
  const csDiff10 = cs10 !== null && enemyJIdx >= 0 ? cs10 - frameVal(10, enemyJIdx, 2)! : null
  const gold15 = frameVal(15, meIdx, 0)
  const goldDiff15 = gold15 !== null && enemyJIdx >= 0 ? gold15 - frameVal(15, enemyJIdx, 0)! : null
  const level15 = frameVal(15, meIdx, 3)
  const levelDiff15 =
    level15 !== null && enemyJIdx >= 0 ? level15 - frameVal(15, enemyJIdx, 3)! : null
  const ejName = enemyJ
    ? (gd.champions.get(enemyJ.champ)?.label ??
      (jungle
        ? tr('le jungler adverse', 'the enemy jungler')
        : tr('ton adversaire direct', 'your lane opponent')))
    : ''

  // Support : le farm ne compte pas (il revient aux autres postes). Modes : pas de farm de voie.
  const farms = myRole !== 'support' && !mode
  // Or et dégâts aux champions par minute, et part des dégâts de l'équipe.
  const goldPerMin = me.gold / Math.max(minutes, 1)
  const dmg = me.phys + me.magic
  const dmgPerMin = dmg / Math.max(minutes, 1)
  const teamDmg = facts.players
    .filter((p) => p.team === me.team)
    .reduce((t, p) => t + p.phys + p.magic, 0)
  const dmgShare = teamDmg > 0 ? dmg / teamDmg : 0
  if (mode) {
    const bGold = bench.goldPerMin ?? MODE_BENCH.goldPerMin!
    const bDmg = bench.dmgPerMin ?? MODE_BENCH.dmgPerMin!
    const bShare = bench.dmgShare ?? MODE_BENCH.dmgShare!
    sub.farm.push(rate(goldPerMin, bGold))
    // Tanks et soutiens : moins de dégâts, plus de dégâts subis ; on ne juge les dégâts que pour
    // les champions qui en font habituellement.
    const dealer = bShare >= 0.17
    if (dealer) sub.farm.push(rate(dmgPerMin, bDmg))
    if (dealer && dmgPerMin < bDmg * 0.7 && minutes >= 10)
      push({
        id: 'mode-dmg-low',
        cat: 'farm',
        tone: 'bad',
        title: tr(
          `Peu de dégâts : ${fmtNumber(Math.round(dmgPerMin))} par minute`,
          `Low damage: ${fmtNumber(Math.round(dmgPerMin))} per minute`
        ),
        detail: bench_(`${fmtNumber(Math.round(bDmg))} / min`),
        impact: 0.55
      })
    else if (dealer && dmgPerMin >= bDmg * 1.2)
      push({
        id: 'mode-dmg-good',
        cat: 'farm',
        tone: 'good',
        title: tr(
          `Beaucoup de dégâts : ${fmtPct(dmgShare)} de ceux de l’équipe`,
          `High damage: ${fmtPct(dmgShare)} of your team’s`
        ),
        detail: bench_(`${fmtNumber(Math.round(bDmg))} / min`),
        impact: 0.45
      })
    if (goldPerMin < bGold * 0.85 && minutes >= 10)
      push({
        id: 'mode-gold-low',
        cat: 'farm',
        tone: 'bad',
        title: tr(
          `Peu d’or : ${fmtNumber(Math.round(goldPerMin))} par minute`,
          `Low gold: ${fmtNumber(Math.round(goldPerMin))} per minute`
        ),
        detail: bench_(`${fmtNumber(Math.round(bGold))} / min`),
        impact: 0.4
      })
  }
  if (cs10 !== null && farms) {
    const s = rate(cs10, bench.cs10)
    sub.farm.push(s)
    if (s < 45)
      push({
        id: 'cs-low',
        cat: 'farm',
        tone: 'bad',
        title: tr(`Farm faible : ${cs10} cs à 10 min`, `Low farm: ${cs10} CS at 10 min`),
        detail: bench_(`${Math.round(bench.cs10)} cs`),
        impact: 0.6 + (45 - s) / 100
      })
    else if (s >= 85)
      push({
        id: 'cs-good',
        cat: 'farm',
        tone: 'good',
        title: tr(`Très bon farm : ${cs10} cs à 10 min`, `Great farm: ${cs10} CS at 10 min`),
        detail: bench_(`${Math.round(bench.cs10)} cs`),
        impact: 0.5
      })
  } else if (farms) {
    sub.farm.push(rate(csPerMin, bench.cs15 / 15))
  }
  if (cs15 !== null && farms) sub.farm.push(rate(cs15, bench.cs15))
  if (goldDiff15 !== null) {
    sub.farm.push(Math.max(0, Math.min(100, 70 + goldDiff15 / 30)))
    if (goldDiff15 <= -800)
      push({
        id: 'gold-behind',
        cat: 'farm',
        tone: 'bad',
        title: tr(
          `En retard sur ${ejName} : ${signed(goldDiff15)} à 15 min`,
          `Behind ${ejName}: ${signed(goldDiff15)} at 15 min`
        ),
        detail:
          levelDiff15 !== null && levelDiff15 < 0
            ? tr(`${-levelDiff15} niveau(x) de retard.`, `${-levelDiff15} level(s) behind.`)
            : undefined,
        impact: 0.6 + Math.min(0.4, -goldDiff15 / 5000)
      })
    else if (goldDiff15 >= 600)
      push({
        id: 'gold-ahead',
        cat: 'farm',
        tone: 'good',
        title: tr(
          `En avance sur ${ejName} : ${signed(goldDiff15)} à 15 min`,
          `Ahead of ${ejName}: ${signed(goldDiff15)} at 15 min`
        ),
        impact: 0.5 + Math.min(0.4, goldDiff15 / 5000)
      })
  }

  // --- Build : rythme d'achat, choix d'objets, anti-soins, résistances ---
  const buys = purchasesOf(facts, me.pid)
  const legendaryBuys = buys.filter((b) => gd.items.get(b.id)?.isLegendary)
  const seen = new Set<number>()
  const legendaries: ItemInfo[] = []
  const legendaryTimes: number[] = []
  for (const b of legendaryBuys) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    legendaries.push(gd.items.get(b.id)!)
    legendaryTimes.push(b.t)
  }
  if (!hasItems) {
    // Sans journal : objets de fin de partie.
    for (const id of me.items) {
      const it = gd.items.get(id)
      if (it?.isLegendary && !seen.has(id)) {
        seen.add(id)
        legendaries.push(it)
      }
    }
  }
  const firstItemMin = legendaryTimes[0] !== undefined ? legendaryTimes[0] / 60 : null
  const secondItemMin = legendaryTimes[1] !== undefined ? legendaryTimes[1] / 60 : null
  if (hasItems) {
    if (firstItemMin !== null) {
      const s = rate(firstItemMin, bench.firstItem, true)
      sub.build.push(s)
      if (firstItemMin > bench.firstItem + 2.5)
        push({
          id: 'first-item-late',
          cat: 'build',
          tone: 'bad',
          title: tr(
            `1er objet tardif : ${fr1(firstItemMin)} min`,
            `Late 1st item: ${fr1(firstItemMin)} min`
          ),
          detail: bench_(`${fr1(bench.firstItem)} min`),
          impact: 0.5 + Math.min(0.3, (firstItemMin - bench.firstItem) / 20)
        })
      else if (firstItemMin <= bench.firstItem - 0.5)
        push({
          id: 'first-item-fast',
          cat: 'build',
          tone: 'good',
          title: tr(
            `1er objet rapide : ${fr1(firstItemMin)} min`,
            `Fast 1st item: ${fr1(firstItemMin)} min`
          ),
          impact: 0.4
        })
    } else if (minutes >= 16) {
      sub.build.push(15)
      push({
        id: 'first-item-late',
        cat: 'build',
        tone: 'bad',
        title: tr('Aucun objet légendaire terminé', 'No legendary item completed'),
        impact: 0.8
      })
    }
    if (secondItemMin !== null) sub.build.push(rate(secondItemMin, bench.secondItem, true))
  }

  // Conformité aux conseils de l'app, achat par achat (inventaires reconstitués).
  const purchases: PurchaseCheck[] = []
  const found = champ ? getBuild(catalog, champ, jungle) : null
  const baseBuild = found?.build ?? null
  // Hors jungle, sans départ dans la méta : départ habituel du poste.
  const build =
    baseBuild && !jungle && !baseBuild.start?.length
      ? { ...baseBuild, start: defaultStart(baseBuild.archetype, myRole) }
      : baseBuild
  const enemyKeys = foes.map((p) => p.champ)
  const allyKeys = allies.map((p) => p.champ)
  const directFoe = enemyJ ? (gd.champions.get(enemyJ.champ) ?? null) : null
  // Conseil de l'app à un instant de la partie, calculé comme en jeu : famille de build choisie
  // selon la partie (puis suivie une fois commencée), choix adaptés aux adversaires, objets face
  // aux adversaires.
  const planAt = (live: LiveGameData, meLive: LivePlayer | null, gold: number): ItemPlan => {
    const threat = analyzeThreat(gd, enemyKeys, allyKeys, live, champ!.id, catalog.profiles)
    const variant = chooseVariant(
      gd,
      build!,
      threat,
      meLive,
      catalog.itemCounters,
      catalog.tuning,
      catalog.priors
    )
    const b = found?.generic
      ? variant.build
      : adaptChoices(
          variant.build,
          threat,
          directFoe,
          variant.chosen?.variant.runeChoices,
          catalog.tuning,
          catalog.priors,
          build!.winRate
        ).build
    return buildItemPlan(
      gd,
      b,
      threat,
      meLive,
      gold,
      undefined,
      catalog.itemCounters,
      tw(catalog.tuning, 'counter')
    )
  }
  if (!hasItems && build && champ && legendaries.length > 0) {
    // Sans minutage : build final comparé au conseil calculé avec les objets de fin de partie de
    // tous les joueurs (votre inventaire sans vos objets légendaires).
    const t = facts.duration
    const live = liveAt(gd, facts, t, true)
    const meLive = live.allPlayers.find((p) => p.riotId === live.activePlayer?.riotId) ?? null
    if (meLive) meLive.items = meLive.items.filter((i) => !gd.items.get(i.itemID)?.isLegendary)
    const plan = planAt(live, meLive, 0)
    const pending = plan.steps.filter((s) => !s.owned && s.item.isLegendary).map((s) => s.item)
    const firstN = pending.slice(0, legendaries.length)
    const missing = firstN.filter((x) => !legendaries.some((l) => l.id === x.id))
    for (const item of legendaries) {
      const same = (x: ItemInfo): boolean => x.id === item.id || x.name === item.name
      const status: PurchaseCheck['status'] = firstN.some(same)
        ? 'follow'
        : pending.some(same) || plan.alternatives.some((a) => same(a.item))
          ? 'plan'
          : 'off'
      purchases.push({
        t: -1,
        item,
        status,
        suggested: status === 'follow' ? null : (missing.shift() ?? null)
      })
    }
  }
  if (hasItems && build && champ) {
    const done = new Set<number>()
    for (const b of legendaryBuys) {
      if (done.has(b.id)) continue
      done.add(b.id)
      const t = Math.max(0, b.t - 1)
      const live = liveAt(gd, facts, t)
      const meLive = live.allPlayers.find((p) => p.riotId === live.activePlayer?.riotId) ?? null
      const plan = planAt(live, meLive, live.activePlayer?.currentGold ?? 0)
      const pending = plan.steps.filter((s) => !s.owned && s.item.isLegendary)
      const item = gd.items.get(b.id)!
      const same = (x: ItemInfo): boolean => x.id === item.id || x.name === item.name
      const status: PurchaseCheck['status'] =
        pending[0] && same(pending[0].item)
          ? 'follow'
          : pending.some((s) => same(s.item)) || plan.alternatives.some((s) => same(s.item))
            ? 'plan'
            : 'off'
      purchases.push({ t: b.t, item, status, suggested: pending[0]?.item ?? null })
    }
  }
  const adherence = purchases.length
    ? purchases.reduce(
        (s, p) => s + (p.status === 'follow' ? 1 : p.status === 'plan' ? 0.6 : 0),
        0
      ) / purchases.length
    : null
  if (adherence !== null) {
    sub.build.push(30 + adherence * 70)
    const off = purchases.filter((p) => p.status === 'off')
    if (off.length >= 2 || (off.length === 1 && purchases.length <= 2))
      push({
        id: 'off-build',
        cat: 'build',
        tone: 'bad',
        title: tr(
          `${off.length} objet(s) hors du build conseillé`,
          `${off.length} item(s) outside the suggested build`
        ),
        detail: off
          .map(
            (p) =>
              `${p.item.label}${p.suggested ? ` (${tr('conseillé', 'suggested')}: ${p.suggested.label})` : ''}`
          )
          .join(' · '),
        impact: 0.35 + 0.1 * off.length
      })
    else if (adherence >= 0.8 && purchases.length >= 2)
      push({
        id: 'follow-build',
        cat: 'build',
        tone: 'good',
        title: tr('Build adapté à la partie', 'Build adapted to the game'),
        detail: tr(
          'Vos achats suivent les conseils calculés pour cette composition.',
          'Your purchases follow the advice computed for this team comp.'
        ),
        impact: 0.35
      })
  }

  // Anti-soins : besoin estimé comme l'app le fait avant la partie.
  const preThreat = analyzeThreat(
    gd,
    foes.map((p) => p.champ),
    allies.map((p) => p.champ),
    null,
    champ?.id ?? null,
    catalog.profiles
  )
  const grievousBuy = buys.find((b) => gd.items.get(b.id)?.grievous)
  const ownsGrievous = !!grievousBuy || me.items.some((id) => gd.items.get(id)?.grievous)
  if (preThreat.metrics.heal >= 0.55 && minutes >= 18) {
    const healers = [...foes]
      .sort((a, b) => b.heal - a.heal)
      .slice(0, 2)
      .map((p) => gd.champions.get(p.champ)?.label)
      .filter(Boolean)
      .join(', ')
    if (!ownsGrievous) {
      sub.build.push(25)
      push({
        id: 'no-antiheal',
        cat: 'build',
        tone: 'bad',
        title: tr('Pas d’anti-soins', 'No anti-heal'),
        detail: tr(`Soins adverses importants (${healers}).`, `Strong enemy healing (${healers}).`),
        impact: 0.7
      })
    } else if (grievousBuy && grievousBuy.t > 18 * 60) {
      push({
        id: 'no-antiheal',
        cat: 'build',
        tone: 'bad',
        title: tr(
          `Anti-soins tardif (${fmtMin(grievousBuy.t)})`,
          `Late anti-heal (${fmtMin(grievousBuy.t)})`
        ),
        detail: tr(
          `Soins adverses importants (${healers}) : composant dès le 1er ou 2e retour.`,
          `Strong enemy healing (${healers}): component on your 1st or 2nd back.`
        ),
        impact: 0.45
      })
    } else {
      push({
        id: 'antiheal-ok',
        cat: 'build',
        tone: 'good',
        title: tr('Anti-soins pris à temps', 'Anti-heal on time'),
        detail: healers ? tr(`Face à ${healers}.`, `Against ${healers}.`) : undefined,
        impact: 0.35
      })
    }
  }

  // Résistances face aux dégâts réellement subis (si beaucoup de morts).
  const foePhys = foes.reduce((s, p) => s + p.phys, 0)
  const foeMagic = foes.reduce((s, p) => s + p.magic, 0)
  const magicShare = foePhys + foeMagic > 0 ? foeMagic / (foePhys + foeMagic) : 0.5
  const finalItems = me.items.map((id) => gd.items.get(id)).filter((i): i is ItemInfo => !!i)
  const hasStat = (k: string): boolean =>
    finalItems.some((i) => (i.isLegendary || i.isBoots) && (i.stats[k] ?? 0) > 0)
  if (me.d >= 6 && minutes >= 20 && build?.archetype !== 'ENCHANTER') {
    if (magicShare >= 0.62 && !hasStat('FlatSpellBlockMod'))
      push({
        id: 'no-mr',
        cat: 'build',
        tone: 'bad',
        title: tr('Aucune résistance magique', 'No magic resist'),
        detail: tr(
          `${fmtPct(magicShare)} des dégâts adverses étaient magiques et vous êtes mort ${me.d} fois.`,
          `${fmtPct(magicShare)} of enemy damage was magic and you died ${me.d} times.`
        ),
        impact: 0.6
      })
    else if (magicShare <= 0.38 && !hasStat('FlatArmorMod'))
      push({
        id: 'no-armor',
        cat: 'build',
        tone: 'bad',
        title: tr('Aucune armure', 'No armor'),
        detail: tr(
          `${fmtPct(1 - magicShare)} des dégâts adverses étaient physiques et vous êtes mort ${me.d} fois.`,
          `${fmtPct(1 - magicShare)} of enemy damage was physical and you died ${me.d} times.`
        ),
        impact: 0.6
      })
  }

  // --- Combats et morts ---
  const teamKills = facts.players.filter((p) => p.team === me.team).reduce((s, p) => s + p.k, 0)
  const kp = teamKills > 0 ? (me.k + me.a) / teamKills : 0
  sub.fights.push(rate(kp, bench.kp))
  if (teamKills >= 8) {
    if (kp < bench.kp * 0.75)
      push({
        id: 'kp-low',
        cat: 'fights',
        tone: 'bad',
        title: tr(
          `Participation faible : ${fmtPct(kp)} des éliminations`,
          `Low kill participation: ${fmtPct(kp)}`
        ),
        detail: bench_(fmtPct(bench.kp)),
        impact: 0.55
      })
    else if (kp >= bench.kp * 1.1)
      push({
        id: 'kp-good',
        cat: 'fights',
        tone: 'good',
        title: tr(
          `Très présent : ${fmtPct(kp)} des éliminations`,
          `High kill participation: ${fmtPct(kp)}`
        ),
        impact: 0.45
      })
  }
  const deathsPer10 = (me.d / Math.max(minutes, 1)) * 10
  // Repère de morts : celui du mode (on meurt bien plus souvent en ARAM), sinon 1,6 / 10 min.
  const deathsTarget = mode ? (bench.deathsPer10 ?? MODE_BENCH.deathsPer10!) : 1.6
  sub.fights.push(rate(deathsPer10, deathsTarget, true))
  const myDeaths = facts.kills.filter((k) => k[2] === me.pid)
  const earlyDeaths = myDeaths.filter((k) => k[0] < 14 * 60).length
  let deathsWithGold = 0
  let worstGold = 0
  if (hasTimeline) {
    for (const [t] of myDeaths) {
      // Journal : or relevé juste avant la mort. Sinon, estimation prudente entre la minute
      // précédente et la suivante (l'or ne baisse qu'en achetant).
      const g = facts.gold?.length
        ? goldAt(facts, t - 1, meIdx)
        : Math.min(
            frameAt(facts, t)?.[meIdx]?.[1] ?? 0,
            frameAt(facts, t + 60)?.[meIdx]?.[1] ?? Infinity
          )
      if (g >= 1400) {
        deathsWithGold++
        worstGold = Math.max(worstGold, g)
      }
    }
    if (mode) {
      // Pas de début de partie en voie ni de retour à la base : rien à juger ici.
    } else if (earlyDeaths >= 3) {
      sub.fights.push(25)
      push({
        id: 'early-deaths',
        cat: 'fights',
        tone: 'bad',
        title: tr(`${earlyDeaths} morts avant 14 min`, `${earlyDeaths} deaths before 14 min`),
        detail: tr(
          jungle
            ? 'Chaque mort en début de partie donne de l’avance au jungler adverse.'
            : 'Chaque mort en début de partie donne de l’avance à ton adversaire de voie.',
          jungle
            ? 'Every early death gives the enemy jungler a lead.'
            : 'Every early death gives your lane opponent a lead.'
        ),
        impact: 0.6 + 0.08 * earlyDeaths
      })
    } else if (earlyDeaths === 0 && minutes >= 15) {
      push({
        id: 'safe-early',
        cat: 'fights',
        tone: 'good',
        title: tr('Aucune mort avant 14 min', 'No death before 14 min'),
        impact: 0.35
      })
    }
    // Sans retour à la base (ARAM), l'or ne se dépense qu'à la mort : rien d'anormal.
    if (deathsWithGold >= 2 && (!mode || mode.recall))
      push({
        id: 'deaths-gold',
        cat: 'fights',
        tone: 'bad',
        title: tr(
          `${deathsWithGold} morts avec beaucoup d’or non dépensé`,
          `${deathsWithGold} deaths with lots of unspent gold`
        ),
        detail: tr(
          `Jusqu’à ${gold(worstGold)} en poche au moment de mourir.`,
          `Up to ${gold(worstGold)} in your pocket when you died.`
        ),
        impact: 0.55
      })
  }
  if (mode ? deathsPer10 >= deathsTarget * 1.5 && me.d >= 8 : me.d >= 9)
    push({
      id: 'many-deaths',
      cat: 'fights',
      tone: 'bad',
      title: tr(`${me.d} morts`, `${me.d} deaths`),
      detail: tr(
        `${fr1(deathsPer10)} morts toutes les 10 min (repère : moins de ${fr1(deathsTarget)}).`,
        `${fr1(deathsPer10)} deaths per 10 min (benchmark: under ${fr1(deathsTarget)}).`
      ),
      impact: 0.5 + Math.min(0.3, (me.d - 9) * 0.05)
    })
  else if (mode ? deathsPer10 <= deathsTarget * 0.6 && minutes >= 12 : me.d <= 2 && minutes >= 22)
    push({
      id: 'few-deaths',
      cat: 'fights',
      tone: 'good',
      title: tr(`Seulement ${me.d} mort(s)`, `Only ${me.d} death(s)`),
      impact: 0.4
    })

  // Or non dépensé (gestion des retours).
  let unspentShare: number | null = null
  // Sans retour à la base, on ne peut acheter qu'à la mort : l'or en poche n'est pas une faute.
  if (hasTimeline && facts.frames.length > 10 && (!mode || mode.recall)) {
    const late = facts.gold?.length
      ? facts.gold.filter(([t]) => t >= 6 * 60).map(([, g]) => g)
      : facts.frames.slice(6).map((f) => f[meIdx][1])
    unspentShare = late.length >= 5 ? late.filter((g) => g >= 1500).length / late.length : null
    if (unspentShare !== null) sub.farm.push(Math.max(10, 100 - unspentShare * 220))
    if (unspentShare !== null && unspentShare >= 0.25)
      push({
        id: 'unspent-gold',
        cat: 'farm',
        tone: 'bad',
        title: tr(
          `Or non dépensé ${fmtPct(unspentShare)} du temps`,
          `Unspent gold ${fmtPct(unspentShare)} of the time`
        ),
        detail: tr(
          `Plus de ${gold(1500)} en poche : un retour plus tôt aurait donné un objet d’avance.`,
          `Over ${gold(1500)} in your pocket: an earlier back would have given you an item lead.`
        ),
        impact: 0.4 + unspentShare * 0.5
      })
  }

  // --- Objectifs ---
  const team = emptyCount()
  const enemy = emptyCount()
  let smited = 0
  for (const [, killer, tm, kind] of facts.monsters) {
    if (tm === me.team) team[kind]++
    else enemy[kind]++
    if (killer === me.pid) smited++
  }
  const wsum = (c: ObjectiveCount): number =>
    (Object.keys(c) as MonsterKind[]).reduce((s, k) => s + c[k] * OBJ_WEIGHT[k], 0)
  const totalObj = wsum(team) + wsum(enemy)
  if (totalObj > 0) {
    const share = wsum(team) / totalObj
    sub.objectives.push(15 + share * 85)
    const dragons = `${team.dragon + team.elder}/${enemy.dragon + enemy.elder}`
    if (totalObj >= 3 && share <= 0.35)
      push({
        id: 'objectives-lost',
        cat: 'objectives',
        tone: 'bad',
        title: tr(`Objectifs perdus (dragons ${dragons})`, `Objectives lost (dragons ${dragons})`),
        detail: tr(
          `Votre équipe : ${fmtPct(share)} des objectifs neutres.`,
          `Your team: ${fmtPct(share)} of neutral objectives.`
        ),
        impact: 0.55 + (0.35 - share)
      })
    else if (totalObj >= 3 && share >= 0.65)
      push({
        id: 'objectives-won',
        cat: 'objectives',
        tone: 'good',
        title: tr(
          `Contrôle des objectifs (dragons ${dragons})`,
          `Objective control (dragons ${dragons})`
        ),
        detail: tr(
          `Votre équipe : ${fmtPct(share)} des objectifs neutres.`,
          `Your team: ${fmtPct(share)} of neutral objectives.`
        ),
        impact: 0.5 + (share - 0.65)
      })
    if (enemy.grubs >= 5 && team.grubs <= 1 && (jungle || myRole === 'top'))
      push({
        id: 'grubs-lost',
        cat: 'objectives',
        tone: 'bad',
        title: `${tr('Larves du Néant', 'Voidgrubs')}: ${team.grubs}/${enemy.grubs}`,
        impact: 0.35
      })
    if (smited >= 4)
      push({
        id: 'smite',
        cat: 'objectives',
        tone: 'good',
        title: tr(
          `${smited} objectifs sécurisés au Châtiment`,
          `${smited} objectives secured with Smite`
        ),
        impact: 0.3
      })
  }

  // --- Vision ---
  const visionPerMin = me.vision / Math.max(minutes, 1)
  // Le nombre de balises de l'historique du client n'est pas fiable (souvent 0, parfois absurde) :
  // on ne le compte que s'il vient du journal enregistré pendant la partie.
  const controlWardsPer10 = facts.controlWardsKnown
    ? (me.controlWards / Math.max(minutes, 1)) * 10
    : null
  sub.vision.push(rate(visionPerMin, bench.visionPerMin))
  if (controlWardsPer10 !== null) sub.vision.push(rate(controlWardsPer10, bench.controlWardsPer10))
  if (controlWardsPer10 !== null && me.controlWards === 0 && minutes >= 20)
    push({
      id: 'no-control-ward',
      cat: 'vision',
      tone: 'bad',
      title: tr('Aucune balise de contrôle achetée', 'No control ward bought'),
      impact: 0.45
    })
  else if (visionPerMin < bench.visionPerMin * 0.7)
    push({
      id: 'vision-low',
      cat: 'vision',
      tone: 'bad',
      title: tr(
        `Vision faible : ${fr1(visionPerMin)} / min`,
        `Low vision: ${fr1(visionPerMin)} / min`
      ),
      detail: bench_(`${fr1(bench.visionPerMin)} / min`),
      impact: 0.35
    })
  else if (visionPerMin >= bench.visionPerMin * 1.15)
    push({
      id: 'vision-good',
      cat: 'vision',
      tone: 'good',
      title: tr(
        `Bonne vision : ${fr1(visionPerMin)} / min`,
        `Good vision: ${fr1(visionPerMin)} / min`
      ),
      impact: 0.3
    })

  // Modes sans objectifs ni vision (ARAM…) : ces catégories ne comptent pas.
  if (mode) {
    sub.objectives = []
    sub.vision = []
    for (let i = findings.length - 1; i >= 0; i--)
      if (findings[i].cat === 'objectives' || findings[i].cat === 'vision') findings.splice(i, 1)
  }
  const scores: Partial<Record<Category, number>> = {}
  for (const c of Object.keys(sub) as Category[])
    if (sub[c].length) scores[c] = Math.round(mean(sub[c]))
  const WEIGHTS = mode ? MODE_WEIGHTS : CATEGORY_WEIGHTS[myRole as Lane]
  let wTotal = 0
  let sTotal = 0
  for (const [c, s] of Object.entries(scores) as [Category, number][]) {
    wTotal += WEIGHTS[c]
    sTotal += WEIGHTS[c] * s
  }
  const overall = wTotal > 0 ? Math.round(sTotal / wTotal) : 50

  findings.sort((a, b) => b.impact - a.impact)
  return {
    facts,
    role: myRole,
    champ,
    enemyJungler: enemyJ ? (gd.champions.get(enemyJ.champ) ?? null) : null,
    win: me.win,
    kda: `${me.k}/${me.d}/${me.a}`,
    minutes,
    scores,
    overall,
    grade: gradeOf(overall),
    findings,
    purchases,
    adherence,
    objectives: { team, enemy, smited },
    stats: {
      csPerMin,
      cs10,
      cs15,
      csDiff10,
      goldDiff15,
      levelDiff15,
      kp,
      visionPerMin,
      controlWardsPer10,
      firstItemMin,
      secondItemMin,
      deathsWithGold,
      earlyDeaths,
      unspentShare,
      goldPerMin,
      dmgPerMin,
      dmgShare,
      deathsPer10
    },
    legendaries,
    bench,
    benchSource,
    hasTimeline,
    hasItems,
    augments: (me.augments ?? []).map((id) => {
      const info = catalog.augmentInfo?.[id] ?? null
      const own = champ ? catalog.builds.get(champ.id)?.augments?.find((a) => a.id === id) : null
      return { id, info, lift: own?.lift ?? info?.lift ?? null }
    })
  }
}

/** Conseil d'un point faible, avec les repères remplacés. */
/** Conseils des modes sans voie (ARAM…), à la place des conseils de la Faille. */
const MODE_TIPS: Record<string, [string, string]> = {
  'mode-dmg-low': [
    'Reste à portée des combats : en ARAM, les dégâts viennent des échanges permanents, pas des coups isolés.',
    'Stay in range of the fights: in ARAM, damage comes from constant trades, not isolated hits.'
  ],
  'mode-gold-low': [
    'Participe aux éliminations et ramasse les vagues proches : l’or vient surtout des combats.',
    'Take part in kills and clear nearby waves: gold mostly comes from fights.'
  ],
  'kp-low': [
    'Joue avec ton équipe : un joueur isolé sur l’Abîme meurt sans rien rapporter.',
    'Play with your team: an isolated player on the Abyss dies for nothing.'
  ],
  'many-deaths': [
    'Garde un sort de mobilité pour reculer, et reviens au combat quand ton équipe est là.',
    'Keep a mobility spell to back off, and re-engage when your team is there.'
  ],
  'first-item-late': [
    'Pas de retour en base : achète à chaque mort, et prends les packs de soin au lieu de reculer.',
    'No recall: buy on each death, and grab health relics instead of backing off.'
  ]
}

export function tipFor(id: string, bench: Benchmark, role: Role = 'jungle'): string | undefined {
  const tip = (isMode(role) ? MODE_TIPS[id] : undefined) ?? ROLE_TIPS[role]?.[id] ?? TIPS[id]
  return tip ? tr(...tip).replace('{first}', fr1(bench.firstItem)) : undefined
}

/** Identifiant de l'objet balise de contrôle (pour les rappels en partie). */
export const CONTROL_WARD_ID = CONTROL_WARD
