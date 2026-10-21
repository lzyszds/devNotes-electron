import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, ClipboardList, Copy, File, Search, Trash2, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { copyText } from '../../utils/clipboard'

/**
 * 剪贴板历史面板。
 *
 * 与草稿纸共用分流入口（main.tsx 按 `?clipboard=1`），不挂 App 的 Provider。
 *
 * 选中一条 = 写进系统剪贴板 + 模拟 ⌘V，把值粘进「唤出面板前那个输入框」。
 * 面板是 non-activating 的，不抢焦点，所以外部应用的光标一直没丢，⌘V 粘得回去。
 */

/** 列表里每条摘要显示多少字符，超出省略 */
const PREVIEW_LENGTH = 200

/** 虚拟滚动的固定行高：条目 / 日期分组标题。高度统一才好按偏移算可视范围 */
const ENTRY_H = 44
const HEADER_H = 32
/** 可视区上下各多渲染几条，滚动时不露白边 */
const OVERSCAN = 6

function relativeTime(at: number): string {
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 某天的唯一标识（本地时区），用于分组 */
function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** 分组标题：今天 / 昨天 / M月D日 / YYYY年M月D日 */
function dayLabel(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((today - that) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 按日期分组。先按时间倒序排序，否则同一天的条目若被其他日期隔开会拆成多个组 */
function groupByDate(
  entries: ClipboardEntry[]
): { key: string; label: string; entries: ClipboardEntry[] }[] {
  const sorted = [...entries].sort((a, b) => b.at - a.at)
  const groups: { key: string; label: string; entries: ClipboardEntry[] }[] = []
  for (const entry of sorted) {
    const key = dayKey(entry.at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.entries.push(entry)
    } else {
      groups.push({ key, label: dayLabel(entry.at), entries: [entry] })
    }
  }
  return groups
}

/**
 * 识别文本是不是颜色值，是则返回色块颜色与标签。
 */
function detectColor(text: string): { swatch: string; label: string } | null {
  const t = text.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return { swatch: t, label: 'HEX' }
  if (/^#[0-9a-fA-F]{8}$/.test(t)) return { swatch: t, label: 'HEXA' }
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(t)) return { swatch: t, label: 'RGB' }
  if (/^rgba\([^)]+\)$/.test(t)) return { swatch: t, label: 'RGBA' }
  if (/^hsl\([^)]+\)$/.test(t)) return { swatch: t, label: 'HSL' }
  return null
}

/** 底部快捷键提示的键帽 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded border border-slate-300 bg-white text-[10px] font-medium text-slate-600 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
      {children}
    </kbd>
  )
}

export default function ClipboardPanel() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  /** 刚注入成功的那条，给个原地反馈 */
  const [justSent, setJustSent] = useState<string | null>(null)
  /** 折叠的日期组。首次加载后默认折叠非今天，用户可手动折叠/展开任意组（含今天） */
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set())

  const searchRef = useRef<HTMLInputElement>(null)
  const api = window.electronAPI

  /* ---------------- 数据 ---------------- */

  useEffect(() => {
    let alive = true
    void api?.clipboardList?.().then((list) => {
      if (alive && list) setEntries(list)
    })
    const off = api?.onClipboardChanged?.((list) => setEntries(list))
    return () => {
      alive = false
      off?.()
    }
  }, [api])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter(
      (entry) => entry.type === 'text' && (entry.text ?? '').toLowerCase().includes(needle)
    )
  }, [entries, query])

  // 按日期分组。搜索时全展开，非搜索态由 collapsedDays 决定。
  const grouped = useMemo(() => groupByDate(filtered), [filtered])
  const todayKey = dayKey(Date.now())
  const isExpanded = (key: string) => query.trim() !== '' || !collapsedDays.has(key)

  // 首次拿到数据后，默认折叠非今天；之后用户手动切换不受影响
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current || entries.length === 0) return
    initializedRef.current = true
    setCollapsedDays(new Set(grouped.filter((g) => g.key !== todayKey).map((g) => g.key)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length])

  /** 展开组的条目平铺成可见列表，键盘导航和 activeIndex 都以它为准 */
  const visibleEntries = useMemo(
    () => grouped.filter((g) => isExpanded(g.key)).flatMap((g) => g.entries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped, collapsedDays, todayKey]
  )

  type RenderItem =
    | { kind: 'header'; key: string; label: string; count: number }
    | { kind: 'entry'; entry: ClipboardEntry; index: number }
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let index = 0
    for (const g of grouped) {
      items.push({ kind: 'header', key: g.key, label: g.label, count: g.entries.length })
      if (isExpanded(g.key)) {
        for (const entry of g.entries) {
          items.push({ kind: 'entry', entry, index })
          index++
        }
      }
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, collapsedDays, todayKey])

  const toggleGroup = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /* ---------------- 虚拟滚动 ---------------- */

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const itemHeights = useMemo(
    () => renderItems.map((item) => (item.kind === 'header' ? HEADER_H : ENTRY_H)),
    [renderItems]
  )
  const itemOffsets = useMemo(() => {
    const offsets: number[] = []
    let acc = 0
    for (const h of itemHeights) {
      offsets.push(acc)
      acc += h
    }
    return offsets
  }, [itemHeights])
  const totalHeight = itemHeights.reduce((a, b) => a + b, 0)

  const rangeStart = useMemo(() => {
    let lo = 0
    let hi = renderItems.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (itemOffsets[mid] + itemHeights[mid] <= scrollTop) lo = mid + 1
      else hi = mid
    }
    // 往前回溯到「当前分组的标题」，让标题始终留在渲染范围里（sticky 依赖）
    let start = Math.max(0, lo - 1)
    while (start > 0 && renderItems[start].kind !== 'header') start--
    return Math.max(0, start - OVERSCAN)
  }, [renderItems, itemOffsets, itemHeights, scrollTop])

  const rangeEnd = useMemo(() => {
    const bottom = scrollTop + viewportH
    let lo = 0
    let hi = renderItems.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (itemOffsets[mid] < bottom) lo = mid + 1
      else hi = mid
    }
    return Math.min(renderItems.length, lo + OVERSCAN)
  }, [renderItems.length, itemOffsets, viewportH, scrollTop])

  const topPad = itemOffsets[rangeStart] ?? 0
  const bottomPad = totalHeight - (itemOffsets[rangeEnd - 1] ?? 0) - (itemHeights[rangeEnd - 1] ?? 0)

  useEffect(() => {
    setActiveIndex((prev) =>
      prev >= visibleEntries.length ? Math.max(0, visibleEntries.length - 1) : prev
    )
  }, [visibleEntries.length])

  /* ---------------- 动作 ---------------- */

  const pick = async (entry: ClipboardEntry) => {
    await api?.clipboardPaste?.({
      type: entry.type,
      text: entry.text,
      imageDataUrl: entry.imageDataUrl,
      filePath: entry.filePath,
    })
    setJustSent(entry.id)
    window.setTimeout(() => void api?.clipboardClose?.(), 200)
  }

  const remove = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    const list = await api?.clipboardRemove?.(id)
    if (list) setEntries(list)
  }

  const clearAll = async () => {
    if (!window.confirm(`清空全部 ${entries.length} 条剪贴板历史？不可撤销。`)) return
    const list = await api?.clipboardClear?.()
    if (list) setEntries(list)
  }

  /* ---------------- 键盘 ---------------- */

  /** 条目 id → 所在日期组的 key，左右键展开/收起分组时要用 */
  const groupKeyByEntry = useMemo(() => {
    const map = new Map<string, string>()
    grouped.forEach((g) => g.entries.forEach((entry) => map.set(entry.id, g.key)))
    return map
  }, [grouped])

  /** 收起某个分组：选中项落到它前面那条，没有前面的就落到第一条 */
  const collapseGroup = (key: string) => {
    const idx = visibleEntries.findIndex((entry) => groupKeyByEntry.get(entry.id) === key)
    setCollapsedDays((prev) => new Set(prev).add(key))
    setActiveIndex(Math.max(0, idx - 1))
  }

  // 键盘挂在 window 上：焦点在哪儿（比如鼠标点了列表空白处）都能上下选
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  keyHandlerRef.current = (event: KeyboardEvent) => {
    const inSearch = document.activeElement === searchRef.current
    const current = visibleEntries[activeIndex]
    const searching = query.trim() !== ''

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, visibleEntries.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'ArrowRight' && !inSearch) {
      // 右：展开当前条目所在的分组（搜索时全部展开，无需操作）
      event.preventDefault()
      const key = current && groupKeyByEntry.get(current.id)
      if (key && !searching && collapsedDays.has(key)) toggleGroup(key)
    } else if (event.key === 'ArrowLeft' && !inSearch) {
      // 左：收起当前条目所在的分组
      event.preventDefault()
      const key = current && groupKeyByEntry.get(current.id)
      if (key && !searching) collapseGroup(key)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (current) void pick(current)
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && !inSearch) {
      event.preventDefault()
      if (current) {
        void api?.clipboardRemove?.(current.id).then((list) => {
          if (list) setEntries(list)
        })
      }
    } else if (event.key === 'Escape') {
      void api?.clipboardClose?.()
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandlerRef.current(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 选中项移出可视区域时，把它滚进来（向上时带上分组标题，不被吸顶挡住）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const rIdx = renderItems.findIndex((item) => item.kind === 'entry' && item.index === activeIndex)
    if (rIdx < 0) return
    const top = itemOffsets[rIdx]
    const bottom = top + itemHeights[rIdx]
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - HEADER_H)
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    // 只在选中项变化时滚动，列表数据更新时不去抢滚动位置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <div className="h-screen w-screen bg-transparent">
      <div className="flex flex-col h-full bg-white text-slate-900 overflow-hidden">
        {/* 标题条：整条可拖动 */}
        <header className="drag-region flex items-center gap-2 pl-4 pr-2.5 h-12 shrink-0">
          <span className="text-[13px] font-semibold tracking-tight">剪贴板历史</span>
          <span className="text-[11px] font-normal text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
            {entries.length} 条 · 本机
          </span>

          <div className="flex-1" />

          <div className="no-drag flex items-center gap-1">
            <Tooltip content="清空全部" placement="right">
              <button
                onClick={() => void clearAll()}
                disabled={!entries.length}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </Tooltip>
            <button
              onClick={() => void api?.clipboardClose?.()}
              title="关闭 (Esc)"
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </header>

        {/* 搜索：胶囊式，聚焦有蓝色光晕 */}
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 h-9 px-3 rounded-[10px] border border-slate-200 bg-slate-50 transition-all focus-within:bg-white focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/15">
            <Search size={14} className="text-slate-500 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              placeholder="搜索历史内容 (支持色值、文本、图片)…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-slate-900 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* 列表：按日期分组，旧分组默认收起；虚拟滚动只渲染可视区 */}
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="flex-1 min-h-0 overflow-y-auto px-3 pb-3"
        >
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-full text-center px-6">
              <ClipboardList size={22} className="text-slate-200" />
              <p className="text-[11px] text-slate-400">
                {entries.length === 0 ? '还没有记录，复制点什么试试' : '没有匹配的内容'}
              </p>
            </div>
          ) : (
            <div style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
              {renderItems.slice(rangeStart, rangeEnd).map((item) => {
                if (item.kind === 'header') {
                  const expanded = isExpanded(item.key)
                  return (
                    <button
                      key={`h-${item.key}`}
                      type="button"
                      onClick={() => toggleGroup(item.key)}
                      style={{ height: HEADER_H }}
                      className="sticky top-0 z-10 flex w-full items-center gap-1.5 px-2 rounded-md bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors text-left"
                    >
                      <ChevronRight
                        size={13}
                        className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                      />
                      <span className="text-[11px] font-semibold">{item.label}</span>
                      <span className="text-[10px] text-slate-400">{item.count} 条</span>
                    </button>
                  )
                }

                const { entry, index } = item
                const active = index === activeIndex
                const sent = justSent === entry.id
                const color = entry.type === 'text' ? detectColor(entry.text ?? '') : null

                return (
                  <div
                    key={entry.id}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => void pick(entry)}
                    style={{ height: ENTRY_H }}
                    className={`group flex items-center gap-3 px-2.5 rounded-[10px] cursor-pointer transition-colors ${
                      active ? 'bg-sky-100' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className={`w-[18px] h-[18px] rounded text-[11px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                        active
                          ? 'bg-sky-200 text-sky-700'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {index + 1}
                    </span>

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {entry.type === 'image' ? (
                        <img
                          src={entry.imageDataUrl}
                          alt="图片"
                          className="w-9 h-9 rounded-md object-cover border border-slate-200 shrink-0"
                        />
                      ) : entry.type === 'file' ? (
                        <span className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                          <File size={16} />
                        </span>
                      ) : color ? (
                        <span
                          className="w-3.5 h-3.5 rounded border border-black/10 shrink-0"
                          style={{ backgroundColor: color.swatch }}
                        />
                      ) : null}

                      <span className="truncate text-[13px] text-slate-900">
                        {entry.type === 'image'
                          ? '图片'
                          : entry.type === 'file'
                            ? (entry.filePath ?? '').split('/').pop() || '文件'
                            : (entry.text ?? '').slice(0, PREVIEW_LENGTH)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {entry.type === 'image' ? (
                        <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">
                          图片
                        </span>
                      ) : entry.type === 'file' ? (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                          文件
                        </span>
                      ) : color ? (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                          {color.label}
                        </span>
                      ) : entry.truncated ? (
                        <span className="text-[10px] text-amber-600 shrink-0">已截断</span>
                      ) : null}

                      <span className="text-[12px] text-slate-500 tabular-nums shrink-0">
                        {relativeTime(entry.at)}
                      </span>

                      {sent ? (
                        <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 shrink-0">
                          <Check size={10} /> 已填入
                        </span>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <Tooltip content="复制到剪贴板" placement="left">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                if (entry.type === 'image') {
                                  await api?.clipboardCopyImage?.(entry.imageDataUrl ?? '')
                                } else if (entry.type === 'file') {
                                  await copyText(entry.filePath ?? '')
                                } else {
                                  await copyText(entry.text ?? '')
                                }
                              }}
                              className="inline-flex items-center justify-center h-5 w-5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-200"
                            >
                              <Copy size={11} />
                            </button>
                          </Tooltip>
                          <Tooltip content="删除这条" placement="left">
                            <button
                              onClick={(e) => void remove(entry.id, e)}
                              className="inline-flex items-center justify-center h-5 w-5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 size={11} />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底栏：kbd 键帽提示 */}
        <footer className="shrink-0 px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="text-[11px] text-slate-500 ml-1">导航</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span className="text-[11px] text-slate-500 ml-1">粘贴</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Del</Kbd>
              <span className="text-[11px] text-slate-500 ml-1">删除</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd>
            <span className="text-[11px] text-slate-500 ml-1">退出</span>
          </span>
        </footer>
      </div>
    </div>
  )
}
