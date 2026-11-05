import { useMemo, useState } from 'react'
import { FolderSearch, HardDrive, RotateCw, ExternalLink } from 'lucide-react'
import ToolShell from '../ui/ToolShell'

type Entry = { path: string; name: string; sizeBytes: number; isDirectory: boolean; modifiedAt: number }
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024, index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  return `${value.toFixed(1)} ${units[index]}`
}

export default function DiskAnalyzerTool() {
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const largestEntries = useMemo(() => entries.slice(0, 100), [entries])

  const scan = async () => {
    const api = window.electronAPI
    if (!api?.systemDiskChoose || !api.systemDiskScan) {
      setError('磁盘扫描需要桌面版权限，浏览器预览不可用')
      return
    }
    setBusy(true); setError('')
    try {
      const selected = await api.systemDiskChoose()
      if (!selected) return
      setRoot(selected)
      setEntries(await api.systemDiskScan(selected))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '扫描失败')
    } finally { setBusy(false) }
  }

  return <ToolShell title="磁盘空间分析" icon={HardDrive} subtitle="只读扫描所选目录，按大小定位空间占用" scroll>
    <div className="h-full min-h-0 flex flex-col bg-[#FAFAF8] text-[#191918]">
      <div className="p-5 border-b border-[#E9E8E4] flex flex-wrap items-center gap-3">
        <button onClick={() => void scan()} disabled={busy} className="h-9 px-3 rounded-md bg-[#1C1C1C] text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50">
          {busy ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <FolderSearch className="w-3.5 h-3.5" />}{busy ? '正在扫描…' : '选择目录并扫描'}
        </button>
        <span className="text-xs text-[#787774] truncate flex-1">{root || '尚未选择目录'}</span>
        {entries.length > 0 && <span className="text-[11px] text-[#787774]">扫描 {entries.length.toLocaleString()} 项</span>}
      </div>
      {error && <p className="px-5 py-3 text-xs text-rose-700 bg-rose-50">{error}</p>}
      {!entries.length ? <div className="flex-1 grid place-items-center text-center text-[#787774]"><div><HardDrive className="w-8 h-8 mx-auto mb-3 text-[#A8A7A2]"/><p className="text-sm font-medium">选择一个目录开始分析</p><p className="text-xs mt-1">只读取文件信息，不会上传、修改或删除文件；最多扫描 20,000 项</p></div></div> :
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-5 py-3 text-xs font-semibold text-[#787774] border-b border-[#E9E8E4]">最大文件 · 前 100 项</div>
          {largestEntries.map((entry) => <div key={entry.path} className="min-h-11 px-5 flex items-center gap-3 border-b border-[#F0EFEC] hover:bg-white">
            <span className="text-xs truncate flex-1" title={entry.path}>{entry.isDirectory ? '文件夹 · ' : ''}{entry.name}</span><span className="text-xs tabular-nums text-[#52514E] w-20 text-right">{formatSize(entry.sizeBytes)}</span>
            <button title="在文件管理器中显示" onClick={() => void window.electronAPI?.systemDiskReveal?.(entry.path)} className="w-7 h-7 grid place-items-center text-[#787774] hover:text-[#191918]"><ExternalLink className="w-3.5 h-3.5"/></button>
          </div>)}
        </div>}
    </div>
  </ToolShell>
}
