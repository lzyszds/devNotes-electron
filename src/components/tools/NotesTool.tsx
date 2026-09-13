import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNotes } from '../../context/NotesContext'
import CherryMarkdownEditor from './CherryMarkdownEditor'
import MilkdownMarkdownEditor from './MilkdownMarkdownEditor'
import EditorModeSwitch, {
  persistEditorMode,
  readEditorMode,
  type EditorMode,
} from './EditorModeSwitch'
import MarkdownStatusBar from './markdown/MarkdownStatusBar'
import {
  persistViewMode,
  readViewMode,
  VIEW_MODE_LABEL,
  type EditorViewMode,
} from './markdown/ViewModeSwitch'
import { ArrowUpToLine, Loader2, TriangleAlert, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { computeDocStats } from '../../utils/markdownStats'

/** 滚动超过这个距离才值得把「返回顶部」露出来 */
const BACK_TO_TOP_THRESHOLD = 120

/** 底部状态栏左端显示当前用的是哪套内核 */
const ENGINE_LABEL: Record<EditorMode, string> = {
  cherry: 'Cherry 双栏',
  milkdown: 'Milkdown 所见即所得',
}

/** 所见即所得是无条件单栏内核，没有视图三态可言 */
const SINGLE_COLUMN_LABEL = '单栏内核'

export default function NotesTool() {
  const {
    ready,
    activeNote,
    handleContentChange,
    saveStatus,
    message: saveMessage,
  } = useNotes()
  const [mode, setMode] = useState<EditorMode>(readEditorMode)
  // 视图三态只有 Cherry 认，但状态放在这里 —— 底部状态栏要显示它
  const [viewMode, setViewMode] = useState<EditorViewMode>(readViewMode)
  const [warning, setWarning] = useState('')
  const [showBackToTop, setShowBackToTop] = useState(false)
  // 全屏由宿主统一实现，两个内核共用 —— Cherry 那边本质上只是加一个 fullscreen 类
  const [fullscreen, setFullscreen] = useState(false)

  // 编辑器外壳：两个内核各自把滚动容器放在内部，统一从这里往下找
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
  }, [mode, viewMode, activeNote?.id, ready])

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

  const handleViewModeChange = (next: EditorViewMode) => {
    setViewMode(next)
    persistViewMode(next)
  }

  const toggleFullscreen = useCallback(() => setFullscreen((prev) => !prev), [])

  // 全屏时按 Esc 退出。捕获阶段监听，免得被编辑器内部的 Esc（关浮层等）先吃掉
  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreen])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-panel text-slate-400">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-logo-500" />
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
      className={`w-full h-full min-h-0 flex flex-col bg-white dark:bg-dark-panel overflow-hidden relative select-none ${
        fullscreen ? 'fixed inset-0 z-50' : ''
      }`}
    >
      {/* 顶部文档条：左显示当前文档名（列表滚动后仍能确认在编辑哪一篇），右为内核切换 */}
      <div className="flex-shrink-0 h-9 px-3 flex items-center justify-between gap-3 border-b border-slate-200/80 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/30">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {activeNote.title || '未命名文档'}
        </span>
        <EditorModeSwitch value={mode} onChange={handleModeChange} />
      </div>

      {/* 兼容性提醒条：只在切进所见即所得、且文档含 Cherry 专有语法时出现 */}
      {warning && (
        <div className="flex-shrink-0 flex items-start gap-2 px-3 py-2 border-b border-amber-200/70 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/10 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <TriangleAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span className="min-w-0 flex-1">{warning}</span>
          <Tooltip content="关闭提醒">
            <button
              type="button"
              onClick={() => setWarning('')}
              className="flex-shrink-0 p-0.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-500/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* 编辑器主体：两个内核共享同一份 activeNote.content */}
      {mode === 'cherry' ? (
        <CherryMarkdownEditor
          key={activeNote.id}
          value={activeNote.content}
          onChange={handleContentChange}
          title={activeNote.title}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onToggleFullscreen={toggleFullscreen}
          className="flex-1"
        />
      ) : (
        <MilkdownMarkdownEditor
          key={activeNote.id}
          value={activeNote.content}
          onChange={handleContentChange}
          onWarning={setWarning}
          title={activeNote.title}
          onToggleFullscreen={toggleFullscreen}
          fullscreen={fullscreen}
          className="flex-1"
        />
      )}

      {/* 底部状态栏：保存状态 + 文档统计 + 当前内核/视图，原本是浮在右下角的胶囊 */}
      <MarkdownStatusBar
        stats={stats}
        engineLabel={ENGINE_LABEL[mode]}
        viewLabel={mode === 'cherry' ? VIEW_MODE_LABEL[viewMode] : SINGLE_COLUMN_LABEL}
        saveStatus={saveStatus}
        saveMessage={saveMessage}
      />

      {/* 右下角只留「返回顶部」，统计已挪到状态栏，避免同屏两处字数 */}
      {showBackToTop && (
        <div className="absolute bottom-10 right-6 z-20 pointer-events-none">
          <Tooltip content="返回顶部">
            <button
              type="button"
              onClick={handleBackToTop}
              aria-label="返回顶部"
              className="pointer-events-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-slate-200/60 bg-white/70 text-slate-400 shadow-xs backdrop-blur-md transition-all duration-200 hover:bg-white hover:text-brand-600 hover:shadow-md dark:border-dark-border/60 dark:bg-dark-panel/70 dark:text-slate-500 dark:hover:bg-dark-panel dark:hover:text-brand-400"
            >
              <ArrowUpToLine className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
