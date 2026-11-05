import os from 'os'
import { readFileSync } from 'fs'
import { statfs, readdir, stat, lstat } from 'fs/promises'
import path from 'path'
import { dialog, shell, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

export interface SystemHardwareInfo {
  platform: string
  platformName: string
  arch: string
  osRelease: string
  hostname: string
  cpuModel: string
  cpuCores: number
  cpuSpeedMhz: number
  totalMemBytes: number
  /** 真空闲。macOS 上几乎恒为零（空闲页全被文件缓存/压缩池借走），只配当诊断数据 */
  freeMemBytes: number
  /**
   * 可用内存 = 真空闲 + 可随时回收的文件缓存。
   * 判断「这台机器还能不能装得下」看它，别看上面那个 free —— 理由见 readDarwinMemStat
   */
  availableMemBytes: number
  usedMemBytes: number
  /** used = total - available。macOS 上与活动监视器「内存已使用」的口径一致 */
  memUsagePercent: number
  /**
   * 内核内存压力等级（仅 macOS，1=正常 2=警告 ≥3=临界）。
   * 这是 jetsam / 内存压力通知在用的同一份内核读数 —— 判断「系统到底紧不紧张」，
   * 它比任何静态的「已用/总量」百分比都权威，sysctl 一次调用就能拿到
   */
  memoryPressureLevel?: number
  /** 以下细分仅 macOS 有值（活动监视器口径的页桶），Windows/Linux 不填 */
  /** 联线内存（wired）：内核与驱动的常驻区，用户侧动不了，也不该拿它做文章 */
  wiredBytes?: number
  /** 活跃应用内存（active 页，不含压缩池） */
  appActiveBytes?: number
  /** 压缩池：被内核压缩后还占着的物理页（省出来的空间就是它的贡献） */
  compressedBytes?: number
  /** 文件缓存（inactive + speculative），随时可回收 ——「释放内存」动作清的就是它 */
  cachedFilesBytes?: number
  /** 已用 Swap 字节数（读 vm.swapusage；换页多说明历史上有真的内存挤兑） */
  swapUsedBytes?: number
  /** 是否支持「释放内存」动作（当前仅 macOS：/usr/sbin/purge） */
  memoryReleaseSupported?: boolean
  /** 磁盘卷容量与剩余（家目录所在卷，即日常文件放的那个盘）；读取失败时不填，UI 显示占位说明 */
  diskTotalBytes?: number
  diskUsedBytes?: number
  diskFreeBytes?: number
  uptimeSeconds: number
}

export interface AppProcessMemory {
  name: string
  displayName: string
  pids: number[]
  rssBytes: number
  memPercent: number
  isCurrentApp: boolean
}

export interface DiskScanEntry {
  path: string
  name: string
  sizeBytes: number
  isDirectory: boolean
  modifiedAt: number
}

export interface DeveloperToolStatus {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
}

const DEVELOPER_TOOLS = [
  { id: 'git', name: 'Git', command: 'git', args: ['--version'] },
  { id: 'node', name: 'Node.js', command: 'node', args: ['--version'] },
  { id: 'python', name: 'Python', command: 'python3', args: ['--version'] },
  { id: 'java', name: 'Java', command: 'java', args: ['-version'] },
  { id: 'docker', name: 'Docker', command: 'docker', args: ['--version'] },
] as const

export async function scanDiskDirectory(root: string): Promise<DiskScanEntry[]> {
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('请选择一个文件夹')
  const results: DiskScanEntry[] = []
  const stack = [root]
  const maxEntries = 20_000
  while (stack.length && results.length < maxEntries) {
    const current = stack.pop()!
    let names: string[]
    try { names = await readdir(current) } catch { continue }
    for (const name of names) {
      if (results.length >= maxEntries) break
      const fullPath = path.join(current, name)
      try {
        const info = await lstat(fullPath)
        const isDirectory = info.isDirectory()
        results.push({ path: fullPath, name, sizeBytes: isDirectory ? 0 : info.size, isDirectory, modifiedAt: info.mtimeMs })
        if (isDirectory) stack.push(fullPath)
      } catch { /* 无权访问或扫描期间已删除的文件跳过 */ }
    }
  }
  const directories = new Map(results.filter((entry) => entry.isDirectory).map((entry) => [entry.path, 0]))
  for (const entry of results) {
    if (entry.isDirectory) continue
    let parent = path.dirname(entry.path)
    while (parent !== root && parent.startsWith(`${root}${path.sep}`)) {
      if (directories.has(parent)) directories.set(parent, (directories.get(parent) ?? 0) + entry.sizeBytes)
      parent = path.dirname(parent)
    }
  }
  for (const entry of results) if (entry.isDirectory) entry.sizeBytes = directories.get(entry.path) ?? 0
  return results.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

export async function checkDeveloperTools(): Promise<DeveloperToolStatus[]> {
  return Promise.all(DEVELOPER_TOOLS.map(async (tool) => {
    try {
      const { stdout, stderr } = await run(tool.command, tool.args, { timeout: 4000 })
      const version = `${stdout || stderr}`.trim().split('\n')[0].slice(0, 120)
      let resolvedPath: string | undefined
      try {
        const resolved = await run(os.platform() === 'win32' ? 'where' : 'which', [tool.command], { timeout: 2000 })
        resolvedPath = resolved.stdout.trim().split('\n')[0]
      } catch { /* 版本命令成功时仍保留已安装状态 */ }
      return { id: tool.id, name: tool.name, installed: true, version, path: resolvedPath }
    } catch {
      return { id: tool.id, name: tool.name, installed: false }
    }
  }))
}

export async function chooseDiskDirectory(parent: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0] ?? null
}

export async function revealDiskPath(target: string): Promise<void> {
  shell.showItemInFolder(target)
}

/** 友好化系统平台名称 */
function getPlatformName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

interface DarwinMemStat {
  freeBytes: number
  /** inactive + speculative：文件缓存，随时可回收 */
  cachedBytes: number
  /** free + cached：口径同活动监视器 Available */
  availableBytes: number
  activeBytes: number
  wiredBytes: number
  compressedBytes: number
  /** 活动监视器 Memory Used 口径：active + wired + compressed */
  usedBytes: number
}

/**
 * 用 vm_stat 读 macOS 的完整内存页桶。
 *
 * os.freemem() 在 macOS 上基本是个陷阱：内核会把空闲页几乎全部拿去填文件缓存
 * 和内存压缩池，真 free 页常年只剩一两百 MB —— 所以 total - free 的老算法会把
 * 一台内存压力全绿的机器报到 98%+。vm_stat 给的是 Mach 主机统计的原始页数据，
 * 活动监视器的口径（内存已使用 = App(含 compressed) + Wired）反过来看就是
 * 「可用 = Free + inactive（文件缓存）+ speculative（预读缓存）」。
 */
async function readDarwinMemStat(): Promise<DarwinMemStat | null> {
  try {
    const { stdout } = await run('vm_stat')
    // 页大小写在首行 "...(page size of 16384 bytes)"：Apple Silicon 是 16K，Intel 是 4K
    const sizeMatch = stdout.match(/page size of (\d+) bytes/)
    const pageSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 4096
    const pages = (label: string): number => {
      const m = stdout.match(new RegExp(`${label}:\\s+(\\d+)`))
      return m ? parseInt(m[1], 10) * pageSize : 0
    }
    const free = pages('Pages free')
    const active = pages('Pages active')
    const cached = pages('Pages inactive') + pages('Pages speculative')
    const wired = pages('Pages wired down')
    const compressed = pages('Pages occupied by compressor')
    // 任何一项都没认出来（解析空了）就宁可让调用方回退老算法，也别报出假的满载
    if (free + active + wired + compressed === 0) return null
    return {
      freeBytes: free,
      cachedBytes: cached,
      availableBytes: free + cached,
      activeBytes: active,
      wiredBytes: wired,
      compressedBytes: compressed,
      usedBytes: active + wired + compressed,
    }
  } catch {
    return null
  }
}

/** 换算给人看的 GB 字符串（purge 前后对比的吐司文案用，不走渲染层的 formatBytes） */
function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** 读 macOS 的 Swap 用量。换页量大说明历史上有真的内存挤兑，值得在界面上明示 */
async function readDarwinSwapUsed(): Promise<number | undefined> {
  try {
    const { stdout } = await run('sysctl', ['-n', 'vm.swapusage'])
    // 形如 "total = 9216.00M  used = 7752.38M  free = 1463.62M  (encrypted)"
    const m = stdout.match(/used\s*=\s*([\d.]+)\s*(B|K|M|G)/)
    if (!m) return undefined
    const factor = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2] as 'B' | 'K' | 'M' | 'G']
    return Math.round(parseFloat(m[1]) * factor)
  } catch {
    return undefined
  }
}

/**
 * Linux 用 /proc/meminfo 的 MemAvailable：内核自己算好的「现有可用」，
 * 已经把可回收的 page cache 计入在内 —— os.freemem() 只看 MemFree，
 * 在跑了很久的 Linux 上同样会虚高占用。
 */
function readLinuxAvailable(): number | null {
  try {
    const content = readFileSync('/proc/meminfo', 'utf8')
    const m = content.match(/^MemAvailable:\s+(\d+)\s*kB/m)
    return m ? parseInt(m[1], 10) * 1024 : null
  } catch {
    return null
  }
}

/** 轻量内存快照：只带 tray 状态条关心的四五个数，不带页桶细分与 CPU */
export interface MemoryQuickStat {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  /** used / total，保留一位小数 */
  percent: number
  /** Swap 已用字节（只在 macOS 上探测，其他平台不填） */
  swapUsedBytes?: number
}

/**
 * 面向托盘状态条的「即时内存读数」。
 *
 * 口径与 getSystemHardwareInfo 严格一致（同一份 vm_stat / MemAvailable 逻辑），
 * 托盘上数字才不会和工具页里对不上。每几秒被托盘轮询一次，所以要轻：
 * Mac 上壮烈一点 vm_stat 一次 + sysctl 一次，Linux 只读 /proc/meminfo，
 * Windows 直接 osFreemem（Windows 上它本身就是 available 口径）。
 */
export async function getMemoryQuickStat(): Promise<MemoryQuickStat> {
  const totalBytes = os.totalmem()
  let availableBytes: number
  let swapUsedBytes: number | undefined

  if (os.platform() === 'darwin') {
    const stat = await readDarwinMemStat()
    // vm_stat 挂了就退回老算法：数字会虚高，但比整个状态条空白好
    availableBytes = stat ? stat.availableBytes : os.freemem()
    swapUsedBytes = await readDarwinSwapUsed()
  } else if (os.platform() === 'linux') {
    availableBytes = readLinuxAvailable() ?? os.freemem()
  } else {
    availableBytes = os.freemem()
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes)
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    percent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    swapUsedBytes,
  }
}

/**
 * 系统级「释放可回收内存」（仅 macOS）：执行 /usr/sbin/purge 把文件缓存整体刷掉。
 *
 * 说明两点，避免变成 CleanMyMac 式的数字游戏：
 *  - purge 需要 root —— 走 osascript 的 administrator 特权弹窗（系统密码框），
 *    用户取消就如实报取消，什么都不改。
 *  - 它只回收文件缓存（inactive/speculative），不碰任何应用的工作集：
 *    真正省内存靠进程榜里的「结束」。释放后可用内存会立刻涨一截，
 *    但系统用着用着又会重新填充缓存 —— 这是诚实的预期，不是 bug。
 */
export async function releaseMemory(): Promise<{
  ok: boolean
  message: string
  cancelled?: boolean
}> {
  if (os.platform() !== 'darwin') return { ok: false, message: '该功能目前仅支持 macOS' }

  const before = await readDarwinMemStat()
  try {
    await run(
      'osascript',
      ['-e', 'do shell script "/usr/sbin/purge" with administrator privileges'],
      // 密码框可能要等用户慢慢输：给 2 分钟，超时按失败处理
      { timeout: 120_000 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // osascript 的用户取消是明确的 -128，别把它当失败吓用户
    if (/(-128)|用户已取消|User canceled/i.test(msg)) {
      return { ok: false, cancelled: true, message: '已取消，未做任何变更' }
    }
    return { ok: false, message: `释放失败：${msg.slice(0, 140)}` }
  }

  // purge 是同步刷盘，但内核记账有一拍延迟；等半秒再读对比数
  await new Promise((resolve) => setTimeout(resolve, 500))
  const after = await readDarwinMemStat()
  if (before && after) {
    const freed = after.availableBytes - before.availableBytes
    if (freed > 64 * 1024 * 1024) {
      return { ok: true, message: `已释放，可用内存 ${gb(before.availableBytes)} → ${gb(after.availableBytes)}` }
    }
    return {
      ok: true,
      message: '已执行 purge；可回收内存变化不大 —— 缓存原本就紧张或正被使用，很快还会填回来',
    }
  }
  return { ok: true, message: '已执行 purge' }
}

/**
 * 磁盘卷剩余：读用户家目录所在卷。
 *
 * statfs 是 Node 原生调用，Mac / Linux / Windows 都通，不用再各平台拼命令。
 * 选家目录而不是根卷的原因：这台机器「日常文件放的那个盘」才是用户关心
 * 的那个 —— mac 家目录就在系统卷，Windows 家目录跟着系统盘走，行为一致。
 * 拿不到（权限 / 卷不在了）就返回 undefined，UI 卡片如实显示占位。
 */
async function readDiskStat(): Promise<{
  totalBytes: number
  usedBytes: number
  freeBytes: number
} | undefined> {
  try {
    const s = await statfs(os.homedir())
    const totalBytes = s.blocks * s.bsize
    // bavail 是给未授权进程看的真正可写空间，比 bfree（含保留块）诚实
    const freeBytes = s.bavail * s.bsize
    if (totalBytes <= 0 || freeBytes < 0) return undefined
    return { totalBytes, usedBytes: Math.max(0, totalBytes - freeBytes), freeBytes }
  } catch {
    return undefined
  }
}

/** 获取硬件与系统基础配置概览（异步：macOS/Linux 需要读一次系统统计输出） */
export async function getSystemHardwareInfo(): Promise<SystemHardwareInfo> {
  const total = os.totalmem()
  const free = os.freemem()
  const cpus = os.cpus() || []
  const firstCpu = cpus[0] || { model: 'Unknown CPU', speed: 0 }

  const disk = await readDiskStat()

  // macOS/Linux 按系统口径算可用；拿不到再退回「total - free」的老算法
  const platform = os.platform()
  const stat = platform === 'darwin' ? await readDarwinMemStat() : null
  const linuxAvailable = platform === 'linux' ? readLinuxAvailable() : null
  const available = stat?.availableBytes ?? linuxAvailable ?? free
  const used = stat?.usedBytes ?? Math.max(0, Math.min(total, total - available))

  // 内核自己的内存压力等级：jetsam 与「内存不足」通知用的就是这份读数。
  // 计算口径在内核内部（memorystatus），与静态的页桶求和不是一回事 ——
  // 系统紧不紧张以它为准。OID 拿不到（旧系统 / 更名）就缺省，UI 不展示
  let memoryPressureLevel: number | undefined
  if (platform === 'darwin') {
    try {
      const { stdout } = await run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])
      const level = parseInt(stdout.trim(), 10)
      if (Number.isFinite(level) && level > 0) memoryPressureLevel = level
    } catch {
      // 读取失败不致命，跳过
    }
  }

  // Linux 的 MemAvailable 里已含可回收 page cache，但没有页桶细分可给
  const swapUsedBytes = platform === 'darwin' ? await readDarwinSwapUsed() : undefined

  return {
    platform,
    platformName: getPlatformName(platform),
    arch: os.arch(),
    osRelease: os.release(),
    hostname: os.hostname(),
    cpuModel: firstCpu.model.trim(),
    cpuCores: cpus.length,
    cpuSpeedMhz: firstCpu.speed,
    totalMemBytes: total,
    freeMemBytes: free,
    availableMemBytes: available,
    usedMemBytes: used,
    memUsagePercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    memoryPressureLevel,
    wiredBytes: stat?.wiredBytes,
    appActiveBytes: stat?.activeBytes,
    compressedBytes: stat?.compressedBytes,
    cachedFilesBytes: stat?.cachedBytes,
    swapUsedBytes,
    memoryReleaseSupported: platform === 'darwin',
    diskTotalBytes: disk?.totalBytes,
    diskUsedBytes: disk?.usedBytes,
    diskFreeBytes: disk?.freeBytes,
    uptimeSeconds: os.uptime(),
  }
}

/**
 * 获取当前所有应用进程的内存占用列表（按内存占用降序排列）
 */
export async function getProcessMemoryList(): Promise<AppProcessMemory[]> {
  const platform = os.platform()
  const totalMem = os.totalmem()
  const currentPid = process.pid

  if (platform === 'darwin' || platform === 'linux') {
    try {
      // ps -axo pid,rss,comm
      // rss 为常驻物理内存大小 (单位 KB)
      const { stdout } = await run('ps', ['-axo', 'pid,rss,comm'])
      const lines = stdout.split('\n').slice(1) // 去掉表头

      const appMap = new Map<string, { pids: number[]; rssBytes: number; isCurrentApp: boolean }>()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (!match) continue

        const pid = parseInt(match[1], 10)
        const rssKb = parseInt(match[2], 10)
        const fullPath = match[3]

        if (isNaN(pid) || isNaN(rssKb) || rssKb <= 0) continue

        // 提取友好的应用名
        let name = fullPath
        if (platform === 'darwin') {
          // 尝试从 .app 目录提取应用名称，如 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
          const appMatch = fullPath.match(/([^/]+)\.app\//)
          if (appMatch) {
            name = appMatch[1]
          } else {
            name = fullPath.split('/').pop() || fullPath
          }
        } else {
          name = fullPath.split('/').pop() || fullPath
        }

        const rssBytes = rssKb * 1024
        const isCurrent = pid === currentPid

        const existing = appMap.get(name)
        if (existing) {
          existing.pids.push(pid)
          existing.rssBytes += rssBytes
          if (isCurrent) existing.isCurrentApp = true
        } else {
          appMap.set(name, {
            pids: [pid],
            rssBytes,
            isCurrentApp: isCurrent,
          })
        }
      }

      const results: AppProcessMemory[] = []
      for (const [name, data] of appMap.entries()) {
        results.push({
          name,
          displayName: name,
          pids: data.pids,
          rssBytes: data.rssBytes,
          memPercent: totalMem > 0 ? Math.round((data.rssBytes / totalMem) * 1000) / 10 : 0,
          isCurrentApp: data.isCurrentApp,
        })
      }

      // 按内存占用倒序排列
      results.sort((a, b) => b.rssBytes - a.rssBytes)
      return results.slice(0, 50) // 取前 50 个高占用应用/进程
    } catch (err) {
      console.error('获取 macOS/Linux 进程内存失败:', err)
      return []
    }
  } else if (platform === 'win32') {
    try {
      // Windows 使用 tasklist /fo csv /nh
      const { stdout } = await run('tasklist', ['/fo', 'csv', '/nh'])
      const lines = stdout.split('\r\n')
      const appMap = new Map<string, { pids: number[]; rssBytes: number; isCurrentApp: boolean }>()

      for (const line of lines) {
        if (!line.trim()) continue
        // CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
        // 例如: "chrome.exe","1234","Console","1","123,456 K"
        const parts = line.split('","').map((p) => p.replace(/"/g, ''))
        if (parts.length < 5) continue

        const name = parts[0]
        const pid = parseInt(parts[1], 10)
        const memStr = parts[4].replace(/[^\d]/g, '')
        const memKb = parseInt(memStr, 10)

        if (isNaN(pid) || isNaN(memKb) || memKb <= 0) continue
        const rssBytes = memKb * 1024
        const isCurrent = pid === currentPid

        const existing = appMap.get(name)
        if (existing) {
          existing.pids.push(pid)
          existing.rssBytes += rssBytes
          if (isCurrent) existing.isCurrentApp = true
        } else {
          appMap.set(name, {
            pids: [pid],
            rssBytes,
            isCurrentApp: isCurrent,
          })
        }
      }

      const results: AppProcessMemory[] = []
      for (const [name, data] of appMap.entries()) {
        results.push({
          name,
          displayName: name.replace(/\.exe$/i, ''),
          pids: data.pids,
          rssBytes: data.rssBytes,
          memPercent: totalMem > 0 ? Math.round((data.rssBytes / totalMem) * 1000) / 10 : 0,
          isCurrentApp: data.isCurrentApp,
        })
      }

      results.sort((a, b) => b.rssBytes - a.rssBytes)
      return results.slice(0, 50)
    } catch (err) {
      console.error('获取 Windows 进程内存失败:', err)
      return []
    }
  }

  return []
}
