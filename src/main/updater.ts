import { app } from 'electron'
import type { UpdateStatus } from '../shared/types'
import { debugLog } from './logger'
import { tr } from '../shared/i18n'
import { UPDATE_REPO } from '../shared/edition'

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

// Mises à jour automatiques : l'app installée (programme d'installation Windows) vérifie les
// « Releases » GitHub du dépôt de l'app, télécharge la nouvelle version en arrière-plan et
// l'installe à la fermeture (ou tout de suite via le bouton « Redémarrer »).

const CHECK_EVERY = 6 * 3600 * 1000

let status: UpdateStatus = { state: 'idle' }
let updater: any = null
let token = ''

/**
 * Source des mises à jour : avec un jeton GitHub, les versions du dépôt (même privé) via l'API ;
 * sans jeton, le dépôt public indiqué à la compilation.
 */
export function setUpdateToken(next: string): void {
  token = next.trim()
  if (!updater || !token) return
  updater.setFeedURL({
    provider: 'github',
    owner: UPDATE_REPO.owner,
    repo: UPDATE_REPO.repo,
    private: true,
    token
  })
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function initUpdater(onStatus: (s: UpdateStatus) => void, initialToken = ''): void {
  const set = (s: UpdateStatus): void => {
    status = s
    onStatus(s)
  }
  if (!app.isPackaged)
    return set({ state: 'unsupported', message: tr('mode développement', 'development mode') })
  if (process.env['PORTABLE_EXECUTABLE_FILE']) {
    return set({
      state: 'unsupported',
      message: tr(
        'version portable : utilisez le programme d’installation',
        'portable version: use the installer'
      )
    })
  }
  try {
    // Chargé dynamiquement : l'app fonctionne même si le module n'est pas installé.
    const moduleName = 'electron-updater'
    updater = require(moduleName).autoUpdater
  } catch {
    return set({
      state: 'unsupported',
      message: tr(
        'module electron-updater absent (npm install)',
        'electron-updater module missing (npm install)'
      )
    })
  }
  setUpdateToken(initialToken)
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => set({ state: 'checking' }))
  updater.on('update-available', (info: any) => set({ state: 'available', version: info?.version }))
  updater.on('update-not-available', () => set({ state: 'none' }))
  updater.on('download-progress', (p: any) =>
    set({ state: 'downloading', percent: Math.round(p?.percent ?? 0), version: status.version })
  )
  updater.on('update-downloaded', (info: any) => set({ state: 'ready', version: info?.version }))
  updater.on('error', (e: any) => {
    debugLog('update', { error: String(e?.message ?? e) })
    const message = String(e?.message ?? e)
    // Dépôt privé sans jeton (ou jeton invalide) : GitHub répond 404.
    if (/\b(404|401)\b/.test(message))
      return set({
        state: 'error',
        message: token
          ? tr(
              'jeton GitHub refusé (Réglages → Application)',
              'GitHub token rejected (Settings → App)'
            )
          : tr(
              'dépôt privé : ajoute ton jeton GitHub (Réglages → Application)',
              'private repository: add your GitHub token (Settings → App)'
            )
      })
    set({ state: 'error', message: message.slice(0, 200) })
  })
  checkForUpdates()
  setInterval(checkForUpdates, CHECK_EVERY)
}

export function checkForUpdates(): void {
  updater?.checkForUpdates().catch(() => undefined)
}

export function installUpdate(): void {
  if (status.state === 'ready') updater?.quitAndInstall(true, true)
}
