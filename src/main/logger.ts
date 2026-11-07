import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Journal de debug : désactivé par défaut, activé via les réglages ou la variable TACTIQUE_DEBUG=1.
// Le fichier est dans le dossier de données de l'application (pas dans le dossier courant)
// et il est vidé au-delà de 1 Mo pour ne pas grossir indéfiniment.

const MAX_SIZE = 1024 * 1024
let enabled = process.env['TACTIQUE_DEBUG'] === '1'

export function setDebug(value: boolean): void {
  enabled = value || process.env['TACTIQUE_DEBUG'] === '1'
}

function logFile(): string {
  return path.join(app.getPath('userData'), 'tactique-debug.log')
}

export function debugLog(scope: string, data: unknown): void {
  if (!enabled) return
  try {
    const file = logFile()
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) fs.writeFileSync(file, '')
    const line = JSON.stringify({ t: new Date().toISOString(), scope, data })
    fs.appendFileSync(file, line + '\n')
  } catch {
    // Le journal ne doit jamais faire planter l'application.
  }
}
