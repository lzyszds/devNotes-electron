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
} from 'lucide-react'
import type { SystemHardwareInfo, AppProcessMemory } from '../../types/system'
import ToolShell from '../ui/ToolShell'

/** 格式化字节大小 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
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

export default function SystemInspectorTool() {
  const [hardware, setHardware] = useState<SystemHardwareInfo | null>(null)
  const [processes, setProcesses] = useState<AppProcessMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [killingPid, setKillingPid] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 读取系统信息
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

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      fetchSystemData()
    }, 4000)
    return () => clearInterval(timer)
  }, [autoRefresh, fetchSystemData])

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
  const memStatus =
    memUsage > 88
      ? { label: '内存极度紧张', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', icon: XCircle }
      : memUsage > 75
        ? { label: '内存占用偏高', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: AlertTriangle }
        : { label: '内存运行健康', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2 }

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
            {/* 内存百分比进度条 */}
            <div className="w-full h-2 bg-black/[0.05] rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  memUsage > 85 ? 'bg-rose-500' : memUsage > 70 ? 'bg-amber-500' : 'bg-[#1C1C1C]'
                }`}
                style={{ width: `${memUsage}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#787774]">
              <span>可用空闲内存</span>
              <span className="font-mono font-medium text-[#191918]">
                {hardware ? formatBytes(hardware.freeMemBytes) : '--'}
              </span>
            </div>
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
