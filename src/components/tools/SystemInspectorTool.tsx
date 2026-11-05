import { useEffect, useState, useMemo, useCallback, type ReactNode } from 'react'
import {
  Cpu,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Wand2,
} from 'lucide-react'
import type { SystemHardwareInfo, AppProcessMemory } from '../../types/system'
import ToolShell from '../ui/ToolShell'
import VirtualList from '../ui/VirtualList'
import { useToast } from '../ui/Toast'

/** 格式化字节大小 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/**
 * 内存趋势迷你图：两条线（已用 / 可用），y 轴是物理内存总量。
 *
 * 它不是装饰 —— 目的是区分「稳态」和「持续吃内存」：前者可以无视，
 * 后者才是去进程榜动手的理由。ring buffer 只有最近 90 个采样点，
 * 断页即丢，不做任何持久化。
 */
function MemoryTrend({
  samples,
  totalGB,
}: {
  samples: { u: number; a: number }[]
  totalGB: number
}) {
  if (samples.length < 2 || totalGB <= 0) {
    return (
      <div className="h-8 flex items-center text-[10px] text-[#9A9996]">
        开启自动刷新后，这里会出现已用 / 可用两条趋势线
      </div>
    )
  }
  const H = 30
  const x = (i: number) => (i / (samples.length - 1)) * 100
  const y = (v: number) => Math.max(1, H - (v / totalGB) * H)
  const points = (pick: (s: { u: number; a: number }) => number) =>
    samples.map((s, i) => `${x(i).toFixed(2)},${y(pick(s)).toFixed(2)}`).join(' ')

  return (
    <div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-8 block">
        <polyline
          points={points((s) => s.u)}
          fill="none"
          stroke="#1C1C1C"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={points((s) => s.a)}
          fill="none"
          stroke="rgb(13 148 136)"
          strokeWidth="1.2"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#9A9996]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-[#1C1C1C] inline-block" /> 已用
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-teal-600 inline-block" style={{ borderTop: '1px dashed' }} />
          可用
        </span>
        <span className="ml-auto">y 轴 0 → {totalGB.toFixed(1)} GB</span>
      </div>
    </div>
  )
}

/** 格式化运行时间 */
function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '刚刚启动'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

/* ==================== 页面级设计 token ==================== */
/*
 * 本页的颜色只有三层：暖灰中性色（取自全局 Notion 暖灰体系）+ ink（#1C1C1C）
 * + 一套三档语义色。语义色不放类名散着写，全走 MEM_ACCENT —— 仪表、徽章、
 * 数值着色从同一份取，健康档位变化时整页一起换，不会各说各话。
 */
const SECTION_LABEL = 'text-[10px] font-semibold tracking-[0.12em] text-[#9A9996]'

/** 环形仪表的周长（r=52），dasharray 按占用百分比切它 */
const MEM_GAUGE_C = 2 * Math.PI * 52

type MemAccent = 'calm' | 'warn' | 'danger'

const MEM_ACCENT: Record<
  MemAccent,
  { main: string; pill: string; icon: typeof CheckCircle2 }
> = {
  calm: {
    main: '#10B981',
    pill: 'text-emerald-700 bg-emerald-50 border-emerald-200/70',
    icon: CheckCircle2,
  },
  warn: {
    main: '#F59E0B',
    pill: 'text-amber-700 bg-amber-50 border-amber-200/70',
    icon: AlertTriangle,
  },
  danger: {
    main: '#F43F5E',
    pill: 'text-rose-700 bg-rose-50 border-rose-200/70',
    icon: XCircle,
  },
}

/** 统一的卡片表面：暖灰 hairline + 极轻阴影，全页同一张皮 */
const PANEL =
  'min-w-0 rounded-2xl border border-[#E9E7E2] bg-white shadow-[0_1px_2px_rgba(28,28,27,0.04)]'

/* ---------------- 内存排行榜（虚拟列表版） ---------------- */

/** 行内容是「名字 + PID」两级，定高 56px 刚好；变高行虚拟列表会跳 */
const LEADERBOARD_ROW_H = 56
/** 视口默认露出前 8 名，剩下的靠内部滚动（虚拟化），列表不再把整页撑长 */
const LEADERBOARD_DEFAULT_ROWS = 8
/** TOP 8 合计占比条的分段色：灰阶往肯德尔绿的过渡，与页面其他图表同族 */
const TOP_SHARE_COLORS = [
  '#1C1C1C',
  '#334155',
  '#475569',
  '#64748B',
  '#94A3B8',
  '#0F766E',
  '#2DD4BF',
  '#99F6E4',
]

/** 前三名奖牌徽章（金银铜），第四名起退回普通灰底数字 */
const MEDAL_CLASSES = [
  'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-xs',
  'bg-gradient-to-br from-zinc-300 to-zinc-400 text-white shadow-xs',
  'bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900 shadow-xs',
]

/** 主卡右侧的数据格：小标签 + 数值 + 提示行，三行一套 */
function StatCell({
  label,
  value,
  hint,
  valueClass = '',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  valueClass?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-[#9A9996] whitespace-nowrap">{label}</dt>
      <dd
        className={`mt-1.5 text-base font-bold text-[#191918] tabular-nums leading-none truncate ${valueClass}`}
      >
        {value}
      </dd>
      {hint != null && <p className="text-[10px] text-[#9A9996] mt-1 truncate">{hint}</p>}
    </div>
  )
}

/** 次卡里的键值行：左标签右值，值超长截断（title 兜底看全文） */
function KVRow({
  label,
  value,
  mono = false,
  title,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  title?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <dt className="text-[11px] text-[#9A9996] shrink-0">{label}</dt>
      <dd
        className={`text-[11px] text-[#191918] truncate min-w-0 text-right ${mono ? 'font-mono' : ''}`}
        title={title ?? (typeof value === 'string' ? value : undefined)}
      >
        {value}
      </dd>
    </div>
  )
}

export default function SystemInspectorTool({ isActive = true }: { isActive?: boolean }) {
  const { showToast } = useToast()
  const [hardware, setHardware] = useState<SystemHardwareInfo | null>(null)
  const [processes, setProcesses] = useState<AppProcessMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [killingPid, setKillingPid] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  /* ---------------- 内存优化：趋势采样与「释放内存」 ---------------- */

  /*
   * 内存趋势只存在于内存里（ring buffer，够画 6 分钟）：断页即丢。
   * 它的价值是「看见涨势」—— 稳定持平的已用不可怕，一路爬升才该去进程榜关东西，
   * 一锤子数字看不出这两种状态的区别。
   */
  const [trend, setTrend] = useState<{ u: number; a: number }[]>([])
  const [releasing, setReleasing] = useState(false)

  const fetchSystemData = useCallback(async () => {
    const api = window.electronAPI
    if (api?.systemInfo && api?.systemProcessList) {
      try {
        const [hw, procList] = await Promise.all([
          api.systemInfo(),
          api.systemProcessList(),
        ])
        setHardware(hw)
        setProcesses(procList)
        setErrorMsg(null)
        // 采样进趋势 ring buffer（GB 为单位，和后面 mini 图的 y 轴一致）
        setTrend((prev) => {
          const next = [
            ...prev,
            { u: hw.usedMemBytes / 1024 ** 3, a: hw.availableMemBytes / 1024 ** 3 },
          ]
          return next.length > 90 ? next.slice(-90) : next
        })
      } catch (err) {
        console.error('获取系统数据失败:', err)
        setErrorMsg('获取系统数据失败，请重试')
      } finally {
        setLoading(false)
      }
    } else {
      // 浏览器环境 Web 模拟 fallback
      const nav = window.navigator as any
      const totalMemEstimate = (nav.deviceMemory || 8) * 1024 * 1024 * 1024
      const usedMemEstimate = totalMemEstimate * 0.58

      setHardware({
        platform: 'web',
        platformName: 'Web 浏览器环境',
        arch: 'wasm/x64',
        osRelease: nav.userAgent,
        hostname: 'localhost',
        cpuModel: `${nav.hardwareConcurrency || 8} 核心逻辑处理器`,
        cpuCores: nav.hardwareConcurrency || 8,
        cpuSpeedMhz: 2400,
        totalMemBytes: totalMemEstimate,
        freeMemBytes: totalMemEstimate - usedMemEstimate,
        availableMemBytes: totalMemEstimate - usedMemEstimate,
        usedMemBytes: usedMemEstimate,
        memUsagePercent: 58.0,
        uptimeSeconds: Math.floor(performance.now() / 1000) + 3600 * 5,
        // 浏览器环境拿不到真实磁盘，跟其他字段一样给个稳定的示意值
        diskTotalBytes: 512 * 1024 ** 3,
        diskUsedBytes: 292 * 1024 ** 3,
        diskFreeBytes: 220 * 1024 ** 3,
      })

      // 模拟进程列表
      setProcesses([
        { name: 'Google Chrome', displayName: 'Google Chrome', pids: [1001], rssBytes: 1.62 * 1024 * 1024 * 1024, memPercent: 20.2, isCurrentApp: false },
        { name: 'devNotes', displayName: 'devNotes (当前桌面端)', pids: [1002], rssBytes: 420 * 1024 * 1024, memPercent: 5.2, isCurrentApp: true },
        { name: 'Visual Studio Code', displayName: 'Code', pids: [1003], rssBytes: 980 * 1024 * 1024, memPercent: 12.1, isCurrentApp: false },
        { name: 'WindowServer', displayName: 'WindowServer (系统)', pids: [1004], rssBytes: 650 * 1024 * 1024, memPercent: 8.0, isCurrentApp: false },
        { name: 'WeChat', displayName: '微信', pids: [1005], rssBytes: 520 * 1024 * 1024, memPercent: 6.4, isCurrentApp: false },
      ])
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSystemData()
  }, [fetchSystemData])

  // 自动刷新：切到后台时暂停轮询，避免无休止 IPC 扫描进程占用主线程
  useEffect(() => {
    if (!autoRefresh || !isActive) return
    const timer = setInterval(() => {
      fetchSystemData()
    }, 4000)
    return () => clearInterval(timer)
  }, [autoRefresh, isActive, fetchSystemData])

  /** 释放可回收内存（macOS：purge 清文件缓存，需要管理员密码）。
      定义在 fetchSystemData 之后：成功/失败都要立刻刷一遍看前后对比 */
  const handleReleaseMemory = useCallback(async () => {
    if (releasing) return
    if (
      !window.confirm(
        '将执行系统级内存清理（purge）：\n\n只回收文件缓存，不会结束任何应用；系统随后会随使用重新填充缓存。需要输入管理员密码。\n\n继续吗？'
      )
    ) {
      return
    }
    setReleasing(true)
    try {
      const result = await window.electronAPI?.memoryRelease?.()
      if (result) {
        // 取消属于中性结果，别用红色吓人；真正的失败才标 error
        showToast(result.message, result.ok || result.cancelled ? 'default' : 'error')
      }
      // 无论成败都刷一遍：成功看「可用 → 」，失败看现状
      await fetchSystemData()
    } finally {
      setReleasing(false)
    }
  }, [releasing, fetchSystemData, showToast])

  // 终止失控进程
  const handleKill = async (pid: number, name: string) => {
    if (confirm(`确定要终止进程「${name}」 (PID: ${pid}) 吗？`)) {
      setKillingPid(pid)
      try {
        if (window.electronAPI?.systemKillProcess) {
          const res = await window.electronAPI.systemKillProcess(pid)
          if (res.ok) {
            await fetchSystemData()
          } else {
            alert(`终止失败: ${res.error || '权限不足'}`)
          }
        }
      } catch (err) {
        alert(`终止发生错误: ${err}`)
      } finally {
        setKillingPid(null)
      }
    }
  }

  // 过滤进程列表
  const filteredProcesses = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return processes
    return processes.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.pids.some((pid: number) => String(pid).includes(q))
    )
  }, [processes, search])

  /* ---------------- 排行榜可视化相关派生值 ---------------- */

  // 占比条的 100% 对应榜首：第一名满条，往下按相对大小收
  // （直接用 memPercent 会把只占物理内存 0.3% 的应用画成看不见的细缝）
  const maxRssBytes = filteredProcesses[0]?.rssBytes ?? 0
  const topProcessRow = filteredProcesses[0]

  // 内存健康度分析
  const memUsage = hardware?.memUsagePercent || 0
  /*
   * 健康度看「可用内存」占比，别看「已用内存」。
   * macOS 的内核会把空闲页几乎全部拿去填文件缓存和压缩池，真 free 常年只剩
   * 一两百 MB —— 老算法 total - free 会把一台内存压力全绿的机器报到 98%+，
   * 然后这里跟着喊「极度紧张」。可用（真空闲 + inactive/speculative 文件缓存，
   * 随时可被内核回收）才是和活动监视器 Memory Pressure 同口径的指标，
   * 阈值取保守近似：可用不足 10% 才算真紧张。
   */
  const availablePercent =
    hardware && hardware.totalMemBytes > 0
      ? (hardware.availableMemBytes / hardware.totalMemBytes) * 100
      : 100 - memUsage
  /*
   * 徽章优先听内核的：压力等级是 jetsam 在用的同一份读数，说紧张才是真紧张。
   * 没拿到（非 macOS / OID 缺失）再退回「可用内存占比」这个静态近似 ——
   * 两条口径平时结论一致，冲突时以内核为准（内核说警告，UI 不敢说健康）。
   * 档位只判定一次，样式全走 MEM_ACCENT token。
   */
  const level = hardware?.memoryPressureLevel
  const memStatus: { label: string; accent: MemAccent } =
    level != null && level >= 3
      ? { label: '内存极度紧张', accent: 'danger' }
      : level === 2
        ? { label: '内存占用偏高', accent: 'warn' }
        : level == null && availablePercent < 10
          ? { label: '内存极度紧张', accent: 'danger' }
          : level == null && availablePercent < 25
            ? { label: '内存占用偏高', accent: 'warn' }
            : { label: '内存运行健康', accent: 'calm' }
  const memAccent = MEM_ACCENT[memStatus.accent]

  /* ---- 内存构成与优化面板的派生值（仅 macOS 有页桶细分，其他平台整块不渲染） ---- */
  const totalBytes = hardware?.totalMemBytes ?? 0
  const totalGB = totalBytes / 1024 ** 3
  const wiredBytes = hardware?.wiredBytes ?? 0
  const appActiveBytes = hardware?.appActiveBytes ?? 0
  const compressedBytes = hardware?.compressedBytes ?? 0
  const cachedFilesBytes = hardware?.cachedFilesBytes ?? 0
  // 桶之外剩下的就是真空闲（vm_stat 的 Pages free 与 known 桶总和会有零头误差）
  const freeBytes = Math.max(
    0,
    totalBytes - wiredBytes - appActiveBytes - compressedBytes - cachedFilesBytes,
  )
  const swapUsedBytes = hardware?.swapUsedBytes ?? 0
  /** 堆叠条各段的宽度百分比 */
  const pctOf = (bytes: number) =>
    totalBytes > 0 ? `${((bytes / totalBytes) * 100).toFixed(2)}%` : '0%'

  /* ---------------- 排行榜 TOP8 合计占比（依赖 totalBytes，所以放在这里） ---------------- */
  const topShareRows = useMemo(() => filteredProcesses.slice(0, 8), [filteredProcesses])
  const topShareBytes = topShareRows.reduce((sum, p) => sum + p.rssBytes, 0)
  const topSharePercent = totalBytes > 0 ? (topShareBytes / totalBytes) * 100 : 0

  /** 磁盘使用率：没读到卷信息时为 null，卡片以占位显示 */
  const diskUsagePercent =
    hardware?.diskTotalBytes != null &&
    hardware?.diskUsedBytes != null &&
    hardware.diskTotalBytes > 0
      ? (hardware.diskUsedBytes / hardware.diskTotalBytes) * 100
      : null

  return (
    <ToolShell
      icon={Cpu}
      title="电脑配置与内存检测"
      subtitle="实时检测系统硬件配置、内存占用空间与各应用程序内存消耗排行"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer border ${
              autoRefresh
                ? 'bg-[#1C1C1C] text-white border-[#1C1C1C]'
                : 'bg-white text-[#787774] border-[#E6E6E3] hover:text-[#191918]'
            }`}
          >
            {autoRefresh ? '自动刷新中 (4s)' : '自动刷新：关'}
          </button>
          <button
            type="button"
            onClick={fetchSystemData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#1C1C1C] text-white text-xs font-medium rounded-md hover:bg-black transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto w-full space-y-4 pb-10">
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-600">
            {errorMsg}
          </div>
        )}

        {/* ============ Row 1 · 主角：内存健康仪表 + 系统环境 ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 主角卡：页面只有这一个该被记住的读数，其余数据全部小一号退到右侧 */}
          <section className={`lg:col-span-2 ${PANEL} p-5`}>
            <div className="flex items-center justify-between mb-5">
              <span className={SECTION_LABEL}>内存占用</span>
              <span
                className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11px] font-medium ${memAccent.pill}`}
              >
                <memAccent.icon className="w-3 h-3" />
                {memStatus.label}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10">
              {/* 环形仪表：颜色随健康档位一起换 */}
              <div className="relative w-40 h-40 shrink-0">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#EFEDE9" strokeWidth="9" />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke={memAccent.main}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(Math.min(100, Math.max(0, memUsage)) / 100) * MEM_GAUGE_C} ${MEM_GAUGE_C}`}
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] text-[#9A9996]">已用</span>
                  <span className="text-[32px] leading-none font-bold text-[#191918] tabular-nums tracking-tight mt-1">
                    {memUsage < 10 ? memUsage.toFixed(1) : Math.round(memUsage)}
                    <span className="text-[13px] font-semibold text-[#9A9996] ml-0.5">%</span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-[#787774] mt-1.5 whitespace-nowrap">
                    {hardware ? formatBytes(hardware.usedMemBytes) : '--'} /{' '}
                    {hardware ? formatBytes(hardware.totalMemBytes) : '--'}
                  </span>
                </div>
              </div>

              {/* 指标格 */}
              <dl className="flex-1 min-w-0 w-full max-w-md grid grid-cols-2 gap-x-8 gap-y-5">
                <StatCell
                  label="可用内存（含可回收缓存）"
                  value={hardware ? formatBytes(hardware.availableMemBytes) : '--'}
                  hint={`占总内存 ${availablePercent.toFixed(0)}%`}
                />
                <StatCell
                  label="应用内存 TOP 1"
                  value={topProcessRow ? formatBytes(topProcessRow.rssBytes) : '--'}
                  hint={topProcessRow ? topProcessRow.displayName : '打开自动刷新后采样'}
                />
                <StatCell
                  label="Swap 已用"
                  value={swapUsedBytes > 0 ? formatBytes(swapUsedBytes) : '0 B'}
                  hint={hardware?.swapUsedBytes != null ? '换页多说明有过内存挤兑' : '仅 macOS 可探测'}
                />
                <StatCell
                  label="内核内存压力"
                  value={
                    hardware?.memoryPressureLevel != null
                      ? hardware.memoryPressureLevel >= 3
                        ? '临界'
                        : hardware.memoryPressureLevel === 2
                          ? '警告'
                          : '正常'
                      : '—'
                  }
                  hint={
                    hardware?.memoryPressureLevel != null
                      ? `等级 ${hardware.memoryPressureLevel} · jetsam 同源读数`
                      : '仅 macOS 提供'
                  }
                  valueClass={
                    hardware?.memoryPressureLevel != null && hardware.memoryPressureLevel >= 3
                      ? 'text-rose-600'
                      : hardware?.memoryPressureLevel === 2
                        ? 'text-amber-600'
                        : ''
                  }
                />
              </dl>
            </div>
          </section>

          {/* 系统环境：次卡 */}
          <section className={`${PANEL} p-5 flex flex-col`}>
            <div className="flex items-center justify-between">
              <span className={SECTION_LABEL}>系统环境</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                在线
              </span>
            </div>
            <p className="mt-4 text-sm font-bold text-[#191918] truncate">
              {hardware ? hardware.platformName : '检测中…'}
              <span className="ml-1.5 text-[11px] font-mono font-normal text-[#9A9996]">
                {hardware?.platform ?? ''}
              </span>
            </p>
            <p className="text-[11px] font-mono text-[#787774] truncate mt-1" title={hardware?.osRelease}>
              {hardware?.osRelease || '--'}
            </p>
            <dl className="mt-4 pt-3 border-t border-[#F0EFEC] space-y-2.5">
              <KVRow label="主机名" value={hardware?.hostname || '--'} mono />
              <KVRow label="架构" value={hardware?.arch.toUpperCase() ?? '--'} mono />
              <KVRow label="连续运行" value={hardware ? formatUptime(hardware.uptimeSeconds) : '--'} />
            </dl>
          </section>
        </div>

        {/* ============ Row 2 · 硬盘剩余 + 内存构成与优化 ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className={`${PANEL} p-5`}>
            <div className="flex items-center justify-between">
              <span className={SECTION_LABEL}>硬盘剩余</span>
              <span className="text-[10px] font-mono text-[#9A9996] bg-[#F3F3F1] px-1.5 py-0.5 rounded-md">
                {hardware?.diskTotalBytes ? `共 ${formatBytes(hardware.diskTotalBytes)}` : '--'}
              </span>
            </div>

            <p className="mt-4 flex items-baseline gap-2 min-w-0">
              <span className="text-[30px] leading-none font-bold text-[#191918] tabular-nums tracking-tight">
                {hardware?.diskFreeBytes ? formatBytes(hardware.diskFreeBytes) : '--'}
              </span>
              <span className="text-[11px] text-[#787774] shrink-0">剩余</span>
            </p>

            <div className="mt-4 pt-3 border-t border-[#F0EFEC]">
              {/* 使用率条：语义同内存卡 —— 超 90% 红、超 72% 黄，剩下的交给 ink */}
              <div className="w-full h-1.5 bg-[#F1F0EE] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${diskUsagePercent ?? 0}%`,
                    background: diskUsagePercent != null && diskUsagePercent > 90
                      ? '#F43F5E'
                      : diskUsagePercent != null && diskUsagePercent > 72
                        ? '#F59E0B'
                        : 'linear-gradient(to right, #A8A29E, #1C1C1C)',
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <StatCell
                  label="已用"
                  value={
                    diskUsagePercent != null
                      ? `${formatBytes(hardware!.diskUsedBytes!)}（${diskUsagePercent.toFixed(0)}%）`
                      : '--'
                  }
                  hint="家目录所在卷"
                />
                <StatCell
                  label="可用"
                  value={hardware?.diskFreeBytes ? formatBytes(hardware.diskFreeBytes) : '--'}
                  hint={hardware?.diskFreeBytes ? '低于 10% 时会变红' : '当前环境不可探测'}
                />
              </div>
            </div>
          </section>

          {/* 构成卡：仅 macOS 有页桶细分，其他平台整个不渲染 */}
          {hardware?.wiredBytes != null && (
            <section className={`lg:col-span-2 ${PANEL} p-5 flex flex-col`}>
              <div className="flex items-center justify-between">
                <span className={SECTION_LABEL}>内存构成与优化</span>
                {swapUsedBytes > 0 && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                      swapUsedBytes > 4 * 1024 ** 3
                        ? 'text-rose-700 bg-rose-50'
                        : swapUsedBytes > 2 * 1024 ** 3
                          ? 'text-amber-700 bg-amber-50'
                          : 'text-[#787774] bg-[#F3F3F1]'
                    }`}
                  >
                    Swap 已用 {formatBytes(swapUsedBytes)}
                  </span>
                )}
              </div>

              {/* 堆叠条：单色相 emerald 渐变，越浅=越能被回收
                  （浅绿段=点「释放内存」清掉的那部分），不混第二族色相 */}
              <div className="mt-4 w-full h-2.5 flex rounded-full overflow-hidden bg-[#EFEDE9]">
                <div className="bg-[#064E3B]" style={{ width: pctOf(wiredBytes) }} title="联线（内核常驻，不可回收）" />
                <div className="bg-[#059669]" style={{ width: pctOf(appActiveBytes) }} title="活跃应用内存" />
                <div className="bg-[#10B981]" style={{ width: pctOf(compressedBytes) }} title="压缩池" />
                <div className="bg-[#6EE7B7]" style={{ width: pctOf(cachedFilesBytes) }} title="文件缓存（可随时回收）" />
                <div className="bg-[#E9E8E4]" style={{ width: pctOf(freeBytes) }} title="真空闲" />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[10px] text-[#787774]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#064E3B] shrink-0" />
                  联线 <span className="font-mono tabular-nums">{formatBytes(wiredBytes)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#059669] shrink-0" />
                  活跃 <span className="font-mono tabular-nums">{formatBytes(appActiveBytes)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                  压缩 <span className="font-mono tabular-nums">{formatBytes(compressedBytes)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#6EE7B7] shrink-0" />
                  缓存 <span className="font-mono tabular-nums">{formatBytes(cachedFilesBytes)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#E9E8E4] shrink-0 ring-1 ring-black/[0.06]" />
                  空闲 <span className="font-mono tabular-nums">{formatBytes(freeBytes)}</span>
                </span>
              </div>

              <div className="mt-4 pt-4 border-t border-[#F0EFEC] flex flex-col md:flex-row gap-5">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#9A9996] mb-1.5">
                    趋势（最近 {trend.length} 次采样 · 自动刷新 4s 一点）
                  </div>
                  <MemoryTrend samples={trend} totalGB={totalGB} />
                </div>

                {hardware.memoryReleaseSupported && (
                  <div className="shrink-0 md:w-60">
                    <button
                      type="button"
                      onClick={handleReleaseMemory}
                      disabled={releasing}
                      className="w-full px-3 py-1.5 bg-[#1C1C1C] text-white text-xs font-medium rounded-lg hover:bg-black transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {releasing ? '正在清理…（等管理员密码）' : '释放可回收内存'}
                    </button>
                    <p className="text-[10px] text-[#9A9996] mt-2 leading-relaxed">
                      执行系统 purge，只清文件缓存（浅绿段），会弹管理员密码框；不会结束任何应用，缓存随后会慢慢回来。
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ============ Row 3 · 应用内存排行榜 ============ */}
        <section className={`${PANEL} overflow-hidden`}>
          <div className="px-4 py-3 border-b border-[#F0EFEC] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-xs font-bold text-[#191918] tracking-tight shrink-0">
                内存占用应用排行榜
              </h3>
              <span className="text-[10px] font-mono text-[#9A9996] bg-[#F3F3F1] px-2 py-0.5 rounded-full whitespace-nowrap">
                {processes.length} 个应用
              </span>
              <span className="hidden md:inline text-[10px] text-[#9A9996] whitespace-nowrap">
                默认展示前 8 · 滚动查看全部
              </span>
            </div>

            <div className="relative w-52 shrink-0">
              <Search className="w-3.5 h-3.5 text-[#9A9996] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索应用或 PID..."
                className="w-full pl-8 pr-3 h-7 text-xs bg-[#F3F3F1] border border-transparent rounded-lg outline-none focus:bg-white focus:border-black/[0.08] focus:ring-2 focus:ring-black/[0.06] text-[#191918] placeholder-[#9A9996] transition-colors"
              />
            </div>
          </div>

          {/* TOP 8 合计占用分段条 */}
          {topShareRows.length > 0 && (
            <div className="px-4 pt-3.5 pb-1 flex items-center gap-3">
              <div className="flex-1 h-2 flex rounded-full overflow-hidden bg-[#EFEDE9]">
                {topShareRows.map((proc, i) => {
                  const share = totalBytes > 0 ? (proc.rssBytes / totalBytes) * 100 : 0
                  return (
                    <div
                      key={`${proc.name}-share-${i}`}
                      style={{
                        width: `${share}%`,
                        background: TOP_SHARE_COLORS[i % TOP_SHARE_COLORS.length],
                      }}
                      title={`${proc.displayName} · ${formatBytes(proc.rssBytes)} · 占物理内存 ${proc.memPercent}%`}
                    />
                  )
                })}
              </div>
              <span className="shrink-0 text-[10px] font-mono text-[#9A9996] whitespace-nowrap">
                前 {topShareRows.length} 合计占用 {topSharePercent.toFixed(1)}%
              </span>
            </div>
          )}

          {filteredProcesses.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-xs text-[#9A9996]">
              {loading ? '正在扫描系统进程与内存数据...' : '没有匹配的应用程序'}
            </div>
          ) : (
            <div
              style={{
                height:
                  Math.min(filteredProcesses.length, LEADERBOARD_DEFAULT_ROWS) * LEADERBOARD_ROW_H,
              }}
            >
              <VirtualList
                className="h-full"
                items={filteredProcesses}
                rowHeight={LEADERBOARD_ROW_H}
                getRowKey={(proc, idx) => `${proc.name}-${idx}`}
                renderRow={(proc, idx) => {
                  /*
                   * 行模板（56px 定高）：[排名] [头像] [应用名 / PID] [内存] [相对条 + 占比] [操作]。
                   * 「结束」默认隐身、悬停现形 —— 一排常驻红字比数据本身还抢眼。
                   */
                  const relPercent = maxRssBytes > 0 ? (proc.rssBytes / maxRssBytes) * 100 : 0
                  const killing = killingPid === proc.pids[0]
                  return (
                    <div
                      className={`group h-full flex items-center gap-3 px-4 border-b border-[#F0EFEC] last:border-b-0 transition-colors ${
                        proc.isCurrentApp ? 'bg-[#FFF9EF]' : 'hover:bg-[#FAFAF9]'
                      }`}
                      title={proc.name}
                    >
                      <div className="w-8 flex justify-center shrink-0">
                        {idx < 3 ? (
                          <div
                            className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${
                              MEDAL_CLASSES[idx]
                            }`}
                          >
                            {idx + 1}
                          </div>
                        ) : (
                          <span className="font-mono font-bold text-xs text-[#9A9996]">{idx + 1}</span>
                        )}
                      </div>

                      <div className="w-6 h-6 rounded-md bg-[#F3F3F1] flex items-center justify-center font-bold text-[10px] text-[#57534E] shrink-0">
                        {proc.displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#191918]">
                          <span className="truncate">{proc.displayName}</span>
                          {proc.isCurrentApp && (
                            <span className="text-[10px] bg-[#1C1C1C] text-white px-1.5 py-0.2 rounded font-normal flex items-center gap-0.5 shrink-0">
                              <Sparkles className="w-2.5 h-2.5" /> 本应用
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#9A9996] font-mono truncate">
                          PID: {proc.pids.slice(0, 3).join(', ')}
                          {proc.pids.length > 3 ? ` 等共 ${proc.pids.length} 个` : ''}
                        </div>
                      </div>

                      <div className="w-20 text-right shrink-0 font-mono font-semibold text-xs text-[#191918] tabular-nums">
                        {formatBytes(proc.rssBytes)}
                      </div>

                      <div className="w-32 md:w-44 shrink-0 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[#F1F0EE] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#A8A29E] to-[#1C1C1C] rounded-full transition-all duration-300"
                            style={{ width: `${relPercent}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-[#787774] w-11 text-right tabular-nums">
                          {proc.memPercent}%
                        </span>
                      </div>

                      <div className="w-16 text-right shrink-0">
                        {proc.isCurrentApp ? (
                          <span className="text-[11px] text-[#9A9996] select-none">保护</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleKill(proc.pids[0], proc.displayName)}
                            disabled={killing}
                            className={`text-[11px] px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                              killing
                                ? 'text-rose-700 bg-rose-100'
                                : 'text-[#9A9996] hover:text-rose-700 hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                            }`}
                          >
                            {killing ? '终止中' : '结束'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
            </div>
          )}
        </section>
      </div>
    </ToolShell>
  )
}
