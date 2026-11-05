import { useCallback, useEffect, useState } from 'react'
import { Check, CircleAlert, RotateCw, Terminal } from 'lucide-react'
import ToolShell from '../ui/ToolShell'

type Status = { id: string; name: string; installed: boolean; version?: string; path?: string }

export default function DeveloperEnvironmentTool() {
  const [items, setItems] = useState<Status[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try {
      if (!window.electronAPI?.systemDevTools) throw new Error('开发环境检查需要桌面版运行')
      setItems(await window.electronAPI.systemDevTools())
    } catch (cause) { setError(cause instanceof Error ? cause.message : '检查失败') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  return <ToolShell title="开发环境检查" icon={Terminal} subtitle="检查常用开发工具是否安装及其版本路径" scroll>
    <div className="h-full overflow-auto bg-[#FAFAF8] text-[#191918]">
      <div className="px-5 py-4 flex items-center justify-between border-b border-[#E9E8E4]"><div><h2 className="text-sm font-semibold">常用开发工具</h2><p className="text-xs text-[#787774] mt-1">在本机 PATH 中查询，不安装或修改任何环境</p></div><button onClick={() => void refresh()} disabled={busy} title="重新检查" className="w-8 h-8 grid place-items-center rounded-md border border-[#E6E6E3] bg-white"><RotateCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}/></button></div>
      {error && <p className="px-5 py-3 text-xs text-rose-700">{error}</p>}
      <div className="divide-y divide-[#F0EFEC]">
        {items.map((item) => <article key={item.id} className="px-5 py-4 flex items-start gap-3"><span className={`mt-0.5 w-6 h-6 grid place-items-center rounded-full ${item.installed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.installed ? <Check className="w-3.5 h-3.5"/> : <CircleAlert className="w-3.5 h-3.5"/>}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-medium">{item.name}</span><span className={`text-[10px] ${item.installed ? 'text-emerald-700' : 'text-[#9A6B16]'}`}>{item.installed ? '已安装' : '未检测到'}</span></div>{item.version && <p className="mt-1 text-xs text-[#52514E] font-mono">{item.version}</p>}{item.path && <p className="mt-1 text-[10px] text-[#9A9996] font-mono truncate" title={item.path}>{item.path}</p>}</div></article>)}
      </div>
      {busy && <div className="px-5 py-8 text-center text-xs text-[#787774]">正在检查本机环境…</div>}
    </div>
  </ToolShell>
}
