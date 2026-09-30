import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Cpu,
  Network,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Skull,
  Terminal,
} from 'lucide-react'
import {
  BTN,
  CopyButton,
  META,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolNotice,
  ToolShell,
  ToolTag,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

/** 内置的常见开发端口，主进程那份是权威，读不到时用这份兜底 */
const FALLBACK_COMMON_PORTS = [3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888]

/** 按进程名猜它是什么 —— 用户真正想知道的是「怎么又是个 node」 */
function guessKind(processName: string): {
  label: string
  tone: 'brand' | 'emerald' | 'amber' | 'slate'
} {
  const name = processName.toLowerCase()
  if (/node|bun|deno/.test(name)) return { label: 'Node', tone: 'emerald' }
  if (/java|gradle|maven/.test(name)) return { label: 'Java', tone: 'amber' }
  if (/docker|com\.docker|containerd/.test(name)) return { label: 'Docker', tone: 'brand' }
  if (/nginx|httpd|apache|caddy/.test(name)) return { label: 'Web 服务', tone: 'brand' }
  if (/python|ruby|php|go$|dotnet/.test(name)) return { label: '服务端', tone: 'amber' }
  if (/postgres|mysql|redis|mongo|mariadb/.test(name)) return { label: '数据库', tone: 'slate' }
  if (/electron|devnotes/.test(name)) return { label: 'devNotes', tone: 'amber' }
  return { label: '进程', tone: 'brand' }
}

/** 端口的中文用途标注，纯装饰，认不出就不标 */
function guessPortLabel(port: number): string {
  const known: Record<number, string> = {
    3000: 'React / Next',
    3001: '前端备用',
    4200: 'Angular',
    5000: 'Flask / .NET',
    5173: 'Vite 默认',
    5174: 'Vite 备用',
    8000: 'Django / http.server',
    8080: 'Tomcat / 代理',
    8888: 'Jupyter',
  }
  return known[port] ?? ''
}

export default function PortKillerTool() {
  const { showToast } = useToast()

  const [customPort, setCustomPort] = useState('')
  /** 已经纳入扫描的端口集合。用数组维持用户添加的顺序 */
  const [ports, setPorts] = useState<number[]>(FALLBACK_COMMON_PORTS)
  const [selected, setSelected] = useState<number>(FALLBACK_COMMON_PORTS[4])

  const [results, setResults] = useState<Record<number, PortInspectResult>>({})
  const [isScanning, setIsScanning] = useState(false)
  const [scannedAt, setScannedAt] = useState<number | null>(null)
  const [pendingKill, setPendingKill] = useState<PortListenerInfo | null>(null)
  const [busyPid, setBusyPid] = useState<number | null>(null)

  const api = window.electronAPI
  const supported = Boolean(api?.portsInspect)

  useEffect(() => {
    let alive = true
    void api?.portsCommon?.().then((list) => {
      if (!alive || !Array.isArray(list) || !list.length) return
      setPorts(list)
      setSelected((prev) => (list.includes(prev) ? prev : list[0]))
    })
    return () => {
      alive = false
    }
  }, [api])

  const scan = useCallback(
    async (targets: number[]) => {
      if (!api?.portsInspect || !targets.length) return
      setIsScanning(true)
      try {
        const list = await api.portsInspect(targets)
        setResults((prev) => {
          const next = { ...prev }
          for (const item of list) next[item.port] = item
          return next
        })
        setScannedAt(Date.now())
      } catch (error) {
        showToast(error instanceof Error ? error.message : '扫描失败', 'error')
      } finally {
        setIsScanning(false)
      }
    },
    [api, showToast],
  )

  // 进页面先扫一次，不然迎面是一个空表格，还得先知道要点「扫描」
  useEffect(() => {
    if (!supported) return
    void scan(ports)
    // 只在挂载时扫默认端口；后续扫描都由按钮和添加动作触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  const addCustomPort = () => {
    const value = Number(customPort.trim())
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      showToast('请输入 1 ~ 65535 之间的端口号', 'error')
      return
    }
    if (!ports.includes(value)) setPorts((prev) => [...prev, value])
    setSelected(value)
    setCustomPort('')
    void scan([value])
  }

  const kill = async (listener: PortListenerInfo) => {
    setPendingKill(null)
    if (!api?.portsKill) return
    setBusyPid(listener.pid)

    const result = await api.portsKill(listener.pid).catch((error) => ({
      ok: false,
      pid: listener.pid,
      error: error instanceof Error ? error.message : String(error),
    }))

    setBusyPid(null)
    if (result.ok) {
      showToast(`已终止 ${listener.processName} (PID ${listener.pid})`, 'default')
      // 重新扫一遍确认端口真的腾出来了 —— 用户点杀就是为了腾端口，
      // 不能只说「命令执行成功」，得给出端口现在的状态
      await scan([listener.port])
    } else {
      showToast(result.error || '终止失败', 'error')
    }
  }

  const activeListeners = useMemo(() => {
    const all = Object.values(results).flatMap((item) => item.listeners)
    return all.sort((a, b) => a.port - b.port)
  }, [results])

  const occupiedCount = activeListeners.length
  const scanError = Object.values(results).find((item) => item.error)?.error

  if (!supported) {
    return (
      <ToolShell icon={Network} title="端口占用排查" subtitle="查出谁占了端口，一键腾出来">
        <ToolNotice tone="warn" icon={AlertTriangle}>
          当前运行环境没有提供端口查询能力（浏览器 / 移动端没有本机进程视图）。
          请在桌面端使用本工具。
        </ToolNotice>
      </ToolShell>
    )
  }

  return (
    <ToolShell
      icon={Network}
      title="端口占用排查"
      subtitle="不用开终端敲 lsof，在这里看清是哪个进程占着端口，再一键强杀"
      badge={
        <ToolBadge tone={occupiedCount ? 'amber' : 'emerald'} pulse={isScanning}>
          {isScanning ? '扫描中…' : `${occupiedCount} 个占用`}
        </ToolBadge>
      }
      actions={
        <>
          <Tooltip content="重新扫描全部端口">
            <button
              onClick={() => void scan(ports)}
              disabled={isScanning}
              className={BTN.secondary}
            >
              <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
              <span>重新扫描</span>
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="tool-cascade flex flex-col gap-3.5">
        {/* 端口选择 */}
        <ToolCard fill={false}>
          <ToolCardHeader
            title="选择要查的端口"
            icon={Search}
            sublabel="点一下直接查；带点的端口正在被占用"
            actions={
              <div className="flex items-center gap-1.5">
                <input
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomPort()
                  }}
                  placeholder="自定义端口"
                  className="w-24 h-7 px-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel font-mono text-[11px] outline-none focus:border-brand-400 dark:focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-100"
                />
                <button onClick={addCustomPort} className={BTN.secondary}>
                  添加
                </button>
              </div>
            }
          />
          <div className="p-3.5 flex flex-wrap gap-2">
            {ports.map((port) => {
              const info = results[port]
              const occupied = Boolean(info?.listeners.length)
              const isActive = port === selected
              return (
                <button
                  key={port}
                  type="button"
                  onClick={() => {
                    setSelected(port)
                    if (!results[port]) void scan([port])
                  }}
                  onDoubleClick={() => void scan([port])}
                  className={`group flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border transition-colors min-w-[92px] ${
                    isActive
                      ? 'border-brand-300 bg-brand-50/70 dark:border-brand-500/40 dark:bg-brand-500/10'
                      : 'border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        occupied ? 'bg-amber-500' : isScanning ? 'bg-slate-300' : 'bg-emerald-500'
                      }`}
                    />
                    <span className="font-mono text-[13px] font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                      {port}
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {occupied ? `${info!.listeners.length} 个进程` : '空闲'}
                  </span>
                </button>
              )
            })}
          </div>
        </ToolCard>

        {scanError && (
          <ToolNotice tone="error" icon={AlertTriangle}>
            端口查询失败：{scanError}
          </ToolNotice>
        )}

        {/* 占用明细 */}
        <ToolCard>
          <ToolCardHeader
            title="占用明细"
            icon={Cpu}
            meta={scannedAt ? `扫描于 ${new Date(scannedAt).toLocaleTimeString()}` : undefined}
            actions={<ToolTag tone="amber">共 {occupiedCount} 条</ToolTag>}
          />

          {!activeListeners.length ? (
            <ToolEmpty
              icon={ShieldAlert}
              title={isScanning ? '正在扫描…' : '这些端口都是空闲的'}
              hint="换几个端口或者添加自定义端口再查；如果前端起不来报错，它报的那个端口号贴进来就行"
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-dark-border">
              {activeListeners.map((listener) => {
                const kind = guessKind(listener.processName)
                const busy = busyPid === listener.pid
                return (
                  <div
                    key={`${listener.port}-${listener.pid}`}
                    className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors ${
                      listener.port === selected ? 'bg-brand-50/40 dark:bg-brand-500/5' : ''
                    }`}
                  >
                    <span className="w-14 shrink-0 font-mono text-[15px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {listener.port}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {listener.processName}
                        </span>
                        <ToolTag tone={kind.tone}>{kind.label}</ToolTag>
                        {listener.self && <ToolTag tone="amber">devNotes 自己</ToolTag>}
                        {guessPortLabel(listener.port) && (
                          <ToolTag tone="slate">{guessPortLabel(listener.port)}</ToolTag>
                        )}
                      </div>
                      <p className={`${META} mt-0.5 truncate`}>
                        PID {listener.pid} · {listener.protocol} {listener.address}:
                        {listener.port}
                        {listener.command ? ` · ${listener.command}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip content={listener.command || listener.processName}>
                        <span className="inline-flex">
                          <CopyButton
                            value={() => `kill -9 ${listener.pid}`}
                            label="复制强杀命令"
                            className={iconButtonClass('neutral')}
                          />
                        </span>
                      </Tooltip>
                      <button
                        type="button"
                        disabled={listener.self || busy}
                        onClick={() => setPendingKill(listener)}
                        className={BTN.danger}
                      >
                        <Skull size={13} />
                        <span>{busy ? '终止中…' : '强杀'}</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ToolCard>

        <ToolActionBar
          info={
            <>
              <Terminal size={13} className="shrink-0" />
              <span>
                macOS / Linux 走 lsof + kill -9；Windows 走 netstat + taskkill /F。
                终止可能需要管理员权限。
              </span>
            </>
          }
        >
          <button onClick={() => void scan(ports)} disabled={isScanning} className={BTN.secondary}>
            <Play size={14} />
            <span>全部重扫</span>
          </button>
        </ToolActionBar>
      </div>

      {/* 强杀二次确认。杀掉一个进程不可逆，必须先把「杀的是谁」摆清楚 */}
      {pendingKill && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/45 px-4">
          <div className="w-full max-w-[440px] rounded-2xl bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border shadow-2xl overflow-hidden">
            <div className="flex items-start gap-3 px-5 pt-5">
              <span className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <ShieldAlert size={19} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">
                  确定要强杀这个进程吗？
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  进程会被立即终止（kill -9），未保存的数据会丢失。这个操作不可撤销。
                </p>
              </div>
            </div>

            <div className="mx-5 mt-4 rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-hover/40 px-3.5 py-3 flex flex-col gap-1.5">
              <Row label="进程名" value={pendingKill.processName} mono />
              <Row label="PID" value={String(pendingKill.pid)} mono />
              <Row
                label="端口"
                value={`${pendingKill.protocol} ${pendingKill.address}:${pendingKill.port}`}
                mono
              />
              {pendingKill.command && <Row label="命令行" value={pendingKill.command} mono />}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4">
              <button onClick={() => setPendingKill(null)} className={BTN.secondary}>
                取消
              </button>
              <button
                onClick={() => void kill(pendingKill)}
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-[10px] bg-rose-600 text-xs font-semibold text-white transition-all duration-150 hover:bg-rose-700 active:scale-[0.98]"
              >
                <Skull size={13} />
                <span>确认强杀</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-slate-400 dark:text-slate-500 shrink-0 w-14">{label}</span>
      <span
        className={`text-slate-700 dark:text-slate-200 break-all ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}
