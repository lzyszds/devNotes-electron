import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  Cpu,
  Database,
  Flame,
  HardDrive,
  Server,
  Layers,
  Activity,
  Zap,
  Search,
  Plus,
  XCircle,
  X,
  Pause,
  Play,
  Terminal,
  Cog,
  PauseCircle,
  PlayCircle,
} from 'lucide-react'
import type {
  SystemHardwareInfo,
  LiveProcess,
  SystemLive,
  DiskVolume,
  StartupItem,
} from '../../types/system'
import ToolShell from '../ui/ToolShell'
import VirtualList from '../ui/VirtualList'
import { useToast } from '../ui/Toast'
import { usePageVisible } from '../../hooks/usePageVisible'

/* ==================== 小工具 ==================== */

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i >= 3 ? 2 : 1)} ${sizes[i]}`
}

function formatRate(bps: number): string {
  return `${formatBytes(bps)}/s`
}

/** dd:hh:mm:ss，与原型顶栏的运行时间一致 */
function formatUptimeClock(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return [d, h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/*
 * 配色取自原型：obsidian 黑 + 暖灰边 + 一个琥珀色强调（可回收/高占用）+ 一个绿色（健康）。
 * 类名里直接写色值，和仓库里其他工具页保持同一种写法。
 */
const CARD = 'bg-white rounded-2xl border border-[#DDD9D1] shadow-[0_1px_3px_rgba(24,23,21,0.06)]'
const HISTORY_LEN = 40
const POLL_MS = 2000

/** 迷你面积图：y 轴固定 0-100%，和原型的 createSparklineSVG 同一套算法 */
function Sparkline({ data, color = '#181715' }: { data: number[]; color?: string }) {
  const id = useRef(`sp-${Math.random().toString(36).slice(2, 8)}`).current
  if (data.length < 2) return <div className="h-full w-full" />
  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100
    const c = Math.max(2, Math.min(96, v))
    const y = 100 - (c / 100) * 88 - 6
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = `M ${coords.join(' L ')}`
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L 100,100 L 0,100 Z`} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function pushHistory(prev: number[], v: number): number[] {
  const next = [...prev, v]
  return next.length > HISTORY_LEN ? next.slice(-HISTORY_LEN) : next
}

/** 魔法棒图标：原型里「释放可回收内存」按钮的 SVG，原样搬过来 */
function WandIcon({ className = '', spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} ${spinning ? 'animate-pulse' : ''}`}
    >
      <path
        d="M14.8284 6.34315L6.34315 14.8284C5.5621 15.6095 5.5621 16.8758 6.34315 17.6569C7.1242 18.4379 8.39052 18.4379 9.17157 17.6569L17.6569 9.17157C18.4379 8.39052 18.4379 7.1242 17.6569 6.34315C16.8758 5.5621 15.6095 5.5621 14.8284 6.34315Z"
        stroke="currentColor"
        strokeWidth="1.95"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.1 8.1L15.9 10.9" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" />
      <path d="M8.5 3.4V7.4M6.5 5.4H10.5" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
      <path d="M4.5 9.2V11.8M3.2 10.5H5.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M16.6 13.6V17.2M14.8 15.4H18.4" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    </svg>
  )
}

type MainTab = 'processes' | 'performance' | 'storage' | 'startup'
type ProcFilter = 'all' | 'app' | 'background' | 'high'
type SortCol = 'name' | 'cpu' | 'ram' | 'count'

/** 「高占用」的判定：CPU ≥5% 或常驻内存 ≥800MB，对应原型的 cpu/ram 阈值 */
const isHighLoad = (p: LiveProcess) => p.cpu >= 5 || p.rssBytes >= 800 * 1024 ** 2

/**
 * 真实应用图标；取不到时按类型给占位：
 * .app 退回首字母方块，裸可执行文件（node、系统守护进程）画终端 / 齿轮，
 * 比一律首字母更容易认出「这不是个应用」。
 */
function AppIcon({ src, name, active, path = '' }: { src?: string | null; name: string; active: boolean; path?: string }) {
  const isBundle = path.endsWith('.app')
  const isSystem = /^\/(System|usr|sbin|bin|Library)\//.test(path)
  const Fallback = isSystem ? Cog : Terminal
  return (
    <div
      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 overflow-hidden transition-colors ${
        src
          ? 'bg-transparent'
          : active
            ? 'bg-[#181715] text-white'
            : 'bg-[#F1EFEA] text-[#181715] border border-[#E8E6E1]'
      }`}
    >
      {src ? (
        <img src={src} alt="" className="w-8 h-8 object-contain" draggable={false} />
      ) : isBundle || !path ? (
        <span className="text-xs font-bold">{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <Fallback className="w-4 h-4 text-[#6B6862]" />
      )}
    </div>
  )
}

export default function SystemInspectorTool({ isActive = true }: { isActive?: boolean }) {
  const { showToast } = useToast()
  const pageVisible = usePageVisible()
  const [hardware, setHardware] = useState<SystemHardwareInfo | null>(null)
  const [live, setLive] = useState<SystemLive | null>(null)
  const [processes, setProcesses] = useState<LiveProcess[]>([])
  const [volumes, setVolumes] = useState<DiskVolume[]>([])
  const [startup, setStartup] = useState<StartupItem[]>([])
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const requestedIcons = useRef<Set<string>>(new Set())

  const [tab, setTab] = useState<MainTab>('processes')
  const [filter, setFilter] = useState<ProcFilter>('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('cpu')
  const [sortDesc, setSortDesc] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [spawnCmd, setSpawnCmd] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [ramHist, setRamHist] = useState<number[]>([])
  const [gpuHist, setGpuHist] = useState<number[]>([])

  /* ---------------- 采集 ---------------- */

  /*
   * 进程列表是整页最贵的一次采集（ps 扫全表，几百行），其他视图用不到它。
   * 看别的页签时降到每 5 次采样拉一次，只给卡片里的「进程数」保个大致新鲜度。
   */
  const tabRef = useRef<MainTab>('processes')
  const tickRef = useRef(0)
  useEffect(() => { tabRef.current = tab }, [tab])

  const fetchAll = useCallback(async () => {
    const api = window.electronAPI
    if (api?.systemInfo && api?.systemLive && api?.systemLiveProcesses) {
      try {
        const withProcs = tabRef.current === 'processes' || tickRef.current++ % 5 === 0
        const [hw, lv, procs] = await Promise.all([
          api.systemInfo(),
          api.systemLive(),
          withProcs ? api.systemLiveProcesses() : Promise.resolve(null),
        ])
        setHardware(hw)
        setLive(lv)
        if (procs) setProcesses(procs)
        setCpuHist((h) => pushHistory(h, lv.cpu.total))
        setRamHist((h) => pushHistory(h, hw.memUsagePercent))
        if (lv.gpu.utilization != null) setGpuHist((h) => pushHistory(h, lv.gpu.utilization as number))
      } catch (err) {
        console.error('获取系统数据失败:', err)
      }
      return
    }
    // 浏览器环境：给一份稳定的示意数据，让页面在 Web 构建里也能完整浏览
    const nav = window.navigator as Navigator & { deviceMemory?: number }
    const total = (nav.deviceMemory || 8) * 1024 ** 3
    const cores = nav.hardwareConcurrency || 8
    const jitter = () => 18 + Math.random() * 14
    const cpuCores = Array.from({ length: cores }, jitter)
    const used = total * 0.58
    setHardware({
      platform: 'web',
      platformName: 'Web 浏览器环境',
      arch: 'x64',
      osRelease: nav.userAgent,
      hostname: 'localhost',
      cpuModel: `${cores} 核心逻辑处理器`,
      cpuCores: cores,
      cpuSpeedMhz: 0,
      totalMemBytes: total,
      freeMemBytes: total - used,
      availableMemBytes: total - used,
      usedMemBytes: used,
      memUsagePercent: 58,
      uptimeSeconds: Math.floor(performance.now() / 1000) + 3600 * 5,
      diskTotalBytes: 512 * 1024 ** 3,
      diskUsedBytes: 292 * 1024 ** 3,
      diskFreeBytes: 220 * 1024 ** 3,
    })
    const lv: SystemLive = {
      cpu: { total: cpuCores.reduce((a, b) => a + b, 0) / cores, cores: cpuCores, speedMhz: 0 },
      gpu: { utilization: null, model: null, cores: null, memUsedBytes: null },
      diskIo: null,
    }
    setLive(lv)
    setProcesses([
      { key: 'Chrome', displayName: 'Google Chrome', iconPath: '', category: 'app', pids: [1001], cpu: 6.2, rssBytes: 1.6 * 1024 ** 3, memPercent: 20, suspended: false, isCurrentApp: false },
      { key: 'devNotes', displayName: 'devNotes', iconPath: '', category: 'app', pids: [1002], cpu: 2.1, rssBytes: 420 * 1024 ** 2, memPercent: 5, suspended: false, isCurrentApp: true },
      { key: 'Code', displayName: 'Code', iconPath: '', category: 'app', pids: [1003], cpu: 3.4, rssBytes: 980 * 1024 ** 2, memPercent: 12, suspended: false, isCurrentApp: false },
      { key: 'WindowServer', displayName: 'WindowServer', iconPath: '', category: 'background', pids: [1004], cpu: 1.2, rssBytes: 650 * 1024 ** 2, memPercent: 8, suspended: false, isCurrentApp: false },
    ])
    setCpuHist((h) => pushHistory(h, lv.cpu.total))
    setRamHist((h) => pushHistory(h, 58))
  }, [])

  const fetchVolumes = useCallback(async () => {
    const api = window.electronAPI
    if (api?.systemVolumes) {
      try {
        setVolumes(await api.systemVolumes())
      } catch {
        /* 卷信息缺失时退回家目录卷的容量 */
      }
    }
  }, [])

  const fetchStartup = useCallback(async () => {
    const api = window.electronAPI
    if (api?.systemStartupList) {
      try {
        setStartup(await api.systemStartupList())
      } catch {
        setStartup([])
      }
    }
  }, [])

  useEffect(() => {
    fetchAll()
    fetchVolumes()
  }, [fetchAll, fetchVolumes])

  // 轮询：切走页签 / 用户点暂停 / 正在清理时都停，避免后台无意义地 ps + ioreg
  useEffect(() => {
    if (!isActive || paused || !pageVisible) return
    fetchAll()
    const timer = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(timer)
  }, [isActive, paused, pageVisible, fetchAll])

  // 磁盘卷变化慢，15 秒一次足够；切到存储页时立刻刷一次
  useEffect(() => {
    if (!isActive || !pageVisible) return
    const timer = setInterval(fetchVolumes, 15000)
    return () => clearInterval(timer)
  }, [isActive, pageVisible, fetchVolumes])

  useEffect(() => {
    if (tab === 'storage') fetchVolumes()
    if (tab === 'startup') fetchStartup()
  }, [tab, fetchVolumes, fetchStartup])

  // 启动项数量要常驻在侧栏上，进页面时取一次
  useEffect(() => {
    fetchStartup()
  }, [fetchStartup])

  // 真实图标：只请求没取过的路径；主进程再按路径缓存
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.systemProcessIcons) return
    const missing = [...processes.map((p) => p.iconPath), ...startup.map((i) => i.iconPath)]
      .filter((p) => p && !requestedIcons.current.has(p))
    if (missing.length === 0) return
    missing.forEach((p) => requestedIcons.current.add(p))
    api
      .systemProcessIcons(missing)
      .then((got) => setIcons((prev) => ({ ...prev, ...got })))
      .catch(() => missing.forEach((p) => requestedIcons.current.delete(p)))
  }, [processes, startup])

  // ⌘K / Ctrl+K 聚焦搜索
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setTab('processes')
        setTimeout(() => searchRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive])

  /* ---------------- 动作 ---------------- */

  const handleReleaseMemory = useCallback(async () => {
    if (releasing) return
    if (!hardware?.memoryReleaseSupported) {
      showToast('释放内存目前仅支持 macOS', 'default')
      return
    }
    if (
      !window.confirm(
        '将执行系统级内存清理（purge）：\n\n只回收文件缓存，不会结束任何应用；系统随后会随使用重新填充缓存。需要输入管理员密码。\n\n继续吗？',
      )
    )
      return
    setReleasing(true)
    try {
      const result = await window.electronAPI?.memoryRelease?.()
      if (result) showToast(result.message, result.ok || result.cancelled ? 'default' : 'error')
      await fetchAll()
    } finally {
      setReleasing(false)
    }
  }, [releasing, hardware?.memoryReleaseSupported, fetchAll, showToast])

  const killGroup = useCallback(
    async (proc: LiveProcess) => {
      if (proc.isCurrentApp) return
      if (!window.confirm(`确定要结束「${proc.displayName}」吗？\n将终止 ${proc.pids.length} 个进程（PID: ${proc.pids.slice(0, 5).join(', ')}${proc.pids.length > 5 ? '…' : ''}）。`)) return
      let failed = 0
      let lastErr = ''
      for (const pid of proc.pids) {
        const res = await window.electronAPI?.systemKillProcess?.(pid)
        if (!res?.ok) {
          failed++
          lastErr = res?.error ?? '权限不足'
        }
      }
      if (failed === 0) showToast(`已终止「${proc.displayName}」，释放 ${formatBytes(proc.rssBytes)} 内存`, 'default')
      else showToast(`${failed} 个进程终止失败：${lastErr}`, 'error')
      if (selectedKey === proc.key) setSelectedKey(null)
      await fetchAll()
    },
    [fetchAll, selectedKey, showToast],
  )

  const toggleSuspend = useCallback(
    async (proc: LiveProcess) => {
      if (proc.isCurrentApp) return
      const action = proc.suspended ? 'resume' : 'suspend'
      const res = await window.electronAPI?.systemProcessSignal?.(proc.pids, action)
      if (res?.ok) showToast(`已${action === 'suspend' ? '挂起' : '恢复'}「${proc.displayName}」`, 'default')
      else showToast('操作失败：权限不足或进程已退出', 'error')
      await fetchAll()
    },
    [fetchAll, showToast],
  )

  const confirmSpawn = useCallback(async () => {
    const cmd = spawnCmd.trim()
    if (!cmd) return
    const res = await window.electronAPI?.systemSpawn?.(cmd)
    if (res?.ok) {
      showToast(res.pid ? `已启动「${cmd}」(PID: ${res.pid})` : `已启动「${cmd}」`, 'default')
      setSpawnOpen(false)
      setSpawnCmd('')
      setTimeout(fetchAll, 600)
    } else {
      showToast(`启动失败：${res?.error ?? '当前环境不支持'}`, 'error')
    }
  }, [spawnCmd, fetchAll, showToast])

  const toggleStartup = useCallback(
    async (item: StartupItem) => {
      const res = await window.electronAPI?.systemStartupToggle?.(item.id, !item.enabled)
      if (res?.ok) showToast(`已${item.enabled ? '禁用' : '启用'}启动项「${item.name}」`, 'default')
      else showToast(res?.error ?? '操作失败', 'error')
      await fetchStartup()
    },
    [fetchStartup, showToast],
  )

  /* ---------------- 派生值 ---------------- */

  const counts = useMemo(
    () => ({
      all: processes.length,
      app: processes.filter((p) => p.category === 'app').length,
      bg: processes.filter((p) => p.category === 'background').length,
    }),
    [processes],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = processes.filter((p) => {
      if (filter === 'app' && p.category !== 'app') return false
      if (filter === 'background' && p.category !== 'background') return false
      if (filter === 'high' && !isHighLoad(p)) return false
      if (!q) return true
      return p.displayName.toLowerCase().includes(q) || p.pids.some((pid) => String(pid).includes(q))
    })
    const dir = sortDesc ? -1 : 1
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case 'name':
          return dir * a.displayName.localeCompare(b.displayName)
        case 'ram':
          return dir * (a.rssBytes - b.rssBytes)
        case 'count':
          return dir * (a.pids.length - b.pids.length)
        default:
          return dir * (a.cpu - b.cpu)
      }
    })
  }, [processes, filter, search, sortCol, sortDesc])

  const selected = processes.find((p) => p.key === selectedKey) ?? null
  const maxRss = useMemo(() => processes.reduce((m, p) => Math.max(m, p.rssBytes), 1), [processes])

  const totalBytes = hardware?.totalMemBytes ?? 0
  const usedBytes = hardware?.usedMemBytes ?? 0
  const ramPercent = hardware?.memUsagePercent ?? 0
  const cachedBytes = hardware?.cachedFilesBytes ?? 0
  const wiredBytes = hardware?.wiredBytes ?? 0
  const activeBytes = hardware?.appActiveBytes ?? 0
  const compressedBytes = hardware?.compressedBytes ?? 0
  const freeBytes = Math.max(0, totalBytes - wiredBytes - activeBytes - compressedBytes - cachedBytes)
  const hasBuckets = hardware?.wiredBytes != null
  const cachePercent = totalBytes > 0 ? (cachedBytes / totalBytes) * 100 : 0
  const cpuTotal = live?.cpu.total ?? 0
  const gpuUtil = live?.gpu.utilization
  const cpuLabel = hardware?.cpuModel ?? '检测中…'

  // 优先用 df 枚举出来的所有卷；没拿到时用家目录所在卷凑一张
  const disks: DiskVolume[] = useMemo(() => {
    if (volumes.length > 0) return volumes
    if (hardware?.diskTotalBytes != null) {
      return [
        {
          mount: '/',
          name: '系统磁盘',
          device: '',
          totalBytes: hardware.diskTotalBytes,
          usedBytes: hardware.diskUsedBytes ?? 0,
          freeBytes: hardware.diskFreeBytes ?? 0,
        },
      ]
    }
    return []
  }, [volumes, hardware])
  const diskFreeTotal = disks.reduce((s, d) => s + d.freeBytes, 0)

  const setSort = (col: SortCol) => {
    if (sortCol === col) setSortDesc((d) => !d)
    else {
      setSortCol(col)
      setSortDesc(true)
    }
  }
  const sortMark = (col: SortCol) => (sortCol === col ? (sortDesc ? '▼' : '▲') : '')

  /* ---------------- 渲染片段 ---------------- */

  const overloaded = ramPercent >= 85
  const ramColor = cachePercent > 8 ? '#D97706' : '#181715'

  return (
    <ToolShell
      icon={Activity}
      title="电脑任务管理器"
      badge={
        <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#181715]/5 text-[#55534E] border border-[#E8E6E1] truncate">
          {hardware ? `${hardware.platformName} · ${hardware.arch.toUpperCase()}` : '检测中'}
        </span>
      }
      actions={
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-4 text-[11px] text-[#55534E]">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-[#D97706]' : 'bg-[#16A34A] animate-pulse'}`} />
              采样 <strong className="font-mono text-[#181715]">{(POLL_MS / 1000).toFixed(2)}s</strong>
            </span>
            <span>
              运行 <strong className="font-mono text-[#181715] tabular-nums">{hardware ? formatUptimeClock(hardware.uptimeSeconds) : '--'}</strong>
            </span>
            <span>
              进程 <strong className="font-mono text-[#181715] tabular-nums">{processes.reduce((s, p) => s + p.pids.length, 0).toLocaleString()}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-[#E8E6E1] text-[#55534E] hover:text-[#181715] hover:border-[#CFCBC2] transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? '继续刷新' : '暂停刷新'}
          </button>
          <button
            type="button"
            onClick={handleReleaseMemory}
            disabled={releasing}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#181715] text-white hover:bg-[#2A2926] transition-all flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            <WandIcon className="w-3.5 h-3.5" spinning={releasing} />
            一键加速
          </button>
        </div>
      }
      scroll={false}
    >
      <div className="flex-1 min-h-0 flex overflow-hidden bg-[#F3F1EC]">
        {/* ============ 右侧主区 ============ */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* 视图标签条：原先的页内左侧栏并入这里，避免与应用级「电脑配置」侧栏重复 */}
          <div className="px-4 pt-3 shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {(
              [
                ['processes', Layers, '进程与实时性能', String(counts.all)],
                ['performance', Activity, '硬件详情曲线', `${live?.cpu.cores.length ?? '-'} 核`],
                ['storage', HardDrive, '磁盘与存储卷', `${disks.length} 卷`],
                ['startup', Zap, '开机启动项', String(startup.length)],
              ] as const
            ).map(([id, Icon, label, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 cursor-pointer ${
                  tab === id ? 'bg-[#181715] text-white' : 'text-[#55534E] hover:bg-[#181715]/5 hover:text-[#181715]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                <span className={`font-mono text-[10px] ${tab === id ? 'text-white/70' : 'text-[#6B6862]'}`}>{n}</span>
              </button>
            ))}
          </div>

          {/* 四卡遥测：统一四段式 —— 标题行 / 大数字 + 副标 / 曲线（吃剩余高度）/ 页脚 */}
          <section className="p-4 pb-3 shrink-0">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
              {/* CPU */}
              <div onClick={() => setTab('performance')} className={`${CARD} p-4 flex flex-col hover:border-[#B9B4A8] transition-all cursor-pointer`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#45433E] whitespace-nowrap">
                    <Cpu className="w-3.5 h-3.5 text-[#181715]" /> CPU
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#181715]/5 border border-[#DDD9D1] text-[#45433E] whitespace-nowrap shrink-0">
                    {cpuTotal >= 80 ? '高负载' : '正常'}
                  </span>
                </div>
                <div className="mt-2 text-[28px] leading-none font-bold font-mono tracking-tight tabular-nums">{cpuTotal.toFixed(1)}%</div>
                <div className="mt-1.5 text-[11px] font-mono text-[#6B6862] truncate">
                  {live && live.cpu.speedMhz > 0 ? `${(live.cpu.speedMhz / 1000).toFixed(2)} GHz · ` : ''}{hardware?.cpuCores ?? '-'} 逻辑核心
                </div>
                <div className="my-3 h-12 shrink-0"><Sparkline data={cpuHist} /></div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6862] font-mono pt-2 border-t border-[#E8E6E1]">
                  <span className="truncate">{live?.cpu.cores.length ?? '-'} 核实时负载</span>
                  <span className="shrink-0 whitespace-nowrap">进程 <strong className="text-[#181715]">{processes.reduce((s, p) => s + p.pids.length, 0)}</strong></span>
                </div>
              </div>

              {/* RAM */}
              <div className={`${CARD} p-4 flex flex-col hover:border-[#B9B4A8] transition-all`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#45433E] whitespace-nowrap">
                    <Database className="w-3.5 h-3.5 text-[#181715]" /> 内存
                  </div>
                  {hardware?.memoryReleaseSupported && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleReleaseMemory() }}
                      title={`立即清理文件缓存（purge），可回收约 ${formatBytes(cachedBytes)}`}
                      className="text-[11px] font-medium px-2.5 py-0.5 rounded-md bg-[#181715] text-white hover:bg-[#2A2926] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      ⚡ 释放
                    </button>
                  )}
                </div>
                <div className="mt-2 text-[28px] leading-none font-bold font-mono tracking-tight tabular-nums">{ramPercent.toFixed(1)}%</div>
                <div className="mt-1.5 text-[11px] font-mono text-[#6B6862] tabular-nums truncate">
                  {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
                </div>
                <div className="my-3 h-12 shrink-0"><Sparkline data={ramHist} color={ramColor} /></div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6862] font-mono pt-2 border-t border-[#E8E6E1]">
                  <span className="whitespace-nowrap">Swap <strong className="text-[#181715]">{formatBytes(hardware?.swapUsedBytes ?? 0)}</strong></span>
                  <span className="whitespace-nowrap">缓存 <strong className="text-[#B45309]">{formatBytes(cachedBytes)}</strong></span>
                </div>
              </div>

              {/* GPU */}
              <div onClick={() => setTab('performance')} className={`${CARD} p-4 flex flex-col hover:border-[#B9B4A8] transition-all cursor-pointer`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#45433E] whitespace-nowrap">
                    <Flame className="w-3.5 h-3.5 text-[#181715]" /> GPU
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#181715]/5 border border-[#DDD9D1] text-[#45433E] whitespace-nowrap shrink-0">
                    {gpuUtil != null ? '已激活' : '不可用'}
                  </span>
                </div>
                <div className="mt-2 text-[28px] leading-none font-bold font-mono tracking-tight tabular-nums">
                  {gpuUtil != null ? `${gpuUtil.toFixed(1)}%` : '—'}
                </div>
                <div className="mt-1.5 text-[11px] font-mono text-[#6B6862] truncate">
                  {live?.gpu.memUsedBytes != null ? `显存 ${formatBytes(live.gpu.memUsedBytes)}` : '仅 macOS 可探测'}
                </div>
                <div className="my-3 h-12 shrink-0"><Sparkline data={gpuHist} /></div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6862] font-mono pt-2 border-t border-[#E8E6E1]">
                  <span className="truncate">{live?.gpu.model ?? '—'}</span>
                  <span className="shrink-0 whitespace-nowrap">{live?.gpu.cores ? `${live.gpu.cores} 核` : ''}</span>
                </div>
              </div>

              {/* 磁盘 */}
              <div onClick={() => setTab('storage')} className={`${CARD} p-4 flex flex-col hover:border-[#B9B4A8] transition-all cursor-pointer`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#45433E] whitespace-nowrap">
                    <HardDrive className="w-3.5 h-3.5 text-[#181715]" /> 磁盘
                  </div>
                  {disks[0]?.smart && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
                      /verified/i.test(disks[0].smart) ? 'bg-[#16A34A]/10 text-[#15803D]' : 'bg-[#D97706]/10 text-[#B45309]'
                    }`}>
                      SMART {/verified/i.test(disks[0].smart) ? '正常' : disks[0].smart}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[28px] leading-none font-bold font-mono tracking-tight tabular-nums whitespace-nowrap">{formatBytes(diskFreeTotal)}</div>
                <div className="mt-1.5 text-[11px] font-mono text-[#6B6862] truncate">可用空间 · {disks.length} 个卷</div>
                <div className="my-3 min-h-12 flex flex-col justify-center gap-2.5">
                  {disks.slice(0, 2).map((d, i) => (
                    <div key={d.mount}>
                      <div className="flex justify-between text-[11px] font-mono mb-1 gap-2">
                        <span className="text-[#45433E] truncate">{d.name}</span>
                        <span className="text-[#181715] font-medium shrink-0 whitespace-nowrap">剩 {formatBytes(d.freeBytes)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#ECE9E2] overflow-hidden">
                        <div className={`h-full rounded-full ${i === 0 ? 'bg-[#181715]' : 'bg-[#686662]'}`} style={{ width: `${(d.usedBytes / d.totalBytes) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  {disks.length === 0 && <div className="text-[11px] text-[#6B6862]">未读取到磁盘卷</div>}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6862] font-mono pt-2 border-t border-[#E8E6E1] tabular-nums">
                  <span className="whitespace-nowrap">读 <strong className="text-[#181715]">{live?.diskIo ? formatRate(live.diskIo.readBps) : '—'}</strong></span>
                  <span className="whitespace-nowrap">写 <strong className="text-[#181715]">{live?.diskIo ? formatRate(live.diskIo.writeBps) : '—'}</strong></span>
                </div>
              </div>
            </div>
          </section>

          {/* ============ 视图：进程 ============ */}
          {tab === 'processes' && (
            <section className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
              <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
                <div className="p-3 border-b border-[#E8E6E1] flex flex-wrap items-center justify-between gap-3 bg-[#FBFBF9]/60">
                  <div className="flex items-center gap-1 bg-[#F1EFEA] p-1 rounded-xl border border-[#E8E6E1]/70">
                    {(
                      [
                        ['all', '全部进程', counts.all],
                        ['app', '前台应用', counts.app],
                        ['background', '后台服务', counts.bg],
                        ['high', '高占用', null],
                      ] as const
                    ).map(([id, label, n]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setFilter(id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                          filter === id ? 'bg-[#181715] text-white shadow-sm' : 'text-[#55534E] hover:text-[#181715]'
                        }`}
                      >
                        {id === 'high' && <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />}
                        {label}
                        {n != null && <span className="font-mono ml-0.5 opacity-75">{n}</span>}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <div className="relative w-full max-w-[16rem]">
                      <Search className="w-3.5 h-3.5 text-[#6B6862] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索进程名称或 PID..."
                        className="w-full pl-8 pr-10 py-1.5 bg-white border border-[#E8E6E1] rounded-xl text-xs placeholder:text-[#6B6862] focus:outline-none focus:border-[#181715] transition-colors"
                      />
                      <kbd className="hidden sm:inline-block absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F1EFEA] text-[#6B6862] border border-[#E8E6E1]">⌘K</kbd>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpawnOpen(true)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-[#E8E6E1] hover:bg-[#F1EFEA] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">运行新任务</span>
                    </button>
                    <button
                      type="button"
                      disabled={!selected || selected.isCurrentApp}
                      onClick={() => selected && killGroup(selected)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                        selected && !selected.isCurrentApp
                          ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C] cursor-pointer'
                          : 'bg-[#F1EFEA] text-[#6B6862] border border-[#E8E6E1] cursor-not-allowed'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      结束任务
                    </button>
                  </div>
                </div>

                {/* 表头 */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-[#F6F5F1] border-b border-[#E8E6E1] text-[11px] font-semibold text-[#55534E] select-none">
                  <div onClick={() => setSort('name')} className="col-span-4 flex items-center gap-1 cursor-pointer hover:text-[#181715]">
                    进程名称 / PID <span className="text-[#181715]">{sortMark('name')}</span>
                  </div>
                  <div className="col-span-1 text-center">状态</div>
                  <div onClick={() => setSort('cpu')} className="col-span-2 flex items-center justify-end gap-1 cursor-pointer hover:text-[#181715]">
                    CPU 占用 <span className="text-[#181715]">{sortMark('cpu')}</span>
                  </div>
                  <div onClick={() => setSort('ram')} className="col-span-3 flex items-center justify-end gap-1 cursor-pointer hover:text-[#181715]">
                    物理内存 (RAM) <span className="text-[#181715]">{sortMark('ram')}</span>
                  </div>
                  <div onClick={() => setSort('count')} className="col-span-1 flex items-center justify-end gap-1 cursor-pointer hover:text-[#181715]">
                    进程数 <span className="text-[#181715]">{sortMark('count')}</span>
                  </div>
                  <div className="col-span-1 text-right">操作</div>
                </div>

                {visible.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#6B6862] gap-1 py-12">
                    <div className="text-sm font-medium text-[#55534E]">未找到匹配的进程</div>
                    <div className="text-xs">请尝试更换搜索关键词或切换分类筛选器</div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0">
                    <VirtualList
                      className="h-full text-xs"
                      items={visible}
                      rowHeight={52}
                      getRowKey={(p) => p.key}
                      renderRow={(p) => {
                        const isSel = p.key === selectedKey
                        const hiCpu = p.cpu >= 15
                        const cpuW = Math.min(100, (p.cpu / Math.max(1, (live?.cpu.cores.length ?? 8) * 12)) * 100 * 4)
                        const ramW = Math.max(3, (p.rssBytes / maxRss) * 100)
                        return (
                          <div
                            onClick={() => setSelectedKey(isSel ? null : p.key)}
                            className={`group h-full grid grid-cols-12 gap-2 px-4 items-center border-b border-[#E8E6E1]/60 cursor-pointer transition-colors ${
                              isSel ? 'bg-[#EFECE6]' : p.isCurrentApp ? 'bg-[#FFF9EF]' : 'hover:bg-[#F7F6F2]'
                            }`}
                          >
                            <div className="col-span-4 flex items-center gap-3 min-w-0">
                              <AppIcon src={icons[p.iconPath]} name={p.displayName} active={isSel} path={p.iconPath} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-[#181715] truncate">{p.displayName}</span>
                                  {p.isCurrentApp && (
                                    <span className="text-[10px] bg-[#181715] text-white px-1.5 rounded shrink-0">本应用</span>
                                  )}
                                  {isHighLoad(p) && (
                                    <span className="text-[10px] font-mono px-1.5 rounded bg-[#D97706]/10 text-[#D97706] shrink-0">高占用</span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[#6B6862] font-mono truncate">
                                  PID: {p.pids.slice(0, 3).join(', ')}{p.pids.length > 3 ? ` 等 ${p.pids.length} 个` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="col-span-1 flex justify-center">
                              {p.suspended ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F1EFEA] text-[#55534E] whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#9C9992]" />挂起
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#16A34A]/10 text-[#16A34A] whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />运行
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 flex flex-col items-end justify-center">
                              <span className={`font-mono font-semibold tabular-nums ${hiCpu ? 'text-[#D97706]' : 'text-[#181715]'}`}>
                                {p.cpu.toFixed(1)}%
                              </span>
                              <div className="w-20 h-1.5 bg-[#F1EFEA] rounded-full overflow-hidden mt-1">
                                <div className={`h-full rounded-full transition-[width] duration-500 ${hiCpu ? 'bg-[#D97706]' : 'bg-[#181715]'}`} style={{ width: `${cpuW}%` }} />
                              </div>
                            </div>
                            <div className="col-span-3 flex flex-col items-end justify-center">
                              <span className="font-mono font-semibold tabular-nums text-[#181715]">{formatBytes(p.rssBytes)}</span>
                              <div className="w-28 h-1.5 bg-[#F1EFEA] rounded-full overflow-hidden mt-1">
                                <div className="h-full bg-[#181715] rounded-full transition-[width] duration-500" style={{ width: `${ramW}%` }} />
                              </div>
                            </div>
                            <div className="col-span-1 text-right font-mono tabular-nums text-[#55534E]">{p.pids.length}</div>
                            <div className="col-span-1 flex items-center justify-end gap-0.5">
                              {p.isCurrentApp ? (
                                <span className="text-[11px] text-[#6B6862]">保护</span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); toggleSuspend(p) }}
                                    title={p.suspended ? '恢复运行' : '挂起进程'}
                                    className="p-1 rounded-lg text-[#6B6862] hover:text-[#181715] hover:bg-[#181715]/5 transition-colors cursor-pointer"
                                  >
                                    {p.suspended ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); killGroup(p) }}
                                    title="结束该应用的全部进程"
                                    className="p-1 rounded-lg text-[#6B6862] hover:text-[#DC2626] hover:bg-[#DC2626]/10 transition-colors cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      }}
                    />
                  </div>
                )}

                <div className="px-4 py-2.5 bg-[#F6F5F1] border-t border-[#E8E6E1] flex items-center justify-between text-xs text-[#55534E] gap-4">
                  <div className="flex items-center gap-2 truncate min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-[#16A34A]' : 'bg-[#9C9992]'}`} />
                    <span className="truncate">
                      {selected ? (
                        <>
                          已选中: <strong className="text-[#181715]">{selected.displayName}</strong>（{selected.pids.length} 个进程，PID{' '}
                          <span className="font-mono">{selected.pids[0]}</span>
                          {selected.pids.length > 1 ? ' 等' : ''}）· 占用内存{' '}
                          <strong className="font-mono text-[#181715]">{formatBytes(selected.rssBytes)}</strong>
                        </>
                      ) : (
                        '点击任意进程行可选中，再用右上角「结束任务」，或行内按钮挂起 / 结束'
                      )}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] shrink-0">
                    共 <strong className="text-[#181715]">{visible.length}</strong> 个应用组
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ============ 视图：硬件详情 ============ */}
          {tab === 'performance' && (
            <section className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
              <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
                <div className="px-4 py-2.5 bg-[#F6F5F1] border-b border-[#E8E6E1] shrink-0 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold text-[#181715]">硬件详情曲线</h3>
                  <span className="text-[11px] text-[#6B6862] truncate">CPU 逐核负载与内存构成</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#FBFBF9]">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center justify-between mb-4 gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Cpu className="w-4 h-4" />
                        处理器逻辑核心负载（{live?.cpu.cores.length ?? 0} 线程实时分布）
                      </h3>
                      <p className="text-xs text-[#55534E] mt-0.5 truncate" title={cpuLabel}>{cpuLabel}</p>
                    </div>
                    <span className="font-mono text-lg font-bold bg-[#181715] text-white px-3 py-1 rounded-xl tabular-nums">
                      {cpuTotal.toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 my-2">
                    {(live?.cpu.cores ?? []).map((c, i) => (
                      <div key={i} className="p-2.5 rounded-xl bg-[#FBFBF9] border border-[#E8E6E1]">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-[#55534E]">CPU #{i}</span>
                          <span className="font-semibold tabular-nums">{c.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#F1EFEA] rounded-full overflow-hidden mt-2">
                          <div className="h-full bg-[#181715] rounded-full transition-[width] duration-500" style={{ width: `${c}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="h-24 mt-3 bg-[#FBFBF9] rounded-xl border border-[#E8E6E1] p-2">
                    <Sparkline data={cpuHist} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-4 mt-3 border-t border-[#E8E6E1] text-xs font-mono">
                    <div><div className="text-[#6B6862] text-[11px]">架构</div><div className="font-semibold mt-0.5">{hardware?.arch.toUpperCase() ?? '--'}</div></div>
                    <div><div className="text-[#6B6862] text-[11px]">逻辑核心</div><div className="font-semibold mt-0.5">{hardware?.cpuCores ?? '--'}</div></div>
                    <div><div className="text-[#6B6862] text-[11px]">主频</div><div className="font-semibold mt-0.5">{hardware && hardware.cpuSpeedMhz > 0 ? `${(hardware.cpuSpeedMhz / 1000).toFixed(2)} GHz` : '系统未公开'}</div></div>
                  </div>
                </div>

                <div className={`${CARD} p-5 flex flex-col`}>
                  <div className="flex items-center justify-between mb-4 gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        物理内存池分配拓扑（{formatBytes(totalBytes)}）
                      </h3>
                      <p className="text-xs text-[#55534E] mt-0.5">实时追踪应用活跃内存、可回收文件缓存与内核联线内存</p>
                    </div>
                    {hardware?.memoryReleaseSupported && (
                      <button
                        type="button"
                        onClick={handleReleaseMemory}
                        disabled={releasing}
                        className="px-3 py-1.5 rounded-xl bg-[#181715] hover:bg-[#2A2926] text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-60 shrink-0"
                      >
                        ✨ 释放可回收内存
                      </button>
                    )}
                  </div>
                  <div className="h-36 w-full bg-[#FBFBF9] rounded-xl border border-[#E8E6E1] p-3">
                    <Sparkline data={ramHist} color={ramColor} />
                  </div>
                  {hasBuckets ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-3 border-t border-[#E8E6E1] text-xs font-mono">
                      {[
                        ['应用活跃', activeBytes, 'bg-[#181715]', ''],
                        ['可回收缓存', cachedBytes, 'bg-[#D97706]', 'text-[#D97706]'],
                        ['完全空闲', freeBytes, 'bg-[#16A34A]', 'text-[#16A34A]'],
                        ['压缩内存页', compressedBytes, 'bg-[#686662]', ''],
                      ].map(([label, v, dot, txt]) => (
                        <div key={label as string} className="p-2.5 rounded-xl bg-[#FBFBF9] border border-[#E8E6E1]">
                          <div className="text-[#6B6862] text-[11px] flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${dot}`} />{label}
                          </div>
                          <div className={`text-sm font-bold mt-1 tabular-nums ${txt}`}>{formatBytes(v as number)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pt-4 mt-3 border-t border-[#E8E6E1] text-xs text-[#6B6862]">当前平台不提供内存页桶细分</div>
                  )}
                  {hasBuckets && (
                    <div className="mt-3 text-[11px] text-[#6B6862] font-mono">
                      联线（内核常驻，不可回收）{formatBytes(wiredBytes)}
                      {overloaded ? ' · 内存占用较高，建议结束大户进程' : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
              </div>
            </section>
          )}

          {/* ============ 视图：磁盘 ============ */}
          {tab === 'storage' && (
            <section className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
              <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
                <div className="px-4 py-2.5 bg-[#F6F5F1] border-b border-[#E8E6E1] shrink-0 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold text-[#181715]">磁盘与存储卷</h3>
                  <span className="text-[11px] text-[#6B6862] truncate">每个已挂载卷的容量与健康状态</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#FBFBF9]">
              {disks.length === 0 ? (
                <div className={`${CARD} p-8 text-center text-xs text-[#6B6862]`}>当前环境读取不到磁盘卷信息</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {disks.map((d, i) => {
                    const pct = (d.usedBytes / d.totalBytes) * 100
                    return (
                      <div key={d.mount} className={`${CARD} p-5 space-y-4`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-11 h-11 rounded-2xl text-white flex items-center justify-center shrink-0 ${i === 0 ? 'bg-[#181715]' : 'bg-[#2A2926]'}`}>
                              {i === 0 ? <HardDrive className="w-5 h-5" /> : <Server className="w-5 h-5" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-sm truncate">{d.name}</h3>
                                {(d.protocol || d.solidState != null) && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#16A34A]/10 text-[#16A34A]">
                                    {[d.solidState ? 'SSD' : d.solidState === false ? 'HDD' : null, d.protocol].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[#55534E] font-mono mt-0.5 truncate" title={d.mount}>
                                {[d.fileSystem, d.media, d.mount].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                          </div>
                          <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#F1EFEA] shrink-0">已用 {pct.toFixed(1)}%</span>
                        </div>
                        <div className="space-y-2">
                          <div className="h-3 w-full rounded-full bg-[#F1EFEA] overflow-hidden flex p-0.5 border border-[#E8E6E1]">
                            <div
                              className={`h-full rounded-full ${pct > 90 ? 'bg-[#DC2626]' : pct > 75 ? 'bg-[#D97706]' : 'bg-[#181715]'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs font-mono text-[#55534E]">
                            <span>总容量: <strong className="text-[#181715]">{formatBytes(d.totalBytes)}</strong></span>
                            <span>已用: <strong className="text-[#181715]">{formatBytes(d.usedBytes)}</strong></span>
                            <span>剩余: <strong className="text-[#16A34A]">{formatBytes(d.freeBytes)}</strong></span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#E8E6E1] text-xs font-mono">
                          <div className="p-2.5 rounded-xl bg-[#FBFBF9] border border-[#E8E6E1]">
                            <div className="text-[#6B6862] text-[10px]">设备</div>
                            <div className="font-semibold mt-0.5 truncate" title={d.device}>{d.device.replace('/dev/', '') || '—'}</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-[#FBFBF9] border border-[#E8E6E1]">
                            <div className="text-[#6B6862] text-[10px]">介质</div>
                            <div className="font-semibold mt-0.5">{d.solidState == null ? '—' : d.solidState ? '固态' : '机械'}</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-[#FBFBF9] border border-[#E8E6E1]">
                            <div className="text-[#6B6862] text-[10px]">SMART</div>
                            <div className={`font-semibold mt-0.5 ${d.smart && /verified/i.test(d.smart) ? 'text-[#16A34A]' : ''}`}>
                              {d.smart ? (/verified/i.test(d.smart) ? '正常' : d.smart) : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
              </div>
            </section>
          )}

          {/* ============ 视图：启动项 ============ */}
          {tab === 'startup' && (
            <section className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
              <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
                <div className="p-4 border-b border-[#E8E6E1] shrink-0">
                  <h3 className="text-sm font-semibold">开机自启应用与服务管理</h3>
                  <p className="text-xs text-[#55534E] mt-0.5">
                    禁用非必要的登录项可缩短登录后的卡顿时间并节省内存。登录项禁用即从系统中移除，重新启用会按原路径加回。
                  </p>
                </div>
                {startup.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#6B6862]">
                    {hardware?.platform === 'darwin' ? '没有发现登录项或用户级 LaunchAgent' : '启动项管理目前仅支持 macOS'}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E8E6E1] text-xs">
                    {startup.map((item) => (
                      <div key={item.id} className="px-4 py-3.5 flex items-center justify-between hover:bg-[#FBFBF9] transition-colors gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <AppIcon src={icons[item.iconPath]} name={item.name} active={false} path={item.iconPath} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{item.name}</div>
                            <div className="text-[11px] text-[#6B6862] truncate" title={item.path}>{item.detail}{item.path ? ` · ${item.path}` : ''}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleStartup(item)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 ${
                            item.enabled ? 'bg-[#181715] text-white' : 'bg-[#F1EFEA] text-[#6B6862] border border-[#E8E6E1]'
                          }`}
                        >
                          {item.enabled ? '已启用' : '已禁用'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* 运行新任务 */}
      {spawnOpen && (
        <div
          className="absolute inset-0 z-50 bg-[#181715]/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setSpawnOpen(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-2xl border border-[#E8E6E1] shadow-[0_12px_32px_-8px_rgba(24,23,21,0.12)] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#181715] text-white flex items-center justify-center">
                  <Terminal className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm">创建并运行新任务</h3>
              </div>
              <button type="button" onClick={() => setSpawnOpen(false)} className="text-[#6B6862] hover:text-[#181715] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#55534E]">
              输入已安装的应用名（如 Safari）或一条命令行，将真实启动并出现在进程列表中。
            </p>
            <input
              autoFocus
              value={spawnCmd}
              onChange={(e) => setSpawnCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmSpawn()}
              placeholder="Safari  或  python3 -m http.server 8000"
              className="w-full px-3 py-2 rounded-xl border border-[#E8E6E1] text-xs font-mono focus:outline-none focus:border-[#181715]"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setSpawnOpen(false)} className="px-3.5 py-2 rounded-xl text-xs font-medium bg-[#F1EFEA] text-[#55534E] hover:text-[#181715] cursor-pointer">
                取消
              </button>
              <button type="button" onClick={confirmSpawn} className="px-4 py-2 rounded-xl text-xs font-medium bg-[#181715] text-white hover:bg-[#2A2926] cursor-pointer">
                立即启动
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  )
}
