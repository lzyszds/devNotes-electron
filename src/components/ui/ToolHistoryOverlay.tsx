import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import {
  Check,
  Clock,
  Copy,
  CornerUpLeft,
  History,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import type { HistoryItem } from '../../hooks/useToolHistory'
import { copyText } from '../../utils/clipboard'
import { useToast } from './Toast'
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
  /** 单条记录删除回调（传入后卡片右侧会显示快速删除按钮） */
  onDelete?: (id: string) => void
  /** 空列表时的提示文案 */
  emptyText?: string
  /** 自定义提取文本内容的函数（用于复制和搜索过滤） */
  toText?: (data: T, item: HistoryItem<T>) => string
}

/** 智能将各种数据格式（字符串、对象、JSON）转换为可展示与复制的纯文本 */
function defaultToText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data == null) return ''
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/** 判断文本是否为代码/结构化数据（JSON、URL、正则等），以便应用等宽字体渲染 */
function isCodeLike(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('ws://') ||
    trimmed.startsWith('wss://') ||
    /^\/[^\/]+\/[gimsuy]*$/.test(trimmed) ||
    /^[0-9]+$/.test(trimmed)
  ) {
    return true
  }
  return false
}

/** 格式化人类友好的相对时间戳 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 0) return '刚刚'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 45) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const date = new Date(timestamp)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}-${d}`
}

/**
 * 工具页统一历史记录抽屉组件（Sheet / Drawer 规范）：
 *
 * 采用 Notion 暖灰阶 + shadcn Sheet 侧滑抽屉规范：
 * 1. 贴边全高抽屉布局，告别原先粗糙的悬浮气泡感；
 * 2. 顶部集成搜索过滤、记录计数与防误触的双重确认清空机制；
 * 3. 卡片集成单条复制、单条删除、快速回填及右键上下文菜单；
 * 4. 键盘原生 Esc 退出支持与平滑进出转场动效。
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
  onDelete,
  emptyText = '暂无历史记录',
  toText,
}: ToolHistoryOverlayProps<T>) {
  // 面板退出 180ms、遮罩 160ms，取长者
  const { mounted, state } = usePresence(open, 180)
  const { showToast } = useToast()

  const [searchQuery, setSearchQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 当面板关闭时重置内部交互状态
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setConfirmClear(false)
      setCopiedId(null)
    }
  }, [open])

  // 支持键盘 Esc 键快速关闭抽屉
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  /** 提取单项条目的纯文本 */
  const getItemText = useCallback(
    (item: HistoryItem<T>) => {
      return toText ? toText(item.data, item) : defaultToText(item.data)
    },
    [toText]
  )

  /** 复制单条内容到剪贴板 */
  const handleCopy = useCallback(
    async (item: HistoryItem<T>) => {
      const text = getItemText(item)
      if (!text) return
      const ok = await copyText(text)
      if (ok) {
        setCopiedId(item.id)
        showToast('已复制记录内容', 'default')
        window.setTimeout(() => {
          setCopiedId((curr) => (curr === item.id ? null : curr))
        }, 1500)
      } else {
        showToast('复制失败', 'error')
      }
    },
    [getItemText, showToast]
  )

  /** 过滤后的历史记录列表 */
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase().trim()
    return items.filter((item) => {
      if (item.title && item.title.toLowerCase().includes(q)) return true
      const text = getItemText(item)
      return text.toLowerCase().includes(q)
    })
  }, [items, searchQuery, getItemText])

  if (!mounted) return null

  return (
    <div className="history-overlay" data-state={state}>
      {/* 磨砂半透明遮罩，点击遮罩快速关闭 */}
      <div
        role="presentation"
        aria-label="关闭历史记录"
        className="history-overlay-backdrop cursor-pointer"
        onClick={onClose}
      />

      {/* 右侧滑出抽屉面板 */}
      <div
        className="history-overlay-panel"
        data-state={state}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏（h-[52px]） */}
        <div className="h-[52px] px-4 border-b border-[#E6E6E3] dark:border-dark-border bg-white dark:bg-[#1C1C1E] flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F3F3F1] dark:bg-[#2C2C2E] border border-[#E6E6E3]/80 dark:border-[#38383C] flex items-center justify-center text-[#191918] dark:text-[#E0E0DE] shrink-0">
              <History size={15} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-[13px] font-semibold text-[#191918] dark:text-[#EDEDED] truncate">
                {title}
              </h3>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-[#F3F3F1] dark:bg-[#2C2C2E] text-[#787774] dark:text-[#9B9A97]">
                {items.length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 清空按钮（带防误触内嵌二次确认） */}
            {items.length > 0 && (
              <>
                {confirmClear ? (
                  <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-2 py-0.5 rounded-md">
                    <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      确定清空?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClear()
                        setConfirmClear(false)
                      }}
                      className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline px-1 py-0.5 cursor-pointer"
                    >
                      确定
                    </button>
                    <span className="text-rose-300 dark:text-rose-700">|</span>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="text-[11px] text-[#787774] hover:text-[#191918] dark:hover:text-white px-1 py-0.5 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="text-xs font-medium text-[#787774] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-2 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    <span>清空</span>
                  </button>
                )}
              </>
            )}

            {/* 关闭按钮 */}
            <Tooltip content="关闭 (Esc)">
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="h-7 w-7 rounded-md flex items-center justify-center text-[#787774] hover:text-[#191918] dark:hover:text-[#EDEDED] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 搜索过滤栏（有条目时展示） */}
        {items.length > 0 && (
          <div className="px-3.5 py-2 border-b border-[#E6E6E3] dark:border-dark-border bg-[#FBFBFA]/80 dark:bg-[#1E1E20]/80 flex items-center gap-2 shrink-0">
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#787774] pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索历史记录..."
                className="w-full h-7 pl-8 pr-7 text-xs bg-white dark:bg-[#252528] border border-[#E6E6E3] dark:border-[#333336] rounded-md text-[#191918] dark:text-[#EDEDED] placeholder-[#787774]/60 outline-none focus:border-[#1C1C1C] dark:focus:border-[#66666B] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="清除搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#787774] hover:text-[#191918] dark:hover:text-white p-0.5 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-[11px] text-[#787774] font-mono shrink-0 tabular-nums">
                {filteredItems.length} 条
              </span>
            )}
          </div>
        )}

        {/* 主列表滚动区 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#FBFBFA] dark:bg-[#171718] select-none">
          {items.length === 0 ? (
            /* 全空状态 */
            <div className="flex flex-col items-center justify-center py-24 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#252528] border border-[#E6E6E3] dark:border-[#38383C] flex items-center justify-center text-[#787774] dark:text-[#9B9A97] shadow-2xs mb-3">
                <Clock size={20} className="opacity-70" />
              </div>
              <p className="text-xs font-semibold text-[#191918] dark:text-[#EDEDED] mb-1">
                {emptyText}
              </p>
              <p className="text-[11px] text-[#787774] dark:text-[#888884] max-w-[220px] leading-relaxed">
                在此工具中执行的操作与生成记录会自动保存在这里，方便随时回填。
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            /* 搜索无匹配状态 */
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Search size={22} className="text-[#787774]/50 mb-2" />
              <p className="text-xs font-medium text-[#191918] dark:text-[#EDEDED] mb-1">
                未找到与「{searchQuery}」相关的记录
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline cursor-pointer mt-1"
              >
                清除搜索条件
              </button>
            </div>
          ) : (
            /* 正常历史记录卡片列表 */
            filteredItems.map((item) => {
              const isCopied = copiedId === item.id
              const textContent = getItemText(item)
              const relativeTime = formatRelativeTime(item.timestamp)
              const exactTime = new Date(item.timestamp).toLocaleString('zh-CN', {
                hour12: false,
              })

              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPick(item)
                    }
                  }}
                  onContextMenu={(e) => onItemContextMenu?.(e, item)}
                  onClick={() => onPick(item)}
                  className="group relative p-3 rounded-xl bg-white dark:bg-[#222225] border border-[#E6E6E3] dark:border-[#2E2E32] hover:border-[#1C1C1C]/30 dark:hover:border-[#4E4E54] hover:shadow-xs transition-all duration-150 cursor-pointer flex flex-col gap-2"
                >
                  {/* 顶部标题 / 内容预览 */}
                  <div className="min-w-0 pr-1">
                    {renderItemTitle ? (
                      <div className="text-[13px] font-medium text-[#191918] dark:text-[#EDEDED] break-all leading-snug">
                        {renderItemTitle(item)}
                      </div>
                    ) : (
                      <>
                        {item.title && (
                          <div className="text-[13px] font-semibold text-[#191918] dark:text-[#EDEDED] truncate mb-1">
                            {item.title}
                          </div>
                        )}
                        <div
                          className={`text-xs text-[#52525B] dark:text-[#A1A1AA] line-clamp-2 leading-relaxed break-all ${
                            isCodeLike(textContent) ? 'font-mono' : ''
                          }`}
                        >
                          {textContent}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 底部信息栏与操作条 */}
                  <div className="flex items-center justify-between pt-1 border-t border-[#F3F3F1] dark:border-[#2C2C2E] gap-2">
                    {/* 相对时间与完整时间悬浮 Tooltip */}
                    <Tooltip content={exactTime}>
                      <div className="flex items-center gap-1 text-[11px] text-[#787774] dark:text-[#888884] tabular-nums font-mono">
                        <Clock size={11} className="opacity-70" />
                        <span>{relativeTime}</span>
                      </div>
                    </Tooltip>

                    {/* 卡片动作按钮组 */}
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 单条复制按钮 */}
                      <Tooltip content={isCopied ? '已复制' : '复制内容'}>
                        <button
                          type="button"
                          onClick={() => handleCopy(item)}
                          aria-label="复制"
                          className={`h-6 w-6 rounded flex items-center justify-center transition-colors cursor-pointer ${
                            isCopied
                              ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                              : 'text-[#787774] hover:text-[#191918] dark:hover:text-[#EDEDED] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2E]'
                          }`}
                        >
                          {isCopied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </Tooltip>

                      {/* 单条删除按钮（若已提供 onDelete 回调） */}
                      {onDelete && (
                        <Tooltip content="删除此条">
                          <button
                            type="button"
                            onClick={() => onDelete(item.id)}
                            aria-label="删除"
                            className="h-6 w-6 rounded flex items-center justify-center text-[#787774] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </Tooltip>
                      )}

                      {/* 回填主按钮 */}
                      <button
                        type="button"
                        onClick={() => onPick(item)}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-[#1C1C1C] dark:bg-white text-white dark:text-[#191918] text-[11px] font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 transition shadow-2xs cursor-pointer ml-0.5"
                      >
                        <CornerUpLeft size={11} />
                        <span>回填</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 底部辅助说明栏 */}
        <div className="h-9 px-4 border-t border-[#E6E6E3] dark:border-dark-border bg-white dark:bg-[#1C1C1E] flex items-center justify-between text-[11px] text-[#787774] dark:text-[#888884] shrink-0 select-none">
          <div className="flex items-center gap-1.5 truncate">
            <kbd className="px-1.5 py-0.5 rounded bg-[#F3F3F1] dark:bg-[#2C2C2E] border border-[#E6E6E3]/60 dark:border-[#38383C] text-[10px] font-mono leading-none">
              Esc
            </kbd>
            <span>关闭</span>
            <span className="text-[#D0D0CD] dark:text-[#38383C]">·</span>
            <span>单击回填</span>
            <span className="text-[#D0D0CD] dark:text-[#38383C]">·</span>
            <span>右键菜单</span>
          </div>
          <span className="font-mono tabular-nums shrink-0 ml-2">
            共 {items.length} 条
          </span>
        </div>
      </div>
    </div>
  )
}
