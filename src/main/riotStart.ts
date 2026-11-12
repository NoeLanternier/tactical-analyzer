import { net } from 'electron'
import type { RiotStartBundles } from '../shared/types'
import { extractRiotStart } from '../shared/riotStart'
import { RIOT_COMPLIANT } from '../shared/edition'
import { loadMetaCache, saveMetaCache } from './metaCache'
import { debugLog } from './logger'

// Départs proposés par la boutique du jeu (édition personnelle) : données du jeu, lues sur
// CommunityDragon (miroir communautaire des fichiers du jeu, hors API officielle de Riot). Seuls
// certains champions en ont (Veigar, Ahri, Teemo…) ; les autres reçoivent des recommandations
// calculées par le jeu, que l'app remplace par les départs des joueurs (méta).

const DAY = 24 * 3600 * 1000
const urlOf = (alias: string): string => {
  const a = alias.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `https://raw.communitydragon.org/latest/game/data/characters/${a}/${a}.bin.json`
}

export async function getRiotStart(alias: string): Promise<RiotStartBundles | null> {
  if (RIOT_COMPLIANT || !alias) return null
  const url = urlOf(alias)
  // Copie locale par carte et mode (v2) : les anciennes copies ne gardaient que la Faille.
  const key = `${url}#v2`
  const cached = loadMetaCache(key)
  if (cached && Date.now() - Date.parse(cached.savedAt) < DAY)
    return cached.data as RiotStartBundles
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await net.fetch(url, { signal: controller.signal })
    // Champion absent (404) : liste vide, gardée en cache pour ne pas redemander.
    const data = res.ok ? extractRiotStart(await res.json()) : res.status === 404 ? [] : null
    if (data) saveMetaCache(key, data)
    return data ?? (cached?.data as RiotStartBundles) ?? null
  } catch (error) {
    debugLog('riotStart', { alias, error: String(error) })
    return (cached?.data as RiotStartBundles) ?? null
  } finally {
    clearTimeout(timeout)
  }
}
