import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

/** 推给渲染进程的更新状态，与 preload.ts 里的类型保持一致 */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | {
      state: 'downloading'
      percent: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
    }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'dev-mode'; message: string }

/** 内存中缓存最新的更新状态，方便新打开的窗口/设置面板立即读取 */
let currentUpdateStatus: UpdateStatus | null = null

function broadcast(status: UpdateStatus) {
  currentUpdateStatus = status
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  })
}

/**
 * 初始化自动更新。
 *
 * 核心设计：
 * 1. 托管于 GitHub Actions 与 GitHub Release；
 * 2. 启用 Blockmap 差量更新（Differential Update），更新时仅下载发生差异的数据分块；
 * 3. 记录 electron-log 日志便于排查更新链路；
 * 4. 暴露 update-get-status IPC，避免渲染层组件迟挂载时漏掉已就绪的下载状态。
 */
export function setupAutoUpdater() {
  // 配置日志
  autoUpdater.logger = log

  // 确保启用差量更新下载（基于 blockmap 只拉取变动块，极大减少流量与下载耗时）
  autoUpdater.disableDifferentialDownload = false
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // 读取当前缓存的更新状态
  ipcMain.handle('update-get-status', () => currentUpdateStatus)

  // 手动触发检查更新
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) {
      const devStatus: UpdateStatus = {
        state: 'dev-mode',
        message: '当前处于开发调试环境，自动更新及差量下载将在生产打包后生效。',
      }
      broadcast(devStatus)
      return devStatus
    }
    broadcast({ state: 'checking' })
    try {
      return await autoUpdater.checkForUpdates()
    } catch (err: any) {
      const errStatus: UpdateStatus = {
        state: 'error',
        message: err?.message || '连接更新服务器失败',
      }
      broadcast(errStatus)
      return errStatus
    }
  })

  // 立即重启并安装新版本
  ipcMain.handle('update-install', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  // 事件监听绑定
  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    broadcast({ state: 'error', message: error.message || '更新过程发生异常' })
  })

  // 启动 3 秒后执行一次后台静默检查
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }, 3000)
}
