import type { RiotStartBundles } from './types'

// Lecture des départs de la boutique dans un fichier de champion du jeu (format CommunityDragon).

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Départs de la boutique, pour chaque carte et mode (Faille CLASSIC, Abîme hurlant ARAM, ARAM
 * Mayhem « KIWI »…), par poste (null : tous les postes).
 */
export function extractRiotStart(bin: any): RiotStartBundles {
  const out: RiotStartBundles = []
  for (const v of Object.values<any>(bin ?? {})) {
    if (v?.__type !== 'ItemRecommendationOverrideSet' || !Array.isArray(v.mOverrides)) continue
    for (const o of v.mOverrides) {
      if (!Array.isArray(o?.StartingItemBundles)) continue
      const bundles = o.StartingItemBundles.map((b: any) =>
        (Array.isArray(b?.items) ? b.items : [])
          .map((x: unknown) => Number(String(x).replace(/^Items\//, '')))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      ).filter((b: number[]) => b.length > 0)
      if (!bundles.length) continue
      for (const ctx of o.mOverrideContexts ?? []) {
        const map = Number(ctx?.mMapID)
        const mode = typeof ctx?.mModeNameStringId === 'string' ? ctx.mModeNameStringId : ''
        if (!map || !mode) continue
        out.push({
          position: typeof ctx.mPosition === 'string' ? ctx.mPosition : null,
          map,
          mode,
          bundles
        })
      }
    }
  }
  return out
}

/** Départs d'une carte et d'un mode (entrées sans carte : anciennes copies, Faille CLASSIC). */
export function riotStartFor(
  all: RiotStartBundles,
  map: number,
  modes: string[]
): RiotStartBundles {
  return all.filter((b) =>
    b.map === undefined
      ? map === 11 && modes.includes('CLASSIC')
      : b.map === map && modes.includes(b.mode ?? '')
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
