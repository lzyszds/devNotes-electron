import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Bold,
  Italic,
  Code,
  Heading,
  List,
  Quote,
  Table,
  GitMerge,
  Loader2,
  FileCode2,
  ArrowLeft,
} from 'lucide-react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import { useNotes } from '../../context/NotesContext'
import CherryMarkdownEditor from './CherryMarkdownEditor'

// 配置 marked 选项
marked.setOptions({
  gfm: true,
  breaks: true,
})

export default function ModernMarkdownWorkbench() {
  const {
    ready,
    activeNote,
    handleContentChange,
    viewMode,
    setViewMode,
    splitPercent,
    setSplitPercent,
    statusCounter,
    setStatusCounter,
    registerInsertHandler,
  } = useNotes()

  const [useCherry, setUseCherry] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const renderTimerRef = useRef<number | null>(null)

  // 初始化 Mermaid
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'Inter, sans-serif',
    })
  }, [])

  // 格式化文本插入辅助函数
  const insertFormat = useCallback(
    (prefix: string, suffix = '') => {
      const textarea = textareaRef.current
      if (!textarea || !activeNote) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = textarea.value
      const selected = text.substring(start, end)
      const replacement = prefix + selected + suffix
      const newContent = text.substring(0, start) + replacement + text.substring(end)

      handleContentChange(newContent)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + prefix.length, end + prefix.length)
      }, 0)
    },
    [activeNote, handleContentChange]
  )

  // 注册全局/外部快捷插入
  useEffect(() => {
    registerInsertHandler(insertFormat)
  }, [insertFormat, registerInsertHandler])

  // 插入 Mermaid 示例
  const insertMermaidDemo = () => {
    const demo = `\n\`\`\`mermaid\nsequenceDiagram\n    autonumber\n    A->>B: 发送数据请求\n    B-->>A: 返回处理结果\n\`\`\`\n`
    insertFormat(demo, '')
  }

  // 实时编译 Marked + Mermaid
  const compileMarkdown = useCallback((rawText: string) => {
    if (!previewRef.current) return

    // 统计字数与行数
    const words = rawText.trim().length
    const lines = rawText ? rawText.split('\n').length : 0
    setStatusCounter({ words, lines })

    if (renderTimerRef.current) {
      window.clearTimeout(renderTimerRef.current)
    }

    renderTimerRef.current = window.setTimeout(async () => {
      if (!previewRef.current) return

      try {
        const parsed = await marked.parse(rawText)
        previewRef.current.innerHTML = parsed

        // 识别 ```mermaid 代码块并转化为渲染容器
        const codeBlocks = previewRef.current.querySelectorAll('pre code.language-mermaid')
        codeBlocks.forEach((codeEl) => {
          const pre = codeEl.parentElement
          if (!pre || !pre.parentNode) return

          const mermaidContainer = document.createElement('div')
          mermaidContainer.className =
            'mermaid my-4 flex justify-center bg-white dark:bg-dark-panel p-4 rounded-xl border border-slate-200/80 dark:border-dark-border shadow-2xs overflow-x-auto'
          mermaidContainer.textContent = codeEl.textContent || ''
          pre.parentNode.replaceChild(mermaidContainer, pre)
        })

        // 运行 Mermaid 渲染引擎
        const isDark = document.documentElement.classList.contains('dark')
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'Inter, sans-serif',
        })

        const nodes = previewRef.current.querySelectorAll<HTMLElement>('.mermaid')
        if (nodes.length > 0) {
          await mermaid.run({ nodes })
        }
      } catch {
        // 容错处理（语法未完全闭合时）
      }
    }, 200)
  }, [setStatusCounter])

  // 当当前文档内容变更时触发实时渲染
  useEffect(() => {
    if (activeNote) {
      compileMarkdown(activeNote.content)
    }
  }, [activeNote, compileMarkdown])

  // 自由拖拽中线分割条
  const handleMouseDown = () => {
    isDraggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - rect.left
      const pct = (newWidth / rect.width) * 100
      if (pct >= 20 && pct <= 80) {
        setSplitPercent(pct)
      }
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = 'default'
      document.body.style.userSelect = 'auto'
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

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

  if (useCherry) {
    return (
      <div className="flex-1 flex flex-col bg-white dark:bg-dark-panel overflow-hidden h-full relative select-none">
        {/* Cherry 模式顶栏导航 */}
        <div className="h-8 border-b border-slate-200/80 dark:border-dark-border px-3 flex items-center justify-between bg-slate-50 dark:bg-dark-sidebar z-20 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="w-2 h-2 rounded-full bg-brand-500" />
            <span>Cherry Markdown 模式</span>
          </div>
          <button
            onClick={() => setUseCherry(false)}
            className="flex items-center gap-1 px-2.5 py-0.5 bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 shadow-2xs transition-all hover:bg-slate-50"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>返回现代工作台</span>
          </button>
        </div>

        {/* Cherry 编辑器独占剩余全部空间 */}
        <div className="flex-1 min-h-0 h-full overflow-hidden relative">
          <CherryMarkdownEditor
            key={activeNote.id}
            value={activeNote.content}
            onChange={handleContentChange}
            // NotesContext 的 ViewMode 用 'code' 表示纯编辑，编辑器外壳用 'edit'，这里对一下
            viewMode={viewMode === 'code' ? 'edit' : viewMode}
            onViewModeChange={(next) => setViewMode(next === 'edit' ? 'code' : next)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-dark-panel overflow-hidden h-full select-none">
      {/* Markdown 快捷操作工具条 */}
      <div className="h-10 border-b border-slate-200/80 dark:border-dark-border px-4 flex items-center justify-between bg-white dark:bg-dark-panel z-10 flex-shrink-0 overflow-x-auto scrollbar-hide flex-nowrap gap-4">
        {/* 左侧排版动作快捷键 */}
        <div className="flex items-center gap-0.5 text-slate-600 dark:text-slate-400 flex-shrink-0">
          <button
            onClick={() => insertFormat('**', '**')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="加粗"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertFormat('*', '*')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="斜体"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertFormat('`', '`')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="行内代码"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-dark-border mx-1" />
          <button
            onClick={() => insertFormat('## ', '')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="标题"
          >
            <Heading className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertFormat('- ', '')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="无序列表"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => insertFormat('> ', '')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="引用"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() =>
              insertFormat('| 标题1 | 标题2 |\n| --- | --- |\n| 内容1 | 内容2 |\n', '')
            }
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover hover:text-slate-900 dark:hover:text-white transition-colors"
            title="插入表格"
          >
            <Table className="w-3.5 h-3.5" />
          </button>
          <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-dark-border mx-1" />
          <button
            onClick={insertMermaidDemo}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/10 hover:bg-brand-100 dark:hover:bg-brand-500/20 font-medium transition-colors"
            title="插入 Mermaid 时序图示例"
          >
            <GitMerge className="w-3.5 h-3.5" /> 插入 Mermaid 时序图
          </button>
        </div>

        {/* 右侧字数统计与视图切换 */}
        <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
          <span className="font-mono text-[11px]">
            {statusCounter.words} 字 · {statusCounter.lines} 行
          </span>

          <button
            onClick={() => setUseCherry(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] transition-colors border text-slate-500 dark:text-slate-400 border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover"
            title="切换到 Cherry Markdown 模式"
          >
            <FileCode2 className="w-3 h-3" />
            <span>Cherry 模式</span>
          </button>

          <div className="flex items-center bg-slate-100 dark:bg-dark-hover p-0.5 rounded-lg border border-slate-200/50 dark:border-dark-border">
            <button
              onClick={() => setViewMode('code')}
              className={`px-2 py-0.5 rounded-md transition-all ${
                viewMode === 'code'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs font-semibold text-slate-900 dark:text-white'
                  : 'hover:text-slate-700 dark:hover:text-white'
              }`}
            >
              代码
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-0.5 rounded-md transition-all ${
                viewMode === 'split'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs font-semibold text-slate-900 dark:text-white'
                  : 'hover:text-slate-700 dark:hover:text-white'
              }`}
            >
              双栏
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2 py-0.5 rounded-md transition-all ${
                viewMode === 'preview'
                  ? 'bg-white dark:bg-dark-panel shadow-2xs font-semibold text-slate-900 dark:text-white'
                  : 'hover:text-slate-700 dark:hover:text-white'
              }`}
            >
              预览
            </button>
          </div>
        </div>
      </div>

      {/* 主体工作台内容 */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
          {/* 左半部：纯文本 Markdown 输入框 */}
          <div
            style={{
              width: viewMode === 'code' ? '100%' : viewMode === 'preview' ? '0%' : `${splitPercent}%`,
              display: viewMode === 'preview' ? 'none' : 'flex',
            }}
            className="h-full flex-col bg-white dark:bg-dark-bg overflow-hidden border-r border-slate-200 dark:border-dark-border"
          >
            <textarea
              ref={textareaRef}
              value={activeNote.content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full h-full p-6 outline-none bg-transparent resize-none font-mono text-xs leading-6 text-slate-800 dark:text-slate-200 select-text"
              placeholder="在此输入 Markdown 内容，支持直接书写 Mermaid 图表..."
              spellCheck="false"
            />
          </div>

          {/* 自由拖拽中线 (Draggable Resizer) */}
          {viewMode === 'split' && (
            <div
              onMouseDown={handleMouseDown}
              className="w-[5px] hover:w-[7px] bg-slate-200 dark:bg-dark-border hover:bg-brand-500 dark:hover:bg-brand-500 cursor-col-resize transition-all duration-150 relative z-20 flex items-center justify-center group flex-shrink-0"
              title="按住拖动调整分栏比例"
            >
              <div className="w-[1px] h-6 bg-slate-400 group-hover:bg-white rounded-full pointer-events-none" />
            </div>
          )}

          {/* 右半部：实时 Markdown + Mermaid 渲染预览区 */}
          <div
            style={{
              display: viewMode === 'code' ? 'none' : 'block',
            }}
            className="flex-1 h-full overflow-y-auto bg-slate-50/50 dark:bg-dark-sidebar p-8 relative"
          >
            {viewMode === 'preview' && (
              <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-dark-border">
                <button
                  onClick={() => setViewMode('split')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-300 dark:hover:border-brand-500/30 shadow-2xs transition-all hover:bg-brand-50/50 dark:hover:bg-dark-hover"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回编辑</span>
                </button>
                <span className="text-xs text-slate-400">当前处于纯净预览模式</span>
              </div>
            )}
            <div
              ref={previewRef}
              className="max-w-3xl mx-auto markdown-body select-text text-slate-800 dark:text-slate-200"
            />
          </div>
        </div>
    </div>
  )
}
