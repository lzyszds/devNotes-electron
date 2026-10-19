import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

/** 推给渲染进程的更新状态，与 preload.ts 里的类型保持一致 */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

function broadcast(status: UpdateStatus) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  })
}

/**
 * 初始化自动更新。
 *
 * electron-updater 读取 GitHub Release 里的 latest.yml / latest-mac.yml，
 * 下载时优先走 blockmap 差量更新，只拉取变化的分块。
 * 开发模式下没有安装包信息，直接跳过。
 */
export function setupAutoUpdater() {
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) return null
    return autoUpdater.checkForUpdates()
  })

  ipcMain.handle('update-install', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) => broadcast({ state: 'error', message: error.message }))

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }, 3000)
}
