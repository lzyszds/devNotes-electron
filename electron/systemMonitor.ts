import os from 'os'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { app, nativeImage } from 'electron'
import { readdir, readFile, unlink, access } from 'fs/promises'
import path from 'path'

const run = promisify(execFile)

/*
 * 「电脑配置」页的实时遥测层。
 *
 * 与 systemInfo.ts 分开的原因：那边是「一次性读配置/内存页桶」，这里是「有状态的采样」——
 * CPU 负载、磁盘吞吐都是两次读数的差值，必须在主进程里留上一次的快照，
 * 渲染层每秒来拿一次就只付 IPC 的钱，不用自己存基线。
 */

/* ==================== CPU ==================== */

let lastCpuTimes: { idle: number; total: number }[] | null = null

export interface CpuLive {
  /** 整体占用 0-100 */
  total: number
  /** 每个逻辑核心占用 0-100 */
  cores: number[]
  /** MHz；Apple Silicon 的 os.cpus().speed 恒为 0，此时为 0，UI 隐藏 */
  speedMhz: number
}

function sampleCpu(): CpuLive {
  const cpus = os.cpus()
  const now = cpus.map((c) => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }
  })
  const prev = lastCpuTimes
  lastCpuTimes = now
  const cores = now.map((cur, i) => {
    const p = prev?.[i]
    if (!p) return 0
    const dTotal = cur.total - p.total
    const dIdle = cur.idle - p.idle
    return dTotal > 0 ? Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)) : 0
  })
  const total = cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : 0
  return { total, cores, speedMhz: cpus[0]?.speed ?? 0 }
}

/* ==================== GPU（macOS：IOAccelerator 的性能统计） ==================== */

export interface GpuLive {
  /** 设备利用率 0-100；读不到为 null */
  utilization: number | null
  /** GPU 型号（system_profiler，缓存） */
  model: string | null
  cores: number | null
  /** 统一内存架构下 GPU 正在占用的系统内存 */
  memUsedBytes: number | null
}

let gpuModelCache: { model: string | null; cores: number | null } | null = null

async function readGpuModel() {
  if (gpuModelCache) return gpuModelCache
  let model: string | null = null
  let cores: number | null = null
  try {
    const { stdout } = await run('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 8000 })
    const item = JSON.parse(stdout)?.SPDisplaysDataType?.[0]
    model = item?.sppci_model ?? item?._name ?? null
    const c = parseInt(item?.sppci_cores, 10)
    cores = Number.isFinite(c) ? c : null
  } catch {
    /* 取不到就留空，UI 显示占位 */
  }
  gpuModelCache = { model, cores }
  return gpuModelCache
}

async function sampleGpu(): Promise<GpuLive> {
  if (os.platform() !== 'darwin') return { utilization: null, model: null, cores: null, memUsedBytes: null }
  const info = await readGpuModel()
  let utilization: number | null = null
  let memUsedBytes: number | null = null
  try {
    const { stdout } = await run('ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOAccelerator'], { timeout: 3000 })
    const u = stdout.match(/"Device Utilization %"\s*=\s*(\d+)/)
    if (u) utilization = parseInt(u[1], 10)
    const m = stdout.match(/"In use system memory"\s*=\s*(\d+)/)
    if (m) memUsedBytes = parseInt(m[1], 10)
  } catch {
    /* 同上 */
  }
  return { utilization, model: info.model, cores: info.cores, memUsedBytes }
}

/* ==================== 磁盘吞吐（累计字节差分） ==================== */

let lastDiskIo: { read: number; write: number; at: number } | null = null

async function sampleDiskIo(): Promise<{ readBps: number; writeBps: number } | null> {
  if (os.platform() !== 'darwin') return null
  try {
    const { stdout } = await run('ioreg', ['-r', '-c', 'IOBlockStorageDriver', '-w0'], { timeout: 3000 })
    let read = 0
    let write = 0
    for (const m of stdout.matchAll(/"Bytes \(Read\)"=(\d+)/g)) read += parseInt(m[1], 10)
    for (const m of stdout.matchAll(/"Bytes \(Write\)"=(\d+)/g)) write += parseInt(m[1], 10)
    const now = Date.now()
    const prev = lastDiskIo
    lastDiskIo = { read, write, at: now }
    if (!prev) return { readBps: 0, writeBps: 0 }
    const dt = (now - prev.at) / 1000
    if (dt <= 0) return { readBps: 0, writeBps: 0 }
    return {
      readBps: Math.max(0, (read - prev.read) / dt),
      writeBps: Math.max(0, (write - prev.write) / dt),
    }
  } catch {
    return null
  }
}

/* ==================== 磁盘卷 ==================== */

export interface DiskVolume {
  mount: string
  name: string
  device: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  fileSystem?: string
  /** 介质名，如 APPLE SSD AP0512Q */
  media?: string
  /** NVMe / Apple Fabric / USB … */
  protocol?: string
  solidState?: boolean
  smart?: string
}

const volumeMetaCache = new Map<string, { at: number; meta: Partial<DiskVolume> }>()

async function readVolumeMeta(mount: string): Promise<Partial<DiskVolume>> {
  const hit = volumeMetaCache.get(mount)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.meta
  const meta: Partial<DiskVolume> = {}
  if (os.platform() === 'darwin') {
    try {
      const { stdout } = await run('diskutil', ['info', mount], { timeout: 4000 })
      const pick = (label: string) => stdout.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, 'm'))?.[1].trim()
      meta.fileSystem = pick('File System Personality') ?? pick('Type \\(Bundle\\)')
      meta.media = pick('Device / Media Name')
      meta.protocol = pick('Protocol')
      const ssd = pick('Solid State')
      if (ssd) meta.solidState = /yes/i.test(ssd)
      meta.smart = pick('SMART Status')
    } catch {
      /* 元数据缺失不影响容量展示 */
    }
  }
  volumeMetaCache.set(mount, { at: Date.now(), meta })
  return meta
}

async function listVolumes(): Promise<DiskVolume[]> {
  const platform = os.platform()
  if (platform === 'win32') return []
  let stdout = ''
  try {
    ;({ stdout } = await run('df', ['-kP'], { timeout: 4000 }))
  } catch {
    return []
  }
  const rows = stdout
    .split('\n')
    .slice(1)
    .map((l) => l.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m && m[1].startsWith('/dev/'))
    .map((m) => ({
      device: m[1],
      total: parseInt(m[2], 10) * 1024,
      used: parseInt(m[3], 10) * 1024,
      free: parseInt(m[4], 10) * 1024,
      mount: m[5],
    }))
    .filter((r) => r.total > 0)

  // macOS：系统卷（/）是只读快照，真实数据在 Data 卷；两个同时列出会让人以为有两块盘
  const picked =
    platform === 'darwin'
      ? rows.filter((r) => r.mount === '/System/Volumes/Data' || r.mount.startsWith('/Volumes/'))
      : rows.filter((r) => !r.mount.startsWith('/snap') && !r.mount.startsWith('/boot'))
  const seen = new Set<string>()
  const unique = picked.filter((r) => (seen.has(r.device) ? false : (seen.add(r.device), true)))

  return Promise.all(
    unique.map(async (r) => {
      const meta = await readVolumeMeta(r.mount)
      const name = r.mount === '/System/Volumes/Data' ? 'Macintosh HD' : r.mount.split('/').pop() || r.mount
      // Data 卷的 df「已用」只算本卷；容器内其他卷共享空间，用 total-free 才和访达一致
      return {
        mount: r.mount,
        name,
        device: r.device,
        totalBytes: r.total,
        usedBytes: Math.max(0, r.total - r.free),
        freeBytes: r.free,
        ...meta,
      }
    }),
  )
}

/* ==================== 进程 ==================== */

export interface LiveProcess {
  key: string
  displayName: string
  /** 可执行文件或 .app 路径，渲染层拿它去取真实图标 */
  iconPath: string
  category: 'app' | 'background'
  pids: number[]
  cpu: number
  rssBytes: number
  memPercent: number
  suspended: boolean
  isCurrentApp: boolean
}

export async function listLiveProcesses(): Promise<LiveProcess[]> {
  const platform = os.platform()
  if (platform !== 'darwin' && platform !== 'linux') return []
  const totalMem = os.totalmem()
  const currentPid = process.pid
  // 取 Electron 自己的 .app 名，把主进程 + Helper 都归到「本应用」
  const { stdout } = await run('ps', ['-axo', 'pid=,rss=,%cpu=,state=,comm='], { maxBuffer: 16 * 1024 * 1024 })
  const map = new Map<string, LiveProcess>()
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/)
    if (!m) continue
    const pid = parseInt(m[1], 10)
    const rssKb = parseInt(m[2], 10)
    if (!rssKb) continue
    const cpu = parseFloat(m[3]) || 0
    const suspended = m[4].startsWith('T')
    const full = m[5]
    const bundle = full.match(/^(.*?\.app)\//)
    const isUserApp =
      !!bundle && !bundle[1].startsWith('/System/') && !bundle[1].startsWith('/usr/') && !bundle[1].startsWith('/Library/')
    const iconPath = bundle ? bundle[1] : full
    const name = bundle ? bundle[1].split('/').pop()!.replace(/\.app$/, '') : full.split('/').pop() || full
    // 同名 key：.app 用 bundle 路径区分（同名不同位置的两份应用不应合并）
    const key = bundle ? bundle[1] : name
    const cur = map.get(key)
    const rssBytes = rssKb * 1024
    if (cur) {
      cur.pids.push(pid)
      cur.cpu += cpu
      cur.rssBytes += rssBytes
      cur.suspended = cur.suspended && suspended
      if (pid === currentPid) cur.isCurrentApp = true
    } else {
      map.set(key, {
        key,
        displayName: name,
        iconPath,
        category: isUserApp ? 'app' : 'background',
        pids: [pid],
        cpu,
        rssBytes,
        memPercent: 0,
        suspended,
        isCurrentApp: pid === currentPid,
      })
    }
  }
  const list = [...map.values()]
  for (const p of list) {
    p.cpu = Math.round(p.cpu * 10) / 10
    p.memPercent = totalMem > 0 ? Math.round((p.rssBytes / totalMem) * 1000) / 10 : 0
  }
  return list.sort((a, b) => b.cpu - a.cpu || b.rssBytes - a.rssBytes).slice(0, 200)
}

/* ==================== 一次拿全：渲染层每秒调这一个 ==================== */

export interface SystemLive {
  cpu: CpuLive
  gpu: GpuLive
  diskIo: { readBps: number; writeBps: number } | null
}

export async function sampleSystemLive(): Promise<SystemLive> {
  const cpu = sampleCpu()
  const [gpu, diskIo] = await Promise.all([sampleGpu(), sampleDiskIo()])
  return { cpu, gpu, diskIo }
}

export { listVolumes }

/* ==================== 真实图标 ==================== */

const iconCache = new Map<string, string | null>()

/**
 * 直接读 .app 包里的 .icns 转 PNG（macOS）。
 *
 * 为什么不只用 app.getFileIcon：它走 NSWorkspace，遇到 Electron 系应用、
 * 资源目录里图标命名不规范的包，常给回一个泛用的「空白应用」图标 ——
 * 看着像取到了其实是假的。包自带的 icns 才是 Finder 里看到的那张。
 * 转换用系统自带的 sips，不引入依赖。
 */
async function iconFromBundle(bundle: string): Promise<string | null> {
  const res = path.join(bundle, 'Contents', 'Resources')
  let file: string | null = null
  try {
    const { stdout } = await run('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], { timeout: 2000 })
    const name = stdout.trim()
    if (name) file = path.join(res, name.endsWith('.icns') ? name : `${name}.icns`)
  } catch {
    /* 没声明图标文件名（如资源目录型图标），下面按目录里的 icns 兜底 */
  }
  if (!file || !(await exists(file))) {
    try {
      const icns = (await readdir(res)).filter((f) => f.toLowerCase().endsWith('.icns'))
      const base = path.basename(bundle, '.app').toLowerCase()
      const pick = icns.find((f) => f.toLowerCase().startsWith(base)) ?? icns.find((f) => /app|icon/i.test(f)) ?? icns[0]
      file = pick ? path.join(res, pick) : null
    } catch {
      file = null
    }
  }
  if (!file) return null
  const tmp = path.join(os.tmpdir(), `devnotes-icon-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
  try {
    await run('sips', ['-s', 'format', 'png', '-z', '64', '64', file, '--out', tmp], { timeout: 4000 })
    return `data:image/png;base64,${(await readFile(tmp)).toString('base64')}`
  } catch {
    return null
  } finally {
    unlink(tmp).catch(() => {})
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function resolveIcon(p: string): Promise<string | null> {
  if (os.platform() === 'darwin' && p.endsWith('.app')) {
    const fromBundle = await iconFromBundle(p)
    if (fromBundle) return fromBundle
    try {
      const thumb = await nativeImage.createThumbnailFromPath(p, { width: 64, height: 64 })
      if (!thumb.isEmpty()) return thumb.toDataURL()
    } catch {
      /* 缩略图失败再退回系统图标 */
    }
  }
  // 裸可执行文件没有自己的图标，getFileIcon 只会给泛用图标 —— 返回 null 让界面画占位符
  if (!p.endsWith('.app') && os.platform() === 'darwin') return null
  try {
    const img = await app.getFileIcon(p, { size: 'normal' })
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

/** 批量取应用图标（data URL）。结果按路径缓存：图标不会在运行期变，不必重复取 */
export async function getProcessIcons(paths: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  await Promise.all(
    paths.slice(0, 200).map(async (p) => {
      if (typeof p !== 'string' || p.length > 4096 || !p) return
      if (!iconCache.has(p)) iconCache.set(p, await resolveIcon(p))
      out[p] = iconCache.get(p) ?? null
    }),
  )
  return out
}

/* ==================== 进程控制 ==================== */

/** 挂起/恢复一组 PID（SIGSTOP/SIGCONT）。本进程自身不可挂起 */
export function signalProcesses(pids: number[], action: 'suspend' | 'resume'): { ok: boolean; failed: number } {
  let failed = 0
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
      failed++
      continue
    }
    try {
      process.kill(pid, action === 'suspend' ? 'SIGSTOP' : 'SIGCONT')
    } catch {
      failed++
    }
  }
  return { ok: failed < pids.length, failed }
}

/** 「运行新任务」：应用名走 open -a，其余当命令行执行（detached，不随本应用退出） */
export async function spawnTask(command: string): Promise<{ ok: boolean; pid?: number; error?: string }> {
  const cmd = command.trim()
  if (!cmd || cmd.length > 2000) return { ok: false, error: '命令为空或过长' }
  try {
    if (os.platform() === 'darwin') {
      // 先当应用名试（Safari / "Visual Studio Code"）；open -Ra 只查不启动，查不到才退回命令行
      try {
        await run('open', ['-Ra', cmd.replace(/\.app$/, '')], { timeout: 3000 })
        await run('open', ['-a', cmd.replace(/\.app$/, '')], { timeout: 5000 })
        return { ok: true }
      } catch {
        /* 不是已安装应用，走命令行 */
      }
    }
    const child =
      os.platform() === 'win32'
        ? spawn('cmd.exe', ['/c', 'start', '""', cmd], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('/bin/sh', ['-c', cmd], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, pid: child.pid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/* ==================== 开机启动项（macOS） ==================== */

export interface StartupItem {
  id: string
  name: string
  detail: string
  enabled: boolean
  kind: 'login-item' | 'launch-agent'
  /** login-item：应用路径（重新启用要用）；launch-agent：plist 路径 */
  path: string
  /** 取图标用的路径：优先 .app 包；解析不到为空串 */
  iconPath: string
}

const DISABLED_LOGIN_ITEMS = new Map<string, StartupItem>()

async function listLoginItems(): Promise<StartupItem[]> {
  try {
    const { stdout } = await run(
      'osascript',
      ['-e', 'tell application "System Events" to get {name, path} of every login item'],
      { timeout: 6000 },
    )
    // 返回形如 "A, B, /Applications/A.app, /Applications/B.app"，前后半对称
    const parts = stdout.trim().split(', ').filter(Boolean)
    const half = parts.length / 2
    if (!Number.isInteger(half)) return []
    return Promise.all(
      parts.slice(0, half).map(async (name, i) => {
        // 无路径的登录项 System Events 会回 "missing value"，当空处理
        const itemPath = parts[half + i] === 'missing value' ? '' : parts[half + i]
        // 没路径时按名字在常见应用目录里碰一碰，至少能把图标找回来
        let iconPath = itemPath
        if (!iconPath) {
          for (const dir of ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications']) {
            const guess = path.join(dir, `${name}.app`)
            if (await exists(guess)) {
              iconPath = guess
              break
            }
          }
        }
        return {
          id: `login:${name}`,
          name,
          detail: '登录项',
          enabled: true,
          kind: 'login-item' as const,
          path: itemPath,
          iconPath,
        }
      }),
    )
  } catch {
    return []
  }
}

async function listLaunchAgents(): Promise<StartupItem[]> {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.plist'))
  } catch {
    return []
  }
  const uid = process.getuid?.() ?? 501
  let disabledText = ''
  try {
    ;({ stdout: disabledText } = await run('launchctl', ['print-disabled', `gui/${uid}`], { timeout: 3000 }))
  } catch {
    /* 取不到就当全部启用 */
  }
  return Promise.all(files.map(async (f) => {
    const label = f.replace(/\.plist$/, '')
    const off = new RegExp(`"${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*=>\\s*(disabled|true)`).test(disabledText)
    // plist 里的 Program / ProgramArguments[0] 指向真正要跑的程序；在 .app 里就用 .app 的图标
    let iconPath = ''
    try {
      const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', path.join(dir, f)], { timeout: 2000 })
      const plist = JSON.parse(stdout)
      const exe: string | undefined = plist.Program ?? plist.ProgramArguments?.[0]
      if (typeof exe === 'string') iconPath = exe.match(/^(.*?\.app)\//)?.[1] ?? exe
    } catch {
      /* 解析失败就不带图标 */
    }
    return {
      id: `agent:${label}`,
      name: label,
      detail: '用户 LaunchAgent',
      enabled: !off,
      kind: 'launch-agent' as const,
      path: path.join(dir, f),
      iconPath,
    }
  }))
}

export async function listStartupItems(): Promise<StartupItem[]> {
  if (os.platform() !== 'darwin') return []
  const [logins, agents] = await Promise.all([listLoginItems(), listLaunchAgents()])
  const active = new Set(logins.map((l) => l.id))
  // 已被本页禁用（从系统登录项里删掉）的项继续留在列表里，才有机会重新启用
  const parked = [...DISABLED_LOGIN_ITEMS.values()].filter((i) => !active.has(i.id))
  return [...logins, ...parked, ...agents]
}

export async function setStartupItemEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (os.platform() !== 'darwin') return { ok: false, error: '仅 macOS 支持' }
  // 只认主进程自己枚举出来的项：渲染层传来的路径不可信，不能直接喂给 osascript
  const item = (await listStartupItems()).find((i) => i.id === id)
  if (!item) return { ok: false, error: '启动项已不存在，请刷新' }
  if (item.kind === 'login-item' && !item.path) return { ok: false, error: '该登录项没有可识别的路径，请在系统设置中手动管理' }
  try {
    if (item.kind === 'login-item') {
      if (enabled) {
        await run(
          'osascript',
          ['-e', `tell application "System Events" to make login item at end with properties {path:"${item.path.replace(/"/g, '\\"')}", hidden:false}`],
          { timeout: 6000 },
        )
        DISABLED_LOGIN_ITEMS.delete(item.id)
      } else {
        await run(
          'osascript',
          ['-e', `tell application "System Events" to delete login item "${item.name.replace(/"/g, '\\"')}"`],
          { timeout: 6000 },
        )
        DISABLED_LOGIN_ITEMS.set(item.id, { ...item, enabled: false })
      }
    } else {
      const uid = process.getuid?.() ?? 501
      const label = item.name
      if (enabled) {
        await run('launchctl', ['enable', `gui/${uid}/${label}`])
      } else {
        await run('launchctl', ['disable', `gui/${uid}/${label}`])
      }
    }
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: /not allowed|1743|-1743/.test(msg) ? '需要在「系统设置 → 隐私与安全性 → 自动化」里允许本应用控制 System Events' : msg.slice(0, 140) }
  }
}
