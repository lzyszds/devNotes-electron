import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Globe, Loader2, Network, RefreshCw, Wifi } from 'lucide-react'
import { CopyButton, META, ToolCard, ToolCardHeader, ToolTag, iconButtonClass } from '../ui'
import Tooltip from '../ui/Tooltip'

const KIND_LABEL: Record<LocalInterface['kind'], { text: string; tone: 'emerald' | 'brand' | 'slate' }> = {
  wifi: { text: 'Wi-Fi', tone: 'emerald' },
  ethernet: { text: '以太网', tone: 'brand' },
  virtual: { text: '虚拟', tone: 'slate' },
}

interface PublicState {
  loading: boolean
  ip: string | null
  error?: string
}

/** 解析 host:port，host 可以是 IP 或域名，端口必须是 1–65535 */
function parseHostPort(raw: string): { host: string; port: number } | string {
  const value = raw.trim()
  const idx = value.lastIndexOf(':')
  if (idx <= 0) return '格式应为 IP:端口，如 192.168.1.10:8080'
  const host = value.slice(0, idx).replace(/^\[|\]$/g, '')
  const port = Number(value.slice(idx + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口需在 1–65535 之间'
  return { host, port }
}

export default function NetInfoCard() {
  const api = window.electronAPI
  const available = !!api?.netInfoInterfaces

  const [interfaces, setInterfaces] = useState<LocalInterface[]>([])
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [direct, setDirect] = useState<PublicState>({ loading: false, ip: null })
  const [proxied, setProxied] = useState<PublicState>({ loading: false, ip: null })
  const [target, setTarget] = useState('')
  const [probe, setProbe] = useState<{ loading: boolean; text: string; ok: boolean | null }>({
    loading: false,
    text: '',
    ok: null,
  })

  const loadLocal = async () => {
    if (!api?.netInfoInterfaces) return
    setLoadingLocal(true)
    try {
      setInterfaces(await api.netInfoInterfaces())
    } catch {
      setInterfaces([])
    } finally {
      setLoadingLocal(false)
    }
  }

  const queryPublic = async (mode: 'direct' | 'proxy') => {
    const set = mode === 'direct' ? setDirect : setProxied
    if (!api?.netInfoPublicIp) return
    set({ loading: true, ip: null })
    try {
      const result = await api.netInfoPublicIp(mode)
      set({ loading: false, ip: result.ip, error: result.error })
    } catch (err) {
      set({ loading: false, ip: null, error: err instanceof Error ? err.message : '查询失败' })
    }
  }

  const runProbe = async () => {
    if (!api?.netTcpProbe) return
    const parsed = parseHostPort(target)
    if (typeof parsed === 'string') {
      setProbe({ loading: false, text: parsed, ok: false })
      return
    }
    setProbe({ loading: true, text: '', ok: null })
    const result = await api.netTcpProbe({ host: parsed.host, port: parsed.port, timeoutMs: 3000 })
    setProbe({
      loading: false,
      ok: result.ok,
      text: result.ok
        ? `${parsed.host}:${parsed.port} 连通，耗时 ${(result.ms ?? 0).toFixed(1)} ms`
        : `${parsed.host}:${parsed.port} 不通：${result.error ?? '未知错误'}`,
    })
  }

  useEffect(() => {
    void loadLocal()
    // 公网 IP 需要外网请求，不在打开时自动查，由用户主动点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!available) return null

  const PublicRow = ({ label, icon, state, onQuery }: { label: string; icon: ReactNode; state: PublicState; onQuery: () => void }) => (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50/70 px-3 py-2 dark:bg-dark-hover/40">
      <span className="flex w-[88px] shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] tabular-nums text-slate-800 dark:text-slate-100">
        {state.loading ? '查询中…' : state.ip ?? (state.error ? <span className="text-rose-500">{state.error}</span> : '未查询')}
      </span>
      {state.ip && <CopyButton value={state.ip} label="复制 IP" size={13} />}
      <button
        type="button"
        onClick={onQuery}
        disabled={state.loading}
        className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-600 shadow-sm hover:bg-brand-50 disabled:opacity-40 dark:bg-dark-panel dark:text-brand-400"
      >
        查询
      </button>
    </div>
  )

  return (
    <ToolCard fill={false}>
      <ToolCardHeader
        title="本机网络"
        icon={Network}
        sublabel="局域网地址、公网出口与连通性"
        actions={
          <Tooltip content="重新读取网卡">
            <button onClick={() => void loadLocal()} disabled={loadingLocal} className={iconButtonClass('neutral')}>
              <RefreshCw size={14} className={loadingLocal ? 'animate-spin' : ''} />
            </button>
          </Tooltip>
        }
      />

      <div className="grid grid-cols-1 gap-4 p-3.5 lg:grid-cols-2">
        {/* 本机网卡 */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">局域网地址</p>
          {interfaces.length === 0 ? (
            <p className={META}>{loadingLocal ? '读取中…' : '没有读到可用的 IPv4 网卡'}</p>
          ) : (
            interfaces.map((item) => (
              <div key={`${item.name}-${item.address}`} className="flex items-center gap-2.5 rounded-lg border border-slate-200/70 px-3 py-2 dark:border-dark-border">
                <Wifi size={13} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">{item.name}</span>
                    <ToolTag tone={KIND_LABEL[item.kind].tone}>{KIND_LABEL[item.kind].text}</ToolTag>
                  </div>
                  <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-slate-500 dark:text-slate-400">
                    {item.address} · {item.cidr}
                  </p>
                </div>
                <CopyButton value={item.address} label="复制 IP" size={13} />
              </div>
            ))
          )}
        </div>

        {/* 公网出口 + 连通性 */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">公网出口 IP</p>
          <PublicRow label="直连" icon={<Globe size={12} />} state={direct} onQuery={() => void queryPublic('direct')} />
          <PublicRow label="经应用代理" icon={<Globe size={12} />} state={proxied} onQuery={() => void queryPublic('proxy')} />
          <p className={META}>查询会请求外部服务（api.ipify.org），只在点击时发起。</p>

          <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">连通性测试（TCP）</p>
          <div className="flex items-center gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runProbe()
              }}
              placeholder="192.168.1.10:8080"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-slate-800 outline-none focus:border-brand-400 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probe.loading || !target.trim()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40"
            >
              {probe.loading ? <Loader2 size={13} className="animate-spin" /> : null}
              测试
            </button>
          </div>
          {probe.text && (
            <p className={`text-[11.5px] ${probe.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
              {probe.text}
            </p>
          )}
        </div>
      </div>
    </ToolCard>
  )
}
