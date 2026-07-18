import { app, BrowserWindow, nativeTheme, screen, shell, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type {
  AppSettings,
  MenuAction,
  ThemePreference,
  WindowBounds,
  WindowMode
} from '@shared/types'
import { IPC } from '@shared/ipc'
import * as store from '../persistence/store'

type WindowRole = 'main' | 'pdf' | 'study'

/**
 * Owns all BrowserWindows. Split mode = main window(s) with both panes;
 * separate mode = independent PDF and Study windows sharing one session.
 * Extra main windows can be opened VSCode-style (File > New Window).
 * Bounds/mode are persisted and restored across launches.
 */
export class WindowManager {
  private settings: AppSettings = { windowMode: 'split', splitRatio: 0.5, windows: {} }
  private saveTimer: NodeJS.Timeout | null = null
  /** action delivered to the next renderer that asks (used across mode switches) */
  private pending: MenuAction | null = null
  /** which screen each window currently shows (reported by its renderer) */
  private screens = new WeakMap<BrowserWindow, string>()
  private roles = new WeakMap<BrowserWindow, WindowRole>()
  private quitting = false
  private transitioning = false
  private quitHooked = false

  async init(): Promise<void> {
    this.settings = await store.getSettings()
    nativeTheme.themeSource = this.settings.theme ?? 'system'
    if (!this.quitHooked) {
      this.quitHooked = true
      app.on('before-quit', () => {
        this.quitting = true
      })
    }
    this.openForMode(this.settings.windowMode)
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    this.settings.theme = theme
    nativeTheme.themeSource = theme
    await this.saveAndBroadcastSettings()
  }

  async setSummaryLevel(level: NonNullable<AppSettings['summaryLevel']>): Promise<void> {
    this.settings.summaryLevel = level
    await this.saveAndBroadcastSettings()
  }

  async setLanguage(language: NonNullable<AppSettings['language']>): Promise<void> {
    this.settings.language = language
    await this.saveAndBroadcastSettings()
  }

  async setAiModel(model: NonNullable<AppSettings['aiModel']>): Promise<void> {
    this.settings.aiModel = model
    await this.saveAndBroadcastSettings()
  }

  private settingsListener: (() => void) | null = null

  setSettingsChangedListener(fn: () => void): void {
    this.settingsListener = fn
  }

  private async saveAndBroadcastSettings(): Promise<void> {
    await store.saveSettings(this.settings)
    this.broadcast(IPC.settingsChanged, this.settings)
    this.settingsListener?.()
  }

  /**
   * The renderer reports its screen; the main window is small for the
   * project list (IntelliJ-welcome style) and grows for the learning screen.
   */
  setScreenFor(sender: WebContents, screenName: string): void {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return
    const prev = this.screens.get(win)
    this.screens.set(win, screenName)
    if (this.roles.get(win) !== 'main' || prev === screenName) return

    const isMain = screenName === 'main'
    const wasMain = prev === 'main'
    if (isMain && !wasMain) {
      const saved = this.settings.windows.main
      if (saved && this.isOnScreen(saved)) {
        win.setBounds(saved, true)
        if (saved.maximized) win.maximize()
      } else {
        this.setCenteredBounds(win, 1360, 860)
      }
    } else if (!isMain && (wasMain || prev === undefined)) {
      if (win.isMaximized()) win.unmaximize()
      this.setCenteredBounds(win, 760, 540)
    }
  }

  private setCenteredBounds(win: BrowserWindow, width: number, height: number): void {
    const display = screen.getDisplayMatching(win.getBounds())
    const area = display.workArea
    const w = Math.min(width, area.width)
    const h = Math.min(height, area.height)
    win.setBounds(
      {
        width: w,
        height: h,
        x: Math.round(area.x + (area.width - w) / 2),
        y: Math.round(area.y + (area.height - h) / 2)
      },
      true
    )
  }

  getSettings(): AppSettings {
    return this.settings
  }

  async setSplitRatio(ratio: number): Promise<void> {
    this.settings.splitRatio = ratio
    this.persistSoon()
  }

  async setWindowMode(mode: WindowMode, pending?: MenuAction): Promise<void> {
    if (mode === this.settings.windowMode) {
      if (pending) this.sendToFocused(pending)
      return
    }
    this.settings.windowMode = mode
    this.pending = pending ?? null
    await store.saveSettings(this.settings)
    this.transitioning = true
    for (const win of BrowserWindow.getAllWindows()) win.destroy()
    this.transitioning = false
    this.openForMode(mode)
  }

  newMainWindow(): void {
    if (this.settings.windowMode === 'separate') return
    this.createWindow('main', { width: 760, height: 540, cascade: true, compact: true })
  }

  takePendingAction(): MenuAction | null {
    const action = this.pending
    this.pending = null
    return action
  }

  sendToFocused(action: MenuAction): void {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(IPC.menuAction, action)
  }

  /** Sends an event to every open window (optionally excluding the sender). */
  broadcast(channel: string, payload: unknown, excludeWebContentsId?: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (excludeWebContentsId !== undefined && win.webContents.id === excludeWebContentsId)
        continue
      win.webContents.send(channel, payload)
    }
  }

  private openForMode(mode: WindowMode): void {
    if (mode === 'split') {
      // welcome window starts small unless it will open straight into a project
      const opensProject = this.pending?.type === 'open-project'
      this.createWindow('main', opensProject ? { width: 1360, height: 860 } : { width: 760, height: 540, compact: true })
    } else {
      this.createWindow('pdf', { width: 820, height: 880 })
      this.createWindow('study', { width: 560, height: 880, offsetX: 840 })
    }
  }

  private createWindow(
    role: WindowRole,
    defaults: { width: number; height: number; offsetX?: number; cascade?: boolean; compact?: boolean }
  ): BrowserWindow {
    const saved =
      defaults.cascade || defaults.compact ? null : (this.settings.windows[role] ?? null)
    const bounds = saved && this.isOnScreen(saved) ? saved : null

    const win = new BrowserWindow({
      width: bounds?.width ?? defaults.width,
      height: bounds?.height ?? defaults.height,
      x: bounds?.x,
      y: bounds ? bounds.y : undefined,
      minWidth: 560,
      minHeight: 480,
      show: false,
      title: role === 'pdf' ? 'Docent — PDF' : role === 'study' ? 'Docent — Study' : 'Docent',
      autoHideMenuBar: true,
      // Tahoe draws different corner radii for toolbar vs plain windows and
      // Electron matches neither, so the main window is transparent and the
      // renderer paints the system-size radius itself (macOS derives the
      // window shadow from the content alpha).
      ...(process.platform === 'darwin' && role === 'main'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 16, y: 16 },
            transparent: true,
            backgroundColor: '#00000000'
          }
        : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff' }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    if (!bounds && defaults.offsetX) {
      const [x, y] = win.getPosition()
      win.setPosition(x + defaults.offsetX - 400, y)
    }
    if (defaults.cascade) {
      const focused = BrowserWindow.getFocusedWindow()
      if (focused) {
        const [x, y] = focused.getPosition()
        win.setPosition(x + 28, y + 28)
      }
    }
    if (bounds?.maximized) win.maximize()

    win.on('ready-to-show', () => win.show())
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    this.roles.set(win, role)

    const remember = (): void => {
      if (win.isDestroyed()) return
      // the compact welcome window must not overwrite the saved main bounds
      if (role === 'main' && this.screens.get(win) !== 'main') return
      const b = win.getBounds()
      this.settings.windows[role] = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized: win.isMaximized()
      }
      this.persistSoon()
    }
    win.on('moved', remember)
    win.on('resized', remember)
    win.on('maximize', remember)
    win.on('unmaximize', remember)

    // rounded corners are painted by the renderer; square them off whenever
    // the window fills the screen
    const sendFrameState = (): void => {
      if (win.isDestroyed()) return
      win.webContents.send(IPC.frameState, {
        square: win.isMaximized() || win.isFullScreen()
      })
    }
    win.on('maximize', sendFrameState)
    win.on('unmaximize', sendFrameState)
    win.on('enter-full-screen', sendFrameState)
    win.on('leave-full-screen', sendFrameState)
    win.webContents.on('did-finish-load', sendFrameState)

    // Xcode-style: closing a window that has a project open brings back the
    // project list window instead of leaving nothing behind.
    let screenAtClose = ''
    win.on('close', () => {
      screenAtClose = this.screens.get(win) ?? ''
    })
    win.on('closed', () => {
      if (this.quitting || this.transitioning) return
      if (role === 'main') {
        if (screenAtClose === 'main' && BrowserWindow.getAllWindows().length === 0) {
          this.createWindow('main', { width: 760, height: 540, compact: true })
        }
      } else {
        // closing either pane window leaves the project: merge back to a
        // single window showing the project list
        this.transitioning = true
        for (const other of BrowserWindow.getAllWindows()) other.destroy()
        this.transitioning = false
        this.settings.windowMode = 'split'
        this.persistSoon()
        this.createWindow('main', { width: 760, height: 540, compact: true })
      }
    })

    const hash = role === 'main' ? '' : `#/${role}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: hash ? hash.slice(1) : undefined
      })
    }

    return win
  }

  private isOnScreen(b: WindowBounds): boolean {
    return screen
      .getAllDisplays()
      .some(
        (d) =>
          b.x >= d.bounds.x - 50 &&
          b.y >= d.bounds.y - 50 &&
          b.x < d.bounds.x + d.bounds.width &&
          b.y < d.bounds.y + d.bounds.height
      )
  }

  private persistSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void store.saveSettings(this.settings), 400)
  }
}
