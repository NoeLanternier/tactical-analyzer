import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'

// Dernière méta reçue, gardée dans le dossier de l'application : l'app démarre tout de suite avec
// les données de la veille (Master+ et Or à Émeraude), même hors ligne ou si GitHub répond lentement.

/** Un fichier par URL (méta de chaque poste et niveau). */
function cacheFile(url: string): string {
  const name = createHash('sha1').update(url).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'meta-cache', `${name}.json`)
}

export function saveMetaCache(url: string, data: unknown): void {
  try {
    const file = cacheFile(url)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ url, savedAt: new Date().toISOString(), data }))
    fs.renameSync(tmp, file)
  } catch {
    // Cache facultatif : une erreur d'écriture ne doit rien bloquer.
  }
}

export function loadMetaCache(url: string): { data: unknown; savedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(url), 'utf-8'))
    if (raw?.url !== url || !raw.data || typeof raw.savedAt !== 'string') return null
    return { data: raw.data, savedAt: raw.savedAt }
  } catch {
    return null
  }
}
