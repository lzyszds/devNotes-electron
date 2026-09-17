import type { MouseEvent, ReactNode } from 'react'
import { ChevronRight, Clock, History, X } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import type { HistoryItem } from '../../hooks/useToolHistory'
import Tooltip from './Tooltip'

export interface ToolHistoryOverlayProps<T = unknown> {
  open: boolean
  onClose: () => void
  /** 浮层标题，如「最近翻译」「历史文本片段」 */
  title: string
  items: HistoryItem<T>[]
  onClear: () => void
  /** 点某一条：各工具自己决定拿它做什么（回填输入框等） */
  onPick: (item: HistoryItem<T>) => void
  /** 右键菜单，通常传 useHistoryContextMenu 返回的 opener */
  onItemContextMenu?: (e: MouseEvent, item: HistoryItem<T>) => void
  /** 列表项标题的自定义渲染，默认取 item.title，没有就退回 data */
  renderItemTitle?: (item: HistoryItem<T>) => ReactNode
  emptyText?: string
}

/**
 * 工具页共用的历史记录浮层：右侧滑出，点条目回填，右键出菜单。
 *
 * 挂在 ToolShell 的 overlay 插槽里 —— 它靠 .history-overlay 的 absolute 定位，
 * 必须留在工具根节点下，不能 portal 出去。
 */
export default function ToolHistoryOverlay<T = unknown>({
  open,
  onClose,
  title,
  items,
  onClear,
  onPick,
  onItemContextMenu,
  renderItemTitle,
  emptyText = '暂无记录',
}: ToolHistoryOverlayProps<T>) {
  // 面板 180ms、遮罩 160ms，取长者
  const { mounted, state } = usePresence(open, 180)

  if (!mounted) return null

  return (
    <div className="history-overlay" data-state={state}>
      <button
        type="button"
        aria-label="关闭历史记录"
        className="history-overlay-backdrop"
        onClick={onClose}
      />
      <div className="history-overlay-panel" data-state={state} onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200/70 dark:border-dark-border bg-white/80 dark:bg-dark-panel/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-black text-xs uppercase tracking-widest">
            <History size={18} className="text-brand-600 dark:text-brand-400" />
            {title}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase"
            >
              清空
            </button>
            <Tooltip content="关闭历史记录">
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-400"
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-dark-bg/50">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300 dark:text-slate-600">
              <Clock size={32} className="mb-2 opacity-20" />
              <p className="text-[10px] font-bold uppercase tracking-widest">{emptyText}</p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onContextMenu={(e) => onItemContextMenu?.(e, item)}
                onClick={() => onPick(item)}
                className="w-full text-left p-5 rounded-2xl bg-white dark:bg-dark-panel border border-slate-200/60 dark:border-dark-border shadow-sm hover:border-brand-600 hover:shadow-brand-500/10 transition-all group"
              >
                <p className="text-[11px] font-black text-slate-800 dark:text-slate-200 mb-2 truncate pr-4">
                  {renderItemTitle
                    ? renderItemTitle(item)
                    : item.title || String(item.data ?? '')}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    {new Date(item.timestamp).toLocaleString()}
                  </span>
                  <ChevronRight
                    size={10}
                    className="text-slate-300 group-hover:text-brand-600 transition-colors"
                  />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
