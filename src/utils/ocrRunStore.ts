/**
 * 截图识别的运行状态（进度 / 阶段 / 耗时 / 结果）。
 *
 * 为什么放在模块级、而不是翻译页组件的 state 里：
 *
 * 翻译页是 Keep-Alive 的，但**它仍然会因为各种原因重挂**（visited 列表变化、
 * Suspense 重试、StrictMode 下 effect 跑两遍……）。实测日志里出现过
 * 「开始识别 → 1ms 后组件卸载 → 重新挂载」，识别结果写进了已经消失的那个
 * 实例，界面上就表现为「识别过程中什么都不显示，识别完才冒出来」。
 *
 * 识别是一次跨秒级的异步任务，它的状态不该绑在某个 React 实例的寿命上。
 * 所以：
 *   - 状态存在这里，组件通过 useSyncExternalStore 订阅；
 *   - 发起识别、写结果也在这些函数里完成，组件只负责触发与展示；
 *   - **每次状态变化都换一个新对象**，snapshot 本身也是整体替换 ——
 *     useSyncExternalStore 靠引用相等判断要不要重渲染，原地改字段它看不见。
 *
 * 「要不要显示进度屏」只由 `beginOcrRun / finishOcrRun / failOcrRun / 收摊`
 * 这四个时刻决定。中间那些进度更新一律不改变显示与否，只改变显示的内容 ——
 * 这样翻页只会在识别开始和识别结束（再停留 2.4s）各发生一次，不会因为
 * 引擎重复上报 p=0 或阶段名又被打回去。
 */

import { OCR_STAGE_LABELS, type OcrProgress, type OcrStage } from './ocr'
import { dlog } from './debugLog'

export interface OcrRunState {
  status: 'recognizing' | 'done'
  /** 当前阶段的进度 0~1 */
  progress: number
  /** 阶段名，界面据此取文案 */
  stage: OcrStage
  /** 该阶段在整条进度里的相对权重（主进程给的） */
  weight?: number
  /** 本次识别已耗时（ms）；完成态下是总耗时 */
  elapsedMs?: number
  /** 本轮识别的起始时刻（performance.now）—— 耗时由展示层逐帧自己算 */
  startedAt: number
}

/** 识别完成后的结果，交给翻译页填进输入框 */
export interface OcrResult {
  text: string
  /** 这次识别总共花了多久 */
  elapsedMs: number
}

interface Snapshot {
  run: OcrRunState | null
  /** 最近一次完成的结果；被消费后置空 */
  result: OcrResult | null
}

const EMPTY: Snapshot = { run: null, result: null }

let snapshot: Snapshot = EMPTY
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

/** 整体替换 snapshot 并通知订阅者；所有写入口都走这里 */
function commit(next: Snapshot): void {
  snapshot = next
  emit()
}

export function subscribeOcrRun(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getOcrSnapshot(): Snapshot {
  return snapshot
}

/** 当前正在跑的那一轮序号：过期的识别结果据此丢弃 */
let currentSeq = 0
/** 完成后退场计时器 */
let settleTimer: ReturnType<typeof setTimeout> | null = null

/** 识别完成后进度屏停留多久再翻回工具栏（ms） */
export const OCR_DONE_HOLD_MS = 2400

/** 开始一轮识别，返回本轮序号 */
export function beginOcrRun(): number {
  currentSeq += 1
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  commit({
    run: { status: 'recognizing', progress: 0, stage: 'engine', elapsedMs: 0, startedAt: performance.now() },
    result: snapshot.result,
  })
  dlog('[ocrRun] 开始 seq', currentSeq)
  return currentSeq
}

/** 这一轮还算不算最新（用户可能已经又截了一张） */
export function isCurrentOcrRun(seq: number): boolean {
  return seq === currentSeq
}

/**
 * 主进程推来的阶段进度。
 *
 * 只更新「进度屏里显示什么」，不碰翻页状态：跑的期间 progress 一直不为 0，
 * 界面就一直停在进度屏上。engine 阶段重复上报 p=0 属于正常现象（引擎分段
 * 加载），这里原样记下，不做任何「看起来像新的一轮」的特殊处理。
 */
export function updateOcrProgress(seq: number, progress: OcrProgress): void {
  if (!isCurrentOcrRun(seq)) return
  const run = snapshot.run
  if (!run || run.status !== 'recognizing') return
  commit({
    ...snapshot,
    run: {
      status: 'recognizing',
      progress: progress.progress,
      stage: progress.stage ?? 'recognize',
      weight: progress.weight,
      elapsedMs: progress.elapsedMs ?? Math.round(performance.now() - run.startedAt),
      startedAt: run.startedAt,
    },
  })
}

/** 识别成功：状态置为完成，并把结果放进 result 等组件消费 */
export function finishOcrRun(seq: number, text: string): void {
  if (!isCurrentOcrRun(seq)) return
  const elapsedMs = Math.round(performance.now() - (snapshot.run?.startedAt ?? performance.now()))
  commit({
    run: { status: 'done', progress: 1, stage: 'recognize', elapsedMs, startedAt: snapshot.run?.startedAt ?? performance.now() },
    result: { text, elapsedMs },
  })
  dlog('[ocrRun] 完成 seq', seq, '耗时', elapsedMs, 'ms')

  // 停留一段时间后自动收摊（进度屏翻回工具栏）。计时器放在这里，
  // 组件重挂不会打断它，也不会出现两个计时器打架。
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    if (!isCurrentOcrRun(seq)) return
    commit({ run: null, result: snapshot.result })
    dlog('[ocrRun] 收摊 seq', seq)
  }, OCR_DONE_HOLD_MS)
}

/** 识别失败或没识别出东西：直接收摊 */
export function failOcrRun(seq: number): void {
  if (!isCurrentOcrRun(seq)) return
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  commit({ run: null, result: null })
  dlog('[ocrRun] 失败收摊 seq', seq)
}

/** 取走识别结果（组件消费一次后清空，避免重复填进输入框） */
export function takeOcrResult(): OcrResult | null {
  const result = snapshot.result
  if (!result) return null
  snapshot = { ...snapshot, result: null }
  return result
}

/** 阶段文案（组件与测试共用） */
export function describeOcrStage(stage: OcrStage): string {
  return OCR_STAGE_LABELS[stage] ?? '识别文字'
}
