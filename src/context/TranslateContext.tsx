import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useToolHistory, type HistoryItem } from '../hooks/useToolHistory'
import { AUTO_LANG } from '../utils/languages'

/**
 * 翻译页跨工具切换时保留的状态。
 * 译文单独订阅：流式输出只刷新结果正文和复制 / 朗读按钮，
 * 不把每个 token 的更新广播给输入框、语言选择器和整页外壳。
 */

/** 「自动双向」：输入中文出英文、输入英文出中文，不必每次手动切 */
export const AUTO_TARGET = 'auto-pair'

const PRIMARY_LANG_KEY = 'text-translate-primary-lang'
const HISTORY_TOOL_ID = 'text-translate'

interface TranslateContextValue {
  /** 待翻译原文 */
  input: string
  setInput: (value: string) => void
  setOutput: (value: string) => void
  /** 源语言，AUTO_LANG 表示自动检测 */
  sourceLang: string
  setSourceLang: (value: string) => void
  /** 目标语言，AUTO_TARGET 表示自动双向 */
  targetLang: string
  setTargetLang: (value: string) => void
  /** 「我的语言」：自动双向时用它定方向，手动选过就记住 */
  primaryLang: string
  setPrimaryLang: (value: string) => void
  /** 交换语言，并把译文回填到输入框（便于立刻回译校验） */
  swapLanguages: () => void
  history: HistoryItem<string>[]
  saveHistory: (data: string, title?: string) => void
  clearHistory: () => void
  removeHistoryItem: (id: string) => void
  /** 把某条历史回填到输入框（侧边栏与历史浮层共用） */
  useHistoryItem: (data: string) => void
  isTranslating: boolean
  setIsTranslating: (value: boolean) => void
  /** 最近一次翻译耗时（毫秒），没翻过为 null */
  elapsed: number | null
  setElapsed: (value: number | null) => void
}

const TranslateContext = createContext<TranslateContextValue | null>(null)
const TranslateOutputContext = createContext('')

export function TranslateProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [sourceLang, setSourceLangState] = useState<string>(AUTO_LANG)
  const [targetLang, setTargetLang] = useState<string>(AUTO_TARGET)
  const [primaryLang, setPrimaryLang] = useState<string>(
    () => localStorage.getItem(PRIMARY_LANG_KEY) || 'zh'
  )
  const [isTranslating, setIsTranslating] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)

  // 交换语言时用来回填目标语言：记住最近一次明确选过的源语言
  const lastSourceRef = useRef('en')

  const setSourceLang = useCallback((value: string) => {
    setSourceLangState(value)
    if (value !== AUTO_LANG) lastSourceRef.current = value
  }, [])

  const textRef = useRef({ input, output })
  textRef.current = { input, output }

  const swapLanguages = useCallback(() => {
    const { input, output } = textRef.current
    // 源语言是「自动检测」时没有具体语种可交换，用它记着的最近一次源语言兜底
    const resolvedSource = sourceLang === AUTO_LANG ? lastSourceRef.current : sourceLang
    setSourceLangState(targetLang)
    setTargetLang(resolvedSource)
    // 译文回填到输入框，可以立刻回译校验
    if (output) {
      setInput(output)
      setOutput(input)
    }
  }, [sourceLang, targetLang])

  useEffect(() => {
    localStorage.setItem(PRIMARY_LANG_KEY, primaryLang)
  }, [primaryLang])

  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>(HISTORY_TOOL_ID)

  const useHistoryItem = useCallback((data: string) => setInput(data), [])

  const value = useMemo<TranslateContextValue>(
    () => ({
      input,
      setInput,
      setOutput,
      sourceLang,
      setSourceLang,
      targetLang,
      setTargetLang,
      primaryLang,
      setPrimaryLang,
      swapLanguages,
      history,
      saveHistory,
      clearHistory,
      removeHistoryItem,
      useHistoryItem,
      isTranslating,
      setIsTranslating,
      elapsed,
      setElapsed,
    }),
    [
      input,
      sourceLang,
      setSourceLang,
      targetLang,
      primaryLang,
      swapLanguages,
      history,
      saveHistory,
      clearHistory,
      removeHistoryItem,
      useHistoryItem,
      isTranslating,
      elapsed,
    ]
  )

  return (
    <TranslateContext.Provider value={value}>
      <TranslateOutputContext.Provider value={output}>{children}</TranslateOutputContext.Provider>
    </TranslateContext.Provider>
  )
}

export function useTranslate() {
  const context = useContext(TranslateContext)
  if (!context) throw new Error('useTranslate 必须在 TranslateProvider 内使用')
  return context
}

/** 译文区配合 memo 使用：只跟随流式内容更新，不被每次输入连带刷新 */
export function useTranslateOutput() {
  return useContext(TranslateOutputContext)
}
