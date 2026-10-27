/**
 * 使用行为的轻量日志（全部存 localStorage，不进 electron-store）。
 *
 * 性能优化考量：
 * 此前在每次主画布 pointerdown 交互时直接同步调用 2 次 localStorage.getItem / setItem，
 * 同步磁盘 I/O 阻塞了浏览器事件主循环，造成所有点击都有十几毫秒的固定输入延迟。
 *
 * 现改为【内存缓存 + 异步防抖批量落盘】：
 * - 点击事件中仅进行纯内存对象计数操作（耗时 ~0.005ms，零 GC 开销）；
 * - 批量写入延迟 1.5s 防抖执行；
 * - 页面卸载或退至后台时（beforeunload / pagehide）强制同步 flush，确保统计数据不丢失。
 */
const DAILY_KEY = 'fehelper-usage-daily'
const LAST_KEY = 'fehelper-usage-last'
const TIME_KEY = 'fehelper-usage-time'
const ACTIONS_KEY = 'fehelper-usage-actions'

export type DailyLog = Record<string, number>
export type LastUsedMap = Record<string, number>
export type UsageTimeMap = Record<string, number>

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 磁盘已满或受限时静默跳过，避免影响应用主功能
  }
}

// 内存暂存区
let memoryDailyLog: DailyLog | null = null
let memoryLastUsed: LastUsedMap | null = null
let memoryUsageTime: UsageTimeMap | null = null
let memoryToolActions: Record<string, number> | null = null

// 待写脏标记
let pendingDaily = false
let pendingLast = false
let pendingTime = false
let pendingActions = false

let flushTimer: number | null = null

export function flushUsageLogs(): void {
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingDaily && memoryDailyLog) {
    writeJSON(DAILY_KEY, memoryDailyLog)
    pendingDaily = false
  }
  if (pendingLast && memoryLastUsed) {
    writeJSON(LAST_KEY, memoryLastUsed)
    pendingLast = false
  }
  if (pendingTime && memoryUsageTime) {
    writeJSON(TIME_KEY, memoryUsageTime)
    pendingTime = false
  }
  if (pendingActions && memoryToolActions) {
    writeJSON(ACTIONS_KEY, memoryToolActions)
    pendingActions = false
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushUsageLogs()
  }, 1500)
}

// 注册卸载刷新监听
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushUsageLogs)
  window.addEventListener('beforeunload', flushUsageLogs)
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
