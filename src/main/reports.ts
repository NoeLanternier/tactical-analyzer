import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { ActionResult } from '../shared/types'
import { debugLog } from './logger'
import { tr } from '../shared/i18n'

// Bilans d'après-partie : un petit fichier JSON par partie dans le dossier de données de l'app.
// On garde les données compactes de la partie (pas l'analyse) : quand le moteur d'analyse
// s'améliore avec une mise à jour, toutes les anciennes parties sont réanalysées.

const MAX_REPORTS = 300

export function reportsDir(): string {
  return path.join(app.getPath('userData'), 'reports')
}

export function saveReport(gameId: number, facts: unknown): ActionResult {
  try {
    if (!Number.isFinite(gameId) || gameId <= 0)
      return { success: false, error: tr('Partie invalide', 'Invalid game') }
    const dir = reportsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${Math.floor(gameId)}.json`), JSON.stringify(facts))
    prune(dir)
    return { success: true }
  } catch (error) {
    debugLog('reports', { saveError: String(error) })
    return { success: false, error: String((error as Error)?.message ?? error) }
  }
}

export function listReports(): unknown[] {
  const dir = reportsDir()
  if (!fs.existsSync(dir)) return []
  const out: { createdAt: number; data: unknown }[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!/^\d+\.json$/.test(name)) continue
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'))
      out.push({ createdAt: Number(data?.createdAt ?? 0), data })
    } catch {
      // Fichier illisible : ignoré.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).map((x) => x.data)
}

/** Ne garde que les parties les plus récentes. */
function prune(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((n) => /^\d+\.json$/.test(n))
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const f of files.slice(MAX_REPORTS)) {
    try {
      fs.unlinkSync(path.join(dir, f.n))
    } catch {
      // ignoré
    }
  }
}
