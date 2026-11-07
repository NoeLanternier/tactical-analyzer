import { useEffect, useState } from 'react'
import { defaultCatalog, mergeOverride, roleBaseCatalog, type Catalog } from '../engine/catalog'
import { GOLD_MIN_GAMES } from '../engine/metaLevel'
import { roleMetaUrl, type Role } from '../engine/role'

// Méta distante (meta.json ou meta-gold.json) : copie locale d'abord (démarrage immédiat, hors
// ligne), puis la version en ligne au démarrage et toutes les 3 heures.

export interface RemoteMetaInfo {
  accepted: number
  rejected: number
  sampleGames: number | null
  generatedAt: string | null
  /** Copie locale (date d'enregistrement) en attendant la version en ligne. */
  cachedAt: string | null
}

export interface RemoteMeta {
  url: string
  /** JSON reçu (pour le superposer à une autre méta). */
  data: unknown
  /** Méta seule, superposée à la base intégrée. */
  catalog: Catalog | null
  error?: string
  info?: RemoteMetaInfo
}

function toRemote(
  url: string,
  data: unknown,
  cachedAt: string | null,
  jungle: boolean
): RemoteMeta {
  // Jungle : superposée aux builds intégrés ; autres postes : la méta du poste seule.
  const merged = mergeOverride(jungle ? defaultCatalog() : roleBaseCatalog(), data)
  return {
    url,
    data,
    catalog: merged.catalog,
    info: {
      accepted: merged.accepted,
      rejected: merged.rejected,
      sampleGames: merged.sampleGames,
      generatedAt: merged.generatedAt,
      cachedAt
    }
  }
}

export function useRemoteMeta(url: string | null, jungle = true): RemoteMeta | null {
  const [state, setState] = useState<RemoteMeta | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    void window.api.getCachedMeta(url).then((cached) => {
      if (cancelled || !cached) return
      setState((prev) =>
        prev?.url === url && prev.catalog
          ? prev
          : toRemote(url, cached.data, cached.savedAt, jungle)
      )
    })
    const refresh = (): void => {
      void window.api.fetchMetaOverride(url).then((res) => {
        if (cancelled) return
        if (!res.ok) {
          // On garde la dernière méta reçue si elle existe.
          setState((prev) =>
            prev?.url === url && prev.catalog
              ? prev
              : { url, data: null, catalog: null, error: res.error ?? '?' }
          )
          return
        }
        setState(toRemote(url, res.data, null, jungle))
      })
    }
    refresh()
    const timer = setInterval(refresh, 3 * 3600 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [url, jungle])
  return url && state?.url === url ? state : null
}

/**
 * Métas d'autres postes (bilans des parties jouées à un autre poste que le poste actuel) :
 * Master+, et Or à Émeraude par-dessus si le niveau des données est Or. Copie locale d'abord, puis
 * version en ligne, une fois.
 */
export function useRoleCatalogs(
  roles: Role[],
  metaUrl: string,
  level: 'master' | 'gold'
): Map<Role, Catalog> {
  const [catalogs, setCatalogs] = useState<{ key: string; map: Map<Role, Catalog> }>({
    key: '',
    map: new Map()
  })
  const key = `${[...roles].sort().join(',')}|${metaUrl}|${level}`
  useEffect(() => {
    if (!roles.length || !metaUrl) return
    let cancelled = false
    const load = async (url: string | null): Promise<unknown> => {
      if (!url) return null
      const online = await window.api.fetchMetaOverride(url).catch(() => null)
      if (online?.ok) return online.data
      return (await window.api.getCachedMeta(url).catch(() => null))?.data ?? null
    }
    void (async () => {
      const map = new Map<Role, Catalog>()
      for (const role of roles) {
        const jungle = role === 'jungle'
        const base = jungle ? defaultCatalog() : roleBaseCatalog()
        const master = await load(roleMetaUrl(metaUrl, role, false))
        let catalog = master ? mergeOverride(base, master).catalog : base
        if (level === 'gold') {
          const gold = await load(roleMetaUrl(metaUrl, role, true))
          const merged = gold ? mergeOverride(catalog, gold) : null
          if (merged && (merged.sampleGames ?? 0) >= GOLD_MIN_GAMES) catalog = merged.catalog
        }
        map.set(role, catalog)
      }
      if (!cancelled) setCatalogs({ key, map })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key résume roles, metaUrl et level
  }, [key])
  return catalogs.key === key ? catalogs.map : NO_CATALOGS
}

const NO_CATALOGS = new Map<Role, Catalog>()
