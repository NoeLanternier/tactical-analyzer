import type { RiotStartBundles } from './types'

// Lecture des départs de la boutique dans un fichier de champion du jeu (format CommunityDragon).

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Départs de la Faille (carte 11, mode CLASSIC), par poste (null : tous les postes). */
export function extractRiotStart(bin: any): RiotStartBundles {
  const out: RiotStartBundles = []
  for (const v of Object.values<any>(bin ?? {})) {
    if (v?.__type !== 'ItemRecommendationOverrideSet' || !Array.isArray(v.mOverrides)) continue
    for (const o of v.mOverrides) {
      const ctx = (o?.mOverrideContexts ?? []).find(
        (c: any) => c?.mMapID === 11 && c?.mModeNameStringId === 'CLASSIC'
      )
      if (!ctx || !Array.isArray(o.StartingItemBundles)) continue
      const bundles = o.StartingItemBundles.map((b: any) =>
        (Array.isArray(b?.items) ? b.items : [])
          .map((x: unknown) => Number(String(x).replace(/^Items\//, '')))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      ).filter((b: number[]) => b.length > 0)
      if (bundles.length)
        out.push({ position: typeof ctx.mPosition === 'string' ? ctx.mPosition : null, bundles })
    }
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */
