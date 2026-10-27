/**
 * 使用行为的轻量日志（全部存 localStorage，不进 electron-store）。
 *
 * usageStats（App 里的 fehelper-usage-stats）只有累计计数，画不出
 * 「近两周活跃趋势 / 今日用量 / 连续天数 / 最近用过什么」这类有时效的内容，
 * 这里补两份极小的日志：
 *   - 按日计数：'YYYY-MM-DD' -> 当日打开次数（趋势图、今日用量、连续天数）
 *   - 按模块最近时刻：toolId -> 最后一次打开的时间戳（排行里的「x 天前」）
 *
 * 为什么不合并进 fehelper-usage-stats：那份数据结构是 { id: number }，
 * 改形状要做旧数据迁移；另开新键零迁移成本，读旧页也不受影响。
 */
const DAILY_KEY = 'fehelper-usage-daily'
const LAST_KEY = 'fehelper-usage-last'

export type DailyLog = Record<string, number>
export type LastUsedMap = Record<string, number>

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
    // ignore
  }
}

/** 本地时区的 'YYYY-MM-DD'。别用 toISOString —— 那是 UTC，晚上 8 点后会算到第二天去 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function readDailyLog(): DailyLog {
  return readJSON(DAILY_KEY, {})
}

export function readLastUsed(): LastUsedMap {
  return readJSON(LAST_KEY, {})
}

/** 打开任意模块时记一笔当日用量（在 App.openTool 里调用） */
export function recordDailyUse(): void {
  const log = readDailyLog()
  const key = dayKey(new Date())
  log[key] = (log[key] ?? 0) + 1
  writeJSON(DAILY_KEY, log)
}

/** 记下某模块最后打开的时刻（在 App.openTool 里调用） */
export function recordToolUse(toolId: string): void {
  const last = readLastUsed()
  last[toolId] = Date.now()
  writeJSON(LAST_KEY, last)
}

/* ============================== 使用时长 ============================== */

const TIME_KEY = 'fehelper-usage-time'

/**
 * 模块前台使用时长（秒）。由 DashboardLayout 的心跳计时写入：
 * 窗口在前台时每 20 秒给当前模块加 20 秒，失焦/最小化/切走一律不计 ——
 * 「打开过」和「真的在用」是两回事，统计页把两者分开呈现。
 */
export type UsageTimeMap = Record<string, number>

export function readUsageTime(): UsageTimeMap {
  return readJSON(TIME_KEY, {})
}

export function addUsageTime(toolId: string, seconds: number): void {
  const map = readUsageTime()
  map[toolId] = (map[toolId] ?? 0) + seconds
  writeJSON(TIME_KEY, map)
}

/* ============================== 使用动作 ============================== */

const ACTIONS_KEY = 'fehelper-usage-actions'

/**
 * 模块内的真实操作次数（点主画布里的按钮、卡片等）。
 * 「打开过 N 次」是调用，「在里面点了几下」才是使用强度 —— 排行页两条都摆出来。
 */
export function readToolActions(): Record<string, number> {
  return readJSON(ACTIONS_KEY, {})
}

export function recordToolAction(toolId: string): void {
  const map = readJSON<Record<string, number>>(ACTIONS_KEY, {})
  map[toolId] = (map[toolId] ?? 0) + 1
  writeJSON(ACTIONS_KEY, map)
}
