/*
 * 截图 / 待翻译文字 → 翻译页 的唯一入口（单向总线）。
 *
 * 设计原则：**只留一条路，不留任何靠时序碰运气的补丁。**
 *
 * 之前的版本叠了好几套机制（ocrBus 压住重试、主进程推 + 渲染层拉、队列 +
 * 事件通知），每加一层都要处理好和其它层的先后关系，结果就是「有时能用、
 * 有时要等很久」—— 本质是竞态，不是功能缺失。
 *
 * 现在的规则只有三条：
 *   1. 结果只落在**一个**地方：本模块的 FIFO 队列（`pending`）。
 *   2. 入队时同步通知「有活」，订阅方（App 根部）负责切到翻译页。
 *   3. 翻译页挂载后自己来取（`takeTranslateRequest`），取完即删；
 *      挂载前入队的东西不会丢，因为它一直在队列里。
 *
 * 不做「没有订阅者就先压着、等订阅了再补发」那一套 —— 那是上一次 bug 的产物。
 */

import { dlog } from './debugLog'

/** 交给翻译页的一件事：要么是一张待识别的截图，要么是一段待翻译的文字 */
export type TranslateRequest =
  | { kind: 'ocr'; dataUrl: string }
  | { kind: 'text'; text: string; targetLang?: string }

function keyOf(request: TranslateRequest): string {
  return request.kind === 'ocr' ? `ocr:${request.dataUrl}` : `text:${request.text}`
}

/**
 * 待处理的活。
 *
 * 用 Map 而不是数组：既保住顺序（Map 保持插入序），又天然去重 ——
 * 同一张图被推两次（比如 ready 补推与正常推送撞在一起）时只算一件。
 * 上限 4：再多说明用户根本没在看，留最新的几件就够。
 */
const MAX_PENDING = 4
const pending = new Map<string, TranslateRequest>()

type Listener = () => void
const listeners = new Set<Listener>()

/** 有活进来时通知（订阅方据此切到翻译页） */
export function subscribeTranslateInbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 把活放进收件箱。重复内容不会重复入队。 */
export function pushTranslateRequest(request: TranslateRequest): void {
  if (request.kind === 'text' && !request.text.trim()) return
  const key = keyOf(request)
  if (pending.has(key)) return
  pending.set(key, request)
  // 超出上限：先丢最旧的
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) break
    pending.delete(oldest)
  }
  dlog('[inbox] 入队', request.kind, '待处理', pending.size, '订阅者', listeners.size)
  listeners.forEach((listener) => listener())
}

/**
 * 翻译页取一件活；没有就返回 null。
 *
 * 挂载时调一次、之后再靠订阅 TranslateInbox 的「有新活」信号调 ——
 * 两条路径都只是「从这里取」，不存在谁先谁后的问题。
 */
export function takeTranslateRequest(): TranslateRequest | null {
  const first = pending.entries().next()
  if (first.done) return null
  const [key, request] = first.value
  pending.delete(key)
  dlog('[inbox] 取出', request.kind, '剩余', pending.size)
  return request
}

/** 收件箱里还有几件（调试 / 自测用） */
export function pendingCount(): number {
  return pending.size
}
