import type { TactiqueApi } from '../shared/types'

declare global {
  interface Window {
    api: TactiqueApi
  }
}

export {}
