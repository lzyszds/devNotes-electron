import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, screen, systemPreferences, Tray, globalShortcut, Notification, nativeImage, shell } from 'electron'
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
import {
  deleteImageFiles,
  installClipProtocolHandler,
  loadImageDataUrl,
  removeOrphanImageFiles,
  registerClipProtocolScheme,
  saveImageEntryToDisk,
} from './clipboardImages'
import {
  addOutboxFiles,
  addOutboxText,
  clearInbox,
  clearOutbox,
  copyInboxItem,
  deleteInboxItem,
  listInbox,
  listOutbox,
  readInboxThumb,
  removeOutbox,
  revealInboxItem,
  setAutoCopy,
  setInboxListener,
  startLanTransfer,
  status as lanStatus,
  stopLanTransfer,
} from './lanTransfer'
import { COMMON_PORTS, inspectPort, killProcess } from './ports'
import { httpProbe, startPing, tcpProbe, validateHost, validatePort, type PingOptions } from './netProbe'
import { listLocalInterfaces, queryPublicIp } from './netInfo'
import { HASH_ALGORITHMS, hashFiles, type HashAlgorithm } from './hashFile'
import { getSystemHardwareInfo, getProcessMemoryList } from './systemInfo'
import { setupAutoUpdater } from './updater'
import { captureMacRegion } from './macRegionCapture'
import { captureWindowsRegion, isWindowsNativeAvailable, releaseWindowsNativeResult } from './windowsNativeCapture'
import { lightOcrRecognize, shutdownLightOcr } from './lightOcr'
import { initDebugLog, mainLog, registerRendererLogIpc } from './debugLog'
import {
  MAX_ENTRIES,
  buildEntry,
  shouldCapture,
  startClipboardWatch,
  type ClipboardEntry,
} from './clipboardHistory'
import {
  lastPasteFailure,
  openAccessibilitySettings,
  pasteModuleLoadError,
  pasteToFocusedApp,
  pasteImageToFocusedApp,
  pasteFileToFocusedApp,
  copyImageToClipboard,
} from './pasteToApp'
import type { IpcMainInvokeEvent } from 'electron'

/**
 * 本地原生 addon（native/ 目录编译出的 .node）：给剪贴板窗口设置
 * nonactivatingPanel mask，让它交互时不激活 app。这是 Electron 原生
 * focusable 选项给不了的（focusable 只控制 key window，挡不住 app 激活）。
 *
 * 编译不出 .node 或平台不对就返回 null，调用方退回 focusable: false +
 * showInactive 的过渡方案，保证非 mac 平台不崩。
 */
let nonactivatingFn: ((handle: Buffer) => void) | null | undefined

function loadNonactivating(): ((handle: Buffer) => void) | null {
  if (process.platform !== 'darwin') return null
  if (nonactivatingFn !== undefined) return nonactivatingFn
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = app.isPackaged
      ? path.join(process.resourcesPath, 'native/nonactivating.node')
      : path.join(__dirname, '../native')
    const mod = require(modulePath) as {
      makeNonActivating?: (handle: Buffer) => void
    }
    nonactivatingFn = typeof mod.makeNonActivating === 'function' ? mod.makeNonActivating : null
  } catch (error) {
    nonactivatingFn = null
    console.warn('[clipboard] 不抢焦点组件加载失败，退回鼠标操作模式：', error)
  }
  return nonactivatingFn
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** 非 macOS 的框选遮罩；macOS 走系统原生选区，不创建此窗口 */
let captureWindow: BrowserWindow | null = null
/** 从权限检查到框选结束均保持单例，避免连按快捷键启动多个系统截图进程 */
let captureOpening = false
let macCaptureController: AbortController | null = null
let windowsCaptureController: AbortController | null = null
/** 已在退出流程中：截图回退不能在这时再开新窗口 */
let quitting = false
/** 草稿纸小窗。单例 —— 反复唤起只把它调出来，不开第二个 */
let scratchWindow: BrowserWindow | null = null
/** 剪贴板取词面板。同样是单例 */
let clipboardWindow: BrowserWindow | null = null
/**
 * 面板最近一次拿到的列表。
 *
 * 面板隐藏期间主进程不再推全量（上万条数据的克隆不便宜），所以它内存里的
 * 列表可能过期。唤起时主进程先把这个缓存放进来、再 show，面板读缓存即刻
 * 显示最新内容 —— 缓存由主进程每次改动列表时同步维护，永远是当前真值。
 */
let lastClipboardList: ClipboardEntry[] = []

/**
 * 列表变动的唯一出口：更新内存列表 / 缓存 / 落盘，面板可见才推。
 *
 * 全仓库不再允许直接给 clipboardEntries 赋值 —— 漏一次缓存或漏一次落盘，
 * 面板就会显示旧数据、重启就丢历史。加/删/清/迁移/渲染层回写统一走这里。
 */
function commitClipboardEntries(next: ClipboardEntry[], persist = true): void {
  clipboardEntries = next
  lastClipboardList = next
  if (persist) store.set(CLIPBOARD_HISTORY_KEY, next)
  if (clipboardWindow && !clipboardWindow.isDestroyed() && clipboardWindow.isVisible()) {
    clipboardWindow.webContents.send('clipboard:changed', next)
  }
}
/** 剪贴板轮询计时器 */
let clipboardTimer: NodeJS.Timeout | null = null
/** 本次框选的截图结果，缓存起来供推 / 拉两条路径共用（见 createCaptureWindow） */
let captureShotPromise: Promise<unknown> | null = null
/** 进行中的流式翻译请求，按 requestId 索引，供中途中断 */
const streamHandles = new Map<string, { abort: () => void }>()

// 必须在 new Store() 之前执行：migrateUserDataIfNeeded 决定本次启动读哪个 userData 目录
// dnclip 协议的 privileged scheme 登记同样卡在 ready 前，错过时机注册会直接抛错
migrateUserDataIfNeeded()
registerClipProtocolScheme()

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
    void openCapture()
  },
  // 草稿纸是独立小窗，跟主窗口的显隐无关 —— 主窗口收进托盘时它照样能唤出来
  'open-scratchpad': () => {
    openScratchWindow()
  },
  'open-clipboard': () => {
    openClipboardWindow()
  },
}

/** 主进程侧的默认键位。渲染端的默认值在 shortcutSettings.ts，两边要保持一致 */
const GLOBAL_SHORTCUT_DEFAULTS: Record<string, string> = {
  'toggle-window': 'Alt+Shift+F',
  'open-translate': 'Alt+Shift+T',
  'screenshot-translate': 'Alt+Shift+S',
  'open-scratchpad': 'Alt+Shift+N',
  'open-clipboard': 'Alt+Shift+V',
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
 * 确保已获得「屏幕录制」权限，没有就先申请 / 引导，拿到后再继续。
 *
 * 必须在开遮罩窗口**之前**做完：抓屏（desktopCapturer.getSources）在
 * macOS 上受「屏幕录制」权限约束，而首次调用会由系统弹出授权窗。遮罩
 * 窗口是 alwaysOnTop 的，若先开窗再弹授权，用户可能被遮罩挡住、点不到
 * 「允许」—— 顺序反了就会卡死。
 *
 * 返回是否已授权；只有 true 才允许调用方开窗。
 */
async function ensureScreenPermission(): Promise<boolean> {
  // 非 macOS 没有屏幕录制权限这个概念，直接放行
  if (process.platform !== 'darwin') return true

  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return true

  // 被家长控制 / 企业策略锁死，或用户拒绝过：系统不会再弹窗，只能引导去设置
  if (status === 'denied' || status === 'restricted') {
    const locked = status === 'restricted'
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: '需要「屏幕录制」权限才能截图取字',
      detail: locked
        ? '当前系统策略限制了屏幕录制权限，无法授权。'
        : '请在系统设置 → 隐私与安全性 → 屏幕录制里勾选 devNotes，然后重试。',
      buttons: locked ? ['知道了'] : ['打开设置', '取消'],
      defaultId: 0,
      cancelId: locked ? 0 : 1,
    })
    if (!locked && response === 0) {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
    return false
  }

  // macOS 不支持 askForMediaAccess('screen')，该接口只支持麦克风和摄像头。
  // 尚未决定时让系统截图调用触发屏幕录制授权；用户授权后若系统要求重启再重试。
  return true
}

/** 快捷键与按钮共用入口；原生框选期间不聚焦主窗口，保留当前桌面的状态。 */
async function openCapture(): Promise<void> {
  if (captureOpening || captureWindow || quitting) return
  captureOpening = true
  const controller = new AbortController()
  try {
    if (!await ensureScreenPermission()) return

    // Windows：独立原生助手按需启动，用完即退，不常驻截图页面。
    if (process.platform === 'win32' && isWindowsNativeAvailable()) {
      windowsCaptureController = controller
      let outcome: Awaited<ReturnType<typeof captureWindowsRegion>>
      try {
        outcome = await captureWindowsRegion(controller.signal)
      } finally {
        windowsCaptureController = null
      }

      if (outcome.status === 'ok') {
        mainLog('[capture] Windows 原生框选成功')
        try {
          deliverCapture(`data:image/png;base64,${outcome.result.image.toString('base64')}`)
        } finally {
          await releaseWindowsNativeResult(outcome.result)
        }
        return
      }
      // 用户按了取消，或应用正在退出：都不再弹一层遮罩
      if (outcome.status === 'cancelled' || controller.signal.aborted || quitting) return

      // 助手没跑起来 / 抓不到桌面：回退一次内置遮罩，别让截图功能整个不可用。
      // 走到这里 windowsCaptureController 已清空，回退的遮罩不会被当成原生截图。
      console.warn('[capture] 原生截图失败，回退内置遮罩：', outcome.reason)
      createCaptureWindow()
      return
    }

    if (process.platform !== 'darwin') {
      createCaptureWindow()
      return
    }

    macCaptureController = controller
    try {
      const image = await captureMacRegion(controller.signal)
      mainLog('[capture] macOS 框选返回', image ? `${image.length} 字节` : 'null')
      if (image) {
        deliverCapture(`data:image/png;base64,${image.toString('base64')}`)
      } else if (!controller.signal.aborted) {
        // Esc 和首次拒绝授权都可能不生成文件；拒绝时补上权限引导，不能静默失败。
        const status = systemPreferences.getMediaAccessStatus('screen')
        if (status === 'denied' || status === 'restricted') await ensureScreenPermission()
      }
    } finally {
      macCaptureController = null
    }
  } catch (error) {
    console.error('[capture]', error)
    if (!controller.signal.aborted) {
      void dialog.showMessageBox({
        type: 'error',
        message: '截图失败',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    captureOpening = false
  }
}

/**
 * 把主窗口拉到屏幕最前并要焦点。
 *
 * 截图翻译的触发点常在别的应用里：框选结束时前台还是那个应用，而 Windows
 * 只允许前台进程调 SetForegroundWindow —— 只 show()/focus() 的话，窗口可能
 * 排在原应用后面。先临时置顶一帧再还回去，让它在不动聚焦规则的情况下
 * 盖到最前。
 */
function raiseMainWindow(): void {
  mainWindow?.setAlwaysOnTop(true, 'screen-saver')
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.setAlwaysOnTop(false)
}

/** 原生选区和自定义选区统一把结果送给常驻主窗口，不在截图页加载 OCR。 */
/**
 * 最近一次截图结果。
 *
 * **只在「主窗口这一版页面还没挂好监听」时才留**，而且只会留一个很短的窗口期：
 * 渲染层的 App 挂载后会立刻发 capture:ocr-ready，主进程收到就补推这张图并
 * 立刻清空（见 handleCaptureOcrReady）。
 *
 * 以前的写法是「推送的同时无条件存一份，等渲染层来拉」—— 推送明明成功了，
 * 这份缓存却没人清，一直躺在主进程里；下次刷新页面时 App 挂载又拉一次，
 * 于是「每次刷新都会把上一次的截图重新识别一遍」。别改回去。
 */
let pendingCapture: string | null = null

/**
 * 主窗口这一版页面是否已经在听 capture:ocr-request。
 *
 * 和下面的 rendererReady 不是一回事：rendererReady 要等笔记数据加载完才发，
 * 截图翻译冷启动时等不起。这个信号由 App 的截图订阅 effect 发出，是「监听
 * 挂上了」最贴近的信号。
 *
 * reload / 重新加载页面时 webContents 还是同一个，所以要显式在 did-start-loading
 * 里清掉 —— 页面一刷新，旧的监听就没了，新的一版挂好之前都算「没就绪」。
 */
let captureListenerReady = false

/** 原生选区和自定义选区统一把结果送给常驻主窗口，不在截图页加载 OCR。 */
function deliverCapture(dataUrl: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    raiseMainWindow()
    if (captureListenerReady) {
      /*
       * 监听已经挂好了：直接推，**不留缓存**。
       *
       * 这是「刷新页面就重放上次截图」的根治点 —— 推送成功后还把图留在
       * pendingCapture 里，就等于让下一次页面加载再识别一遍。
       */
      mainLog('[capture] 推送识别请求（渲染层已就绪，不留缓存），字节数', Math.round(dataUrl.length / 1024), 'KB')
      mainWindow.webContents.send('capture:ocr-request', dataUrl)
      return
    }

    // 还没挂好监听（冷启动刚打开窗口 / 页面刚 reload）：留一份，等 ready 信号补推
    pendingCapture = dataUrl
    mainLog('[capture] 渲染层未就绪，暂存待补推，字节数', Math.round(dataUrl.length / 1024), 'KB')
    return
  }

  /*
   * 主窗口被用户真关过（closed → mainWindow 为 null）：当场重建，截图结果
   * 不能吞掉。
   *
   * 先存进 pendingCapture 再重建：did-finish-load 只是「HTML 加载完」，
   * React 的监听那时还没挂 —— 直接在这里 send 大概率落空。存下来让渲染层
   * 挂好监听后发 ready 信号来补推，是唯一可靠的一路。
   */
  pendingCapture = dataUrl
  mainLog('[capture] 主窗口不存在，重建后补推，字节数', Math.round(dataUrl.length / 1024), 'KB')
  createMainWindow()
}

/**
 * 非 macOS 使用铺满主屏的无边框窗口框选。
 * 截图在显示前完成，渲染层通过推送与主动拉取共用同一张底图。
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
  const shotPromise = grabPrimaryScreen().catch((error: unknown) => ({
    error: error instanceof Error ? error.message : '截图失败',
  }))
  captureShotPromise = shotPromise

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    backgroundColor: '#0f172a',
    paintWhenInitiallyHidden: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    /*
     * 先不显示。抓屏必须发生在窗口显示**之前** —— 否则拍到的是自己那层
     * 遮罩，底图就是灰的。这里不设 show: false 的话窗口创建即显示；
     * 真正 show 的时机在渲染层把底图画好之后（见下面的 capture:shown）。
     */
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 必须跟主窗口一致用 true。contextIsolation 为 false 时 preload 跑在
      // 渲染进程主世界里，contextBridge.exposeInMainWorld 会失效 —— 表现为
      // window.electronAPI 是 undefined，遮罩层既截不到图也关不掉
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏时也要走绘制帧，等真实底图完成后才显示，而不是定时猜加载时间。
      backgroundThrottling: false,
    },
  })
  captureWindow = win

  /*
   * 用 'floating' 而不是 'screen-saver'。
   *
   * 'screen-saver' 是 macOS 上的最高层级，会盖住系统权限弹窗（辅助功能、
   * 屏幕录制等）—— 用户申请权限时看不到弹窗，又退不出遮罩，等于卡死。
   * 'floating' 已经高于普通应用窗口，压住别人的界面没问题，同时把
   * 权限弹窗的层级让出来。
   */
  win.setAlwaysOnTop(true, 'floating')

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
  const reveal = (event: Electron.IpcMainEvent) => {
    if (event.sender !== win.webContents || win.isDestroyed() || win.isVisible()) return
    clearTimeout(loadTimer)
    win.show()
    win.focus()
  }
  ipcMain.on('capture:shown', reveal)

  // 加载失败只关闭并报错，绝不把尚未准备好的全屏背景色展示给用户。
  const fail = (error: unknown) => {
    if (win.isDestroyed() || captureWindow !== win) return
    closeCaptureWindow()
    void dialog.showMessageBox({
      type: 'error',
      message: '截图界面加载失败',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  const loadTimer = setTimeout(() => fail(new Error('截图界面加载超时，请重试')), 15000)
  win.on('closed', () => {
    clearTimeout(loadTimer)
    ipcMain.removeListener('capture:shown', reveal)
    if (captureWindow === win) {
      globalShortcut.unregister('Escape')
      captureWindow = null
      captureShotPromise = null
    }
  })
  win.webContents.on('render-process-gone', () => fail(new Error('截图渲染进程已退出')))
  win.webContents.once('did-finish-load', async () => {
    const payload = await shotPromise
    // 闭包绑定本次窗口和截图，取消后的旧异步任务不能污染下一次截图。
    if (!win.isDestroyed()) win.webContents.send('capture:ready', payload)
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const loading = devServerUrl
    ? win.loadURL(`${devServerUrl}?capture=1`)
    : win.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'capture=1' })
  void loading.catch(fail)
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

/** 先隐藏完整画面，再销毁表面，避免关闭期间露出 BrowserWindow 的背景色。 */
function closeCaptureWindow(): void {
  const win = captureWindow
  if (!win || win.isDestroyed()) return
  win.hide()
  win.close()
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

/* ---------------- 剪贴板历史 ---------------- */

const CLIPBOARD_HISTORY_KEY = 'clipboard-history'
const CLIPBOARD_BOUNDS_KEY = 'clipboard-window-bounds'
const CLIPBOARD_DEFAULT_SIZE = { width: 460, height: 520 }
const CLIPBOARD_MIN_SIZE = { width: 360, height: 320 }
/** 内存里留一份，轮询每 700ms 一次，不能每次都读盘比对 */
let clipboardEntries: ClipboardEntry[] = []

/**
 * 校验从 store 读回的窗口位置。
 *
 * 与草稿纸同理：显示器可能已经拔了，越界坐标会把窗口丢到看不见的地方，
 * 下次唤起时用户以为快捷键坏了。
 */
function readClipboardBounds(): Partial<Electron.Rectangle> | undefined {
  const saved = store.get(CLIPBOARD_BOUNDS_KEY) as Partial<Electron.Rectangle> | undefined
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return undefined
  const displays = screen.getAllDisplays()
  const onScreen = displays.some((display) => {
    const { x, y, width, height } = display.workArea
    return (
      typeof saved.x === 'number' &&
      typeof saved.y === 'number' &&
      saved.x < x + width &&
      saved.y < y + height &&
      saved.x + saved.width! > x &&
      saved.y + saved.height! > y
    )
  })
  return onScreen ? saved : undefined
}

function loadClipboardHistory(): void {
  const saved = store.get(CLIPBOARD_HISTORY_KEY)
  const list = Array.isArray(saved) ? (saved as ClipboardEntry[]) : []

  /*
   * 清掉 Promise 化时期留下的脏数据。
   *
   * readText() 改成异步后，有一版代码把未 await 的 Promise 字符串化存了进来
   * （内容就是 "[object Promise]"）。这些条目本身没意义，留着只会占位置，
   * 加载时顺手剔除 —— 代码改了但历史不清，用户会以为 bug 还在。
   */
  const cleaned = list.filter((entry) => entry && entry.text !== '[object Promise]')
  // 加载阶段面板还没建，isVisible 分支不会推；脏数据清除要落盘，不落的话每次开机都白清一遍
  commitClipboardEntries(cleaned, cleaned.length !== list.length)
}

/*
 * 旧版迁移：历史 JSON 里曾直接内嵌图片 base64（如今只允许存 imageId 指针）。
 * 逐条把 inline 图片搬到磁盘文件（原图 + 缩略图），完成后清掉 JSON 里的 inline
 * 数据并整体重写历史 JSON。一次性任务，跑在 startClipboardCapture 里后台执行，
 * 不阻塞启动；迁移完成顺手再做孤儿文件兜底清理。
 */
async function migrateLegacyInlineClipboardImages(): Promise<void> {
  if (!clipboardEntries.some((entry) => entry.type === 'image' && entry.imageDataUrl)) {
    // 没有旧格式数据，也照做一次孤儿清理：删条目只删 JSON 的历史包袱在这里还债
    removeOrphanImageFiles(clipboardEntries)
    return
  }

  const migrated: ClipboardEntry[] = []
  for (const entry of clipboardEntries) {
    if (entry.type === 'image' && entry.imageDataUrl) {
      try {
        migrated.push(await saveImageEntryToDisk(entry))
      } catch {
        // 单条失败保持 inline 数据，不动它
        migrated.push(entry)
      }
    } else {
      migrated.push(entry)
    }
  }
  // 迁移完成后统一提交：落盘 + 补缩略图（面板可见才会推）
  commitClipboardEntries(migrated)
  removeOrphanImageFiles(migrated)
}

/** 入库时把「附件文件跟随条目生死」封装起来：删条目必须连图片文件一起删 */
function deleteImageFilesForIds(ids: string[]): void {
  for (const id of ids) deleteImageFiles(id)
}

/**
 * 单条入库：inline 图片先转成文件态，再头部插入 + 超量裁剪 + 落盘。
 *
 * 用链式 promise 串行化：图片落盘是异步的，两次采集 tick 之间如果并发跑
 * 会导致插入顺序错乱。
 */
let appendEntryChain: Promise<void> = Promise.resolve()

function appendClipboardEntry(entry: ClipboardEntry): void {
  appendEntryChain = appendEntryChain.then(async () => {
    let settled = entry
    if (entry.type === 'image' && entry.imageDataUrl) {
      try {
        settled = await saveImageEntryToDisk(entry)
      } catch {
        // 转换失败保留 inline base64 兜底，图不能丢
      }
    }

    // 淘汰超量的旧条目，被挤掉的图片条目连文件一起清
    const merged = [settled, ...clipboardEntries]
    const dropped = merged.slice(MAX_ENTRIES)
    deleteImageFilesForIds(
      dropped.filter((droppedEntry) => droppedEntry.type === 'image').map((e) => e.id)
    )
    // 面板可见才推全量列表：面板隐藏时它靠唤起时的缓存同步（见 lastClipboardList），
    // 关着推送纯属白克隆上万条数据
    commitClipboardEntries(merged.slice(0, MAX_ENTRIES))
  }).catch((error) => {
    /*
     * 链尾必须有 catch：没有它，任何一次入库异常都会让 appendEntryChain 变成
     * rejected 且永不再前进 —— 剪贴板从此静默停止记录，比偶发丢一条严重得多。
     * 捕获后重新赋值成已 resolve 的链，下一 tick 继续正常工作。
     */
    console.warn('[clipboard] 入库失败：', error)
  })
}

/**
 * 开始采集。
 *
 * 剪贴板历史已接入云同步，但遵循严格约束：
 * 上云时图片数据一律丢弃，并在云端标记为【图片】，
 * 保证服务器硬盘 0 压力，同时让文本与代码片段能在多端跨设备流转。
 */
function startClipboardCapture(): void {
  loadClipboardHistory()
  clipboardStop?.()

  /*
   * 旧版 inline 图片迁磁盘与「采集入库」共用同一条串行链 —— 迁移要处理
   * 数秒，期间用户复制东西若并发进行，迁移尾部拿快照覆写会把新条目挤丢。
   * catch 同样必要：迁移失败不能毒化后续所有入库
   */
  appendEntryChain = appendEntryChain
    .then(() => migrateLegacyInlineClipboardImages())
    .catch((error) => console.warn('[clipboard] 旧图片迁移失败：', error))

  clipboardStop = startClipboardWatch((entry) => {
    /*
     * 只对文本走 shouldCapture（敏感词过滤 + 与最新一条去重）。
     * 图片在采集层已经按 PNG 指纹去重过了，且没有「敏感」问题，
     * 这里直接放行 —— 之前拿 entry.text（图片条目是 undefined）喂
     * shouldCapture，非字符串一律返回 false，图片全被丢掉了。
     */
    if (entry.type === 'text' && !shouldCapture(entry.text, clipboardEntries[0])) return
    appendClipboardEntry(entry)
  })
}

let clipboardStop: (() => void) | null = null

/**
 * 面板隐藏时的闲置销毁。
 *
 * 面板数据全部来自主进程（clipboardList 推拉共用 clipboardEntries），
 * 渲染层没有独占状态，销毁重建零损失；隐藏不复用的话，下一次唤起要
 * 重开一整个渲染进程 + 加载应用前端（几百毫秒）。折衷：先隐藏保留
 * 快速唤起，闲置 10 分钟仍不可见就销毁 —— 偷懒常驻的渲染进程至少
 * 有一份完整应用前端的内存（几十上百 MB），用户看不见不该一直背着。
 */
const CLIPBOARD_IDLE_DESTROY_MS = 10 * 60_000
let clipboardIdleTimer: NodeJS.Timeout | null = null

function cancelClipboardIdleDestroy(): void {
  if (clipboardIdleTimer !== null) {
    clearTimeout(clipboardIdleTimer)
    clipboardIdleTimer = null
  }
}

function scheduleClipboardIdleDestroy(): void {
  cancelClipboardIdleDestroy()
  clipboardIdleTimer = setTimeout(() => {
    clipboardIdleTimer = null
    // 期间没有被再次唤起（唤起会清掉这个定时器）才动手
    if (clipboardWindow && !clipboardWindow.isDestroyed() && !clipboardWindow.isVisible()) {
      clipboardWindow.close()
    }
  }, CLIPBOARD_IDLE_DESTROY_MS)
}

function openClipboardWindow(): void {
  // 原生 addon 是否可用：可用则走「nonactivating mask + show/focus」的完整方案
  // （不抢焦点、有 hover、有键盘）；不可用则退回 focusable: false + showInactive。
  const nonactivating = loadNonactivating()
  // 唤起即取消闲置销毁
  cancelClipboardIdleDestroy()

  // devNotes 是否在前台。面板是 non-activating 的，不抢焦点，所以这个
  // 只用来决定「要不要把主窗口藏起来」，粘贴不再需要它记目标应用。
  const wasForeground = Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()
  )

  /*
   * 外部场景（用户在别的应用里唤面板）：先把主窗口藏起来，
   * 免得面板出现时主窗口跟着浮上来。
   */
  if (!wasForeground && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
  }

  if (clipboardWindow && !clipboardWindow.isDestroyed()) {
    if (clipboardWindow.isMinimized()) clipboardWindow.restore()
    /*
     * 先把最新列表推到面板的「同步缓存」，再 show —— 渲染层的 show 监听
     * 会立刻读缓存，所以面板挂起期间新复制的条目是「唤起即就位」，
     * 不会先闪一帧旧列表。send 本身是异步投递，缓存保证顺序不错。
     */
    clipboardWindow.webContents.send('clipboard:changed', clipboardEntries)
    if (nonactivating) {
      clipboardWindow.show()
      clipboardWindow.focus()
    } else {
      clipboardWindow.showInactive()
    }
    return
  }

  const saved = readClipboardBounds()
  const window = new BrowserWindow({
    ...(saved ?? CLIPBOARD_DEFAULT_SIZE),
    minWidth: CLIPBOARD_MIN_SIZE.width,
    minHeight: CLIPBOARD_MIN_SIZE.height,
    frame: false,
    /*
     * type: 'panel' 让窗口成为 NSPanel（nonactivating mask 只对它有效）。
     *
     * focusable 跟着 addon 走：addon 可用则 true —— 窗口能成为 key window
     * 收键盘，而 nonactivating mask 保证它不激活 app，两者叠加才是 Paste 的
     * 完整效果（有键盘、有 hover、不抢焦点）。addon 不可用则 false 退回
     * 「不抢焦点但没键盘」的过渡方案。
     */
    focusable: !!nonactivating,
    type: 'panel',
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: true,
    resizable: true,
    skipTaskbar: true,
    title: '剪贴板历史',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  clipboardWindow = window
  registerWindowShortcuts(window)

  // 设置 nonactivating mask（追加 + 私有 SPI 同步），要在 show 之前生效
  nonactivating?.(window.getNativeWindowHandle())

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}?clipboard=1`)
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'clipboard=1' })
  }

  window.once('ready-to-show', () => {
    if (nonactivating) {
      // nonactivating mask 已生效：show/focus 让它成为 key window（收键盘），
      // 但不会激活 app —— 唤出面板前的应用保持焦点。
      window.show()
      window.focus()
    } else {
      // 退回方案：只渲染置顶、不激活。
      window.showInactive()
    }
  })

  /*
   * 失焦即收起（隐藏，不销毁）。
   *
   * 面板 focusable: true，点击面板外（切到微信 / 别的应用）会触发 blur ——
   * 那一刻就该收起来。用 hide 而不是 close：窗口常驻复用，下次唤出直接
   * show 即出，省掉重建窗口 + 重新加载页面那几百毫秒。
   *
   * 点面板内部的按钮（删除、复制）不会 blur，所以不会误收。
   */
  window.on('blur', () => {
    if (!window.isDestroyed()) window.hide()
  })

  /*
   * 每次重新露出都让面板重拉一份列表。
   *
   * clipboard:changed 只在面板可见时推全量（隐藏时推上万条等于白克隆），
   * 所以面板挂起期间入库的新条目它并不知道 —— 这里补一次唤醒同步。
   * 首次加载由挂载时的 clipboard-list 覆盖。
   */
  window.on('show', () => {
    if (!window.isDestroyed()) window.webContents.send('clipboard:changed', lastClipboardList)
  })

  const persistBounds = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    store.set(CLIPBOARD_BOUNDS_KEY, window.getBounds())
  }
  window.on('resized', persistBounds)
  window.on('moved', persistBounds)
  window.on('closed', () => {
    cancelClipboardIdleDestroy()
    clipboardWindow = null
  })
}

/**
 * 收起面板：先隐藏保快速唤起；闲置 10 分钟仍不可见则销毁整个渲染进程
 * （数据全在主进程，重建零损失，见 scheduleClipboardIdleDestroy 的说明）。
 */
function hideClipboardWindow(): void {
  if (clipboardWindow && !clipboardWindow.isDestroyed()) clipboardWindow.hide()
  // 闲置一段时间仍不可见就销毁整个渲染进程，见 scheduleClipboardIdleDestroy
  scheduleClipboardIdleDestroy()
}

/** 真正销毁面板，仅应用退出时调用 */
function closeClipboardWindow(): void {
  cancelClipboardIdleDestroy()
  if (clipboardWindow && !clipboardWindow.isDestroyed()) clipboardWindow.close()
  clipboardWindow = null
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

/*
 * 通知渲染层「把未保存的笔记立刻落盘」。
 *
 * 笔记默认不自动保存，未保存的改动只存在于渲染进程内存里。进程被退出
 * （托盘「退出」、系统关机）时如果没人通知它，最后几段编辑就丢了。
 * 渲染层收到后会同步写 localStorage 并发起 electron-store 写入
 * （见 NotesContext.flushSync）。
 *
 * 故意不等待回执：落盘本身很快，而等待会让退出变慢，渲染层卡死时更会把
 * 用户困在一个关不掉的应用里。由调用方（before-quit）的延时兜底。
 */
function requestNotesFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('notes:flush-request')
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

  /*
   * 页面一 reload，旧的截图监听就没了，新的一版挂好之前都得算「没就绪」。
   * did-start-loading 每次加载都会触发（首次 load、reload、缓存刷新都算），
   * 比 once('did-finish-load') 更能覆盖「刷新页面」这条路径。
   */
  const mainContents = mainWindow.webContents
  captureListenerReady = false
  mainContents.on('did-start-loading', () => {
    captureListenerReady = false
  })

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

  /*
   * 窗口被藏起来时落一次盘（托盘点击、全局快捷键唤起前的收起）。
   *
   * 用户常常敲完就直接 ⌘H 或切去别的应用，不会再按 ⌘S —— 这是「不自动保存」
   * 下最常走的一条兜底路径。挂在窗口上而不是 app 上：只有这个窗口里有编辑器。
   */
  mainWindow.on('hide', () => requestNotesFlush())

  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
    captureListenerReady = false
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

  /* ---------------- 剪贴板历史 ---------------- */

  ipcMain.handle('clipboard-open', () => {
    openClipboardWindow()
  })

  ipcMain.handle('clipboard-close', () => {
    hideClipboardWindow()
  })

  /** 面板读全量列表。渲染端挂载时拉一次，之后的增量走 clipboard:changed 推送 */
  ipcMain.handle('clipboard-list', () => lastClipboardList)

  /**
   * 上云用的剪贴板投影。
   *
   * 用户硬性要求：剪切板图片不上云，云端只留【图片】占位 —— 服务器硬盘 0 压力，
   * 同时文本仍能多端流转。投影在主进程侧完成，渲染层拿到的是已经脱敏的轻列表。
   */
  ipcMain.handle('clipboard-project-for-sync', () =>
    clipboardEntries.map((entry) => {
      if (entry.type === 'image' || entry.imageDataUrl) {
        return { id: entry.id, type: 'text' as const, text: '【图片】', at: entry.at || Date.now() }
      }
      return {
        id: entry.id,
        type: 'text' as const,
        text: entry.type === 'file' ? entry.filePath ?? '' : entry.text ?? '',
        at: entry.at,
      }
    })
  )

  /** 删单条。被删的图片条目连磁盘文件一起清，不留垃圾 */
  ipcMain.handle('clipboard-remove', (_event, id: string) => {
    const target = clipboardEntries.find((entry) => entry.id === id)
    if (target && (target.imageId || target.imageDataUrl)) {
      deleteImageFilesForIds([target.id])
    }
    const next = clipboardEntries.filter((entry) => entry.id !== id)
    commitClipboardEntries(next)
    return next
  })

  ipcMain.handle('clipboard-clear', () => {
    deleteImageFilesForIds(clipboardEntries.map((entry) => entry.id))
    commitClipboardEntries([])
    return lastClipboardList
  })

  /** 图片只写回剪贴板，不模拟粘贴 —— 面板图片条目的「复制」按钮 */
  ipcMain.handle('clipboard-copy-image', (_event, imageDataUrl: string) => {
    return copyImageToClipboard(imageDataUrl)
  })

  /**
   * 按条目 id 复制/粘贴图片。
   *
   * 原图已从 JSON 摘到磁盘（见 clipboardImages），渲染层不再持有 base64 ——
   * 这里读文件换回 dataURL 再走原来的链路，「贴出 base64 图」的能力不变，
   * 只是数据从「JSON 常驻」变成了「按需读盘」。
   */
  const resolveImageDataUrl = async (entryId: string): Promise<string | null> => {
    const entry = clipboardEntries.find((item) => item.id === entryId)
    if (entry?.imageDataUrl) return entry.imageDataUrl
    if (entry?.imageId) return loadImageDataUrl(entry.imageId)
    return null
  }

  ipcMain.handle('clipboard-copy-image-by-id', async (_event, entryId: string) => {
    const dataUrl = await resolveImageDataUrl(entryId)
    if (!dataUrl) return false
    return copyImageToClipboard(dataUrl)
  })

  ipcMain.handle('clipboard-paste-image', async (_event, entryId: string) => {
    const dataUrl = await resolveImageDataUrl(entryId)
    if (!dataUrl) return { ok: false, reason: 'failed' as const }

    /*
     * 与 clipboard-paste 同一套时序：non-activating 面板抢了焦点，先收起，
     * 等焦点还给唤出面板前的应用再模拟 ⌘V。
     */
    const panel = clipboardWindow
    const wasVisible = panel && !panel.isDestroyed() && panel.isVisible()
    hideClipboardWindow()
    await new Promise((resolve) => setTimeout(resolve, 80))

    let result: { ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }
    try {
      result = await pasteImageToFocusedApp(dataUrl)
    } catch (error) {
      console.warn('[paste] 图片粘贴写入剪贴板或模拟按键异常：', error)
      result = { ok: false, reason: 'failed' }
    }

    if (
      !result.ok &&
      wasVisible &&
      panel === clipboardWindow &&
      !panel.isDestroyed()
    ) {
      if (loadNonactivating()) {
        panel.show()
        panel.focus()
      } else {
        panel.showInactive()
      }
    }
    return result
  })

  /** 直接打开系统设置的辅助功能面板（用户拒绝过授权后，系统不再弹窗，只能这样引导） */
  ipcMain.handle('clipboard-open-accessibility', () => openAccessibilitySettings())

  /**
   * 选中即粘贴：写剪贴板 + 模拟 ⌘V，落进当前聚焦的那个输入框。
   *
   * 按条目类型写入剪贴板，再由 paste() 模拟系统粘贴快捷键。
   * 返回结果给界面，让它区分「贴好了」与「已复制，请手动按 ⌘V」。
   */
  ipcMain.handle(
    'clipboard-paste',
    async (
      _event,
      payload: {
        type: 'text' | 'image' | 'file'
        text?: string
        imageDataUrl?: string
        filePath?: string
      }
    ) => {
      /*
       * non-activating 面板抢了 key window（键盘焦点），收起它之后 key window
       * 会自动还给唤出面板前的应用。等一小拍让这个转移稳定，再模拟 ⌘V。
       */
      const panel = clipboardWindow
      const wasVisible = panel && !panel.isDestroyed() && panel.isVisible()
      hideClipboardWindow()
      await new Promise((resolve) => setTimeout(resolve, 80))

      let result: { ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }
      try {
        result =
          payload.type === 'image'
            ? await pasteImageToFocusedApp(payload.imageDataUrl ?? '')
            : payload.type === 'file'
              ? await pasteFileToFocusedApp(payload.filePath ?? '')
              : await pasteToFocusedApp(payload.text ?? '')
      } catch (error) {
        console.warn('[paste] 写入剪贴板或模拟粘贴异常：', error)
        result = { ok: false, reason: 'failed' }
      }

      /*
       * 失败要能在日志里看到原因，而不是只看到「没粘贴成功」这个现象：
       * no-module 说明打包配置/架构有问题，no-permission 是授权，
       * failed 是模拟按键本身出错（常见原因是另一个工具在长按修饰键）。
       */
      if (!result.ok) {
        console.warn(
          `[paste] 自动粘贴失败 reason=${result.reason}`,
          result.reason === 'no-module'
            ? `原生模块加载失败：${pasteModuleLoadError() ?? '未知'}`
            : (lastPasteFailure() ?? '')
        )
        // 粘贴前已经隐藏过面板，失败时要恢复它，否则渲染层的原因提示永远看不到。
        if (wasVisible && panel === clipboardWindow && !panel.isDestroyed()) {
          if (loadNonactivating()) {
            panel.show()
            panel.focus()
          } else {
            panel.showInactive()
          }
        }
      }
      return result
    }
  )

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

  ipcMain.handle('system-info', () => {
    return getSystemHardwareInfo()
  })

  ipcMain.handle('system-process-list', async () => {
    return await getProcessMemoryList()
  })

  ipcMain.handle('system-kill-process', async (_, pid: number) => {
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
  ipcMain.handle('start-capture', () => openCapture())

  /**
   * 主窗口的截图订阅挂好了。
   *
   * 由 App 里那条截图订阅 effect 发出（send，不用 invoke —— 它只是通知，
   * 不必等回执）。收到就：
   *   1. 标记监听已就绪，之后 deliverCapture 一律直推、不再留缓存；
   *   2. 把暂存的那张（冷启动 / 页面 reload 期间截的）立刻补推并清空。
   *
   * 只认主窗口：工具窗口、截图遮罩层都会加载同一份渲染代码，它们的 signal
   * 不能把主窗口的状态带偏。sender 对不上时顺带把暂存图也作废 —— 那说明
   * 这张图对应的那一版页面已经不存在了，留着只会在下次加载时被重放。
   */
  ipcMain.on('capture:ocr-ready', (event) => {
    if (event.sender !== mainWindow?.webContents) {
      mainLog('[capture] 忽略非主窗口的 ocr-ready 信号')
      return
    }
    captureListenerReady = true
    const dataUrl = pendingCapture
    pendingCapture = null
    if (!dataUrl) {
      mainLog('[capture] 渲染层已就绪，没有待补推的截图')
      return
    }
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainLog('[capture] 渲染层已就绪，补推暂存截图，字节数', Math.round(dataUrl.length / 1024), 'KB')
    mainWindow.webContents.send('capture:ocr-request', dataUrl)
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
  ipcMain.handle('finish-capture', (event, dataUrl: string) => {
    mainLog('[capture] finish-capture 到达，sender 匹配 =', event.sender === captureWindow?.webContents)
    if (event.sender !== captureWindow?.webContents) return
    closeCaptureWindow()
    deliverCapture(dataUrl)
  })

  ipcMain.handle('cancel-capture', (event) => {
    if (event.sender === captureWindow?.webContents) closeCaptureWindow()
  })

  /**
   * light-ocr（PP-OCRv6 子进程）识别一张图。
   * unsupported = 依赖没装/包不完整；failed = 跑起来但出错。
   * 渲染层两种失败都回退 tesseract，仅 console.warn 记录原因。
   */
  ipcMain.handle(
    'ocr-light-recognize',
    async (event, dataUrl: string, provider?: 'auto' | 'cpu' | 'apple', requestId?: number) => {
      /*
       * 进度按 requestId 推回发起方窗口。渲染层连截几张图时会有多个请求在路上，
       * 不带 id 的话进度条会被上一张的进度串台。
       */
      const send = (progress: { progress: number; status: string; weight: number }) => {
        if (event.sender.isDestroyed()) return
        /*
         * requestId 缺省时也要推：老版本渲染层（或还没重新构建的那份）不带这个参数，
         * 早期这里直接 return，结果是引擎跑完都没有一条进度 —— 进度条永远停在起点。
         * 用 0 兜底，渲染层按 0 订阅即可，连截几张时新版本会各自带上自己的号。
         */
        event.sender.send('ocr:progress', {
          requestId: requestId ?? 0,
          // status 是给人看的中文，按它归类阶段（见 electron/lightOcr.ts 里的三处回调）
          stage:
            progress.status === '准备识别引擎'
              ? 'engine'
              : progress.status === '分析排版'
                ? 'detect'
                : 'recognize',
          value: progress.progress,
          // 权重交给渲染层换算成整条进度，主进程只报「本阶段走到哪」
          weight: progress.weight,
        })
      }
      return lightOcrRecognize(dataUrl, { provider, onProgress: send })
    }
  )


  // Store operations
  ipcMain.handle('store-get', (_, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('store-set', (_, key: string, value: any) => {
    store.set(key, value)
    if (key === CLIPBOARD_HISTORY_KEY && Array.isArray(value)) {
      commitClipboardEntries(value, false)
    }
  })

  ipcMain.handle('store-delete', (_, key: string) => {
    store.delete(key)
  })

  // 剪贴板读写:打包后 file:// 环境下渲染进程 navigator.clipboard 不可靠,由主进程兜底
  // Electron 44 起 readText() 是异步的，这里显式 await 拿到字符串再回给渲染层
  ipcMain.handle('clipboard-read', async () => {
    const text = await clipboard.readText()
    return typeof text === 'string' ? text : ''
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
        onEnd: (error) => {
          // 关键：自然结束也要摘掉 handle。之前只有「用户主动 abort」才 delete，
          // 正常跑完的请求会在 Map 里永久留一个闭包（连带钉住 net.request 与
          // webContents），常驻一天泄漏量 = 全天流式请求数
          streamHandles.delete(requestId)
          send('translate-stream-end', { error })
        },
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
    // 笔记可能是几十 MB 的长文，同步读会把主进程卡住，窗口跟着顿一下
    const [content, stat] = await Promise.all([
      fs.promises.readFile(filePath, 'utf-8'),
      fs.promises.stat(filePath),
    ])
    return {
      path: filePath,
      name: path.basename(filePath),
      content,
      mtimeMs: stat.mtimeMs,
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

      await fs.promises.writeFile(result.filePath, options.content ?? '', 'utf-8')
      return {
        path: result.filePath,
        name: path.basename(result.filePath),
      }
    }
  )


  /* 网络探测：ICMP ping 以事件流推给渲染进程，TCP / HTTP 为单次请求 */
  const pingRuns = new Map<number, () => void>()
  let pingCounter = 0
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  ipcMain.handle('net-ping-start', (event, payload: { host: string; count: number; intervalSec: number; timeoutSec: number; size: number }) => {
    const host = validateHost(String(payload?.host ?? ''))
    if (!host) throw new Error('地址格式不对，只能是域名或 IP')
    const opts: PingOptions = {
      count: Math.round(clamp(payload.count, 1, 200, 10)),
      intervalSec: clamp(payload.intervalSec, 0.2, 10, 1),
      timeoutSec: clamp(payload.timeoutSec, 0.5, 10, 2),
      size: Math.round(clamp(payload.size, 8, 1472, 56)),
    }
    pingCounter += 1
    const id = pingCounter
    const stop = startPing(host, opts, (ev) => {
      if (ev.kind === 'done') pingRuns.delete(id)
      if (!event.sender.isDestroyed()) event.sender.send('net-ping:event', { id, ...ev })
    })
    pingRuns.set(id, stop)
    /*
     * 窗口关闭/刷新后渲染层不会再发 net-ping-stop，那些还在跑的 ping
     * 会一直挂在定时器里（且回调里 isDestroyed 早退，等于纯粹空转）。
     * 挂在 sender 上随窗口销毁一起收掉 —— once 保证 watch 用完即卸。
     */
    event.sender.once('destroyed', () => {
      pingRuns.get(id)?.()
      pingRuns.delete(id)
    })
    return { id, host }
  })
  ipcMain.handle('net-ping-stop', (_, id: number) => {
    pingRuns.get(id)?.()
    pingRuns.delete(id)
  })
  ipcMain.handle('net-tcp-probe', async (_, payload: { host: string; port: number; timeoutMs: number }) => {
    const host = validateHost(String(payload?.host ?? ''))
    const port = validatePort(Number(payload?.port))
    if (!host) return { ok: false, ms: null, error: '地址格式不对' }
    if (!port) return { ok: false, ms: null, error: '端口需在 1–65535 之间' }
    return tcpProbe(host, port, clamp(payload.timeoutMs, 300, 10000, 2000))
  })
  /* 文件哈希：主进程流式计算，进度以事件推送 */
  ipcMain.handle('hash-pick', async () => {
    const result = await dialog.showOpenDialog({ title: '选择要计算哈希的文件', properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(
    'hash-compute',
    async (event, payload: { paths: string[]; algorithms: string[]; requestId: number }) => {
      if (!Array.isArray(payload?.paths)) throw new Error('无效的文件列表')
      const algorithms = (payload.algorithms ?? []).filter((algo): algo is HashAlgorithm =>
        (HASH_ALGORITHMS as readonly string[]).includes(algo),
      )
      if (algorithms.length === 0) throw new Error('至少选择一种算法')
      /*
       * 进度节流：hashFile 是按块回调的，大文件（几个 G）会每块推一条 IPC，
       * 渲染层也就跟着每块重渲一次。100ms 一次足够让进度条平滑；文件切换
       * （path 变化）时强制推一条，保证界面上文件名的切换即时可见。
       */
      let lastProgressAt = 0
      let lastProgressPath = ''
      return hashFiles(payload.paths.filter((p) => typeof p === 'string' && p), algorithms, (progress) => {
        const now = Date.now()
        const pathChanged = progress.path !== lastProgressPath
        if (!pathChanged && now - lastProgressAt < 100) return
        lastProgressAt = now
        lastProgressPath = progress.path
        if (!event.sender.isDestroyed()) event.sender.send('hash:progress', { requestId: payload.requestId, ...progress })
      })
    },
  )
  ipcMain.handle('netinfo-interfaces', () => listLocalInterfaces())
  ipcMain.handle('netinfo-public-ip', (_, mode: 'direct' | 'proxy') => queryPublicIp(mode === 'proxy' ? 'proxy' : 'direct'))
  ipcMain.handle('net-http-probe', (_, payload: { url: string; timeoutMs: number }) =>
    httpProbe(String(payload?.url ?? ''), clamp(payload.timeoutMs, 300, 15000, 5000)),
  )

  /* 局域网中转台：手机扫一次码即可双向传（文件 / 图片 / 文字） */
  setInboxListener(({ entry }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('lan:inbox-received', entry)
    }
  })
  ipcMain.handle('lan-start', () => startLanTransfer())
  ipcMain.handle('lan-stop', () => {
    stopLanTransfer()
    return lanStatus()
  })
  ipcMain.handle('lan-status', () => lanStatus())
  ipcMain.handle('lan-inbox-list', () => listInbox())
  ipcMain.handle('lan-inbox-thumb', (_, id: string) => readInboxThumb(id))
  ipcMain.handle('lan-inbox-copy', (_, id: string) => copyInboxItem(id))
  ipcMain.handle('lan-inbox-reveal', (_, id: string) => revealInboxItem(id))
  ipcMain.handle('lan-inbox-delete', (_, id: string) => deleteInboxItem(id))
  ipcMain.handle('lan-inbox-clear', () => clearInbox())
  ipcMain.handle('lan-outbox-list', () => listOutbox())
  ipcMain.handle('lan-outbox-pick', async () => {
    const result = await dialog.showOpenDialog({ title: '选择要发给手机的文件', properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return listOutbox()
    return addOutboxFiles(result.filePaths)
  })
  ipcMain.handle('lan-outbox-add-files', (_, paths: string[]) => addOutboxFiles(Array.isArray(paths) ? paths : []))
  ipcMain.handle('lan-outbox-add-text', (_, text: string) => addOutboxText(text))
  ipcMain.handle('lan-outbox-remove', (_, id: string) => removeOutbox(id))
  ipcMain.handle('lan-outbox-clear', () => clearOutbox())
  ipcMain.handle('lan-set-auto-copy', (_, on: boolean) => setAutoCopy(!!on))

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
  // 先把本地日志落盘通道建起来，后面所有排查日志都写进同一个文件
  initDebugLog(app.getPath('userData'))
  registerRendererLogIpc(ipcMain, app.isPackaged)

  // 无边框窗口没有菜单栏可挂，默认菜单留着只会提供一批用不上的快捷键
  Menu.setApplicationMenu(null)

  // dnclip:// 图片协议：面板缩略图 <img> 直接走它，不经过 IPC/JSON 搬运
  installClipProtocolHandler()

  await applyProxyConfig(store)
  createMainWindow()
  createTray()
  setupIpc()
  setupAutoUpdater()

  // 处理启动参数中的文件(Windows 关联启动 / 命令行直接传路径)
  extractFilePaths(process.argv).forEach(queueOpenFile)

  // 按用户配置注册全局快捷键（没配置就用内置默认值）
  applyGlobalShortcuts()

  startClipboardCapture()

  app.on('activate', () => {
    /*
     * macOS 点 Dock 图标（或系统级「重新打开」）唤起。
     * 本应用的窗口策略是常驻复用：托盘点击、外部唤起剪贴板面板等都会把主窗口
     * hide 掉而不是销毁，所以大多数时候窗口还在、只是不可见 —— 旧逻辑只在
     * 「窗口数为 0」时重建，点了 Dock 图标应用永远不出现。
     * 改成：窗口没了才重建，还在就 restore（最小化缩进 Dock 的情况）+ show + focus，
     * 与 second-instance 的处理保持一致。
     */
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
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
  closeClipboardWindow()
  clipboardStop?.()
  clipboardStop = null
  stopLanTransfer()
  // OCR 引擎子进程是常驻的（模型占一百多 MB），退出时必须主动收掉，
  // 否则会留下一个没有父进程的孤儿 Node 进程
  shutdownLightOcr()
})

/*
 * 退出前给渲染层一次落盘的机会。
 *
 * 托盘「退出」走的是 app.quit()，窗口被直接销毁，渲染层收不到 pagehide；
 * 而笔记默认不自动保存，此时内存里可能还有用户刚敲的内容。这里拦一次
 * before-quit，通知渲染层写完再真正退出。
 *
 * 500ms 是 empirically 够用的量级（localStorage 同步写 + electron-store
 * 一次 IPC），到点重新 quit。第二次进来时 notesFlushPending 仍为 true，
 * 直接放行，于是 will-quit 里的清理（全局快捷键、剪贴板监听等）照常执行。
 */
let notesFlushPending = false
app.on('before-quit', (event) => {
  // 截图助手可能正开着全屏框选层：先杀掉 / 中止，再处理窗口
  quitting = true
  macCaptureController?.abort()
  windowsCaptureController?.abort()
  closeCaptureWindow()
  if (notesFlushPending) return
  const win = mainWindow
  if (!win || win.isDestroyed()) return

  event.preventDefault()
  notesFlushPending = true
  requestNotesFlush()
  setTimeout(() => {
    app.quit()
  }, 500)
})
