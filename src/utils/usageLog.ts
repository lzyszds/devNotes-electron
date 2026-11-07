/**
 * 使用行为的轻量日志（electron-store；旧 localStorage 仅一次性 peek 迁移）。
 *
 * 性能优化考量：
 * 此前在每次主画布 pointerdown 交互时直接同步读写旧本地存储，
 * 同步磁盘 I/O 阻塞了浏览器事件主循环，造成所有点击都有十几毫秒的固定输入延迟。
 *
 * 现改为【内存缓存 + 异步防抖批量落盘】：
 * - 点击事件中仅进行纯内存对象计数操作（耗时 ~0.005ms，零 GC 开销）；
 * - 批量写入延迟 1.5s 防抖执行（storeSet）；
 * - 页面卸载或退至后台时（beforeunload / pagehide）强制 storeSetSync flush，确保统计数据不丢失。
 */
import {
  peekLegacyLocalJson,
  purgeLegacyLocalKeys,
} from '../store/migrateLocalKey'

const DAILY_KEY = 'fehelper-usage-daily'
const LAST_KEY = 'fehelper-usage-last'
const TIME_KEY = 'fehelper-usage-time'
const ACTIONS_KEY = 'fehelper-usage-actions'

export type DailyLog = Record<string, number>
export type LastUsedMap = Record<string, number>
export type UsageTimeMap = Record<string, number>

// 内存暂存区
let memoryDailyLog: DailyLog | null = null
let memoryLastUsed: LastUsedMap | null = null
let memoryUsageTime: UsageTimeMap | null = null
let memoryToolActions: Record<string, number> | null = null

// 每个 key 是否已发起过异步 storeGet 细化
const storeHydrateStarted = new Set<string>()

// 待写脏标记
let pendingDaily = false
let pendingLast = false
let pendingTime = false
let pendingActions = false

let flushTimer: number | null = null

function memoryFor(key: string): Record<string, number> | null {
  switch (key) {
    case DAILY_KEY:
      return memoryDailyLog
    case LAST_KEY:
      return memoryLastUsed
    case TIME_KEY:
      return memoryUsageTime
    case ACTIONS_KEY:
      return memoryToolActions
    default:
      return null
  }
}

function setMemory(key: string, value: Record<string, number>): void {
  switch (key) {
    case DAILY_KEY:
      memoryDailyLog = value
      break
    case LAST_KEY:
      memoryLastUsed = value
      break
    case TIME_KEY:
      memoryUsageTime = value
      break
    case ACTIONS_KEY:
      memoryToolActions = value
      break
  }
}

function isPending(key: string): boolean {
  switch (key) {
    case DAILY_KEY:
      return pendingDaily
    case LAST_KEY:
      return pendingLast
    case TIME_KEY:
      return pendingTime
    case ACTIONS_KEY:
      return pendingActions
    default:
      return false
  }
}

/**
 * 同步首读：legacy peek 进内存并 purge；同时 fire-and-forget storeGet 细化。
 * 已有内存则直接返回（热点路径零 I/O）。
 */
function readJSON<T extends Record<string, number>>(key: string, fallback: T): T {
  const existing = memoryFor(key)
  if (existing) return existing as T

  const legacy = peekLegacyLocalJson<T>(key)
  const seeded =
    legacy && typeof legacy === 'object' ? ({ ...legacy } as T) : ({ ...fallback } as T)
  setMemory(key, seeded)
  purgeLegacyLocalKeys([key])

  if (!storeHydrateStarted.has(key)) {
    storeHydrateStarted.add(key)
    const api = window.electronAPI
    if (api?.storeGet) {
      void api.storeGet(key).then((stored) => {
        if (!stored || typeof stored !== 'object') return
        // 用户已在内存里开始累计时以内存为准，避免异步回填盖掉刚记的一笔
        if (isPending(key) && memoryFor(key)) return
        setMemory(key, { ...(stored as Record<string, number>) })
      })
    }
  }

  return seeded
}

function writeJSON(key: string, value: unknown): void {
  const api = window.electronAPI
  if (api?.storeSet) {
    void api.storeSet(key, value).catch(() => {
      /* 磁盘已满或受限时静默跳过，避免影响应用主功能 */
    })
  }
}

function writeJSONSync(key: string, value: unknown): void {
  try {
    window.electronAPI?.storeSetSync?.(key, value)
  } catch {
    /* ignore */
  }
}

function flushPending(forceSync: boolean): void {
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  const write = forceSync ? writeJSONSync : writeJSON
  if (pendingDaily && memoryDailyLog) {
    write(DAILY_KEY, memoryDailyLog)
    pendingDaily = false
  }
  if (pendingLast && memoryLastUsed) {
    write(LAST_KEY, memoryLastUsed)
    pendingLast = false
  }
  if (pendingTime && memoryUsageTime) {
    write(TIME_KEY, memoryUsageTime)
    pendingTime = false
  }
  if (pendingActions && memoryToolActions) {
    write(ACTIONS_KEY, memoryToolActions)
    pendingActions = false
  }
}

/** 日常防抖 flush：异步 storeSet */
export function flushUsageLogs(): void {
  flushPending(false)
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushUsageLogs()
  }, 1500)
}

// 注册卸载刷新监听（必须 storeSetSync）
if (typeof window !== 'undefined') {
  const syncFlush = () => flushPending(true)
  window.addEventListener('pagehide', syncFlush)
  window.addEventListener('beforeunload', syncFlush)
}

/** 本地时区的 'YYYY-MM-DD'。别用 toISOString —— 那是 UTC，晚上 8 点后会算到第二天去 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function readDailyLog(): DailyLog {
  if (!memoryDailyLog) {
    memoryDailyLog = readJSON(DAILY_KEY, {})
  }
  return { ...memoryDailyLog }
}

export function readLastUsed(): LastUsedMap {
  if (!memoryLastUsed) {
    memoryLastUsed = readJSON(LAST_KEY, {})
  }
  return { ...memoryLastUsed }
}

/** 打开任意模块时记一笔当日用量（在 App.openTool 里调用） */
export function recordDailyUse(): void {
  if (!memoryDailyLog) {
    memoryDailyLog = readJSON(DAILY_KEY, {})
  }
  const key = dayKey(new Date())
  memoryDailyLog[key] = (memoryDailyLog[key] ?? 0) + 1
  pendingDaily = true
  scheduleFlush()
}

/** 记下某模块最后打开的时刻（在 App.openTool 里调用） */
export function recordToolUse(toolId: string): void {
  if (!memoryLastUsed) {
    memoryLastUsed = readJSON(LAST_KEY, {})
  }
  memoryLastUsed[toolId] = Date.now()
  pendingLast = true
  scheduleFlush()
}

/* ============================== 使用时长 ============================== */

export function readUsageTime(): UsageTimeMap {
  if (!memoryUsageTime) {
    memoryUsageTime = readJSON(TIME_KEY, {})
  }
  return { ...memoryUsageTime }
}

export function addUsageTime(toolId: string, seconds: number): void {
  if (!memoryUsageTime) {
    memoryUsageTime = readJSON(TIME_KEY, {})
  }
  memoryUsageTime[toolId] = (memoryUsageTime[toolId] ?? 0) + seconds
  pendingTime = true
  scheduleFlush()
}

/* ============================== 使用动作 ============================== */

export function readToolActions(): Record<string, number> {
  if (!memoryToolActions) {
    memoryToolActions = readJSON(ACTIONS_KEY, {})
  }
  return { ...memoryToolActions }
}

export function recordToolAction(toolId: string): void {
  if (!memoryToolActions) {
    memoryToolActions = readJSON(ACTIONS_KEY, {})
  }
  memoryToolActions[toolId] = (memoryToolActions[toolId] ?? 0) + 1
  pendingActions = true
  scheduleFlush()
}
