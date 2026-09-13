import { useEffect, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  ChevronRight,
  Clock,
  History,
  Languages,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import Tooltip from '../ui/Tooltip'
import { Select, type SelectOption } from '../ui'
import {
  describeProvider,
  isProvider,
  isProviderConfigured,
  loadTranslateConfig,
  providerLabel,
  subscribeTranslateConfig,
  type TranslateApiConfig,
} from '../../utils/translateConfig'
import { translateTextBatch, type TranslationAPI } from '../../utils/jsonI18nTranslate'
import { openAppSettings } from '../../utils/settingsBus'
import { AUTO_LANG, LANGUAGES, langName } from '../../utils/languages'

const API_OPTIONS: SelectOption<TranslationAPI>[] = [
  { value: 'gtx', label: 'GTX' },
  { value: 'mymemory', label: 'MyMemory' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'libretranslate', label: 'LibreTranslate' },
]

/** 源语言多一个「自动检测」 */
const SOURCE_OPTIONS: SelectOption[] = [
  { value: AUTO_LANG, label: '自动检测' },
  ...LANGUAGES.map((item) => ({ value: item.code, label: item.name })),
]

const TARGET_OPTIONS: SelectOption[] = LANGUAGES.map((item) => ({
  value: item.code,
  label: item.name,
}))

/**
 * 单块字节上限。GTX 与 MyMemory 都用 GET 把正文挂在 query 上，太长会直接失败；
 * MyMemory 官方对 q 的限制是 500 字节（中文按 UTF-8 三字节算，只有约 160 字），
 * 所以必须按引擎分别设定，否则长文在 MyMemory 上会整段失败。
 */
const CHUNK_BYTE_LIMIT: Record<TranslationAPI, number> = {
  gtx: 3600,
  mymemory: 480,
  openai: 3600,
  libretranslate: 3600,
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * 兜底硬切：整段没有句末标点时按字节数切开。
 * 用 for...of 按码点迭代，不会把 emoji 之类的代理对劈成两半。
 */
function hardSplit(text: string, byteLimit: number): string[] {
  const pieces: string[] = []
  let current = ''
  for (const char of text) {
    if (byteLength(current + char) > byteLimit) {
      pieces.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) pieces.push(current)
  return pieces
}

/**
 * 段落超过上限时，先按「句末标点 / 换行」切成句子再贪心合并。
 * 切点是零宽的，所以切出来的片段拼回去与原文逐字一致 —— 译文里不会凭空多出或少掉空行。
 */
function splitLongText(paragraph: string, byteLimit: number): string[] {
  if (byteLength(paragraph) <= byteLimit) return [paragraph]

  const sentences = paragraph.split(/(?<=[。！？!?；;])(?=[^\n])|(?<=\n)/)
  const pieces: string[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) {
      pieces.push(buffer)
      buffer = ''
    }
  }

  for (const sentence of sentences) {
    if (byteLength(sentence) > byteLimit) {
      flush()
      pieces.push(...hardSplit(sentence, byteLimit))
      continue
    }
    if (byteLength(buffer) + byteLength(sentence) > byteLimit) {
      flush()
      buffer = sentence
    } else {
      buffer += sentence
    }
  }
  flush()
  return pieces
}

/** 待翻译的一片，或一段必须原样保留的分隔符 */
interface Segment {
  text: string
  translate: boolean
}

/** 把原文切成「要翻的正文」与「原样保留的空白分隔符」 */
function toSegments(text: string, byteLimit: number): Segment[] {
  // 捕获式切分：偶数下标是正文，奇数下标是空行分隔符
  const raw = text.split(/(\n[ \t]*\n+)/)
  const segments: Segment[] = []

  raw.forEach((part, index) => {
    if (!part) return
    // 空行分隔符与纯空白片段一律不送翻译，避免译文里凭空多出空行
    if (index % 2 === 1 || !part.trim()) {
      segments.push({ text: part, translate: false })
      return
    }
    for (const piece of splitLongText(part, byteLimit)) {
      segments.push({ text: piece, translate: !!piece.trim() })
    }
  })

  return segments
}

export default function TextTranslateTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [sourceLang, setSourceLang] = useState<string>(AUTO_LANG)
  const [targetLang, setTargetLang] = useState('zh')
  // 默认走 LibreTranslate：这是设置里已配置好的自定义接口，GTX 在部分网络下不可达
  const [api, setApi] = useState<TranslationAPI>('libretranslate')
  const [translateConfig, setTranslateConfig] = useState<TranslateApiConfig | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  // 交换语言时用来回填目标语言：记住最近一次明确选过的源语言
  const lastSourceRef = useRef('en')
  // 代际 id：翻译请求没有 AbortSignal，用它在响应回来时丢弃过期的结果
  const runIdRef = useRef(0)

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('text-translate')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  // 跟随设置弹窗里的接口配置
  useEffect(() => {
    loadTranslateConfig().then(setTranslateConfig)
    return subscribeTranslateConfig(setTranslateConfig)
  }, [])

  const needsConfig = isProvider(api) && !isProviderConfigured(translateConfig)
  // MyMemory 不支持自动检测：langpair=auto|xx 不被接受，它会把原文当译文静默返回
  const mymemoryAutoBlocked = api === 'mymemory' && sourceLang === AUTO_LANG
  // 空输入 / 正在翻译 / 引擎与源语言冲突，这三种情况都不发起翻译
  const canTranslate = !!input.trim() && !isTranslating && !mymemoryAutoBlocked

  const engineSummary =
    api === 'gtx'
      ? 'GTX 免费接口 · 无需配置'
      : api === 'mymemory'
        ? 'MyMemory 免费接口 · 需指定源语言'
        : describeProvider(translateConfig)

  const handleSourceChange = (value: string) => {
    setSourceLang(value)
    if (value !== AUTO_LANG) lastSourceRef.current = value
  }

  const handleSwap = () => {
    const resolvedSource = sourceLang === AUTO_LANG ? lastSourceRef.current : sourceLang
    setSourceLang(targetLang)
    setTargetLang(resolvedSource)
    // 译文回填到输入框，可以立刻回译校验
    if (output) {
      setInput(output)
      setOutput(input)
    }
  }

  const handleTranslate = async () => {
    if (!input.trim() || isTranslating || mymemoryAutoBlocked) return

    if (needsConfig) {
      setError(
        `尚未配置「${providerLabel(api as 'openai' | 'libretranslate')}」接口。\n\n` +
          '请点击右侧「未配置，点此填写接口」按钮，或从顶栏进入设置填写后重试。'
      )
      return
    }

    setError('')
    setIsTranslating(true)
    setProgress({ current: 0, total: 0 })

    const myId = ++runIdRef.current
    const text = input

    try {
      const segments = toSegments(text, CHUNK_BYTE_LIMIT[api])
      const indexes = segments
        .map((segment, index) => (segment.translate ? index : -1))
        .filter((index) => index >= 0)

      const result = await translateTextBatch({
        texts: indexes.map((index) => segments[index].text),
        sourceLang,
        targetLang,
        api,
        providerConfig: translateConfig ?? undefined,
        onProgress: (done, total) => {
          if (myId === runIdRef.current) setProgress({ current: done, total })
        },
      })

      // 已经有更新的请求在跑，这次的结果直接丢掉，免得旧译文盖掉新的
      if (myId !== runIdRef.current) return

      const merged = segments.slice()
      indexes.forEach((segmentIndex, order) => {
        merged[segmentIndex] = {
          text: result.results[order] ?? segments[segmentIndex].text,
          translate: false,
        }
      })

      setOutput(merged.map((segment) => segment.text).join(''))
      // 即使部分失败也把已拿到的译文显示出来（失败块回落原文）
      if (!result.ok && result.error) setError(result.error)

      if (result.ok) {
        const from = sourceLang === AUTO_LANG ? '自动检测' : langName(sourceLang)
        saveHistory(text, `翻译: ${from} → ${langName(targetLang)}`)
      }
    } catch (e) {
      if (myId === runIdRef.current) setError('翻译过程中出错: ' + (e as Error).message)
    } finally {
      if (myId === runIdRef.current) setIsTranslating(false)
    }
  }

  return (
    <div className="relative flex h-full min-h-[600px] bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部标题区 */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-100">
              <Languages size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">文本翻译</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">{engineSummary}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select<TranslationAPI>
              value={api}
              onChange={setApi}
              options={API_OPTIONS}
              className="w-36"
              title="翻译引擎"
            />

            {needsConfig && (
              <Tooltip content="打开设置里的翻译接口配置">
                <button
                  onClick={() => openAppSettings('translate-api')}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 shrink-0"
                >
                  <TriangleAlert size={14} />
                  未配置，点此填写接口
                </button>
              </Tooltip>
            )}

            <div className="w-px h-6 bg-slate-100" />

            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600' : ''}`}
            >
              <History size={16} />
              <span>翻译历史</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/20">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* 语言选择条 */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Select
                value={sourceLang}
                onChange={handleSourceChange}
                options={SOURCE_OPTIONS}
                className="w-44"
                title="源语言"
              />

              <Tooltip content="互换源语言与目标语言">
                <button
                  type="button"
                  onClick={handleSwap}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 flex items-center justify-center transition hover:border-slate-300 hover:text-slate-800 hover:bg-slate-50"
                >
                  <ArrowRightLeft size={15} />
                </button>
              </Tooltip>

              <Select
                value={targetLang}
                onChange={setTargetLang}
                options={TARGET_OPTIONS}
                className="w-44"
                title="目标语言"
              />
            </div>

            {/* MyMemory 不支持自动检测，提前说清楚，别让它把原文当译文返回 */}
            {mymemoryAutoBlocked && (
              <div className="status-note border-amber-100 bg-amber-50/30 text-amber-700 flex items-start gap-2">
                <TriangleAlert size={14} className="mt-px shrink-0" />
                <span>MyMemory 不支持自动检测源语言，请指定源语言或改用 GTX。</span>
              </div>
            )}

            {error && (
              <div className="status-note border-rose-100 bg-rose-50/30 text-rose-600 flex items-start gap-2">
                <TriangleAlert size={14} className="mt-px shrink-0" />
                <p className="whitespace-pre-line">{error}</p>
              </div>
            )}

            {/* 双栏：原文 / 译文 */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_48px_1fr] gap-4 items-start">
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="tool-label">原文</label>
                  {input && (
                    <Tooltip content="清空原文与译文">
                      <button
                        onClick={() => {
                          setInput('')
                          setOutput('')
                          setError('')
                        }}
                        className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    if (error) setError('')
                  }}
                  onKeyDown={(e) => {
                    // 回车即翻译，Shift + 回车换行；翻不了的时候把回车让给默认的换行行为
                    if (e.key !== 'Enter' || e.shiftKey || !canTranslate) return
                    // 中文/日文输入法用回车确认候选词，这一下不能算「提交」
                    if (e.nativeEvent.isComposing) return
                    e.preventDefault()
                    void handleTranslate()
                  }}
                  placeholder="在这里输入或粘贴要翻译的文本…（回车翻译，Shift + 回车换行）"
                  className="tool-textarea min-h-[400px] border-slate-200 shadow-sm"
                />
              </div>

              <div className="hidden xl:flex flex-col justify-center items-center gap-4 pt-24">
                <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 shadow-sm">
                  <ArrowRightLeft size={18} className="xl:rotate-90" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="tool-label">译文（{langName(targetLang)}）</label>
                </div>
                <textarea
                  value={output}
                  readOnly
                  placeholder="译文将在此显示…"
                  className="tool-textarea min-h-[400px] border-brand-100 bg-brand-50/10 font-bold text-slate-800 placeholder:text-slate-300"
                />
              </div>
            </div>

            {/* 操作区 */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => void handleTranslate()}
                disabled={!canTranslate}
                className="tool-button-primary h-14 px-12 bg-slate-900 shadow-xl shadow-slate-100 text-sm group"
              >
                {isTranslating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    翻译中 {progress.current}/{progress.total}
                  </>
                ) : (
                  <>
                    立即翻译
                    <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              {isTranslating && progress.total > 0 && (
                <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-900 rounded-full transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="history-overlay">
          <button
            type="button"
            aria-label="关闭历史记录"
            className="history-overlay-backdrop"
            onClick={() => setShowHistory(false)}
          />
          <div className="history-overlay-panel" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
                <History size={18} className="text-brand-600" />
                最近翻译
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearHistory}
                  className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase"
                >
                  清空
                </button>
                <Tooltip content="关闭历史记录">
                  <button
                    onClick={() => setShowHistory(false)}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"
                  >
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Clock size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">暂无记录</p>
                </div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    onContextMenu={(e) => openHistoryMenu(e, item)}
                    onClick={() => {
                      setInput(item.data)
                      setShowHistory(false)
                    }}
                    className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-brand-600 hover:shadow-brand-500/10 transition-all group"
                  >
                    <p className="text-[11px] font-black text-slate-800 mb-2 truncate pr-4">
                      {item.title || item.data}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                      <ChevronRight
                        size={10}
                        className="text-slate-300 group-hover:text-brand-600 transition-colors"
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 空态装饰：只在完全没有内容时出现，避免打断双栏布局 */}
      {!input && !output && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
          <Sparkles size={12} />
          支持 20 种语言互译
        </div>
      )}
    </div>
  )
}
