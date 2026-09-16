import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Tray, globalShortcut, Notification, nativeImage, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import {
  applyProxyConfig,
  fetchViaNet,
  getProxyConfig,
  setProxyConfig,
  testGoogleTranslate,
  type ProxyConfig,
} from './proxy'
import { migrateUserDataIfNeeded } from './migrateUserData'
import type { IpcMainInvokeEvent } from 'electron'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// 必须在 new Store() 之前执行:迁移会决定本次启动读哪个 userData 目录
migrateUserDataIfNeeded()

const store = new Store()

// 外部打开 .md 文件(md 文件关联)相关状态
const pendingOpenFiles = new Set<string>()
let rendererReady = false
const OPEN_FILE_EXTS = new Set(['.md', '.markdown'])

// 从命令行参数中提取可打开的 Markdown 文件路径
// (绝对路径 + md/markdown 扩展名 + 真实存在的文件,可自然排除 dev 下的 --no-sandbox 等参数)
function extractFilePaths(argv: string[]): string[] {
  return argv.filter((arg) => {
    if (!path.isAbsolute(arg)) return false
    if (!OPEN_FILE_EXTS.has(path.extname(arg).toLowerCase())) return false
    try {
      return fs.statSync(arg).isFile()
    } catch {
      return false
    }
  })
}

// 把待打开文件推送给渲染层;渲染层未就绪时先入队
function flushOpenFiles() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // 窗口不存在(如 macOS 运行中窗口全关)时重建,ready 后会再次 flush
    if (!mainWindow) {
      createMainWindow()
    }
    return
  }
  if (!rendererReady) return

  for (const filePath of [...pendingOpenFiles]) {
    const name = path.basename(filePath)
    let payload: {
      path: string
      name: string
      content?: string
      mtimeMs?: number
      error?: string
    }
    try {
      payload = {
        path: filePath,
        name,
        content: fs.readFileSync(filePath, 'utf-8'),
        mtimeMs: fs.statSync(filePath).mtimeMs,
      }
    } catch (error) {
      console.warn('Failed to read opened file:', filePath, error)
      payload = { path: filePath, name, error: String(error) }
    }
    mainWindow.webContents.send('notes:open-file-request', payload)
    pendingOpenFiles.delete(filePath)
  }
}

function queueOpenFile(filePath: string) {
  pendingOpenFiles.add(filePath)
  flushOpenFiles()
}

function loadRendererWindow(window: BrowserWindow, toolName?: string) {
  const query = toolName ? `?tool=${encodeURIComponent(toolName)}` : ''

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query}`)
    return
  }

  window.loadFile(path.join(__dirname, '../dist/index.html'), {
    search: query,
  })
}

/**
 * 无边框窗口没有菜单栏可挂，Menu.setApplicationMenu(null) 之后默认菜单里的快捷键
 * （重载、开发者工具）也一并没了 —— 而顶部只剩应用自绘的那条 bar，再没有别的入口。
 * 这里把真正会用到的几个显式补回来，不依赖菜单内部实现。
 */
function registerWindowShortcuts(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const mod = input.control || input.meta

    // F12 / Ctrl+Shift+I：开发者工具
    if (key === 'f12' || (mod && input.shift && key === 'i')) {
      event.preventDefault()
      window.webContents.toggleDevTools()
      return
    }

    // Ctrl+R / Ctrl+Shift+R：重载（笔记是落盘的，重载不会丢内容）
    if (mod && (key === 'r' || key === 'f5')) {
      event.preventDefault()
      if (input.shift) {
        window.webContents.reloadIgnoringCache()
      } else {
        window.webContents.reload()
      }
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 520,
    title: 'devNotes',
    // 无边框：系统的标题栏和菜单栏都不要，顶部只保留应用自绘的那条 bar。
    // 代价是拖拽、双击最大化、最小化/最大化/关闭全部落到渲染层的 drag-region 与三个圆点上。
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  registerWindowShortcuts(mainWindow)
  loadRendererWindow(mainWindow)

  // 拦截应用内的外部超链接跳转，统一调用系统默认浏览器打开，防止应用窗口被外部网页篡改
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })
}

function createToolWindow(toolName: string) {
  const toolWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 520,
    title: `devNotes - ${toolName}`,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  registerWindowShortcuts(toolWindow)
  loadRendererWindow(toolWindow, toolName)

  toolWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  toolWindow.once('ready-to-show', () => {
    toolWindow.show()
  })
}

function createTray() {
  const iconDir = path.join(__dirname, '../assets')
  // 只认带透明通道的格式:jpg 无 alpha,会把透明背景渲成不透明
  const iconFiles = ['icon.png', 'icon.ico']
  let icon: nativeImage | null = null
  
  for (const file of iconFiles) {
    const iconPath = path.join(iconDir, file)
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) break
    }
  }
  
  if (!icon || icon.isEmpty()) {
    console.warn('No tray icon found, skipping tray creation')
    return
  }
  
  try {
    const trayIcon = process.platform === 'darwin' 
      ? icon.resize({ width: 22, height: 22 }) 
      : icon.resize({ width: 16, height: 16 })
    tray = new Tray(trayIcon)
  } catch (e) {
    console.warn('Failed to create tray:', e)
    return
  }
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示 devNotes', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  
  tray.setToolTip('devNotes')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

// 无边框之后窗口控制完全由渲染层的自绘按钮负责，必须作用在「发出请求的那个窗口」上。
// 原来三个 handler 都写死 mainWindow，工具窗口点自己的圆点会去动主窗口。
function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window && !window.isDestroyed() ? window : null
}

function setupIpc() {
  ipcMain.handle('window-minimize', (event) => {
    windowOf(event)?.minimize()
  })

  ipcMain.handle('window-maximize', (event) => {
    const window = windowOf(event)
    if (!window) return
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })

  ipcMain.handle('window-close', (event) => {
    const window = windowOf(event)
    if (!window) return
    // 主窗口的关闭是「收进托盘」，托盘菜单还能再唤出来；
    // 其余窗口关掉就是关掉，否则会留下一个看不见也唤不回的僵尸窗口
    if (window === mainWindow) {
      window.hide()
    } else {
      window.close()
    }
  })

  ipcMain.handle('show-notification', (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  })

  ipcMain.handle('open-tool', (_, toolName: string) => {
    createToolWindow(toolName)
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // Store operations
  ipcMain.handle('store-get', (_, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('store-set', (_, key: string, value: any) => {
    store.set(key, value)
  })

  ipcMain.handle('store-delete', (_, key: string) => {
    store.delete(key)
  })

  // 剪贴板读写:打包后 file:// 环境下渲染进程 navigator.clipboard 不可靠,由主进程兜底
  ipcMain.handle('clipboard-read', () => {
    return clipboard.readText()
  })

  ipcMain.handle('clipboard-write', (_, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''))
  })

  // 翻译 API 代理：使用 Electron net 模块，自动走系统/手动代理
  ipcMain.handle(
    'translate-fetch',
    async (
      _,
      options: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        timeout?: number
      }
    ) => {
      return fetchViaNet(options)
    }
  )

  ipcMain.handle('get-proxy-config', () => {
    return getProxyConfig(store)
  })

  ipcMain.handle('set-proxy-config', async (_, config: ProxyConfig) => {
    const saved = setProxyConfig(store, config)
    await applyProxyConfig(store)
    return saved
  })

  ipcMain.handle('test-proxy', async () => {
    return testGoogleTranslate(store)
  })

  // 渲染层就绪信号:仅接受主窗口(每个窗口都会挂载 NotesProvider,需防 tool 窗口抢占)
  ipcMain.handle('notes-renderer-ready', (event) => {
    if (event.sender === mainWindow?.webContents) {
      rendererReady = true
      flushOpenFiles()
    }
  })

  // Markdown 笔记：打开本地文件
  ipcMain.handle('notes-open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入 Markdown 笔记',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    return {
      path: filePath,
      name: path.basename(filePath),
      content,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }
  })

  // Markdown 笔记：导出本地文件
  ipcMain.handle(
    'notes-save-file',
    async (
      _,
      options: {
        content: string
        defaultPath?: string
      }
    ) => {
      const result = await dialog.showSaveDialog({
        title: '导出 Markdown 笔记',
        defaultPath: options.defaultPath || 'untitled.md',
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'Text', extensions: ['txt'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      fs.writeFileSync(result.filePath, options.content ?? '', 'utf-8')
      return {
        path: result.filePath,
        name: path.basename(result.filePath),
      }
    }
  )

  ipcMain.handle('open-external', (_, url: string) => {
    if (url && (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:'))) {
      return shell.openExternal(url)
    }
  })
}

// 单实例锁:二次启动(如 Windows 双击关联文件)时把文件转发给已有实例
// dev 下跳过,避免 vite-plugin-electron 热重启时的锁竞争
const gotLock = app.isPackaged || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_, argv) => {
    extractFilePaths(argv).forEach(queueOpenFile)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createMainWindow()
    }
  })
}

// macOS:双击关联文件 / open -a 打开文件(冷启动时该事件先于 ready 触发,靠队列兜底)
app.on('will-finish-launching', () => {
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueOpenFile(filePath)
  })
})

app.whenReady().then(async () => {
  // 无边框窗口没有菜单栏可挂，默认菜单留着只会提供一批用不上的快捷键
  Menu.setApplicationMenu(null)

  await applyProxyConfig(store)
  createMainWindow()
  createTray()
  setupIpc()

  // 处理启动参数中的文件(Windows 关联启动 / 命令行直接传路径)
  extractFilePaths(process.argv).forEach(queueOpenFile)

  globalShortcut.register('Alt+Shift+F', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
