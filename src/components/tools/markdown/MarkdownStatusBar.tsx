import type { SaveStatus } from '../../../context/NotesContext'
import type { DocStats } from '../../../utils/markdownStats'

export type MarkdownStatusBarProps = {
  stats: DocStats
  /** 当前内核名，如「双栏（Cherry）」/「即时渲染」 */
  engineLabel: string
  /** 当前视图模式，如「双栏」/「单栏内核」 */
  viewLabel: string
  saveStatus: SaveStatus
  saveMessage: string
}

const SAVE_TONE: Record<SaveStatus, { text: string; dot: string }> = {
  saving: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500 animate-ping' },
  error: { text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' },
  saved: { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  idle: { text: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400' },
}

/**
 * 编辑器底部状态栏。
 *
 * 原先这部分是浮在编辑区右下角的胶囊 + hover 浮窗，会压住正文，
 * 而且和「返回顶部」挤在一起。改到底部固定一条，统计口径仍走 computeDocStats，
 * 与右键菜单的「当前文档信息」保持一致。
 */
export default function MarkdownStatusBar({
  stats,
  engineLabel,
  viewLabel,
  saveStatus,
  saveMessage,
}: MarkdownStatusBarProps) {
  const tone = SAVE_TONE[saveStatus]

  return (
    <div className="relative z-40 flex h-7 flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50/70 px-3 font-mono text-[11px] text-slate-400 dark:border-dark-border dark:bg-dark-hover/30 dark:text-slate-500">
      <div className="group relative flex min-w-0 items-center gap-2">
        <span className={`flex flex-shrink-0 items-center gap-1.5 font-sans font-semibold ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {saveMessage}
        </span>
        <span className="text-slate-300 dark:text-dark-border">·</span>
        <span className="truncate">
          {stats.totalWords.toLocaleString()} 字 · {stats.totalLines.toLocaleString()} 行 · 约{' '}
          {stats.readingTime} 分钟
        </span>

        {/* 悬停看明细。贴左端向上弹，不再占用编辑区右下角 */}
        <div className="absolute bottom-full left-0 mb-2 hidden flex-col gap-1.5 rounded-xl border border-slate-200/80 bg-white/95 p-3 text-[11px] font-mono text-slate-600 shadow-xl backdrop-blur-xl group-hover:flex dark:border-dark-border dark:bg-dark-panel/95 dark:text-slate-300 min-w-[176px]">
          <div className="mb-0.5 border-b border-slate-100 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-dark-border">
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
          <div className="mt-0.5 flex justify-between border-t border-slate-100 pt-1.5 text-brand-600 dark:border-dark-border dark:text-brand-400">
            <span>预估用时</span>
            <span>{stats.readingTime} 分钟阅读</span>
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 font-sans">
        <span className="text-slate-400 dark:text-slate-500">{engineLabel}</span>
        <span className="text-slate-300 dark:text-dark-border">·</span>
        <span className="text-slate-500 dark:text-slate-400">{viewLabel}</span>
      </div>
    </div>
  )
}
