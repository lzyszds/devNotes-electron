import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, screen, Tray, globalShortcut, Notification, nativeImage, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import {
  applyProxyConfig,
  fetchViaNet,
  fetchViaNetStream,
  getProxyConfig,
  setProxyConfig,
  testGoogleTranslate,
  type ProxyConfig,
} from './proxy'
import { migrateUserDataIfNeeded } from './migrateUserData'
import { COMMON_PORTS, inspectPort, killProcess } from './ports'
import type { IpcMainInvokeEvent } from 'electron'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** 截图框选用的一次性全屏遮罩窗口 */
let captureWindow: BrowserWindow | null = null
/** 草稿纸小窗。单例 —— 反复唤起只把它调出来，不开第二个 */
let scratchWindow: BrowserWindow | null = null
/** 本次框选的截图结果，缓存起来供推 / 拉两条路径共用（见 createCaptureWindow） */
let captureShotPromise: Promise<unknown> | null = null
/** 进行中的流式翻译请求，按 requestId 索引，供中途中断 */
const streamHandles = new Map<string, { abort: () => void }>()

// 必须在 new Store() 之前执行:迁移会决定本次启动读哪个 userData 目录
migrateUserDataIfNeeded()

const store = new Store()

// 外部打开 .md 文件(md 文件关联)相关状态
const pendingOpenFiles = new Set<string>()
let rendererReady = false
const OPEN_FILE_EXTS = new Set(['.md', '.markdown'])

/**
 * 全局快捷键：配置存 electron-store，键位由设置界面写入。
 *
 * 注册动作全在主进程 —— 渲染进程的 window 键盘事件只在应用聚焦时才有，
 * 要做到「在其他应用里也能唤起」必须走 globalShortcut。
 */

/** 存储键名。与 src/utils/shortcutSettings.ts 的 SHORTCUT_STORAGE_KEY 一致 */
const SHORTCUT_STORAGE_KEY = 'shortcut-bindings'

/** 主进程认得的全局快捷键：id -> 按下时的行为 */
const GLOBAL_SHORTCUT_ACTIONS: Record<string, () => void> = {
  'toggle-window': () => {
    if (!mainWindow) return
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
  },
  'open-translate': () => {
    void focusWindowAndOpenTool('text-translate')
  },
  'screenshot-translate': () => {
    createCaptureWindow()
  },
  // 草稿纸是独立小窗，跟主窗口的显隐无关 —— 主窗口收进托盘时它照样能唤出来
  'open-scratchpad': () => {
    openScratchWindow()
  },
}

/** 主进程侧的默认键位。渲染端的默认值在 shortcutSettings.ts，两边要保持一致 */
const GLOBAL_SHORTCUT_DEFAULTS: Record<string, string> = {
  'toggle-window': 'Alt+Shift+F',
  'open-translate': 'Alt+Shift+T',
  'screenshot-translate': 'Alt+Shift+S',
  'open-scratchpad': 'Alt+Shift+N',
}

/** 读用户配置的快捷键表；读不到就用默认值 */
function readShortcutMap(): Record<string, string> {
  const saved = store.get(SHORTCUT_STORAGE_KEY)
  const map = { ...GLOBAL_SHORTCUT_DEFAULTS }
  if (saved && typeof saved === 'object') {
    for (const id of Object.keys(GLOBAL_SHORTCUT_ACTIONS)) {
      const value = (saved as Record<string, unknown>)[id]
      // 空串是用户主动清空，要尊重 —— 只有非字符串才回退默认值
      if (typeof value === 'string') map[id] = value
    }
  }
  return map
}

/**
 * 按当前配置注册全部全局快捷键。
 *
 * 先全注销再全注册：globalShortcut 是全局单例表，逐个管理容易漏掉旧键位，
 * 整体重来最省心（键位数量是个位数，开销可以忽略）。
 *
 * 返回注册失败的 id 列表。register 返回 false 表示该组合被系统或其他应用
 * 占用，必须把结果回给设置界面，让用户知道这个键没生效 —— 不能假装成功。
 */
function applyGlobalShortcuts(): { failed: string[] } {
  globalShortcut.unregisterAll()
  const map = readShortcutMap()
  const failed: string[] = []

  for (const [id, action] of Object.entries(GLOBAL_SHORTCUT_ACTIONS)) {
    const accelerator = map[id]
    if (!accelerator) continue
    try {
      if (!globalShortcut.register(accelerator, action)) failed.push(id)
    } catch {
      // 非法 accelerator 写法会抛异常，同样按失败处理
      failed.push(id)
    }
  }
  return { failed }
}

/**
 * 开一个铺满主屏的透明无边框窗口，用来做截图框选。
 *
 * 截图数据在窗口 did-finish-load 之后才推送：渲染层要先挂上监听，
 * 早发就丢了。窗口用 alwaysOnTop + fullscreenable 的组合保证盖住其他应用。
 */
function createCaptureWindow(): void {
  if (captureWindow) {
    captureWindow.focus()
    return
  }

  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  /*
   * 立刻开始抓屏，且必须在窗口显示之前完成 —— 拍到遮罩自己就没底图了。
   * 结果缓存成 Promise，窗口加载好后无论是主进程推还是渲染层拉，都读这一份，
   * 避免重复抓屏（第二次抓就会把已经显示出来的遮罩拍进去）。
   */
  captureShotPromise = grabPrimaryScreen()

  captureWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    // 截图期间要让用户看到底下的原始画面，所以窗口本身不画背景
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    /*
     * 先不显示。窗口默认创建即显示，而抓屏必须发生在它显示**之前** ——
     * 否则拍到的是自己那层半透明遮罩，底图就是灰的。等图抓完再 show。
     */
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 必须跟主窗口一致用 true。contextIsolation 为 false 时 preload 跑在
      // 渲染进程主世界里，contextBridge.exposeInMainWorld 会失效 —— 表现为
      // window.electronAPI 是 undefined，遮罩层既截不到图也关不掉
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  captureWindow.setAlwaysOnTop(true, 'screen-saver')

  /*
   * 兜底：注册一个自毁快捷键。
   *
   * 遮罩层铺满屏幕，一旦渲染层出问题（白屏、脚本报错、接口不可用），
   * 用户就没有任何办法退出，只能强杀进程。这里在主进程侧留一个不依赖
   * 渲染层的退出方式 —— 渲染层的 Esc 已经有一层，但它在同一侧，共命运。
   */
  globalShortcut.register('Escape', () => {
    if (captureWindow) closeCaptureWindow()
  })

  // 窗口被系统或用户关掉时，别把 Escape 留在全局注册表里 ——
  // 否则正常使用时按 Esc 会被这个残留的注册吃掉
  captureWindow.on('closed', () => {
    globalShortcut.unregister('Escape')
    captureWindow = null
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void captureWindow.loadURL(`${devServerUrl}?capture=1`)
  } else {
    void captureWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      search: 'capture=1',
    })
  }

  /*
   * 图抓到、页面也加载完了，才把遮罩显示出来。
   *
   * 用 Promise.all 等两件事：图没抓到就显示会露出桌面一片空白；
   * 页面没加载完就显示会先闪一下透明白窗。
   */
  captureWindow.webContents.once('did-finish-load', async () => {
    let payload: unknown
    try {
      payload = await captureShotPromise
    } catch (e) {
      payload = { error: e instanceof Error ? e.message : '截图失败' }
    }
    captureWindow?.show()
    captureWindow?.focus()
    captureWindow?.webContents.send('capture:ready', payload)
  })
}

/** 抓主屏全屏图，转 dataURL */
async function grabPrimaryScreen() {
  const primary = screen.getPrimaryDisplay()
  const scale = primary.scaleFactor || 1
  const { width, height } = primary.size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    // 按物理分辨率抓：截图要拿去 OCR，缩过会掉识别率
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  })
  const target = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
  if (!target) throw new Error('没有可截取的屏幕')

  return {
    dataUrl: target.thumbnail.toDataURL(),
    // 逻辑尺寸，框选坐标按它算
    width,
    height,
    scaleFactor: scale,
  }
}

/** 关掉遮罩窗口。框选完成或取消都走这里 */
function closeCaptureWindow(): void {
  captureWindow?.close()
  captureWindow = null
  // 缓存要清掉：那是一张全屏图，留着白占几 MB 内存
  captureShotPromise = null
}

/* ==================== 草稿纸：置顶小窗 ==================== */

/** 小窗尺寸与位置在 electron-store 里的键。关窗时记，下次开还原 */
const SCRATCH_BOUNDS_KEY = 'scratch-window-bounds'
const SCRATCH_DEFAULT_SIZE = { width: 420, height: 480 }
/** 缩到多小就不让再缩了，再小写不下几行字 */
const SCRATCH_MIN_SIZE = { width: 280, height: 220 }

/** 校验从 store 读回来的窗口位置：显示器可能已经拔了，越界的坐标会把窗口丢到看不见的地方 */
function readScratchBounds(): Electron.Rectangle | null {
  const saved = store.get(SCRATCH_BOUNDS_KEY) as Partial<Electron.Rectangle> | undefined
  if (!saved || typeof saved !== 'object') return null
  const { x, y, width, height } = saved
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null
  }

  const rect = {
    x: x as number,
    y: y as number,
    width: Math.max(SCRATCH_MIN_SIZE.width, width as number),
    height: Math.max(SCRATCH_MIN_SIZE.height, height as number),
  }

  // 至少要有 80px 落在某块屏幕里，否则还原出来是个「在屏幕外」的窗口
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      rect.x + rect.width > area.x + 80 &&
      rect.x < area.x + area.width - 80 &&
      rect.y + rect.height > area.y + 40 &&
      rect.y < area.y + area.height - 40
    )
  })
  return visible ? rect : null
}

/**
 * 打开（或唤起）草稿纸小窗。
 *
 * 单例：已经开着就只调出来，不开第二个 —— 同一份草稿被两个窗口同时编辑，
 * 后写的会把先写的覆盖掉。
 */
function openScratchWindow(): void {
  if (scratchWindow && !scratchWindow.isDestroyed()) {
    if (scratchWindow.isMinimized()) scratchWindow.restore()
    scratchWindow.show()
    scratchWindow.focus()
    return
  }

  const saved = readScratchBounds()
  const bounds = saved ?? {
    ...SCRATCH_DEFAULT_SIZE,
    // 首次打开摆在主窗口右侧，像从主窗口「撕」下来的一张纸
    x: mainWindow ? mainWindow.getBounds().x + mainWindow.getBounds().width + 16 : undefined,
    y: mainWindow ? mainWindow.getBounds().y : undefined,
  }

  const window = new BrowserWindow({
    ...bounds,
    minWidth: SCRATCH_MIN_SIZE.width,
    minHeight: SCRATCH_MIN_SIZE.height,
    frame: false,
    // 置顶：做前后端开发时它要能浮在编辑器、终端、浏览器上面
    alwaysOnTop: true,
    fullscreenable: false,
    // 小窗自己画不出阴影，让系统给一层，脱离主窗口时才有「浮着」的层次
    hasShadow: true,
    title: '草稿纸',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  scratchWindow = window

  // 置顶层级用 floating：既压得住普通窗口，又不会盖住系统弹窗与输入法候选框
  window.setAlwaysOnTop(true, 'floating')
  registerWindowShortcuts(window)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}?scratch=1`)
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'scratch=1' })
  }

  window.once('ready-to-show', () => window.show())

  // 拖动 / 缩放结束后落盘。用 'resized' + 'moved' 而不是监听 'resize' 过程中的每一帧，
  // 避免拖拽时几十次写盘
  const persistBounds = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    store.set(SCRATCH_BOUNDS_KEY, window.getBounds())
  }
  window.on('resized', persistBounds)
  window.on('moved', persistBounds)

  window.on('closed', () => {
    scratchWindow = null
  })
}

/** 关掉草稿纸小窗（渲染层的 ✕ 走这里） */
function closeScratchWindow(): void {
  if (scratchWindow && !scratchWindow.isDestroyed()) scratchWindow.close()
  scratchWindow = null
}

/**
 * 唤起窗口并切到指定工具页。
 *
 * 三步都要做：最小化的窗口只 show() 还会缩在坞里，必须 restore()；
 * 再 focus() 拿到焦点，否则窗口只在后面闪一下。窗口还没建出来时
 * 要等 did-finish-load 再发跳转指令，否则消息发出去没人接。
 */
async function focusWindowAndOpenTool(toolId: string): Promise<void> {
  if (!mainWindow) {
    // createMainWindow 是通过副作用给 mainWindow 赋值的，TS 的控制流分析
    // 不认这一点，会把这里的 mainWindow 一直当成 null（进而提示 never），
    // 所以走断言把类型放开
    createMainWindow()
    const created = mainWindow as BrowserWindow | null
    created?.webContents.once('did-finish-load', () => {
      created.webContents.send('tool:open-request', toolId)
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('tool:open-request', toolId)
}

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

  for (const filePath of Array.from(pendingOpenFiles)) {
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
  let icon: Electron.NativeImage | null = null
  
  for (const file of [...iconFiles]) {
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
    // 主窗口关掉是收进托盘，草稿纸是独立小窗，托盘里得单独给个入口
    { label: '打开草稿纸', click: () => openScratchWindow() },
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

  /**
   * 系统通知。
   *
   * 带关闭回调：截图取字的结果是异步回来的，用户很可能已经把窗口切走了，
   * 那时候得主动把窗口拉回前台，否则识别完了也没人看见。
   */
  ipcMain.handle(
    'show-notification',
    (_, title: string, body: string, options?: { focusMainWindow?: boolean }) => {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title, body })
      if (options?.focusMainWindow) {
        notification.on('click', () => {
          if (!mainWindow) {
            createMainWindow()
            return
          }
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        })
      }
      notification.show()
    }
  )

  ipcMain.handle('open-tool', (_, toolName: string) => {
    createToolWindow(toolName)
  })

  /* ---------------- 草稿纸置顶小窗 ---------------- */

  ipcMain.handle('scratch-open', () => {
    openScratchWindow()
  })

  ipcMain.handle('scratch-close', () => {
    closeScratchWindow()
  })

  /**
   * 重新钉在最上层。
   *
   * 置顶标志有时会被系统或其他置顶窗口顶掉（切全屏、显示器热插拔），
   * 界面上留一个「图钉」按钮，让用户能手动把它按回最前。
   */
  ipcMain.handle('scratch-pin', (event, pinned: boolean) => {
    const window = windowOf(event)
    if (!window) return
    if (pinned) window.setAlwaysOnTop(true, 'floating')
    else window.setAlwaysOnTop(false)
  })

  /* ---------------- 端口占用排查 ---------------- */

  ipcMain.handle('ports-common', () => COMMON_PORTS)

  /**
   * 查端口占用。
   *
   * 单项失败（比如系统没装 lsof）不能把整个列表拖垮 —— 每个端口各自兜住异常，
   * 失败的那个返回 error 字段，界面按「查不到」呈现即可。
   */
  ipcMain.handle('ports-inspect', async (_, ports: number[]) => {
    const list = Array.isArray(ports) ? ports.filter((p) => Number.isInteger(p)) : []

    return await Promise.all(
      list.map(async (port) => {
        try {
          const listeners = await inspectPort(port)
          return { port, listeners }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // lsof 查无结果时以退出码 1 收场，execFile 会把它抛成异常 ——
          // 这不是错误，是「这个端口没人监听」
          const nothingFound = /command failed/i.test(message) && !/permission/i.test(message)
          return {
            port,
            listeners: [],
            ...(nothingFound ? {} : { error: message }),
          }
        }
      }),
    )
  })

  ipcMain.handle('ports-kill', async (_, pid: number) => {
    return await killProcess(pid)
  })


  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  /**
   * 保存快捷键配置并立刻生效。
   *
   * 返回 failed：注册失败的 id 列表。调用方要把这个回显到界面上 ——
   * 用户设的键可能被别的应用占着，静默失败会让人以为设成了。
   */
  ipcMain.handle('set-shortcuts', (_, map: Record<string, string>) => {
    store.set(SHORTCUT_STORAGE_KEY, map)
    return applyGlobalShortcuts()
  })

  /** 读当前生效的全局快捷键映射，供设置界面回显 */
  ipcMain.handle('get-shortcuts', () => {
    return readShortcutMap()
  })

  /**
   * 录制快捷键期间暂停 / 恢复全局快捷键。
   *
   * 必须暂停：录制 ⌥A 时如果它已经注册着，按下去会当场把窗口唤起、抢走焦点，
   * 录制框就收不到这次按键了。这里只是临时注销，不动存储里的配置。
   */
  ipcMain.handle('set-shortcut-recording', (_, recording: boolean) => {
    if (recording) globalShortcut.unregisterAll()
    else applyGlobalShortcuts()
  })

  /** 渲染层主动请求开截图（比如翻译页上的按钮） */
  ipcMain.handle('start-capture', () => {
    createCaptureWindow()
  })

  /**
   * 遮罩层的渲染进程就绪后主动来拉一次截图。
   *
   * 主进程推图是在 did-finish-load，那是「HTML 加载完」，React 的 effect
   * 可能还没跑、监听还没挂上，推过去的消息就丢了 —— 表现为只有遮罩没有底图。
   * 两条路径都留着，谁先到谁用，读的都是同一份缓存。
   */
  ipcMain.handle('request-capture-shot', async () => {
    if (!captureShotPromise) return { error: '没有可用的截图' }
    try {
      return await captureShotPromise
    } catch (e) {
      return { error: e instanceof Error ? e.message : '截图失败' }
    }
  })

  /**
   * 框选完成：拿到裁剪好的图片，转交主窗口去做 OCR + 翻译。
   *
   * 先关遮罩再发消息：遮罩是 alwaysOnTop 的，不关掉会把主窗口盖住，
   * 用户看不到识别结果。
   */
  ipcMain.handle('finish-capture', (_, dataUrl: string) => {
    closeCaptureWindow()
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('capture:ocr-request', dataUrl)
  })

  ipcMain.handle('cancel-capture', () => {
    closeCaptureWindow()
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

  /**
   * 流式翻译代理。
   *
   * 不用 invoke 的一问一答，因为流式是「一发多收」：请求一次，结果分很多
   * 次推回来。改成 webContents.send 主动推，渲染层按 requestId 归拢
   * —— 用户连打几个字会并发好几个请求，得能对上号。
   */
  ipcMain.handle(
    'translate-stream-start',
    (
      event,
      options: {
        requestId: string
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        timeout?: number
      }
    ) => {
      const { requestId, ...rest } = options
      const send = (channel: string, payload: unknown) => {
        // 窗口可能已经关了，发之前确认一下，否则会抛 "Object has been destroyed"
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, { requestId, ...(payload as object) })
        }
      }

      const handle = fetchViaNetStream({
        ...rest,
        onChunk: (chunk) => send('translate-stream-chunk', { chunk }),
        onEnd: (error) => send('translate-stream-end', { error }),
      })

      streamHandles.set(requestId, handle)
    }
  )

  /** 中断流式请求（用户改了输入、或关掉页面） */
  ipcMain.handle('translate-stream-abort', (_, requestId: string) => {
    streamHandles.get(requestId)?.abort()
    streamHandles.delete(requestId)
  })

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

  // 按用户配置注册全局快捷键（没配置就用内置默认值）
  applyGlobalShortcuts()

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
  // 草稿纸是常驻置顶的小窗，退出时得一并收掉，否则会留下一个唤不回的窗口
  closeScratchWindow()
})
