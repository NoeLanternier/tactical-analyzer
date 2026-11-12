import { app, shell, BrowserWindow, ipcMain, globalShortcut, screen, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { LcuService } from './lcu'
import { LivePoller } from './live'
import { loadSettings, saveSettings } from './settings'
import { setDebug } from './logger'
import {
  checkForUpdates,
  getUpdateStatus,
  initUpdater,
  installUpdate,
  setUpdateToken
} from './updater'
import { listReports, reportsDir, saveReport } from './reports'
import * as fs from 'fs'
import { JournalRecorder } from './journal'
import { langFromLocale, setLang, tr, type Lang } from '../shared/i18n'
import { loadMetaCache, saveMetaCache } from './metaCache'
import { getRiotStart } from './riotStart'
import { RIOT_COMPLIANT } from '../shared/edition'
import {
  metaFallbackUrl,
  type ItemSetPayload,
  type RawPostGame,
  type RunePagePayload,
  type Settings
} from '../shared/types'

// Plus de "ignore-certificate-errors" : l'API en jeu est vérifiée avec le certificat Riot (live.ts).

const WIDTH = 380
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+T'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let settings: Settings = loadSettings()
setDebug(settings.debug)

/** Lancement au démarrage de Windows (uniquement pour l'app installée ou l'exe). */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  const exe = process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath
  app.setLoginItemSettings({ openAtLogin: enabled, path: exe })
}

const lcu = new LcuService()

/** Langue effective : réglage, ou en mode auto la langue du client LoL (sinon celle du système). */
let lang: Lang = 'fr'
function updateLang(): void {
  const next =
    settings.language === 'auto'
      ? langFromLocale(lcu.locale ?? (app.isReady() ? app.getLocale() : 'fr'))
      : settings.language
  setLang(next)
  if (next !== lang) {
    lang = next
    send('lang-update', next)
  }
}
let journal: JournalRecorder
const live = new LivePoller(() => ['GameStart', 'InProgress', 'Reconnect'].includes(lcu.phase))

function windowBounds(side: 'left' | 'right'): Electron.Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const height = Math.min(780, area.height - 40)
  return {
    width: WIDTH,
    height,
    x: side === 'left' ? area.x : area.x + area.width - WIDTH,
    y: area.y + Math.round((area.height - height) / 2)
  }
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...windowBounds(settings.side),
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  // Niveau le plus haut pour rester visible au-dessus du jeu en mode "Sans bordures".
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true)
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  mainWindow.on('ready-to-show', () => mainWindow?.showInactive())
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('get-initial-state', () => ({
    lang,
    status: lcu.status,
    phase: lcu.phase,
    draft: lcu.draft,
    queue: lcu.queue
  }))

  ipcMain.handle('apply-runes', (_e, payload: RunePagePayload) =>
    lcu.applyRunePage(payload, settings.replaceActivePageIfFull)
  )

  ipcMain.handle('apply-item-set', (_e, payload: ItemSetPayload) => lcu.applyItemSet(payload))

  ipcMain.handle(
    'get-recommended-runes',
    (_e, championId: number, position: string, mapId?: number) =>
      lcu.getRecommendedRunes(championId, position, Number(mapId) || 11)
  )
  // Banc et relances : actions dans le client, édition personnelle seulement.
  ipcMain.handle('swap-with-bench', (_e, championId: number) =>
    RIOT_COMPLIANT
      ? { success: false, error: 'unsupported' }
      : lcu.swapWithBench(Number(championId))
  )
  ipcMain.handle('reroll', () =>
    RIOT_COMPLIANT ? { success: false, error: 'unsupported' } : lcu.reroll()
  )
  ipcMain.handle('get-riot-start', (_e, alias: string) => getRiotStart(String(alias)))

  ipcMain.handle('get-champion-pool', () => lcu.getChampionPool())
  ipcMain.handle('get-ranked-tier', () => lcu.getRankedTier())

  ipcMain.handle('get-app-info', () => ({ version: app.getVersion(), update: getUpdateStatus() }))
  ipcMain.on('check-for-updates', () => checkForUpdates())
  ipcMain.on('install-update', () => installUpdate())

  ipcMain.handle('get-settings', () => settings)

  ipcMain.handle('save-settings', (_e, next: Settings) => {
    const previousSide = settings.side
    const previousStartup = settings.launchAtStartup
    const previousToken = settings.updateToken
    settings = saveSettings(next)
    if (settings.updateToken !== previousToken) {
      setUpdateToken(settings.updateToken)
      checkForUpdates()
    }
    setDebug(settings.debug)
    updateLang()
    if (settings.launchAtStartup !== previousStartup) applyLoginItem(settings.launchAtStartup)
    if (mainWindow && settings.side !== previousSide)
      mainWindow.setBounds(windowBounds(settings.side))
    return settings
  })

  ipcMain.handle('fetch-meta-override', async (_e, url: string) => {
    if (!/^https:\/\//i.test(url))
      return { ok: false, error: tr('URL https:// requise', 'https:// URL required') }
    const get = async (from: string): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await net.fetch(from, { signal: controller.signal })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
        return { ok: true, data: await res.json() }
      } catch (error) {
        return { ok: false, error: String((error as Error)?.message ?? error) }
      } finally {
        clearTimeout(timeout)
      }
    }
    // Méta officielle : branche meta, sinon la copie quotidienne de la branche main.
    let res = await get(url)
    const fallback = metaFallbackUrl(url)
    if (!res.ok && fallback) {
      const second = await get(fallback)
      if (second.ok) res = second
    }
    if (res.ok) saveMetaCache(url, res.data)
    return res
  })

  ipcMain.handle('get-cached-meta', (_e, url: string) => {
    const fallback = metaFallbackUrl(String(url))
    return loadMetaCache(String(url)) ?? (fallback ? loadMetaCache(fallback) : null)
  })

  // Après-partie.
  // Le journal enregistré pendant la partie est joint : le renderer le rattache si les champions
  // correspondent à la partie récupérée.
  const withJournal = (raw: RawPostGame | null): RawPostGame | null =>
    raw ? { ...raw, journal: journal.latest() } : null
  ipcMain.handle('wait-finished-game', async (_e, sinceMs: number) =>
    withJournal(await lcu.waitForFinishedGame(Number(sinceMs) || 0))
  )
  ipcMain.handle('get-recent-games', (_e, count: number) => lcu.getRecentGames(Number(count) || 20))
  ipcMain.handle('get-game-details', async (_e, gameId: number) =>
    withJournal(await lcu.getGameDetails(Number(gameId)))
  )
  ipcMain.handle('list-reports', () => listReports())
  ipcMain.handle('save-report', (_e, gameId: number, facts: unknown) =>
    saveReport(Number(gameId), facts)
  )
  ipcMain.on('open-reports-folder', () => {
    const dir = reportsDir()
    fs.mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  })

  ipcMain.on('set-overlay-mode', (event, expanded: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (expanded) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
  })

  ipcMain.on('close-app', () => app.quit())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tactique.analyzer')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  journal = new JournalRecorder()
  updateLang()
  registerIpc()
  createWindow()

  lcu.on('status', (s) => send('lcu-status', s))
  lcu.on('phase', (p) => send('lcu-phase-update', p))
  lcu.on('draft', (d) => send('lcu-draft-update', d))
  lcu.on('queue', (q) => send('lcu-queue-update', q))
  lcu.on('locale', () => updateLang())
  live.on('update', (d) => {
    journal.update(d)
    send('live-update', d)
  })
  lcu.start()
  live.start()
  applyLoginItem(settings.launchAtStartup)
  initUpdater((s) => send('update-status', s), settings.updateToken)

  // Raccourci global : épingler / masquer le panneau sans passer la souris dessus.
  globalShortcut.register(TOGGLE_SHORTCUT, () => send('toggle-pin'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  lcu.stop()
  live.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
