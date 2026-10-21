/*
 * 「打开某个工具的某个模式」的请求。
 *
 * 搜索面板里点「编码转换 · Unicode」这类结果时，工具可能还没挂载，也可能已经开着。
 * 请求先存在这里，工具挂载时取走一次；已经开着的工具订阅变化，直接切换。
 * 取走即删除，所以之后再打开工具不会被旧请求覆盖。
 */

export interface ModeRequest {
  mode: string
  /** 每次请求都是新对象，供 React effect 依赖判断 */
  nonce: number
}

const pending = new Map<string, ModeRequest>()
const listeners = new Set<() => void>()
let counter = 0

export function requestToolMode(toolId: string, mode: string) {
  counter += 1
  pending.set(toolId, { mode, nonce: counter })
  listeners.forEach((listener) => listener())
}

export function takeToolMode(toolId: string): ModeRequest | null {
  const request = pending.get(toolId) ?? null
  pending.delete(toolId)
  return request
}

export function subscribeToolMode(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
