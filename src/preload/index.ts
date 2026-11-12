import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { TactiqueApi } from '../shared/types'

// Chaque abonnement renvoie une fonction de désinscription (évite les écouteurs en double).
function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: TactiqueApi = {
  onDraftUpdate: (cb) => listen('lcu-draft-update', cb),
  onPhaseUpdate: (cb) => listen('lcu-phase-update', cb),
  onLcuStatus: (cb) => listen('lcu-status', cb),
  onLiveUpdate: (cb) => listen('live-update', cb),
  onTogglePin: (cb) => listen('toggle-pin', () => cb()),
  onLangUpdate: (cb) => listen('lang-update', cb),
  onQueueUpdate: (cb) => listen('lcu-queue-update', cb),
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  applyRunes: (payload) => ipcRenderer.invoke('apply-runes', payload),
  applyItemSet: (payload) => ipcRenderer.invoke('apply-item-set', payload),
  getRecommendedRunes: (championId, position, mapId) =>
    ipcRenderer.invoke('get-recommended-runes', championId, position, mapId),
  swapWithBench: (championId) => ipcRenderer.invoke('swap-with-bench', championId),
  reroll: () => ipcRenderer.invoke('reroll'),
  getRiotStart: (alias) => ipcRenderer.invoke('get-riot-start', alias),
  getChampionPool: () => ipcRenderer.invoke('get-champion-pool'),
  getRankedTier: () => ipcRenderer.invoke('get-ranked-tier'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onUpdateStatus: (cb) => listen('update-status', cb),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  fetchMetaOverride: (url) => ipcRenderer.invoke('fetch-meta-override', url),
  getCachedMeta: (url) => ipcRenderer.invoke('get-cached-meta', url),
  waitForFinishedGame: (sinceMs) => ipcRenderer.invoke('wait-finished-game', sinceMs),
  getRecentGames: (count) => ipcRenderer.invoke('get-recent-games', count),
  getGameDetails: (gameId) => ipcRenderer.invoke('get-game-details', gameId),
  listReports: () => ipcRenderer.invoke('list-reports'),
  saveReport: (gameId, facts) => ipcRenderer.invoke('save-report', gameId, facts),
  openReportsFolder: () => ipcRenderer.send('open-reports-folder'),
  setOverlayMode: (expanded) => ipcRenderer.send('set-overlay-mode', expanded),
  closeApp: () => ipcRenderer.send('close-app')
}

contextBridge.exposeInMainWorld('api', api)
