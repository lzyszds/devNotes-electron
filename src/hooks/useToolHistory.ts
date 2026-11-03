import { useState, useEffect, useCallback, useRef } from 'react'

export interface HistoryItem<T = any> {
  id: string
  timestamp: number
  data: T
  title?: string
}

export function useToolHistory<T>(toolId: string, maxItems = 50) {
  const [history, setHistory] = useState<HistoryItem<T>[]>([])

  /*
   * 历史列表的最新值放 ref：saveHistory / removeHistoryItem 的身份必须稳定。
   *
   * 曾经这两个函数把 history 列进依赖，每次存档换一次函数体。ColorPaletteTool
   * 的「自动保存」effect 恰好把 saveHistory 当依赖 —— 存档 → setHistory →
   * 函数身份变了 → effect 重跑 → 再存……打开工具就进入 600ms 一轮的死循环：
   * 每轮一次 store-set（主进程同步重写整个 config.json）+ 组件全量重渲染，
   * 而且 KeepAlive 不卸载组件，切到别的工具它还在转。这就是
   * 「打开颜色调试器整个应用都很卡」与「历史里全是同一颜色的重复项」两个症状；
   * 其他工具是「用户动作才存」，所以只有这个工具炸出来。
   */
  const historyRef = useRef(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])

  const loadHistory = useCallback(async () => {
    const key = `history-${toolId}`
    const saved = await window.electronAPI?.storeGet(key)
    if (saved && Array.isArray(saved)) {
      setHistory(saved)
    }
  }, [toolId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const saveHistory = useCallback(async (data: T, title?: string) => {
    const key = `history-${toolId}`
    // 与最近一条完全相同就免存：自动保存类调用方防抖回落后的多数存档都是重复
    const latest = historyRef.current[0]
    if (
      latest &&
      JSON.stringify(latest.data) === JSON.stringify(data) &&
      (latest.title ?? undefined) === (title ?? undefined)
    ) {
      return
    }
    const newItem: HistoryItem<T> = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      data,
      title
    }

    const updatedHistory = [newItem, ...historyRef.current].slice(0, maxItems)
    setHistory(updatedHistory)
    await window.electronAPI?.storeSet(key, updatedHistory)
  }, [toolId, maxItems])

  const clearHistory = useCallback(async () => {
    const key = `history-${toolId}`
    setHistory([])
    await window.electronAPI?.storeDelete(key)
  }, [toolId])

  const removeHistoryItem = useCallback(async (id: string) => {
    const key = `history-${toolId}`
    const updatedHistory = historyRef.current.filter(item => item.id !== id)
    setHistory(updatedHistory)
    await window.electronAPI?.storeSet(key, updatedHistory)
  }, [toolId])

  return {
    history,
    saveHistory,
    clearHistory,
    removeHistoryItem,
    loadHistory
  }
}
