/**
 * 左侧菜单栏（56px 工具 Rail）的默认项配置。
 *
 * Rail 上原先写死了 6 个工具。可自定义之后要解决两件事：
 *  1. 用户在设置里勾选的项要立刻反映到 Rail 上 —— 走订阅广播，见 subscribeRailTools
 *  2. **老版本的用户装上新版时，看到的必须还是原来那 6 个** —— 见 DEFAULT_RAIL_TOOL_IDS
 *     与 normalizeRailToolIds 里「空数组 = 用默认值」的处理
 *
 * 配置跟着设置一起上云（和主题、快捷键同样的待遇），换台机器不用重配。
 */

/** 存储键。与 main.ts / capacitorBridge 的 store 键空间共用 */
export const RAIL_TOOLS_STORAGE_KEY = 'rail-tool-ids'

/**
 * 出厂默认项：就是改造前写死在 Rail 上的那 6 个，顺序也保持一致。
 * 老用户升级后看到的界面因此没有任何变化。
 */
export const DEFAULT_RAIL_TOOL_IDS = [
  'markdown-notes',
  'text-translate',
  'json-format',
  'websocket',
  'qr-code',
  'image-convert',
]

/**
 * 可以在 Rail 上配置的工具白名单。
 *
 * 不直接放开全部工具：Rail 只有 56px 宽、一屏十来个，把几十个工具全塞进去
 * 反而让人找不到；而且小工具更常见的入口是工具中心与指令面板。
 * 这里挑的是「高频、且打开就要长时间停留」的那一批。
 */
export const RAIL_CANDIDATES: string[] = [
  'markdown-notes',
  'text-translate',
  'snippets',
  'json-format',
  'json-i18n',
  'websocket',
  'qr-code',
  'image-convert',
  'en-decode',
  'timestamp',
  'regexp',
  'password',
  'bitwise',
  'port-killer',
  'scratchpad',
]

/** Rail 上最多放几个，再多就要滚动才能看全 */
export const RAIL_MAX_ITEMS = 8

/* ---------------- 校验 ---------------- */

/**
 * 把任意来源（存储、云端、用户手改的文件）的数组收敛成一份合法配置。
 *
 * 规则：丢掉认不出的 id、去重、截断到上限。**空数组归一成默认值** ——
 * 存储里空数组与「从没配过」没有区别，都该显示出厂默认，否则用户会得到
 * 一个空白的 Rail 且不知道该怎么恢复。
 */
export function normalizeRailToolIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_RAIL_TOOL_IDS]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (!RAIL_CANDIDATES.includes(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= RAIL_MAX_ITEMS) break
  }
  return result.length ? result : [...DEFAULT_RAIL_TOOL_IDS]
}

/* ---------------- 读写与订阅 ---------------- */

type RailListener = (ids: string[]) => void
const listeners = new Set<RailListener>()

/** 当前配置的内存副本。Rail 与设置面板都读它，避免每次渲染都去碰存储 */
let cached: string[] | null = null

/** 同步读缓存。首次调用会先用 localStorage 顶一个值出来 */
export function getCachedRailToolIds(): string[] {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(RAIL_TOOLS_STORAGE_KEY)
    cached = normalizeRailToolIds(raw ? JSON.parse(raw) : null)
  } catch {
    cached = [...DEFAULT_RAIL_TOOL_IDS]
  }
  // 真值以 electron-store 为准，异步补一次
  void refreshRailToolIds()
  return cached
}

/** 从存储重读并广播。首次加载与云端同步写回后都走它 */
export async function refreshRailToolIds(): Promise<string[]> {
  try {
    const stored = await window.electronAPI?.storeGet(RAIL_TOOLS_STORAGE_KEY)
    // undefined 表示「这份设置没上过云」，保持现状而不是打回默认值
    if (stored !== undefined && stored !== null) {
      cached = normalizeRailToolIds(stored)
    } else {
      cached = cached ?? [...DEFAULT_RAIL_TOOL_IDS]
    }
  } catch {
    cached = cached ?? [...DEFAULT_RAIL_TOOL_IDS]
  }
  listeners.forEach((listener) => listener(cached as string[]))
  return cached
}

/** 写入并广播 */
export async function saveRailToolIds(ids: string[]): Promise<string[]> {
  const next = normalizeRailToolIds(ids)
  cached = next
  try {
    localStorage.setItem(RAIL_TOOLS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式等写不进去，不影响本次会话
  }
  await window.electronAPI?.storeSet(RAIL_TOOLS_STORAGE_KEY, next).catch(() => {})
  listeners.forEach((listener) => listener(next))
  return next
}

export function subscribeRailToolIds(listener: RailListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
