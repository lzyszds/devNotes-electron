import { useState, useEffect, useCallback } from 'react'

export interface HistoryItem<T = any> {
  id: string
  timestamp: number
  data: T
  title?: string
}

export function useToolHistory<T>(toolId: string, maxItems = 50) {
  const [history, setHistory] = useState<HistoryItem<T>[]>([])

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
    const newItem: HistoryItem<T> = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      data,
      title
    }

    const updatedHistory = [newItem, ...history].slice(0, maxItems)
    setHistory(updatedHistory)
    await window.electronAPI?.storeSet(key, updatedHistory)
  }, [toolId, history, maxItems])

  const clearHistory = useCallback(async () => {
    const key = `history-${toolId}`
    setHistory([])
    await window.electronAPI?.storeDelete(key)
  }, [toolId])

  const removeHistoryItem = useCallback(async (id: string) => {
    const key = `history-${toolId}`
    const updatedHistory = history.filter(item => item.id !== id)
    setHistory(updatedHistory)
    await window.electronAPI?.storeSet(key, updatedHistory)
  }, [toolId, history])

  return {
    history,
    saveHistory,
    clearHistory,
    removeHistoryItem,
    loadHistory
  }
}
