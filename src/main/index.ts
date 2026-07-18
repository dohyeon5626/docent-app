import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { createAIProvider } from './services/claude/factory'
import { listProjects } from './services/persistence/store'
import { buildAppMenu } from './services/window/menu'
import { WindowManager } from './services/window/WindowManager'

const windows = new WindowManager()
// swap the id (or make it a setting-driven lookup) to use a different backend
const ai = createAIProvider(
  'claude',
  () => windows.getSettings().language ?? 'ko',
  () => windows.getSettings().aiModel
)

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.claude-pdf-learn')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(ai, windows)
  buildAppMenu(windows, await listProjects())
  await windows.init()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void windows.init()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
