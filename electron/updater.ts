import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

/** 推给渲染进程的更新状态，与 preload.ts 里的类型保持一致 */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; checkedAt: number }
  | { state: 'not-available'; checkedAt: number }
  | {
      state: 'downloading'
      percent: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
    }
  | { state: 'downloaded'; version: string; checkedAt: number }
  | { state: 'error'; message: string; checkedAt: number }
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
 * 更新就绪时发一条系统原生通知。
 *
 * 应用内横幅只在用户盯着本应用时可见，toast 更是几秒即逝 —— 用户切在
 * 别的窗口干活时两条都收不到。系统通知走操作系统的通知中心，常驻可回看；
 * 点击把主窗口拉到前台，配合应用内横幅完成安装。
 */
function notifyUpdateReady(version: string) {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'devNotes 新版本已就绪',
    body: `v${version} 已在后台下载完成，点击返回应用即可一键安装`,
    silent: false,
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  notification.show()
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
      await autoUpdater.checkForUpdates()

      /*
       * 不把 checkForUpdates 的原始返回值交给 IPC：里面带着 CancellationToken
       * 等不可结构化克隆的类实例，直接 return 会报 "An object could not be cloned"，
       * 渲染层误以为检查失败，实际检查早已完成。真正的结论由事件广播
       * （update-available / update-not-available / download-progress）带回，
       * 这里只回执一个可序列化的确认。
       */
      return { state: 'checking' }
    } catch (err: any) {
      const errStatus: UpdateStatus = {
        state: 'error',
        message: err?.message || '连接更新服务器失败',
        checkedAt: Date.now(),
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
    broadcast({ state: 'available', version: info.version, checkedAt: Date.now() })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available', checkedAt: Date.now() })
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
    broadcast({ state: 'downloaded', version: info.version, checkedAt: Date.now() })
    notifyUpdateReady(info.version)
  })

  autoUpdater.on('error', (error) => {
    broadcast({ state: 'error', message: error.message || '更新过程发生异常', checkedAt: Date.now() })
  })

  // 启动 3 秒后执行一次后台静默检查
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }, 3000)

  /*
   * 周期性静默复查。
   *
   * 启动那一次检查的结果会缓存整个会话 —— 如果新版本发布晚于本次启动，
   * 用户会一直看着过期的「已是最新版本」，除非自己想起来手动点检查。
   * 每 4 小时复查一次，长开的应用半天内也能收到新版提醒。
   */
  const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }, RECHECK_INTERVAL_MS)
}
