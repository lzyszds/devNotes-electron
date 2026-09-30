/*
 * 全局与应用内快捷键的定义与存储。
 *
 * 两类快捷键性质不同，分开放：
 *  - 全局键（global）：即使本应用没聚焦也生效，会跟系统和其他应用抢，
 *    注册失败必须如实告诉用户，不能假装成功。
 *  - 应用内键（app）：只在窗口聚焦时生效，冲突风险小。
 *
 * 默认值只在这里写一份，设置界面和实际生效都读它 —— 改键位不用两头同步。
 */

/** 一个可自定义的快捷键绑定 */
export interface ShortcutBinding {
  /** 稳定标识，也是存储用的键名，不要跟着显示名改 */
  id: string
  /** 界面上显示的名字 */
  label: string
  /** 说明这个键干什么 */
  description: string
  /** 默认键位，Electron accelerator 写法（如 'CommandOrControl+K'） */
  defaultAccelerator: string
  /** global = 系统级；app = 仅应用内 */
  scope: 'global' | 'app'
}

/** 本平台的主修饰键：Mac 是 ⌘，其余是 Ctrl。只用于默认值 */
const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const PRIMARY = isMacPlatform ? 'Command' : 'Control'

/**
 * 全部可自定义的快捷键。
 *
 * 默认值按平台给（Mac 用 ⌘、其余用 Ctrl），但**用户录进去的是哪个键就是哪个**，
 * 不再做跨平台归一 —— 详见 eventToAccelerator 上的说明。
 */
export const SHORTCUT_BINDINGS: ShortcutBinding[] = [
  {
    id: 'toggle-window',
    label: '显示 / 隐藏窗口',
    description: '在任何应用里都能把 devNotes 唤到前台，再按一次收起',
    defaultAccelerator: 'Alt+Shift+F',
    scope: 'global',
  },
  {
    id: 'open-translate',
    label: '打开文本翻译',
    description: '唤起窗口并直接切到文本翻译模块',
    defaultAccelerator: 'Alt+Shift+T',
    scope: 'global',
  },
  {
    id: 'screenshot-translate',
    label: '截图取字翻译',
    description: '框选屏幕任意区域，识别其中的文字并翻译',
    defaultAccelerator: 'Alt+Shift+S',
    scope: 'global',
  },
  {
    id: 'command-palette',
    label: '全局指令面板',
    description: '呼出搜索与功能指令，输入关键字直接跳转',
    defaultAccelerator: `${PRIMARY}+K`,
    scope: 'app',
  },
  {
    id: 'toggle-sidebar',
    label: '折叠 / 展开文档目录',
    description: '收起或展开 Markdown 二级侧边栏',
    defaultAccelerator: `${PRIMARY}+B`,
    scope: 'app',
  },
  {
    id: 'new-note',
    label: '新建 Markdown 笔记',
    description: '在笔记模块内新建，其他模块下会先切过去',
    defaultAccelerator: `${PRIMARY}+N`,
    scope: 'app',
  },
  {
    id: 'toggle-bookmark',
    label: '切换当前文档书签',
    description: '给正在阅读的笔记加书签或取消',
    defaultAccelerator: `${PRIMARY}+Shift+B`,
    scope: 'app',
  },
  {
    id: 'export-note',
    label: '导出为 .md',
    description: '把当前笔记导出成 Markdown 文件',
    defaultAccelerator: `${PRIMARY}+E`,
    scope: 'app',
  },
  {
    id: 'toggle-theme',
    label: '切换深浅主题',
    description: '在深色与浅色主题之间来回切换',
    defaultAccelerator: `${PRIMARY}+D`,
    scope: 'app',
  },
  {
    id: 'open-settings',
    label: '打开全局设置',
    description: '直接进入设置面板的通用页',
    defaultAccelerator: `${PRIMARY}+,`,
    scope: 'app',
  },
  {
    id: 'cloud-sync-settings',
    label: '打开云同步设置',
    description: '直接进入设置面板的 Cloudflare 同步页',
    defaultAccelerator: `${PRIMARY}+U`,
    scope: 'app',
  },
]

export const SHORTCUT_STORAGE_KEY = 'shortcut-bindings'

/** id -> accelerator，未配置的项不出现在这里 */
export type ShortcutMap = Record<string, string>

export function defaultShortcutMap(): ShortcutMap {
  return Object.fromEntries(SHORTCUT_BINDINGS.map((b) => [b.id, b.defaultAccelerator]))
}

/** 把存储里读到的东西合并成完整映射，缺项用默认值补 */
export function mergeShortcutMap(partial?: Partial<ShortcutMap> | null): ShortcutMap {
  const base = defaultShortcutMap()
  if (!partial || typeof partial !== 'object') return base
  for (const binding of SHORTCUT_BINDINGS) {
    const value = partial[binding.id]
    // 空串代表用户主动清空了这个键位，要尊重；只有非字符串才当作无效
    if (typeof value === 'string') base[binding.id] = value
  }
  return base
}

/* ---------------- 按键事件 ↔ accelerator 互转 ---------------- */

/** 是否是纯修饰键（单独按下不算一个完整快捷键） */
export function isModifierKey(key: string): boolean {
  return ['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(key)
}

/**
 * 把键盘事件转成 Electron accelerator 写法。
 *
 * **Meta 与 Control 分开记，不合并成 CommandOrControl。**
 *
 * 早先合并过一次，结果是：按 Ctrl 录出来存成 CommandOrControl，而它在
 * Electron 里同时匹配 ⌘ 和 Ctrl —— 用户按 Ctrl 录的键，之后按 ⌘ 也能触发，
 * 反过来也一样。快捷键该「按什么录什么」，这个便利不值得用错位换。
 *
 * 代价：配置不再跨平台通用（Mac 录的 Command+K 拿到 Windows 上没有 Command
 * 这个键）。但这是桌面应用、配置文件本来就跟机器走，可以接受。
 */
export function eventToAccelerator(event: KeyboardEvent): string {
  if (isModifierKey(event.key)) return ''

  const parts: string[] = []
  // 按事件里实际置上的修饰键来记，两者可同时存在（⌘ 与 Ctrl 一起按）
  if (event.metaKey) parts.push('Command')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = normalizeKey(event)
  if (!key) return ''
  parts.push(key)
  return parts.join('+')
}

/**
 * 主键部分。
 *
 * **以 event.code 为准，不看 event.key。**
 *
 * 原因：macOS 上 Option(Alt) 会把字符改掉 —— 按 Option+A 时 event.key 是
 * 'å' 而不是 'a'，按 Option+1 会变成 '¡'。用 key 去匹配字母数字表就全都
 * 认不出来，录制静默失败（早先的版本正是这样：设 Alt+A 什么也没录上）。
 * event.code 表示物理按键，不受修饰键影响，是唯一可靠的依据。
 *
 * 键盘布局差异（QWERTY / Dvorak）会让 code 与字符对不上，但快捷键本来就
 * 是按物理位置记的，这个取舍是对的。
 */
function normalizeKey(event: KeyboardEvent): string {
  const { key, code } = event

  // 字母：KeyA ~ KeyZ -> A ~ Z
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]

  // 数字：Digit0 ~ Digit9 -> 0 ~ 9
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]

  // 小键盘数字。accelerator 里叫 numpad0 ~ numpad9
  const numpad = /^Numpad([0-9])$/.exec(code)
  if (numpad) return `num${numpad[1]}`

  // 功能键：F1 ~ F24
  const fn = /^(F([1-9]|1[0-9]|2[0-4]))$/.exec(code)
  if (fn) return fn[1]

  const byCode: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    NumpadEnter: 'Return',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
  }
  if (byCode[code]) return byCode[code]

  // 少数环境（旧 WebView、合成事件）给不出 code，退回 key。
  // 这时 Option+字母仍会认不出，属于可接受的降级。
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key

  // 不认识的键返回空，调用方会当成「这次录入无效」忽略掉
  return ''
}

/**
 * 把 accelerator 显示成给人看的样子。
 *
 * 只做展示 —— 存储里始终是 CommandOrControl 那种写法，这样跨平台都能用。
 */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  if (!accelerator) return ''
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        // 兼容旧配置里遗留的写法：那时把 ⌘ 和 Ctrl 合并过，
        // 现在新录的键不会再产生它，但读老配置时仍要能显示
        case 'CommandOrControl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Command':
        case 'Cmd':
          return '⌘'
        case 'Control':
        case 'Ctrl':
          return isMac ? '⌃' : 'Ctrl'
        case 'Alt':
          return isMac ? '⌥' : 'Alt'
        case 'Option':
          return '⌥'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        case 'Return':
          return '↵'
        case 'Escape':
          return 'Esc'
        case 'Up':
          return '↑'
        case 'Down':
          return '↓'
        case 'Left':
          return '←'
        case 'Right':
          return '→'
        default:
          return part
      }
    })
    .join(isMac ? '' : '+')
}

/**
 * 找出一份映射里重复绑定的键位。
 *
 * 返回 accelerator -> 绑定了它的 id 列表。只在同一 scope 内比较 ——
 * 全局键与应用内键互不干扰，同一个键位在两类里各用一次是合理的。
 */
export function findConflicts(map: ShortcutMap): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  for (const binding of SHORTCUT_BINDINGS) {
    const accelerator = map[binding.id]
    if (!accelerator) continue
    // 比较时归一化大小写与修饰键顺序，避免 CommandOrControl+K 与
    // k+commandorcontrol 被当成两个键
    const key = `${binding.scope}::${normalizeForCompare(accelerator)}`
    const list = seen.get(key) ?? []
    list.push(binding.id)
    seen.set(key, list)
  }
  const conflicts = new Map<string, string[]>()
  for (const [key, ids] of seen) {
    if (ids.length > 1) conflicts.set(key.split('::')[1], ids)
  }
  return conflicts
}

/**
 * 排序修饰键并统一大小写，只用于比较是否重复。
 *
 * Command 与 Control 是并列的两个键，不合并 —— Command+A 与 Control+A 是
 * 两个不同的快捷键，不该被判成重复。
 */
function normalizeForCompare(accelerator: string): string {
  const order = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift']
  const parts = accelerator.split('+')
  const modifiers = order.filter((m) => parts.includes(m))
  const keys = parts.filter((p) => !order.includes(p)).map((p) => p.toUpperCase())
  return [...modifiers, ...keys].join('+')
}

/* ---------------- 配置的读写与订阅 ---------------- */

/**
 * 快捷键配置在渲染端的副本，仅用于界面显示。
 *
 * 真正决定全局键能否生效的是主进程那份（electron/main.ts 里的 store），
 * 这里存一份是为了设置界面能读出当前键位。
 *
 * 注意必须把全局键也一起存：早先只存了应用内键，导致界面重新挂载时
 * getShortcutMap 读不到全局键、又回退成默认值 —— 表现为「改成 Alt+A 后
 * 界面显示的还是 Alt+Shift+T，像是没生效」。
 */

type ShortcutListener = (map: ShortcutMap) => void
const listeners = new Set<ShortcutListener>()
/** 当前映射的内存副本，避免每次按键都去读存储 */
let cachedMap: ShortcutMap | null = null

/** 同步读缓存（首次调用会从存储载入） */
export function getShortcutMap(): ShortcutMap {
  if (cachedMap) return cachedMap
  // 先用 localStorage 顶上，它是同步的，能给按键监听一个立即可用的值
  try {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY)
    cachedMap = mergeShortcutMap(raw ? JSON.parse(raw) : null)
  } catch {
    cachedMap = defaultShortcutMap()
  }
  // 真值以主进程为准（云端同步会写那边），异步刷新一次
  void refreshShortcutMap()
  return cachedMap
}

/**
 * 从存储重新读一次并广播。
 *
 * 两处地方会用到：
 *  1. 首次加载（上面 getShortcutMap 触发的异步补齐）
 *  2. 云端同步把设置写回本地之后 —— 内存缓存还是旧值，得刷新才会生效
 */
export async function refreshShortcutMap(): Promise<ShortcutMap> {
  const api = window.electronAPI
  try {
    const stored = api?.getShortcuts ? await api.getShortcuts() : null
    cachedMap = mergeShortcutMap(stored)
  } catch {
    cachedMap = cachedMap ?? defaultShortcutMap()
  }
  listeners.forEach((listener) => listener(cachedMap as ShortcutMap))
  return cachedMap
}

/**
 * 写入并广播。
 *
 * 全局键同时交给主进程去重注册 —— 那边 register 返回 false 说明键位被
 * 系统占用，失败的 id 会带回来，设置界面要如实提示，不能静默吞掉。
 */
export async function saveShortcutMap(next: ShortcutMap): Promise<{ failed: string[] }> {
  cachedMap = next
  try {
    // 存 localStorage 一份，作为主进程不可用时的兜底（移动端没有 electronAPI）
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储写不进去（隐私模式等）也不影响本次会话生效，忽略
  }

  let failed: string[] = []
  const api = window.electronAPI
  if (api?.setShortcuts) {
    try {
      const result = await api.setShortcuts(next)
      failed = result?.failed ?? []
    } catch {
      // 主进程不可用（移动端）时只保留应用内键的改动
    }
  }

  listeners.forEach((listener) => listener(next))
  return { failed }
}

/** 订阅配置变化，返回取消订阅函数 */
export function subscribeShortcuts(listener: ShortcutListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/* ---------------- 录制态 ---------------- */

/**
 * 是否正在录制快捷键。
 *
 * 录制期间必须让所有快捷键「让路」：用户要按 ⌘K 来录它，如果那条快捷键
 * 还有效，命令面板会当场弹出来盖住设置面板，根本录不下去。
 *
 * 用一个模块级标志而不是 React 状态，是因为按键监听（DashboardLayout）
 * 和录制框是两个互不相识的组件，靠 props 传会绕一大圈；而且主进程的
 * 全局快捷键也要一并暂停（见 setShortcutRecording 的 IPC）。
 */
let recording = false
const recordingListeners = new Set<(recording: boolean) => void>()

export function isRecordingShortcut(): boolean {
  return recording
}

export function setRecordingShortcut(next: boolean): void {
  if (recording === next) return
  recording = next
  // 全局快捷键在主进程注册，那边也得暂停，否则录 ⌥A 时窗口会被真的唤起
  window.electronAPI?.setShortcutRecording?.(next)
  recordingListeners.forEach((listener) => listener(next))
}

export function subscribeRecording(listener: (recording: boolean) => void): () => void {
  recordingListeners.add(listener)
  return () => {
    recordingListeners.delete(listener)
  }
}

/** 单条绑定的键位，供界面显示 */
export function acceleratorFor(map: ShortcutMap, id: string): string {
  return map[id] ?? ''
}
