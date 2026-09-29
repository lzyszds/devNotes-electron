import { useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { usePresence } from '../../../hooks/usePresence'

export type BookmarkNoteDialogProps = {
  /** 待确认的信息；为 null 表示关闭 */
  draft: { heading: string; percent: number } | null
  /** 确认：带上备注（可能为空串） */
  onConfirm: (note: string) => void
  /** 取消：什么都不做 */
  onCancel: () => void
}

/**
 * 记书签时补一句备注的小弹窗。
 *
 * 不用 `window.prompt`：Electron 的渲染进程没有实现它（`alert` / `confirm` 有，
 * 唯独 `prompt` 会直接抛异常），用了就是「点一下按钮什么都没发生、控制台报错」。
 * 自己画一个还能顺带把「记在哪一节、读到百分之几」摆出来。
 */
export default function BookmarkNoteDialog({
  draft,
  onConfirm,
  onCancel,
}: BookmarkNoteDialogProps) {
  const { mounted, state } = usePresence(Boolean(draft), 130)
  const [note, setNote] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次打开都从空白开始，不带上一次输入的内容
  useEffect(() => {
    if (!draft) return
    setNote('')
    // 等挂载完成再聚焦，否则 ref 还是 null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [draft])

  // 收起期间 draft 已经置空，内容却还要留一会儿播退出动画 —— 留住最后一份快照
  const lastDraftRef = useRef<BookmarkNoteDialogProps['draft']>(null)
  if (draft) lastDraftRef.current = draft
  const shown = draft ?? lastDraftRef.current
  if (!mounted || !shown) return null

  const submit = () => onConfirm(note.trim())

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={onCancel}
    >
      <div
        data-state={state}
        onMouseDown={(event) => event.stopPropagation()}
        className="fe-pop w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl dark:border-dark-border dark:bg-dark-panel"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
            <Bookmark className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
              记下当前位置
            </div>
            <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
              {shown.heading} · 读到 {shown.percent}%
            </div>
          </div>
        </div>

        <input
          ref={inputRef}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onCancel()
          }}
          maxLength={200}
          placeholder="写一句备注，方便以后认出来（可留空）"
          className="mt-3 h-9 w-full rounded-[10px] border border-slate-200/80 bg-slate-50 px-3 text-[13px] text-slate-800 outline-none transition-all placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10 dark:border-dark-border dark:bg-dark-hover dark:text-slate-100"
        />

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-8 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-700"
          >
            记下
          </button>
        </div>
      </div>
    </div>
  )
}
