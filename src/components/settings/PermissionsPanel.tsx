import { useCallback, useEffect, useState } from 'react'
import { Accessibility, Check, ExternalLink, RefreshCw, Shield } from 'lucide-react'

type PermissionState = { accessibilitySupported: boolean; accessibility: boolean; pasteAvailable: boolean; platform: string }

export default function PermissionsPanel() {
  const [state, setState] = useState<PermissionState | null>(null)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try { setState(await window.electronAPI?.permissionsGet?.() ?? null) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const request = async () => {
    await window.electronAPI?.permissionsRequestAccessibility?.()
    await refresh()
  }

  return <div className="space-y-5 text-[#191918]">
    <div><h2 className="text-base font-bold">权限管理</h2><p className="mt-1 text-xs text-[#787774]">查看应用依赖的系统权限，并跳转到对应设置页面。</p></div>
    {!state ? <div className="rounded-md border border-[#E9E8E4] p-4 text-xs text-[#787774]">{window.electronAPI ? '正在读取权限状态…' : '浏览器环境无法读取桌面系统权限。'}</div> : <>
      <section className="border border-[#E9E8E4] rounded-md divide-y divide-[#F0EFEC]">
        <div className="p-4 flex items-start gap-3"><span className="w-8 h-8 rounded-md bg-[#F3F3F1] grid place-items-center"><Accessibility className="w-4 h-4 text-[#52514E]"/></span><div className="flex-1"><div className="flex items-center gap-2 text-sm font-semibold">辅助功能 <span className={`text-[10px] font-medium ${state.accessibility ? 'text-emerald-700' : 'text-amber-700'}`}>{state.accessibilitySupported ? state.accessibility ? '已授权' : '未授权' : '系统不需要'}</span></div><p className="mt-1 text-xs leading-5 text-[#787774]">用于将剪贴板内容自动粘贴到其他应用。拒绝授权不会影响复制和手动粘贴。</p></div>{state.accessibility && <Check className="w-4 h-4 text-emerald-600"/>}</div>
        {state.accessibilitySupported && !state.accessibility && <div className="px-4 pb-4 pl-[60px] flex flex-wrap gap-2"><button onClick={() => void request()} className="h-8 px-3 rounded-md bg-[#1C1C1C] text-white text-xs">请求授权</button><button onClick={() => void window.electronAPI?.clipboardOpenAccessibility?.()} className="h-8 px-3 rounded-md border border-[#E6E6E3] bg-white text-xs flex items-center gap-1.5">打开系统设置<ExternalLink className="w-3 h-3"/></button></div>}
      </section>
      <section className="border border-[#E9E8E4] rounded-md p-4 flex items-start gap-3"><Shield className="w-4 h-4 mt-0.5 text-[#787774]"/><div><h3 className="text-sm font-semibold">按需授权</h3><p className="mt-1 text-xs leading-5 text-[#787774]">磁盘空间分析仅扫描你主动选择的目录；开发环境检查只读取命令版本和路径。应用不会后台扫描全盘，也不会擅自修改系统设置。</p></div></section>
      <button onClick={() => void refresh()} disabled={loading} className="h-8 px-3 rounded-md border border-[#E6E6E3] text-xs flex items-center gap-2"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>刷新权限状态</button>
    </>}
  </div>
}
