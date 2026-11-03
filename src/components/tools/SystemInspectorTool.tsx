import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Cpu,
  HardDrive,
  Activity,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Layers,
  Sparkles,
  Wand2,
} from 'lucide-react'
import type { SystemHardwareInfo, AppProcessMemory } from '../../types/system'
import ToolShell from '../ui/ToolShell'
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
      <div className="h-8 flex items-center text-[10px] text-[#787774]/60">
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
      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#787774]">
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
   * 两条口径平时结论一致，冲突时以内核为准（内核说警告，UI 不敢说健康）
   */
  const level = hardware?.memoryPressureLevel
  const memStatus =
    level != null && level >= 3
      ? { label: '内存极度紧张', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', icon: XCircle }
      : level === 2
        ? { label: '内存占用偏高', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: AlertTriangle }
        : level == null && availablePercent < 10
          ? { label: '内存极度紧张', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', icon: XCircle }
          : level == null && availablePercent < 25
            ? { label: '内存占用偏高', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: AlertTriangle }
            : { label: '内存运行健康', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2 }

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
                : 'bg-white text-[#787774] border-black/[0.08] hover:text-[#191918]'
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
      <div className="max-w-6xl mx-auto space-y-4 pb-8">
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-600">
            {errorMsg}
          </div>
        )}

        {/* 顶部三栏核心指标卡 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* 1. 内存占用空间 */}
          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#787774] flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-[#191918]" />
                内存占用空间
              </span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${memStatus.bg} ${memStatus.color} flex items-center gap-1`}>
                <memStatus.icon className="w-3 h-3" />
                {memStatus.label}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-[#191918]">
                {hardware ? formatBytes(hardware.usedMemBytes) : '--'}
              </span>
              <span className="text-xs text-[#787774]">
                / {hardware ? formatBytes(hardware.totalMemBytes) : '--'} ({memUsage}%)
              </span>
            </div>
            {/* 内存百分比进度条（used 现在是活动监视器口径，超过 90% 才是真满） */}
            <div className="w-full h-2 bg-black/[0.05] rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  memUsage > 90 ? 'bg-rose-500' : memUsage > 72 ? 'bg-amber-500' : 'bg-[#1C1C1C]'
                }`}
                style={{ width: `${memUsage}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#787774]">
              <span>可用内存（含可回收缓存）</span>
              <span className="font-mono font-medium text-[#191918]">
                {hardware ? formatBytes(hardware.availableMemBytes) : '--'}
              </span>
            </div>
            {/* macOS 再补一行内核自己评的内存压力等级 —— 这是 jetsam 在用的
                同一份读数，「系统到底紧不紧张」以它为最终裁判 */}
            {hardware?.memoryPressureLevel != null && (
              <div className="flex items-center justify-between text-[11px] text-[#787774] mt-1">
                <span>内核内存压力等级</span>
                <span
                  className={`font-mono font-medium ${
                    hardware.memoryPressureLevel >= 3
                      ? 'text-rose-600'
                      : hardware.memoryPressureLevel === 2
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                  }`}
                >
                  {hardware.memoryPressureLevel >= 3
                    ? '临界'
                    : hardware.memoryPressureLevel === 2
                      ? '警告'
                      : '正常'}
                  （{hardware.memoryPressureLevel}）
                </span>
              </div>
            )}
          </div>

          {/* 2. 处理器与平台架构 */}
          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#787774] flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#191918]" />
                处理器 CPU
              </span>
              <span className="text-[11px] font-mono font-medium text-[#787774] bg-black/[0.04] px-1.5 py-0.5 rounded">
                {hardware?.arch.toUpperCase()}
              </span>
            </div>
            <h4 className="text-sm font-bold text-[#191918] truncate mb-1" title={hardware?.cpuModel}>
              {hardware?.cpuModel || '检测中...'}
            </h4>
            <div className="flex items-center gap-3 text-xs text-[#787774] mb-3">
              <span>核心数: <strong className="text-[#191918] font-mono">{hardware?.cpuCores || '--'}</strong> 核</span>
              {hardware?.cpuSpeedMhz ? (
                <span>基准主频: <strong className="text-[#191918] font-mono">{(hardware.cpuSpeedMhz / 1000).toFixed(2)}</strong> GHz</span>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#787774] pt-2 border-t border-black/[0.04]">
              <span>主机名</span>
              <span className="font-mono text-[#191918] truncate max-w-[140px]">
                {hardware?.hostname || '--'}
              </span>
            </div>
          </div>

          {/* 3. 系统版本与运行状态 */}
          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#787774] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#191918]" />
                系统环境
              </span>
              <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                在线
              </span>
            </div>
            <h4 className="text-sm font-bold text-[#191918] truncate mb-1">
              {hardware ? `${hardware.platformName} (${hardware.platform})` : '检测中...'}
            </h4>
            <p className="text-xs text-[#787774] truncate mb-3" title={hardware?.osRelease}>
              内核版本: <span className="font-mono">{hardware?.osRelease || '--'}</span>
            </p>
            <div className="flex items-center justify-between text-[11px] text-[#787774] pt-2 border-t border-black/[0.04]">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                连续运行时间
              </span>
              <span className="font-medium text-[#191918]">
                {hardware ? formatUptime(hardware.uptimeSeconds) : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. 内存构成与释放（仅 macOS 有页桶细分） */}
        {hardware?.wiredBytes != null && (
          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-[#787774] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#191918]" />
                内存构成与优化
              </span>
              {swapUsedBytes > 0 && (
                <span
                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                    swapUsedBytes > 4 * 1024 ** 3
                      ? 'text-rose-600 bg-rose-50'
                      : swapUsedBytes > 2 * 1024 ** 3
                        ? 'text-amber-600 bg-amber-50'
                        : 'text-[#787774] bg-black/[0.04]'
                  }`}
                >
                  Swap 已用 {formatBytes(swapUsedBytes)}
                </span>
              )}
            </div>

            {/* 堆叠条：联线 / 活跃 / 压缩 / 文件缓存 / 真空闲，一眼看出哪些能被回收 */}
            <div className="w-full h-3 flex rounded-full overflow-hidden bg-black/[0.06] mb-2">
              <div className="bg-[#1C1C1C]" style={{ width: pctOf(wiredBytes) }} title="联线（内核常驻，不可回收）" />
              <div className="bg-zinc-500" style={{ width: pctOf(appActiveBytes) }} title="活跃应用内存" />
              <div className="bg-teal-500" style={{ width: pctOf(compressedBytes) }} title="压缩池" />
              <div className="bg-teal-200" style={{ width: pctOf(cachedFilesBytes) }} title="文件缓存（可随时回收）" />
              <div className="bg-black/[0.04]" style={{ width: pctOf(freeBytes) }} title="真空闲" />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#787774] mb-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#1C1C1C] shrink-0" />
                联线 {formatBytes(wiredBytes)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
                活跃 {formatBytes(appActiveBytes)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                压缩 {formatBytes(compressedBytes)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-200 shrink-0" />
                缓存 {formatBytes(cachedFilesBytes)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-zinc-200 shrink-0" />
                空闲 {formatBytes(freeBytes)}
              </span>
            </div>

            <div className="flex flex-col md:flex-row gap-4 pt-3 border-t border-black/[0.06]">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[#787774] mb-1">
                  趋势（最近 {trend.length} 次采样，自动刷新 4s 一点）
                </div>
                <MemoryTrend samples={trend} totalGB={totalGB} />
              </div>

              {hardware.memoryReleaseSupported && (
                <div className="shrink-0 md:w-64">
                  <button
                    type="button"
                    onClick={handleReleaseMemory}
                    disabled={releasing}
                    className="w-full px-3 py-1.5 bg-[#1C1C1C] text-white text-xs font-medium rounded-md hover:bg-black transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    {releasing ? '正在清理…（等管理员密码）' : '释放可回收内存'}
                  </button>
                  <p className="text-[10px] text-[#787774]/80 mt-1.5 leading-relaxed">
                    执行系统 purge，只清文件缓存（上图青色段），会弹出管理员密码框；
                    不会结束任何应用，缓存也会随使用慢慢回来。真正省内存靠进程榜里的「结束」。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 下方：应用内存占用排行榜 (用户明确指令) */}
        <div className="bg-white border border-black/[0.06] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          {/* 表头与搜索 */}
          <div className="px-4 py-3 border-b border-black/[0.06] flex items-center justify-between gap-3 bg-[#F9F9F8]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#191918]" />
              <h3 className="text-xs font-bold text-[#191918] tracking-tight">
                内存占用应用排行 (TOP 50)
              </h3>
              <span className="text-[11px] font-mono text-[#787774] bg-black/[0.05] px-1.5 py-0.2 rounded-full">
                共 {processes.length} 个应用
              </span>
            </div>

            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 text-[#9A9996] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索应用或 PID..."
                className="w-full pl-8 pr-3 h-7 text-xs bg-white border border-black/[0.08] rounded-md outline-none focus:border-black text-[#191918] placeholder-[#9A9996]"
              />
            </div>
          </div>

          {/* 列表内容 */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] bg-[#F9F9F8] text-[#787774]">
                  <th className="py-2 px-4 font-semibold w-12 text-center">排名</th>
                  <th className="py-2 px-4 font-semibold">应用程序 / 进程名</th>
                  <th className="py-2 px-4 font-semibold w-28">子进程数</th>
                  <th className="py-2 px-4 font-semibold w-36">内存占用空间</th>
                  <th className="py-2 px-4 font-semibold w-40">物理内存占比</th>
                  <th className="py-2 px-4 font-semibold w-24 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {filteredProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[#787774]">
                      {loading ? '正在扫描系统进程与内存数据...' : '没有匹配的应用程序'}
                    </td>
                  </tr>
                ) : (
                  filteredProcesses.map((proc, idx) => (
                    <tr
                      key={`${proc.name}-${idx}`}
                      className={`hover:bg-black/[0.02] transition-colors ${
                        proc.isCurrentApp ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      {/* 排名 */}
                      <td className="py-2.5 px-4 text-center font-mono font-bold text-[#787774]">
                        {idx + 1}
                      </td>

                      {/* 应用程序名称 */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-black/[0.05] flex items-center justify-center font-bold text-[10px] text-[#191918] shrink-0">
                            {proc.displayName.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#191918] truncate flex items-center gap-1.5">
                              {proc.displayName}
                              {proc.isCurrentApp && (
                                <span className="text-[10px] bg-[#1C1C1C] text-white px-1.5 py-0.2 rounded font-normal flex items-center gap-0.5">
                                  <Sparkles className="w-2.5 h-2.5" /> 本应用
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-[#787774] font-mono truncate block" title={proc.name}>
                              PID: {proc.pids.slice(0, 3).join(', ')}{proc.pids.length > 3 ? ` 等共 ${proc.pids.length} 个` : ''}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 子进程数 */}
                      <td className="py-2.5 px-4 font-mono text-[#787774]">
                        {proc.pids.length} 个
                      </td>

                      {/* 内存占用空间 */}
                      <td className="py-2.5 px-4 font-mono font-bold text-[#191918]">
                        {formatBytes(proc.rssBytes)}
                      </td>

                      {/* 占比条 */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1C1C1C] rounded-full"
                              style={{ width: `${Math.min(100, proc.memPercent * 3)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] text-[#787774] w-12 text-right">
                            {proc.memPercent}%
                          </span>
                        </div>
                      </td>

                      {/* 操作 */}
                      <td className="py-2.5 px-4 text-right">
                        {proc.isCurrentApp ? (
                          <span className="text-[11px] text-[#787774] opacity-50 select-none">保护</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleKill(proc.pids[0], proc.displayName)}
                            disabled={killingPid === proc.pids[0]}
                            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-0.5 rounded transition-colors cursor-pointer"
                          >
                            {killingPid === proc.pids[0] ? '终止中' : '结束'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
