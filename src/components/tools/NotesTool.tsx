import { useMemo } from 'react'
import { useNotes } from '../../context/NotesContext'
import CherryMarkdownEditor from './CherryMarkdownEditor'
import { Loader2 } from 'lucide-react'
import { computeDocStats } from '../../utils/markdownStats'

export default function NotesTool() {
  const { ready, activeNote, handleContentChange } = useNotes()

  const content = activeNote?.content || ''

  // 实时精细化统计（与右键菜单的「当前文档信息」共用同一套口径）
  const stats = useMemo(() => computeDocStats(content), [content])

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
    <div className="w-full h-full min-h-0 flex flex-col bg-white dark:bg-dark-panel overflow-hidden relative select-none">
      {/* Cherry Markdown 编辑器主体 */}
      <CherryMarkdownEditor
        key={activeNote.id}
        value={activeNote.content}
        onChange={handleContentChange}
        title={activeNote.title}
      />

      {/* 淡淡悬浮在右下角内容背景上的字数与多维统计微胶囊 */}
      <div className="absolute bottom-3 right-6 z-20 pointer-events-auto group">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/40 dark:bg-dark-panel/40 hover:bg-white/90 dark:hover:bg-dark-panel/90 backdrop-blur-md border border-slate-200/50 dark:border-dark-border/50 text-[11px] font-mono text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 shadow-2xs hover:shadow-md transition-all duration-300 opacity-40 hover:opacity-100 cursor-default">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
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
  )
}


