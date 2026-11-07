import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Gauge,
  Play,
  ArrowDownCircle,
  ArrowUpCircle,
  Wifi,
  Activity,
  CheckCircle2,
  Trash2,
  Globe,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'
import ToolShell from '../ui/ToolShell'
import { useUiPrefsStore } from '../../store/uiPrefsStore'

interface SpeedRecord {
  id: string
  time: string
  ping: number
  jitter: number
  download: number
  upload: number
  quality: string
  isp?: string
  server?: string
  resultUrl?: string | null
}

type UiPhase =
  | 'idle'
  | 'preparing'
  | 'ping'
  | 'download'
  | 'upload'
  | 'completed'
  | 'error'

function rateQuality(downloadMbps: number, pingMs: number): string {
  if (downloadMbps >= 300 && pingMs < 30) return '千兆极速 · 4K/8K 丝滑'
  if (downloadMbps >= 100 && pingMs < 50) return '百兆高速 · 游戏影音无阻'
  if (downloadMbps >= 50) return '流畅稳定 · 高清视频'
  if (downloadMbps >= 20) return '普通 · 满足日常'
  return '偏慢 · 大文件会等很久'
}

function phaseLabel(phase: UiPhase, statusHint: string | null): string {
  if (phase === 'preparing') return statusHint || '正在准备 Speedtest® CLI…'
  if (phase === 'ping') return '正在探测延迟 (Ping)…'
  if (phase === 'download') return '正在测试下载速率…'
  if (phase === 'upload') return '正在测试上传吞吐量…'
  if (phase === 'completed') return '测速完成'
  if (phase === 'error') return '测速失败'
  return '准备就绪 · Ookla Speedtest® CLI'
}

/** 把阶段内 0~1 进度映射到整条测速条大致占比 */
function overallProgress(phase: UiPhase, phaseProgress: number): number {
  const p = Math.min(1, Math.max(0, phaseProgress))
  if (phase === 'preparing') return 5
  if (phase === 'ping') return 5 + p * 15
  if (phase === 'download') return 20 + p * 45
  if (phase === 'upload') return 65 + p * 35
  if (phase === 'completed') return 100
  return 0
}

export default function SpeedTestTool() {
  const [phase, setPhase] = useState<UiPhase>('idle')
  const [statusHint, setStatusHint] = useState<string | null>(null)
  const [ping, setPing] = useState<number | null>(null)
  const [jitter, setJitter] = useState<number | null>(null)
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null)
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null)
  const [currentSpeed, setCurrentSpeed] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const [packetLoss, setPacketLoss] = useState<number | null>(null)
  const [isp, setIsp] = useState<string | null>(null)
  const [server, setServer] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const historyRaw = useUiPrefsStore((s) => s.speedtestHistory)
  const clearSpeedtestHistory = useUiPrefsStore((s) => s.clearSpeedtestHistory)
  const history = (Array.isArray(historyRaw) ? historyRaw : []) as SpeedRecord[]

  const runIdRef = useRef<number | null>(null)
  const available = Boolean(window.electronAPI?.speedtestStart)

  useEffect(() => {
    const unsub = window.electronAPI?.onSpeedtestEvent?.((event) => {
      if (runIdRef.current !== null && event.id !== runIdRef.current) return

      if (event.kind === 'status') {
        setPhase('preparing')
        if (event.status === 'checking') setStatusHint('正在检测 Speedtest® CLI…')
        else if (event.status === 'downloading') setStatusHint('首次使用，正在下载官方 CLI…')
        else if (event.status === 'ready') setStatusHint('CLI 就绪，即将开始…')
        else setStatusHint('正在连接 Ookla 测速节点…')
        return
      }

      if (event.kind === 'progress') {
        setPhase(event.phase)
        setPhaseProgress(event.progress)
        setStatusHint(null)
        if (event.isp) setIsp(event.isp)
        if (event.serverName) {
          const loc = event.serverLocation ? ` · ${event.serverLocation}` : ''
          setServer(`${event.serverName}${loc}`)
        }
        if (event.phase === 'ping') {
          if (event.pingMs != null) setPing(Math.round(event.pingMs * 10) / 10)
          if (event.jitterMs != null) setJitter(Math.round(event.jitterMs * 10) / 10)
        }
        if (event.phase === 'download' || event.phase === 'upload') {
          if (event.mbps != null) setCurrentSpeed(event.mbps)
          if (event.phase === 'download' && event.mbps != null) setDownloadSpeed(event.mbps)
          if (event.phase === 'upload' && event.mbps != null) setUploadSpeed(event.mbps)
        }
        return
      }

      if (event.kind === 'result') {
        setPhase('completed')
        setPhaseProgress(1)
        setDownloadSpeed(event.downloadMbps)
        setUploadSpeed(event.uploadMbps)
        setCurrentSpeed(event.downloadMbps)
        setPing(event.pingMs)
        setJitter(event.jitterMs)
        setPacketLoss(event.packetLoss)
        setIsp(event.isp || null)
        setServer(
          event.serverName
            ? `${event.serverName}${event.serverLocation ? ` · ${event.serverLocation}` : ''}`
            : null,
        )
        setResultUrl(event.resultUrl)
        const quality = rateQuality(event.downloadMbps, event.pingMs)
        const record: SpeedRecord = {
          id: String(Date.now()),
          time: new Date().toLocaleString(),
          ping: event.pingMs,
          jitter: event.jitterMs,
          download: event.downloadMbps,
          upload: event.uploadMbps,
          quality,
          isp: event.isp,
          server: event.serverName,
          resultUrl: event.resultUrl,
        }
        const prev = useUiPrefsStore.getState().speedtestHistory
        const list = (Array.isArray(prev) ? prev : []) as SpeedRecord[]
        useUiPrefsStore.getState().setSpeedtestHistory([record, ...list].slice(0, 20))
        return
      }

      if (event.kind === 'error') {
        setPhase('error')
        setError(event.message)
        setCurrentSpeed(0)
        return
      }

      if (event.kind === 'done') {
        runIdRef.current = null
        setPhase((prev) => (prev === 'preparing' || prev === 'ping' || prev === 'download' || prev === 'upload' ? 'idle' : prev))
      }
    })
    return () => unsub?.()
  }, [])

  const stopTest = useCallback(() => {
    const id = runIdRef.current
    if (id != null) void window.electronAPI?.speedtestStop?.(id)
    runIdRef.current = null
    setPhase('idle')
    setCurrentSpeed(0)
    setPhaseProgress(0)
    setStatusHint(null)
  }, [])

  const startTest = useCallback(async () => {
    if (!window.electronAPI?.speedtestStart) {
      setPhase('error')
      setError('网络测速需要在桌面版（Electron）中使用')
      return
    }

    setPhase('preparing')
    setStatusHint('正在准备…')
    setPing(null)
    setJitter(null)
    setDownloadSpeed(null)
    setUploadSpeed(null)
    setCurrentSpeed(0)
    setPhaseProgress(0)
    setPacketLoss(null)
    setIsp(null)
    setServer(null)
    setResultUrl(null)
    setError(null)

    try {
      const { id } = await window.electronAPI.speedtestStart()
      runIdRef.current = id
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const clearHistory = () => {
    clearSpeedtestHistory()
  }

  const progress = overallProgress(phase, phaseProgress)
  const running = phase === 'preparing' || phase === 'ping' || phase === 'download' || phase === 'upload'
  const mainValue =
    phase === 'download' || phase === 'upload'
      ? currentSpeed
      : downloadSpeed !== null
        ? downloadSpeed
        : null

  return (
    <ToolShell
      icon={Gauge}
      title="网络测速"
      subtitle="基于 Ookla Speedtest® CLI，测量真实下载、上传、延迟与抖动"
      actions={
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              type="button"
              onClick={startTest}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1C1C1C] text-white text-xs font-semibold rounded-lg hover:bg-black transition-colors cursor-pointer shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              开始测速
            </button>
          ) : (
            <button
              type="button"
              onClick={stopTest}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 transition-colors cursor-pointer shadow-xs"
            >
              停止测试
            </button>
          )}
        </div>
      }
    >
      <div className="max-w-4xl mx-auto space-y-5 pb-8">
        {!available && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>当前环境没有 Electron 主进程，无法调用 Speedtest® CLI。请在桌面版应用里使用本工具。</p>
          </div>
        )}

        <div className="bg-white border border-black/[0.06] rounded-2xl p-8 flex flex-col items-center justify-center relative overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
          <div className="absolute inset-0 bg-[radial-gradient(#1C1C1C_1px,transparent_1px)] [background-size:16px_16px] opacity-[0.03] pointer-events-none" />

          <div className="mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F3F3F1] text-[#191918]">
              <Wifi className="w-3.5 h-3.5" />
              {phaseLabel(phase, statusHint)}
            </span>
          </div>

          {(isp || server) && (
            <p className="text-[11px] text-[#787774] mb-2 text-center max-w-md">
              {isp && <span>{isp}</span>}
              {isp && server && <span> · </span>}
              {server && <span>{server}</span>}
            </p>
          )}

          <div className="flex flex-col items-center justify-center my-2 select-none">
            <div className="flex items-baseline gap-2">
              <span className="text-6xl md:text-7xl font-extrabold font-mono tracking-tighter text-[#1C1C1C]">
                {mainValue !== null ? mainValue : '--'}
              </span>
              <span className="text-lg md:text-xl font-bold text-[#787774] font-mono">Mbps</span>
            </div>
            <span className="text-xs text-[#787774] mt-1 font-medium">
              {phase === 'upload' ? '实时上传速率' : '下载带宽'}
            </span>
          </div>

          {running && (
            <div className="w-full max-w-md mt-6">
              <div className="w-full h-1.5 bg-black/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#1C1C1C] transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'idle' && (
            <button
              type="button"
              onClick={startTest}
              className="mt-6 flex items-center gap-2 px-6 py-2.5 bg-[#1C1C1C] text-white text-sm font-semibold rounded-xl hover:bg-black transition-all hover:scale-[1.02] cursor-pointer shadow-md"
            >
              <Play className="w-4 h-4 fill-current" />
              点击开始 Speedtest®
            </button>
          )}

          {phase === 'completed' && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3.5 py-1.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-4 h-4" />
                测试完成 · {history[0]?.quality || '网络优良'}
              </div>
              {resultUrl && (
                <button
                  type="button"
                  onClick={() => void window.electronAPI?.openExternal?.(resultUrl)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#52514E] bg-[#F3F3F1] px-3 py-1.5 rounded-full hover:bg-[#EAEAE8] transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  在 Speedtest.net 查看
                </button>
              )}
            </div>
          )}

          {phase === 'error' && error && (
            <div className="mt-5 flex items-start gap-2 max-w-md text-xs text-rose-700 bg-rose-50 px-3.5 py-2 rounded-xl border border-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-1.5 text-xs text-[#787774] mb-1 font-medium">
              <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600" />
              下载速率
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-[#191918]">
                {downloadSpeed !== null ? downloadSpeed : '--'}
              </span>
              <span className="text-xs text-[#787774] font-mono">Mbps</span>
            </div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-1.5 text-xs text-[#787774] mb-1 font-medium">
              <ArrowUpCircle className="w-3.5 h-3.5 text-blue-600" />
              上传速率
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-[#191918]">
                {uploadSpeed !== null ? uploadSpeed : '--'}
              </span>
              <span className="text-xs text-[#787774] font-mono">Mbps</span>
            </div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-1.5 text-xs text-[#787774] mb-1 font-medium">
              <Activity className="w-3.5 h-3.5 text-amber-600" />
              延迟 (Ping)
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-[#191918]">
                {ping !== null ? ping : '--'}
              </span>
              <span className="text-xs text-[#787774] font-mono">ms</span>
            </div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-1.5 text-xs text-[#787774] mb-1 font-medium">
              <Globe className="w-3.5 h-3.5 text-purple-600" />
              网络抖动
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-[#191918]">
                {jitter !== null ? jitter : '--'}
              </span>
              <span className="text-xs text-[#787774] font-mono">ms</span>
            </div>
            {packetLoss !== null && (
              <p className="mt-1 text-[10px] text-[#9A9996] font-mono">丢包 {packetLoss}%</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="px-4 py-3 border-b border-black/[0.06] flex items-center justify-between bg-[#F9F9F8]">
            <h3 className="text-xs font-bold text-[#191918] tracking-tight">最近测速记录</h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="text-xs text-[#787774] hover:text-rose-600 transition-colors cursor-pointer flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                清空历史
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] bg-[#F9F9F8] text-[#787774]">
                  <th className="py-2.5 px-4 font-semibold">测试时间</th>
                  <th className="py-2.5 px-4 font-semibold">下载速度</th>
                  <th className="py-2.5 px-4 font-semibold">上传速度</th>
                  <th className="py-2.5 px-4 font-semibold">时延 / 抖动</th>
                  <th className="py-2.5 px-4 font-semibold text-right">网络评价</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-[#787774]">
                      暂无历史测速记录，点击上方「开始测速」使用 Speedtest® CLI
                    </td>
                  </tr>
                ) : (
                  history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-black/[0.02] transition-colors">
                      <td className="py-2.5 px-4 font-mono text-[#787774]">{rec.time}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-emerald-600">
                        {rec.download} Mbps
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">
                        {rec.upload} Mbps
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#787774]">
                        {rec.ping} ms / {rec.jitter} ms
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium text-[#191918]">
                        {rec.quality}
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
