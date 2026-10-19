/*
 * AI 改写任务与结果的共享状态。
 *
 * 一次完整流程分两态：
 *  - running：点了动作、请求已发出，侧栏显示「正在润色…」，可取消
 *  - ready：结果回来了，侧栏并排展示「原文 / AI 结果」，由用户决定插入还是丢弃
 *
 * 浮条（SelectionToolbar）负责发起，笔记页的右侧栏负责展示，两边不在同一棵
 * React 子树里（浮条挂在 document.body 下），所以走这个小 store 而不是 Context。
 */

import type { NoteAiActionId } from './noteAi'

export interface AiReviewTask {
  /** 选中的原文 */
  original: string
  /** 哪个动作，用于标题与「追加/替换」的默认行为 */
  actionId: NoteAiActionId
  actionLabel: string
  /** 结果落回文档的方式 */
  mode: 'replace' | 'append'
  /** 归属的笔记，切到别的笔记时自动丢弃 */
  noteId: string
  /** 生成时记下的选区位置，用户点插入时据此恢复 */
  snapshot: { from: number; to: number } | null
  /** 发起时间，用来显示已等待秒数 */
  startedAt: number
  /** 用户点「取消」时置为 true，返回的结果会被丢弃 */
  cancelled: boolean
}

export interface AiReviewReady extends AiReviewTask {
  suggested: string
  elapsedMs: number
}

export type AiReviewState =
  | { status: 'idle' }
  /** 请求进行中；streamed 是已经收到的部分文本，用于边生成边显示 */
  | { status: 'running'; task: AiReviewTask; streamed: string }
  | { status: 'ready'; task: AiReviewReady }

type Listener = (state: AiReviewState) => void

let current: AiReviewState = { status: 'idle' }
const listeners = new Set<Listener>()

export function getAiReview(): AiReviewState {
  return current
}

export function subscribeAiReview(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(next: AiReviewState) {
  current = next
  listeners.forEach((listener) => listener(next))
}

/** 开始一次任务；返回的 task 对象由发起方继续持有，用于判断是否已取消 */
export function startAiReview(task: Omit<AiReviewTask, 'startedAt' | 'cancelled'>): AiReviewTask {
  const full: AiReviewTask = { ...task, startedAt: Date.now(), cancelled: false }
  publish({ status: 'running', task: full, streamed: '' })
  return full
}

/** 流式增量：把已经生成的部分推给侧栏，边写边看 */
export function updateAiReviewStream(task: AiReviewTask, streamed: string) {
  if (current.status !== 'running' || current.task !== task) return
  publish({ status: 'running', task, streamed })
}

/**
 * 请求成功，转入待确认。
 *
 * 传 task 校验是不是**同一个**任务：用户切过笔记（侧栏被关掉）或又发起了一次，
 * 迟到的结果就不该再把侧栏顶出来。
 */
export function finishAiReview(task: AiReviewTask, suggested: string, elapsedMs: number) {
  if (current.status !== 'running' || current.task !== task) return
  publish({ status: 'ready', task: { ...current.task, suggested, elapsedMs } })
}

/** 请求失败，撤回侧栏（同样只影响发起它的那个任务） */
export function failAiReview(task: AiReviewTask) {
  if (current.status === 'running' && current.task === task) publish({ status: 'idle' })
}

/** 取消：标记任务作废并收掉侧栏 */
export function cancelAiReview() {
  if (current.status === 'running') current.task.cancelled = true
  publish({ status: 'idle' })
}

export function closeAiReview() {
  publish({ status: 'idle' })
}

// ================= 应用请求 =================

/*
 * 侧栏点「插入」时发出，由编辑器接住并写回文档。
 *
 * 编辑器实例没有对外暴露（它是组件内部的），走事件比传 ref 侵入更小；
 * 同一时刻只有一个编辑器在挂载，不需要认领方。
 */
type ApplyListener = (draft: AiReviewReady) => boolean

let applyListener: ApplyListener | null = null

export function registerAiReviewApply(listener: ApplyListener): () => void {
  applyListener = listener
  return () => {
    if (applyListener === listener) applyListener = null
  }
}

/** 返回 false 表示没有编辑器接住（或选区已失效） */
export function applyAiReview(draft: AiReviewReady): boolean {
  return applyListener ? applyListener(draft) : false
}
