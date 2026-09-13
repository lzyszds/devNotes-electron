import { useEffect, useMemo, useRef, useState } from 'react'
import { useNotes } from '../../context/NotesContext'
import CherryMarkdownEditor from './CherryMarkdownEditor'
import VditorMarkdownEditor from './VditorMarkdownEditor'
import EditorModeSwitch, {
  persistEditorMode,
  readEditorMode,
  type EditorMode,
} from './EditorModeSwitch'
import { ArrowUpToLine, Loader2, TriangleAlert, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { computeDocStats } from '../../utils/markdownStats'

/** 滚动超过这个距离才值得把「返回顶部」露出来 */
const BACK_TO_TOP_THRESHOLD = 120

export default function NotesTool() {
  const {
    ready,
    activeNote,
    handleContentChange,
    saveStatus,
    message: saveMessage,
  } = useNotes()
  const [mode, setMode] = useState<EditorMode>(readEditorMode)
  const [warning, setWarning] = useState('')
  const [showBackToTop, setShowBackToTop] = useState(false)

  // 编辑器外壳：Cherry / Vditor 各自把滚动容器放在内部，统一从这里往下找
  const rootRef = useRef<HTMLDivElement>(null)

  const content = activeNote?.content || ''

  // 实时精细化统计（与右键菜单的「当前文档信息」共用同一套口径）
  const stats = useMemo(() => computeDocStats(content), [content])

  /**
   * 收集编辑器内部真正溢出滚动的容器。
   * 双栏模式下源码区与预览区是两个独立滚动容器，返回顶部时一并归零。
   */
  const collectScrollers = (): HTMLElement[] => {
    const root = rootRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
      if (el.scrollHeight - el.clientHeight < 1) return false
      const overflowY = getComputedStyle(el).overflowY
      return overflowY === 'auto' || overflowY === 'scroll'
    })
  }

  // 滚动事件不冒泡，但能在父节点上捕获；直接用事件目标判断，避免每次滚动都遍历子树
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    setShowBackToTop(false)

    const handleScroll = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (!el || typeof el.scrollTop !== 'number') return
      setShowBackToTop(el.scrollTop > BACK_TO_TOP_THRESHOLD)
    }

    root.addEventListener('scroll', handleScroll, true)
    return () => root.removeEventListener('scroll', handleScroll, true)
  }, [mode, activeNote?.id, ready])

  const handleBackToTop = () => {
    collectScrollers().forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }))
    setShowBackToTop(false)
  }

  // 兼容性提醒不常驻，看过即走
  useEffect(() => {
    if (!warning) return
    const timer = setTimeout(() => setWarning(''), 12000)
    return () => clearTimeout(timer)
  }, [warning])

  // 切笔记时旧文档的提醒不该跟过来
  useEffect(() => {
    setWarning('')
  }, [activeNote?.id])

  const handleModeChange = (next: EditorMode) => {
    setMode(next)
    persistEditorMode(next)
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-panel text-slate-400">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
          正在载入文档...
        </div>
      </div>
    )
  }

  if (!activeNote) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-panel text-slate-400 text-xs font-medium">
        暂无选中的笔记，请在左侧新建或选择笔记
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="w-full h-full min-h-0 flex flex-col bg-white dark:bg-dark-panel overflow-hidden relative select-none"
    >
      {/* 顶部模式条：左显示当前文档名（列表滚动后仍能确认在编辑哪一篇），右为内核切换 */}
      <div className="flex-shrink-0 h-9 px-3 flex items-center justify-between gap-3 border-b border-slate-200/80 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/30">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {activeNote.title || '未命名文档'}
        </span>
        <EditorModeSwitch value={mode} onChange={handleModeChange} />
      </div>

      {/* 兼容性提醒条：只在切进 Vditor 且文档含 Cherry 专有语法时出现 */}
      {warning && (
        <div className="flex-shrink-0 flex items-start gap-2 px-3 py-2 border-b border-amber-200/70 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/10 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <TriangleAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span className="min-w-0 flex-1">{warning}</span>
          <button
            type="button"
            onClick={() => setWarning('')}
            title="关闭提醒"
            className="flex-shrink-0 p-0.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-500/20 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 编辑器主体：两种内核共享同一份 activeNote.content */}
      {mode === 'cherry' ? (
        <CherryMarkdownEditor
          key={activeNote.id}
          value={activeNote.content}
          onChange={handleContentChange}
          title={activeNote.title}
        />
      ) : (
        <VditorMarkdownEditor
          key={activeNote.id}
          value={activeNote.content}
          onChange={handleContentChange}
          mode={mode}
          onWarning={setWarning}
        />
      )}

      {/* 右下角悬浮区：返回顶部（滚动后才出现）+ 保存状态与字数微胶囊，两者同排底部对齐 */}
      <div className="absolute bottom-3 right-6 z-20 flex items-end gap-2 pointer-events-none">
        {showBackToTop && (
          <Tooltip content="返回顶部">
            <button
              type="button"
              onClick={handleBackToTop}
              aria-label="返回顶部"
              className="pointer-events-auto flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/40 dark:bg-dark-panel/40 hover:bg-white/90 dark:hover:bg-dark-panel/90 backdrop-blur-md border border-slate-200/50 dark:border-dark-border/50 text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-indigo-400 shadow-2xs hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-1"
            >
              <ArrowUpToLine className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}

        <div className="pointer-events-auto group">
          {/* 淡淡悬浮在内容背景上的字数与多维统计微胶囊 */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/40 dark:bg-dark-panel/40 hover:bg-white/90 dark:hover:bg-dark-panel/90 backdrop-blur-md border border-slate-200/50 dark:border-dark-border/50 text-[11px] font-mono text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 shadow-2xs hover:shadow-md transition-all duration-300 opacity-80 hover:opacity-100 cursor-default">
            {/* 保存状态：实色 + 彩色圆点，比后面的字数更抓眼 */}
            <span
              className={`flex items-center gap-1 font-sans font-semibold ${
                saveStatus === 'saving'
                  ? 'text-amber-600 dark:text-amber-400'
                  : saveStatus === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  saveStatus === 'saving'
                    ? 'bg-amber-500 animate-ping'
                    : saveStatus === 'error'
                      ? 'bg-rose-500'
                      : 'bg-emerald-500'
                }`}
              />
              {saveMessage}
            </span>
            <span className="text-slate-300 dark:text-dark-border">·</span>
            <span>{stats.totalWords.toLocaleString()} 字</span>
            <span className="text-slate-300 dark:text-dark-border">·</span>
            <span>{stats.totalLines.toLocaleString()} 行</span>
            <span className="text-slate-300 dark:text-dark-border">·</span>
            <span>约 {stats.readingTime} 分钟</span>
          </div>

          {/* 鼠标移入浮现详尽统计浮窗 */}
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:flex flex-col gap-1.5 p-3 rounded-2xl bg-white/95 dark:bg-dark-panel/95 backdrop-blur-xl border border-slate-200/80 dark:border-dark-border shadow-xl text-[11px] font-mono text-slate-600 dark:text-slate-300 min-w-[170px] animate-in fade-in duration-150 z-30">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 border-b border-slate-100 dark:border-dark-border pb-1.5">
              文档数据统计
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">中文字数</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{stats.chineseChars}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">英文词数</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{stats.englishWords}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">总字符数</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{stats.totalChars}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">总行数</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{stats.totalLines}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 dark:border-dark-border pt-1.5 mt-0.5 text-brand-600 dark:text-indigo-400">
              <span>预估用时</span>
              <span>{stats.readingTime} 分钟阅读</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


