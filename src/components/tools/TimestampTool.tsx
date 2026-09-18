import { useState, useEffect } from 'react'
import { ArrowRight, Calendar, Clock, Copy, Hash, History } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BTN,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolShell,
  iconButtonClass,
} from '../ui'
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
      <ToolCard fill={false}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[28px] font-semibold tracking-tight leading-none text-slate-900 dark:text-white tabular-nums">
                {currentTime.toLocaleTimeString('zh-CN', { hour12: false })}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                {currentTime.toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 px-3.5 py-2">
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">秒 (Epoch)</p>
              <p className="font-mono text-[13px] font-semibold text-brand-600 dark:text-brand-400 tabular-nums">
                {Math.floor(currentTime.getTime() / 1000)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 px-3.5 py-2">
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">毫秒 (Millis)</p>
              <p className="font-mono text-[13px] font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                {currentTime.getTime()}
              </p>
            </div>
          </div>
        </div>
      </ToolCard>

      {/* 两个方向的转换 */}
      <div className="tool-cascade grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 时间戳 → 日期 */}
        <ToolCard>
          <ToolCardHeader title="时间戳 转 日期" icon={Hash} />

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
              className={`${BTN.primary} w-full`}
            >
              <span>开始转换</span>
              <ArrowRight size={14} />
            </button>

            <div className="mt-auto">
              {timestampResult ? (
                <div className="p-3 rounded-xl bg-brand-50/60 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-brand-600/80 dark:text-brand-400/80 mb-0.5">
                      本地时间
                    </span>
                    <span className="text-[13px] font-semibold text-brand-900 dark:text-brand-100 truncate">
                      {timestampResult}
                    </span>
                  </div>
                  <Tooltip content="复制本地时间">
                    <button
                      onClick={() => void copy(timestampResult, '本地时间')}
                      className={iconButtonClass('brand')}
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
        </ToolCard>

        {/* 日期 → 时间戳 */}
        <ToolCard>
          <ToolCardHeader title="日期 转 时间戳" icon={Calendar} />

          <div className="flex-1 p-4 flex flex-col gap-3">
            <input
              type="datetime-local"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              className="tool-input"
            />
            <button
              onClick={dateToTimestamp}
              disabled={!inputDate}
              className={`${BTN.primary} w-full`}
            >
              <span>开始转换</span>
              <ArrowRight size={14} />
            </button>

            <div className="mt-auto">
              {dateResult ? (
                <div className="p-3 rounded-xl bg-brand-50/60 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-brand-600/80 dark:text-brand-400/80 mb-0.5">
                      UNIX 时间戳
                    </span>
                    <span className="text-[13px] font-semibold text-brand-900 dark:text-brand-100 truncate">
                      {dateResult}
                    </span>
                  </div>
                  <Tooltip content="复制 UNIX 时间戳">
                    <button
                      onClick={() => void copy(dateResult, 'UNIX 时间戳')}
                      className={iconButtonClass('brand')}
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
        </ToolCard>
      </div>
    </ToolShell>
  )
}
