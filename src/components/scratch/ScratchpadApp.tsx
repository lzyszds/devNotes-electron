import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Eraser, Minus, Pin, PinOff, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { copyText } from '../../utils/clipboard'
import { renderScratchPreview } from '../../utils/scratchMarkdown'

/**
 * 草稿纸：常驻置顶小窗的内容。
 *
 * 和主界面共用同一套入口（main.tsx 按 `?scratch=1` 分流），但不挂 App 的
 * 任何 Provider —— 它只需要一个 textarea 和几个按钮，拉一整套 Notes /
 * Translate / Toast 进来纯属浪费，小窗还会因此慢半拍。
 *
 * 内容存在 electron-store 的 scratchpad-content 键下，**不参与 Cloudflare
 * 同步**：草稿纸是「临时 Token、临时接口地址」这种只对本机有意义的东西，
 * 同步上去反而会把别的机器上的草稿覆盖掉。
 */

const STORE_KEY = 'scratchpad-content'
/** 落盘防抖：打字过程中每敲一下都写盘没必要，也伤 SSD */
const SAVE_DEBOUNCE_MS = 400

const EMPTY_HINT = `随手写点什么。

- 临时接口地址和 Token
- 待办清单
- 一段还没想好的 SQL

支持简易 Markdown，按 ⌘/Ctrl + P 切换预览。关掉窗口内容也会留着。`

export default function ScratchpadApp() {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pinned, setPinned] = useState(true)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [justCopied, setJustCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer = useRef<number | null>(null)

  const api = window.electronAPI

  /* ---------------- 载入与落盘 ---------------- */

  useEffect(() => {
    let alive = true
    void api?.storeGet(STORE_KEY).then((saved) => {
      if (!alive) return
      if (typeof saved === 'string') setText(saved)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [api])

  // 防抖落盘。依赖里只有 text，所以每次输入都会重排定时器，
  // 停手 400ms 才真正写一次
  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void api?.storeSet(STORE_KEY, text)
      setSavedAt(Date.now())
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [text, loaded, api])

  /* ---------------- 快捷键 ---------------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // ⌘/Ctrl + P：预览与编辑互切
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowPreview((prev) => !prev)
        return
      }
      // ⌘/Ctrl + S：立刻落盘（其实已经在自动保存，这里只是给个确定的反馈）
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void api?.storeSet(STORE_KEY, text)
        setSavedAt(Date.now())
        return
      }
      // Esc：关窗。小窗没有系统标题栏，键盘是唯一的快捷出口
      if (e.key === 'Escape') {
        e.preventDefault()
        void api?.scratchClose?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [api, text])

  // 打开就聚焦，省一次点击
  useEffect(() => {
    if (!showPreview) textareaRef.current?.focus()
  }, [showPreview, loaded])

  const html = useMemo(() => (showPreview ? renderScratchPreview(text) : ''), [text, showPreview])

  const stats = useMemo(() => {
    const chars = text.length
    const lines = text ? text.split('\n').length : 0
    return { chars, lines }
  }, [text])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    void api?.scratchPin?.(next)
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-dark-bg text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* 标题条：整条可拖动，按钮都在 no-drag 里 */}
      <header
        className="drag-region flex items-center gap-1.5 pl-2.5 pr-1.5 h-9 shrink-0 bg-slate-50 dark:bg-dark-panel border-b border-slate-200/80 dark:border-dark-border"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.no-drag')) return
          togglePin()
        }}
      >
        <span className="w-4 h-4 rounded bg-amber-400/90 shadow-inner shrink-0" />
        <span className="text-[11px] font-bold tracking-tight truncate">草稿纸</span>

        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate ml-1">
          {savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString()}` : '自动保存'}
        </span>

        <div className="flex-1" />

        <div className="no-drag flex items-center gap-0.5">
          <Tooltip content={pinned ? '取消置顶（当前会浮在其他窗口上）' : '置顶显示'} placement="right">
            <button
              onClick={togglePin}
              className={`inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors ${
                pinned
                  ? 'text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-500/15'
                  : 'text-slate-400 hover:bg-slate-200/60 dark:hover:bg-dark-hover'
              }`}
            >
              {pinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>
          </Tooltip>

          <Tooltip content={showPreview ? '回到编辑 (⌘P)' : '预览 Markdown (⌘P)'} placement="right">
            <button
              onClick={() => setShowPreview((prev) => !prev)}
              className={`inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors ${
                showPreview
                  ? 'text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-500/15'
                  : 'text-slate-400 hover:bg-slate-200/60 dark:hover:bg-dark-hover'
              }`}
            >
              <span className="text-[11px] font-bold leading-none">M↓</span>
            </button>
          </Tooltip>

          <Tooltip content="复制全部" placement="right">
            <button
              onClick={async () => {
                const ok = await copyText(text)
                if (!ok) return
                setJustCopied(true)
                window.setTimeout(() => setJustCopied(false), 1200)
              }}
              disabled={!text}
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:bg-slate-200/60 dark:hover:bg-dark-hover disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {justCopied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
          </Tooltip>

          <Tooltip content="清空（不可撤销）" placement="right">
            <button
              onClick={() => {
                if (!text || window.confirm('清空草稿纸？内容无法找回。')) setText('')
              }}
              disabled={!text}
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Eraser size={13} />
            </button>
          </Tooltip>
        </div>

        {/* 关窗：小窗没有系统红绿灯，这里自己画一个 */}
        <div className="no-drag flex items-center gap-0.5 ml-0.5">
          <button
            onClick={() => void api?.scratchClose?.()}
            title="关闭"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:bg-slate-200/70 dark:hover:bg-dark-hover transition-colors"
          >
            <Minus size={13} className="hidden" />
            <X size={13} />
          </button>
        </div>
      </header>

      {/* 正文 */}
      <div className="flex-1 min-h-0 relative">
        {!loaded ? (
          <p className="text-xs text-slate-400 p-4">正在载入…</p>
        ) : showPreview ? (
          <div
            className="scratch-preview h-full overflow-y-auto px-4 py-3 text-[13px] leading-6"
            // 预览的 HTML 由本地的 renderScratchPreview 生成：它只处理标题、列表、
            // 引用、代码与行内格式，并且把原文里的 HTML 转义掉，不会执行用户写的内容
            dangerouslySetInnerHTML={{ __html: html || '<p class="text-slate-400">（空）</p>' }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={EMPTY_HINT}
            className="w-full h-full resize-none outline-none bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600"
          />
        )}
      </div>

      {/* 状态条 */}
      <footer className="flex items-center justify-between px-3 h-6 shrink-0 bg-slate-50 dark:bg-dark-panel border-t border-slate-200/80 dark:border-dark-border text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
        <span>{showPreview ? '预览模式 · ⌘P 回到编辑' : '⌘P 预览 · ⌘S 保存 · Esc 关闭'}</span>
        <span>
          {stats.lines} 行 · {stats.chars} 字符
        </span>
      </footer>
    </div>
  )
}
