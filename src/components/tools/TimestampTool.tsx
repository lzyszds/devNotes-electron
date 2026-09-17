import { useState, useEffect } from 'react'
import { ArrowRight, Calendar, Clock, Copy, Hash, History, Timer } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import { ToolBadge, ToolHistoryOverlay, ToolShell } from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

export default function TimestampTool() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [inputTimestamp, setInputTimestamp] = useState('')
  const [inputDate, setInputDate] = useState('')
  const [timestampResult, setTimestampResult] = useState('')
  const [dateResult, setDateResult] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('timestamp')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      // 带 - 或 T 的是日期串，其余按时间戳回填
      if (item.data.includes('-') || item.data.includes('T')) setInputDate(item.data)
      else setInputTimestamp(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const timestampToDate = () => {
    if (!inputTimestamp) return
    let ts = parseInt(inputTimestamp)
    if (isNaN(ts)) return
    // 10 位以内按秒算，其余按毫秒
    if (ts < 10000000000) ts *= 1000
    const result = new Date(ts).toLocaleString('zh-CN')
    setTimestampResult(result)
    saveHistory(inputTimestamp, `时间戳 → ${result}`)
  }

  const dateToTimestamp = () => {
    if (!inputDate) return
    const result = Math.floor(new Date(inputDate).getTime() / 1000).toString()
    setDateResult(result)
    saveHistory(inputDate, `日期 → ${result}`)
  }

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text)
    showToast(ok ? `已复制${label}` : '复制失败', ok ? 'default' : 'error')
  }

  return (
    <ToolShell
      icon={Clock}
      title="时间戳转换中心"
      subtitle="秒、毫秒与人类可读时间的双向转换"
      badge={
        <ToolBadge tone="emerald" pulse className="hidden sm:flex">
          {currentTime.toLocaleTimeString('zh-CN', { hour12: false })}
        </ToolBadge>
      }
      actions={
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`tool-button-secondary h-9 ${
            showHistory
              ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
              : ''
          }`}
        >
          <History size={15} />
          <span>转换日志</span>
        </button>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="最近转换历史"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            if (item.data.includes('-') || item.data.includes('T')) setInputDate(item.data)
            else setInputTimestamp(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {/* 实时系统时钟 */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-200/90 dark:border-dark-border shadow-sm p-6 flex-shrink-0">
        <div className="absolute top-0 right-0 p-6 opacity-[0.05] pointer-events-none">
          <Timer size={140} />
        </div>

        <div className="relative z-10 space-y-5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
              实时系统时钟
            </span>
          </div>

          <div className="space-y-1">
            <div className="text-5xl font-mono font-black tracking-tighter leading-none text-white">
              {currentTime.toLocaleTimeString('zh-CN', { hour12: false })}
            </div>
            <p className="text-base font-bold text-slate-400 tracking-wide">
              {currentTime.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 text-center">
                秒 (Epoch)
              </p>
              <p className="text-sm font-mono font-bold text-brand-300">
                {Math.floor(currentTime.getTime() / 1000)}
              </p>
            </div>
            <div className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 text-center">
                毫秒 (Millis)
              </p>
              <p className="text-sm font-mono font-bold text-sky-300">{currentTime.getTime()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 两个方向的转换 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 时间戳 → 日期 */}
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Hash size={13} className="text-brand-600 dark:text-brand-400" />
              时间戳 转 日期
            </span>
          </div>

          <div className="flex-1 p-4 flex flex-col gap-3">
            <input
              type="text"
              value={inputTimestamp}
              onChange={(e) => setInputTimestamp(e.target.value)}
              placeholder="例如: 1717315200"
              className="tool-input font-mono"
            />
            <button
              onClick={timestampToDate}
              disabled={!inputTimestamp}
              className="tool-button-primary h-9 w-full"
            >
              <span>开始转换</span>
              <ArrowRight size={14} />
            </button>

            <div className="mt-auto">
              {timestampResult ? (
                <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/25 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase mb-0.5">
                      本地时间
                    </span>
                    <span className="text-sm font-bold text-brand-900 dark:text-brand-200 truncate">
                      {timestampResult}
                    </span>
                  </div>
                  <Tooltip content="复制本地时间">
                    <button
                      onClick={() => void copy(timestampResult, '本地时间')}
                      className="p-1.5 rounded-lg text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition flex-shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <div className="h-[58px] border border-dashed border-slate-200 dark:border-dark-border rounded-xl flex items-center justify-center text-[11px] text-slate-300 dark:text-slate-600">
                  等待输入…
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 日期 → 时间戳 */}
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Calendar size={13} className="text-brand-600 dark:text-brand-400" />
              日期 转 时间戳
            </span>
          </div>

          <div className="flex-1 p-4 flex flex-col gap-3">
            <input
              type="datetime-local"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              className="tool-input h-[44px]"
            />
            <button
              onClick={dateToTimestamp}
              disabled={!inputDate}
              className="tool-button-primary h-9 w-full"
            >
              <span>开始转换</span>
              <ArrowRight size={14} />
            </button>

            <div className="mt-auto">
              {dateResult ? (
                <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/25 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase mb-0.5">
                      UNIX 时间戳
                    </span>
                    <span className="text-sm font-bold text-brand-900 dark:text-brand-200 truncate">
                      {dateResult}
                    </span>
                  </div>
                  <Tooltip content="复制 UNIX 时间戳">
                    <button
                      onClick={() => void copy(dateResult, 'UNIX 时间戳')}
                      className="p-1.5 rounded-lg text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition flex-shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <div className="h-[58px] border border-dashed border-slate-200 dark:border-dark-border rounded-xl flex items-center justify-center text-[11px] text-slate-300 dark:text-slate-600">
                  等待选择日期…
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
