import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Relevé de l'API en jeu hors Faille (ARAM Mayhem…), édition personnelle : tout ce que l'API envoie
// (champs, événements, adresses disponibles) est noté dans live-probe.json, dans le dossier de
// l'application. Sert à savoir si le jeu donne les augments (proposés ou pris) ; rien n'est envoyé.

const MAX_SAMPLE = 300
const MAX_AUG_SAMPLE = 3000
const MAX_PATHS = 600

interface ModeProbe {
  paths: Record<string, string>
  events: string[]
  endpoints: string[]
  /** Réponses des adresses dont le nom évoque les augments. */
  extra: Record<string, string>
  games: number
}

const sample = (v: unknown, key: string): string => {
  const text = typeof v === 'string' ? v : JSON.stringify(v)
  return (text ?? '').slice(0, /aug/i.test(key) ? MAX_AUG_SAMPLE : MAX_SAMPLE)
}

/** Chemins des champs (tableaux notés « [] »), jusqu'à 5 niveaux. */
export function fieldPaths(
  value: unknown,
  prefix = '',
  depth = 0,
  out = new Map<string, unknown>()
): Map<string, unknown> {
  if (depth > 5 || value === null || typeof value !== 'object') {
    if (!out.has(prefix)) out.set(prefix, value)
    return out
  }
  if (Array.isArray(value)) {
    if (!value.length && !out.has(`${prefix}[]`)) out.set(`${prefix}[]`, [])
    for (const v of value.slice(0, 10)) fieldPaths(v, `${prefix}[]`, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value))
    fieldPaths(v, prefix ? `${prefix}.${k}` : k, depth + 1, out)
  return out
}

export class LiveProbe {
  private data: { updatedAt: string; modes: Record<string, ModeProbe> } = {
    updatedAt: '',
    modes: {}
  }
  private file = ''
  private dirty = false
  private lastWrite = 0
  private lastGameTime = Infinity
  private asked = new Set<string>()

  constructor(private readonly fetchJson: (p: string) => Promise<any>) {}

  /** Fichier du relevé (lu au premier usage : le dossier de l'app n'est connu qu'au démarrage). */
  private load(): void {
    if (this.file) return
    try {
      this.file = path.join(app.getPath('userData'), 'live-probe.json')
      const prev = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
      if (prev?.modes) this.data = prev
    } catch {
      // Premier relevé.
    }
  }

  observe(raw: any): void {
    try {
      this.record(raw)
    } catch {
      // Le relevé ne doit jamais gêner la lecture de la partie.
    }
  }

  private record(raw: any): void {
    const mode = String(raw?.gameData?.gameMode ?? '')
    if (!mode || mode === 'CLASSIC') return
    this.load()
    const m = (this.data.modes[mode] ??= {
      paths: {},
      events: [],
      endpoints: [],
      extra: {},
      games: 0
    })
    const t = Number(raw?.gameData?.gameTime ?? 0)
    if (t < this.lastGameTime) m.games++
    this.lastGameTime = t
    for (const [p, v] of fieldPaths(raw)) {
      if (p.startsWith('events.Events[]') && !/aug/i.test(p)) continue
      if (!(p in m.paths) && Object.keys(m.paths).length < MAX_PATHS) {
        m.paths[p] = sample(v, p)
        this.dirty = true
      } else if (/aug/i.test(p) && m.paths[p] !== sample(v, p)) {
        m.paths[p] = sample(v, p)
        this.dirty = true
      }
    }
    for (const e of raw?.events?.Events ?? []) {
      const name = String(e?.EventName ?? '')
      if (name && !m.events.includes(name)) {
        m.events.push(name)
        this.dirty = true
      }
      if (/aug/i.test(name)) {
        m.extra[`event:${name}`] = sample(e, 'aug')
        this.dirty = true
      }
    }
    if (!this.asked.has(mode)) {
      this.asked.add(mode)
      void this.listEndpoints(m)
    }
    this.save()
  }

  /** Adresses de l'API (description swagger) ; celles qui évoquent les augments sont relevées. */
  private async listEndpoints(m: ModeProbe): Promise<void> {
    for (const doc of ['/swagger/v2/swagger.json', '/swagger/v3/openapi.json']) {
      try {
        const spec = await this.fetchJson(doc)
        const paths = Object.keys(spec?.paths ?? {})
        if (!paths.length) continue
        m.endpoints = paths
        for (const p of paths.filter((x) => /aug/i.test(x)).slice(0, 5)) {
          try {
            m.extra[p] = sample(await this.fetchJson(p), 'aug')
          } catch (e) {
            m.extra[p] = `erreur : ${String((e as Error)?.message ?? e)}`
          }
        }
        this.dirty = true
        break
      } catch {
        // Description indisponible à cette adresse.
      }
    }
    this.save()
  }

  private save(): void {
    if (!this.dirty || !this.file || Date.now() - this.lastWrite < 10000) return
    this.dirty = false
    this.lastWrite = Date.now()
    this.data.updatedAt = new Date().toISOString()
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      // Relevé facultatif.
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
