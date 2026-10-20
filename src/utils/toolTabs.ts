import { useSyncExternalStore } from 'react'

/*
 * 工具标签：记录「打开过的工具」，顺序即标签顺序，持久化到 localStorage。
 * 这里只存工具 id，不缓存工具内部的表单内容。
 *
 * 「工作中」状态是另一张表：工具在做耗时任务时调用 setToolBusy(id, true)，
 * 标签上就会亮绿点。它不落盘，重启后自然清空。
 */

const STORAGE_KEY = 'devnotes-tool-tabs'
const MAX_TABS = 20
const DEFAULT_TABS = ['markdown-notes']

interface TabState {
  tabs: string[]
  busy: ReadonlySet<string>
}

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((id): id is string => typeof id === 'string')
      if (ids.length > 0) return ids
    }
  } catch {
    // 存的内容坏了就退回默认，不影响启动
  }
  return DEFAULT_TABS
}

let state: TabState = { tabs: load(), busy: new Set() }
const listeners = new Set<() => void>()

function commit(next: TabState) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.tabs))
  } catch {
    // 存储满了也不该影响标签本身
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 确保某个工具在标签里（已存在则不动顺序） */
export function openToolTab(id: string) {
  if (state.tabs.includes(id)) return
  const tabs = [...state.tabs, id].slice(-MAX_TABS)
  commit({ ...state, tabs })
}

export function closeToolTab(id: string) {
  if (!state.tabs.includes(id)) return
  const busy = new Set(state.busy)
  busy.delete(id)
  commit({ tabs: state.tabs.filter((tab) => tab !== id), busy })
}

/** 只保留给定的这些标签，其余全部关闭（顺序保持不变） */
export function keepToolTabs(ids: string[]) {
  const keep = new Set(ids)
  const busy = new Set([...state.busy].filter((id) => keep.has(id)))
  commit({ tabs: state.tabs.filter((id) => keep.has(id)), busy })
}

export function setToolBusy(id: string, isBusy: boolean) {
  if (state.busy.has(id) === isBusy) return
  const busy = new Set(state.busy)
  if (isBusy) busy.add(id)
  else busy.delete(id)
  commit({ ...state, busy })
}

export function useToolTabs(): TabState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}
