import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Loader2, Sparkles, X } from 'lucide-react'
import {
  cancelAiReview,
  closeAiReview,
  subscribeAiReview,
  type AiReviewReady,
  type AiReviewState,
} from '../../../utils/aiReview'
import Tooltip from '../../ui/Tooltip'
import { useToast } from '../../ui/Toast'

export type AiReviewPanelProps = {
  /** 当前笔记 id；结果不属于这篇时自动丢弃 */
  noteId: string
  /** 用户点「插入」时把内容写回文档；返回 false 表示选区已失效 */
  onInsert: (draft: AiReviewReady) => boolean
}

/** 生成中每秒刷新一次，用来显示已等待多久 */
function useElapsed(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active || startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt, active])
  return startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/**
 * AI 改写结果窗口：固定在右下角，可收起。
 *
 * 任务开始就弹出来，流式显示生成过程；生成完切成「原文 / AI 结果」对比，
 * 用户点「替换原文」才真正写进文档 —— 不点就一直不动原文。
 */
export default function AiReviewPanel({ noteId, onInsert }: AiReviewPanelProps) {
  const [state, setState] = useState<AiReviewState>({ status: 'idle' })
  const [collapsed, setCollapsed] = useState(false)
  const resultRef = useRef<HTMLPreElement>(null)
  const { showToast } = useToast()

  useEffect(() => subscribeAiReview(setState), [])

  const task = state.status === 'idle' ? null : state.task
  const belongsHere = task?.noteId === noteId
  const elapsed = useElapsed(task?.startedAt ?? null, state.status === 'running')

  // 切到别的笔记时，这批结果对新笔记没有意义
  useEffect(() => {
    if (task && !belongsHere) closeAiReview()
  }, [task, belongsHere])

  // 新任务开始时自动展开，别让用户错过
  useEffect(() => {
    if (state.status === 'running') setCollapsed(false)
  }, [state.status, task])

  // 流式输出时跟着滚到底部
  const streamed = state.status === 'running' ? state.streamed : ''
  useEffect(() => {
    const el = resultRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamed])

  if (!task || !belongsHere) return null

  const running = state.status === 'running'
  const ready = state.status === 'ready' ? state.task : null

  const copy = async () => {
    if (!ready) return
    try {
      await navigator.clipboard.writeText(ready.suggested)
      showToast('已复制 AI 结果')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const insert = () => {
    if (!ready) return
    if (!onInsert(ready)) {
      showToast('选区已失效，请重新选中后再试一次', 'error')
      return
    }
    closeAiReview()
    showToast(`已${ready.mode === 'replace' ? '替换' : '插入'}${ready.actionLabel}结果`)
  }

  // 收起态：只留一条细条，仍能看到状态
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[75] flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-xl transition-colors hover:bg-slate-50 dark:border-dark-border dark:bg-dark-panel dark:hover:bg-dark-hover"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600 dark:text-brand-400" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
        )}
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
          {running ? `正在${task.actionLabel}…` : `AI ${task.actionLabel}`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[75] flex h-[min(70vh,560px)] w-[420px] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xl dark:border-dark-border dark:bg-dark-panel">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-dark-border">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-brand-600 dark:text-brand-400" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-brand-600 dark:text-brand-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
          {running ? `正在${task.actionLabel}…` : `AI ${task.actionLabel}`}
        </span>
        <span className="text-[10px] tabular-nums text-slate-400">
          {running ? `${elapsed}s` : `${ready?.elapsedMs ?? 0} ms`}
        </span>
        <Tooltip content="收起">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover dark:hover:text-slate-200"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={running ? '取消生成' : '关闭，丢弃结果'}>
          <button
            type="button"
            onClick={running ? cancelAiReview : closeAiReview}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <section className="flex min-h-0 flex-[0.8] flex-col">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            原文
          </p>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200/80 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 select-text dark:border-dark-border dark:bg-dark-bg dark:text-slate-300">
            {task.original}
          </pre>
        </section>

        <section className="flex min-h-0 flex-[1.2] flex-col">
          <p
            className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
              running ? 'text-brand-600 dark:text-brand-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            AI 结果
            {running && streamed && (
              <span className="font-normal normal-case tracking-normal text-slate-400">
                生成中…
              </span>
            )}
          </p>
          <pre
            ref={resultRef}
            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-200/80 bg-white p-2 text-[11px] leading-relaxed text-slate-800 select-text dark:border-emerald-500/30 dark:bg-dark-bg dark:text-slate-100"
          >
            {running ? (
              streamed ? (
                // 光标跟着流式文本走，让人一眼看出还在生成
                <>
                  {streamed}
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-brand-500 align-middle" />
                </>
              ) : (
                <span className="text-slate-400">等待模型响应…</span>
              )
            ) : (
              (ready?.suggested ?? '')
            )}
          </pre>
        </section>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 border-t border-slate-200/80 px-3 py-2 dark:border-dark-border">
        {running ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
              {streamed ? '正在边生成边显示，原文不会动' : '原文保持原样，不会自动改写'}
            </span>
            <button
              type="button"
              onClick={cancelAiReview}
              className="rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-dark-border dark:bg-dark-panel dark:text-slate-300 dark:hover:bg-dark-hover"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <Tooltip content="复制 AI 结果">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-dark-border dark:bg-dark-panel dark:text-slate-300 dark:hover:bg-dark-hover"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
            </Tooltip>
            <div className="flex-1" />
            <button
              type="button"
              onClick={closeAiReview}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-dark-hover"
            >
              丢弃
            </button>
            <button
              type="button"
              onClick={insert}
              className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs shadow-brand-500/20 transition-all hover:bg-brand-700 active:scale-[0.98]"
            >
              <Check className="h-3 w-3" />
              {task.mode === 'replace' ? '替换原文' : '插入'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
