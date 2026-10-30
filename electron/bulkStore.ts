/*
 * 超大存储 key 的分文件异步存储（bulk store）。
 *
 * 背景（为什么 electron-store 扛不住这几个 key）：
 * electron-store 底层的 conf 在任何一次 store.set 后都会把「整个 store 对象」
 * 全量 JSON.stringify 并同步写回 config.json。clipboard-history（内含截图
 * base64，实测 74MB+）、fehelper-backup-snapshots（34MB+）和笔记库混在同一个
 * config.json 里，文件膨胀到 110MB+，于是任何一次 set —— 哪怕只是切个会话改
 * 一下 active-id 指针 —— 都把主进程同步锁死几百 ms，体感就是整个应用卡死。
 *
 * 方案：把这几个「大而独立」的 key 挪到各自独立的 JSON 文件里，写入走内存缓存 +
 * 防抖异步落盘，主进程事件循环不再被磁盘 IO 阻塞；config.json 回归只装小配置。
 *
 * IPC 接口不变（store-get / store-set 继续按 key 路由），渲染层完全无感。
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'

/** 已知的大 key（历史上实测膨胀的）。新的大 key 登记进这里即可 */
export const BULK_STORE_KEYS = [
  'clipboard-history',
  'fehelper-backup-snapshots',
  'fehelper-markdown-notes',
] as const

const BULK_DIR_NAME = 'bulk-store'
/**
 * 大 key 的体积阈值：config.json 里单 key 超过它就转独立分文件（约 256KB）。
 * 两处生效：
 *  1. 启动迁移按「真实体积」扫描 —— 防止未来冒出新的大 key 没登记，每次开机自愈；
 *  2. 运行时 store-set 写入路径按同样阈值动态晋升（见 promoteKeyToBulk），
 *     让一个 key 从小写到大的那一刻就被拦在 config.json 外面，杜绝"用久了又卡"。
 */
export const BULK_THRESHOLD_BYTES = 256 * 1024
/** 防抖窗口：大 JSON 序列化 + 写盘要几百 ms，高频写（复制一次就写 74MB）必须合并 */
const WRITE_DEBOUNCE_MS = 500

const bulkDir = () => path.join(app.getPath('userData'), BULK_DIR_NAME)

/** key 直接拿来做文件名，防御性清洗：只留安全字符，其余换下划线 */
const safeNameOf = (key: string) => key.replace(/[^A-Za-z0-9_.-]/g, '_')

const keyFile = (key: string) => path.join(bulkDir(), `${safeNameOf(key)}.json`)

/** 内存缓存。惰性加载：应用启动不主动读任何大文件，首次 get/set 才读盘 */
const memoryCache = new Map<string, unknown>()

/** 每 key 一个写入定时器，防抖合并高频写 */
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 待落盘的 key 集合，退出前同步 flush 的依据 */
const pendingWrites = new Set<string>()

/**
 * 运行时动态晋升的 key。写死名单（BULK_STORE_KEYS）只是已知大 key 的起步状态，
 * 真正的防线是按体积晋升：运行期内任何 key 长过阈值就进 bulk，从此与 config.json 无关。
 * 跨会话兜底交给启动迁移（按体积扫描）。
 */
const dynamicBulkKeys = new Set<string>()

export function isBulkKey(key: string): boolean {
  return (BULK_STORE_KEYS as readonly string[]).includes(key) || dynamicBulkKeys.has(key)
}

/**
 * 运行时晋升：把一个悄悄长大的 key 转为独立文件存储。
 *
 * 只登记 + 告警，不动数据 —— 调用方（main 的 store-set）负责：
 * 1. 用 bulkSet 写新值；
 * 2. store.delete(key) 把 config.json 里的旧副本剔除（不剔的话 config 全量
 *    序列化时会把大副本一起背住，等于晋升做了个寂寞）。
 *
 * 只晋升不降级：小回去了也继续走文件，行为稳定不值得回切。
 */
export function promoteKeyToBulk(key: string, bytes: number): void {
  if (isBulkKey(key)) return
  dynamicBulkKeys.add(key)
  console.warn(
    `[bulk-store] key "${key}" 已增长到 ${(bytes / 1024).toFixed(1)}KB（阈值 ` +
      `${BULK_THRESHOLD_BYTES / 1024}KB），自动晋升为独立文件存储，config.json 不再承载它`
  )
}

export function bulkGet(key: string): unknown {
  if (memoryCache.has(key)) {
    return memoryCache.get(key)
  }
  // 惰性从磁盘加载（同步读只发生在首次访问该 key 时）
  try {
    const raw = fs.readFileSync(keyFile(key), 'utf-8')
    memoryCache.set(key, JSON.parse(raw))
  } catch {
    // 文件不存在或损坏按无值处理
    memoryCache.set(key, undefined)
  }
  return memoryCache.get(key)
}

export function bulkSet(key: string, value: unknown): void {
  memoryCache.set(key, value)
  pendingWrites.add(key)

  if (writeTimers.has(key)) clearTimeout(writeTimers.get(key))
  writeTimers.set(
    key,
    setTimeout(() => {
      writeTimers.delete(key)
      void flushBulkKey(key)
    }, WRITE_DEBOUNCE_MS),
  )
}

export function bulkDelete(key: string): void {
  memoryCache.delete(key)
  if (writeTimers.has(key)) {
    clearTimeout(writeTimers.get(key))
    writeTimers.delete(key)
  }
  pendingWrites.delete(key)
  try {
    fs.unlinkSync(keyFile(key))
  } catch {
    // 文件可能本来就不存在
  }
}

/**
 * 异步落盘单个 key：写入时刻从 memoryCache 取「最新值」而不是调用方闭包里的
 * 快照 —— 防抖期间一旦又有 bulkSet，先触发的 flush 也能拿到最新值一并写掉。
 * 先写带随机后缀的临时文件再 rename，随机后缀防止两次 flush 在途时
 * 争抢同一个 tmp 文件；成功后才清掉待写标记，退出兜底 flush 才能覆盖到
 * 没写完的 key。
 */
async function flushBulkKey(key: string): Promise<void> {
  const value = memoryCache.get(key)
  try {
    fs.mkdirSync(bulkDir(), { recursive: true })
    const tmpPath = tmpPathFor(key)
    await fsPromises.writeFile(tmpPath, JSON.stringify(value ?? null))
    await fsPromises.rename(tmpPath, keyFile(key))
    pendingWrites.delete(key)
  } catch {
    // 写失败保留待写标记：退出时 flushBulkStoreSync 会再试；运行期内下一次
    // bulkSet 也会重新触发落盘，不做额外重试避免雪崩
  }
}

/** 原子替换临时文件（供 flushBulkStoreSync 复用同一套临时文件命名规则） */
function tmpPathFor(key: string): string {
  return `${keyFile(key)}.${Math.random().toString(36).slice(2, 8)}.tmp`
}

/**
 * 应用退出前的最后一道保险：防抖窗口内还没落盘的 key 同步写掉。
 * 只在 quit 时执行一次，几百 ms 的同步写用户感知不到。
 */
export function flushBulkStoreSync(): void {
  for (const key of Array.from(pendingWrites)) {
    const value = memoryCache.get(key)
    try {
      fs.mkdirSync(bulkDir(), { recursive: true })
      const tmpPath = tmpPathFor(key)
      fs.writeFileSync(tmpPath, JSON.stringify(value ?? null))
      fs.renameSync(tmpPath, keyFile(key))
      pendingWrites.delete(key)
    } catch {
      // 保底失败只能放弃
    }
  }
}

/** 迁移时清空 bulk 内存缓存（保证缓存与磁盘文件一致，首次 get/set 按需重新加载） */
function memoryCacheClear(): void {
  memoryCache.clear()
}

/**
 * 估算任意 JSON 值的序列化体积，专供迁移时判定「这个 key 是否太大」。
 * 只在启动迁移跑一次，全量 stringify 算不心疼。
 */
export function serializedSizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * 一次性迁移：把 config.json 里体积超阈值的大 key 抽到独立文件。
 *
 * 必须在 new Store() 之前执行 —— electron-store 构造时就会同步读全量
 * config.json（当前 110MB ≈ 0.4s 的启动开销），不先瘦身这次启动照样付。
 *
 * 幂等：bulk 文件已存在的 key 只负责从 config.json 摘除，不重复写文件。
 * config.json 本身用临时文件 + rename 原子替换，防止中途崩溃损坏整个配置。
 */
export function migrateBulkKeysFromConfigSync(): void {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  let config: Record<string, unknown>
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    // config 不存在或损坏，没有迁移对象
    return
  }

  const oversizedKeys = Object.keys(config).filter((key) => {
    return serializedSizeOf(config[key]) >= BULK_THRESHOLD_BYTES || isBulkKey(key)
  })
  if (oversizedKeys.length === 0) return

  console.warn(
    '[bulk-store] 启动迁移：从 config.json 摘出超限 key → ' +
      oversizedKeys
        .map((key) => `${key}(${(serializedSizeOf(config[key]) / 1024).toFixed(1)}KB)`)
        .join(', ')
  )

  try {
    fs.mkdirSync(bulkDir(), { recursive: true })
  } catch {
    return
  }

  let allFilesReady = true
  for (const key of oversizedKeys) {
    if (fs.existsSync(keyFile(key))) continue
    try {
      fs.writeFileSync(keyFile(key), JSON.stringify(config[key] ?? null))
    } catch {
      allFilesReady = false
    }
  }
  memoryCacheClear()

  // 文件没全部就位时不摘除 config 里的原始值，保证数据永远有一份可用的
  if (!allFilesReady) return

  const slimConfig: Record<string, unknown> = {}
  for (const key of Object.keys(config)) {
    if (!oversizedKeys.includes(key)) slimConfig[key] = config[key]
  }
  try {
    const tmpPath = `${configPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(slimConfig))
    fs.renameSync(tmpPath, configPath)
  } catch {
    return
  }
}
