import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ClipboardList, Copy, File, Search, Trash2, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { copyText } from '../../utils/clipboard'

/**
 * 剪贴板历史面板。
 *
 * 与草稿纸共用分流入口（main.tsx 按 `?clipboard=1`），不挂 App 的 Provider。
 *
 * 选中一条 = 写进系统剪贴板 + 模拟 ⌘V，把值粘进「唤出面板前那个输入框」。
 * 面板不抢焦点（focusable: false），所以外部应用的光标一直没丢，⌘V 粘得回去。
 */

/** 列表里每条摘要显示多少字符，超出省略 */
const PREVIEW_LENGTH = 200

function relativeTime(at: number): string {
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/**
 * 识别文本是不是颜色值，是则返回色块颜色与标签。
 *
 * 覆盖常见的色值写法：HEX 六位/八位、rgb()、rgba()、hsl()。
 * 色块直接交给 CSS 的 background-color 解析，这些字符串它都认得。
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

  const searchRef = useRef<HTMLInputElement>(null)
  const api = window.electronAPI

  /* ---------------- 数据 ---------------- */

  useEffect(() => {
    let alive = true
    void api?.clipboardList?.().then((list) => {
      if (alive && list) setEntries(list)
    })
    // 主进程采集到新的会推过来，不用轮询
    const off = api?.onClipboardChanged?.((list) => setEntries(list))
    return () => {
      alive = false
      off?.()
    }
  }, [api])

  // 开窗即聚焦搜索框，敲字就能筛
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    // 图片没有文本可搜，搜索时只匹配文本条目
    return entries.filter(
      (entry) => entry.type === 'text' && (entry.text ?? '').toLowerCase().includes(needle)
    )
  }, [entries, query])

  // 过滤后选中项可能越界，夹回范围内，避免回车注入到不存在的条目
  useEffect(() => {
    setActiveIndex((prev) => (prev >= filtered.length ? Math.max(0, filtered.length - 1) : prev))
  }, [filtered.length])

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

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 焦点在搜索框里时，Backspace 要删搜索文字，不能误删历史条目
    const inSearch = document.activeElement === searchRef.current

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const entry = filtered[activeIndex]
      if (entry) void pick(entry)
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && !inSearch) {
      // Del 删除当前选中项
      event.preventDefault()
      const entry = filtered[activeIndex]
      if (entry) {
        void api?.clipboardRemove?.(entry.id).then((list) => {
          if (list) setEntries(list)
        })
      }
    } else if (event.key === 'Escape') {
      void api?.clipboardClose?.()
    }
  }

  return (
    <div className="h-screen w-screen bg-transparent">
      <div
        onKeyDown={onKeyDown}
        className="flex flex-col h-full bg-white text-slate-900 overflow-hidden"
      >
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

        {/* 列表：卡片式横向排列 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 text-center px-6">
              <ClipboardList size={22} className="text-slate-200" />
              <p className="text-[11px] text-slate-400">
                {entries.length === 0 ? '还没有记录，复制点什么试试' : '没有匹配的内容'}
              </p>
            </div>
          ) : (
            filtered.map((entry, index) => {
              const active = index === activeIndex
              const sent = justSent === entry.id
              const color = entry.type === 'text' ? detectColor(entry.text ?? '') : null

              return (
                <div
                  key={entry.id}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => void pick(entry)}
                  className={`group flex items-center gap-3 px-2.5 py-2 rounded-[10px] cursor-pointer transition-colors ${
                    active ? 'bg-sky-100' : 'hover:bg-slate-100'
                  }`}
                >
                  {/* 键盘序号键帽 */}
                  <span
                    className={`w-[18px] h-[18px] rounded text-[11px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'bg-sky-200 text-sky-700'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {index + 1}
                  </span>

                  {/* 内容主体：色块 / 缩略图 / 文件图标 + 单行文本 */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {entry.type === 'image' ? (
                      <img
                        src={entry.imageDataUrl}
                        alt="图片"
                        className="w-12 h-12 rounded-md object-cover border border-slate-200 shrink-0"
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

                  {/* 元信息：标签 + 时间 + 操作 */}
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
            })
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
