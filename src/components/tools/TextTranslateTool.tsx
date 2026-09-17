import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  ChevronRight,
  Clock,
  Copy,
  History,
  Languages,
  Loader2,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import Tooltip from '../ui/Tooltip'
import { Select, type SelectOption } from '../ui'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
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
import { speak } from '../../utils/speechSettings'
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

/** 两张卡片顶部的高频语言快捷 pill；其余语言走「更多」下拉 */
const SOURCE_PILLS = [AUTO_LANG, 'en', 'zh']
const TARGET_PILLS = ['zh', 'en']

/**
 * 「自动双向」哨兵值。它不是语言码，而是「按输入内容自己决定方向」的模式：
 * 输入是「我的语言」就译到它的对应语言，否则一律译回「我的语言」。
 * 用独立字符串而不是 'auto'，免得和源语言的 AUTO_LANG 撞上。
 */
const AUTO_TARGET = 'auto-pair'

/** 「我的语言」的持久化键 */
const PRIMARY_LANG_KEY = 'text-translate-primary-lang'

/** 「我的语言」对应的另一半；没列到的语言统一配英文 */
const COUNTERPART: Record<string, string> = {
  zh: 'en',
  'zh-TW': 'en',
  en: 'zh',
}

/**
 * 粗略判断一段文本是不是中文。
 *
 * 只看「CJK 汉字 vs 拉丁字母」谁多 —— 足够决定「中 ⇄ 英」该往哪边翻，
 * 不追求语言识别的准确度（真要精确检测，交给翻译引擎自己的 auto 参数）。
 * 只取前 400 字采样：开头就足以定调，没必要全文扫一遍。
 */
function looksChinese(text: string): boolean {
  const sample = text.slice(0, 400)
  const cjk = (sample.match(/[一-鿿]/g) || []).length
  const latin = (sample.match(/[a-zA-Z]/g) || []).length
  return cjk > 0 && cjk >= latin
}

/** 按「我的语言」和输入内容，定出这次该译到哪种语言 */
function resolveAutoTarget(text: string, primary: string): string {
  const counterpart = COUNTERPART[primary] ?? 'en'
  const isPrimary = primary.startsWith('zh') ? looksChinese(text) : !looksChinese(text)
  return isPrimary ? counterpart : primary
}

/** 实时自动翻译的防抖时长 */
const AUTO_DEBOUNCE_MS = 300

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

/**
 * 合并单个换行、保留空行。
 * PDF 复制出来的正文常在每行末尾硬断行，直接翻会把一句话拆成好几段；
 * 空行是真正的段落边界，必须留着，所以只吃掉「一个换行」。
 */
function unwrapHardBreaks(text: string): string {
  return text.replace(/([^\n])\n([^\n])/g, '$1 $2')
}

export default function TextTranslateTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [sourceLang, setSourceLang] = useState<string>(AUTO_LANG)
  // 默认「自动双向」：输入中文出英文、输入英文出中文，不必每次手动切
  const [targetLang, setTargetLang] = useState<string>(AUTO_TARGET)
  // 「我的语言」：自动双向时用它定方向，手动选过就记住
  const [primaryLang, setPrimaryLang] = useState<string>(
    () => localStorage.getItem(PRIMARY_LANG_KEY) || 'zh'
  )
  // 默认走 LibreTranslate：这是设置里已配置好的自定义接口，GTX 在部分网络下不可达
  const [api, setApi] = useState<TranslationAPI>('libretranslate')
  const [translateConfig, setTranslateConfig] = useState<TranslateApiConfig | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  // 输入停顿即翻；默认开，与设计稿一致
  const [autoTranslate, setAutoTranslate] = useState(true)
  const [unwrapLines, setUnwrapLines] = useState(false)
  // 最近一次翻译的耗时（毫秒），显示在译文卡片底栏
  const [elapsed, setElapsed] = useState<number | null>(null)
  // 历史浮层退出动画：面板 180ms、遮罩 160ms，取长者
  const { mounted: historyMounted, state: historyState } = usePresence(showHistory, 180)
  const { showToast } = useToast()

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

  useEffect(() => {
    localStorage.setItem(PRIMARY_LANG_KEY, primaryLang)
  }, [primaryLang])

  // 自动双向时方向随输入走；手动选了语言就照手动来
  const effectiveTarget =
    targetLang === AUTO_TARGET ? resolveAutoTarget(input, primaryLang) : targetLang

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
          '请点击顶部的「未配置」按钮，或从顶栏进入设置填写后重试。'
      )
      return
    }

    setError('')
    setIsTranslating(true)
    setProgress({ current: 0, total: 0 })

    const myId = ++runIdRef.current
    const text = input
    const startedAt = performance.now()

    try {
      const segments = toSegments(unwrapLines ? unwrapHardBreaks(text) : text, CHUNK_BYTE_LIMIT[api])
      const indexes = segments
        .map((segment, index) => (segment.translate ? index : -1))
        .filter((index) => index >= 0)

      const result = await translateTextBatch({
        texts: indexes.map((index) => segments[index].text),
        sourceLang,
        targetLang: effectiveTarget,
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
      setElapsed(Math.round(performance.now() - startedAt))
      // 即使部分失败也把已拿到的译文显示出来（失败块回落原文）
      if (!result.ok && result.error) setError(result.error)

      if (result.ok) {
        const from = sourceLang === AUTO_LANG ? '自动检测' : langName(sourceLang)
        saveHistory(text, `翻译: ${from} → ${langName(effectiveTarget)}`)
      }
    } catch (e) {
      if (myId === runIdRef.current) setError('翻译过程中出错: ' + (e as Error).message)
    } finally {
      if (myId === runIdRef.current) setIsTranslating(false)
    }
  }

  // 实时翻译的定时器要用到「最新那次渲染的 handleTranslate」，
  // 而它每次渲染都会重建 —— 直接进依赖数组会把自己无限重启，所以走 ref。
  const translateRef = useRef(handleTranslate)
  translateRef.current = handleTranslate

  useEffect(() => {
    if (!autoTranslate) return
    if (!input.trim() || mymemoryAutoBlocked) return
    // 接口没配就别自动跑：否则每敲一个字都弹一次红色错误条，等着用户去点「立即翻译」时提示一次就够了
    if (needsConfig) return
    const timer = setTimeout(() => void translateRef.current(), AUTO_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input, autoTranslate, mymemoryAutoBlocked, needsConfig])

  // 音色与语速取自「设置 → 语音朗读」，和设置面板里的试听共用同一套参数
  const speakText = (text: string, langCode: string) => {
    if (!text.trim()) return
    if (!speak(text, langCode)) {
      showToast('当前环境不支持朗读', 'error')
    }
  }

  // 源语言是「自动检测」时没有语种码可给，用判方向那套中文粗判兜一下。
  // 只能分中/英，但自动检测本身就只在这儿定调，够用
  const sourceSpeakLang = sourceLang === AUTO_LANG ? (looksChinese(input) ? 'zh' : 'en') : sourceLang

  const handleCopyOutput = async () => {
    if (!output) return
    const ok = await copyText(output)
    showToast(ok ? '已复制译文' : '复制失败', ok ? 'default' : 'error')
  }

  const clearAll = () => {
    setInput('')
    setOutput('')
    setError('')
    setElapsed(null)
  }

  // 顶栏的引擎健康度：未配置时是醒目的琥珀色可点入口，否则显示引擎名与最近耗时
  const healthTone = needsConfig
    ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    : 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300'

  return (
    <div className="relative flex h-full min-h-0 bg-slate-50/60 dark:bg-dark-bg overflow-hidden text-slate-900 dark:text-slate-100">
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部工具栏：引擎状态、引擎切换、历史记录 */}
        <div className="flex-wrap gap-3 px-4 py-3 md:px-8 md:py-4 bg-white dark:bg-dark-panel border-b border-slate-200/80 dark:border-dark-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-sm shadow-brand-500/20 flex-shrink-0">
              <Languages size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-none">
                  多语言智能翻译
                </h2>

                {needsConfig ? (
                  <Tooltip content="打开设置里的翻译接口配置">
                    <button
                      onClick={() => openAppSettings('translate-api')}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition hover:brightness-[0.98] ${healthTone}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>未配置，点此填写接口</span>
                    </button>
                  </Tooltip>
                ) : (
                  <span
                    className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${healthTone}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      {API_OPTIONS.find((item) => item.value === api)?.label ?? api}
                      {elapsed !== null ? ` · ${elapsed}ms` : ' · 就绪'}
                    </span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 truncate">{engineSummary}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Select<TranslationAPI>
              value={api}
              onChange={setApi}
              options={API_OPTIONS}
              className="w-40"
              title="翻译引擎"
            />

            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-9 ${showHistory ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600' : ''}`}
            >
              <History size={15} />
              <span>历史记录</span>
            </button>
          </div>
        </div>

        {/* 主工作区 */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 flex flex-col gap-4">
          {/* MyMemory 不支持自动检测，提前说清楚，别让它把原文当译文返回 */}
          {mymemoryAutoBlocked && (
            <div className="status-note border-amber-100 bg-amber-50/30 text-amber-700 flex items-start gap-2 flex-shrink-0">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <span>MyMemory 不支持自动检测源语言，请指定源语言或改用 GTX。</span>
            </div>
          )}

          {error && (
            <div className="status-note border-rose-100 bg-rose-50/30 text-rose-600 flex items-start gap-2 flex-shrink-0">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <p className="whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* 双子卡片：原文 / 译文 */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[440px]">
            {/* ---------------- 原文 ---------------- */}
            <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0 transition duration-150">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-start justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
                {/* 语言区自己换行，整条不做横向滚动 —— 滚动容器会把「更多」下拉截断在边上 */}
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 mr-1 flex-shrink-0">源语言:</span>
                  {SOURCE_PILLS.map((code) => {
                    const active = sourceLang === code
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => handleSourceChange(code)}
                        className={`px-2.5 py-1 rounded-md text-xs flex-shrink-0 transition ${
                          active
                            ? 'font-semibold bg-white dark:bg-dark-panel text-brand-700 dark:text-brand-400 shadow-2xs border border-brand-100 dark:border-brand-500/30'
                            : 'font-medium text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-dark-hover hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        {code === AUTO_LANG ? '自动检测' : langName(code)}
                      </button>
                    )
                  })}
                  {/* pill 放不下 20 种语言，其余走这个下拉 */}
                  <Select
                    value={SOURCE_PILLS.includes(sourceLang) ? '' : sourceLang}
                    onChange={handleSourceChange}
                    options={SOURCE_OPTIONS.filter((item) => !SOURCE_PILLS.includes(item.value))}
                    className="w-[92px]"
                    size="sm"
                    placeholder="更多…"
                    title="更多源语言"
                  />
                </div>

                {/* 自动双向下方向由输入决定，互换按钮没有意义，收起来 */}
                {targetLang !== AUTO_TARGET && (
                  <Tooltip content="互换源语言与目标语言">
                    <button
                      type="button"
                      onClick={handleSwap}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition flex-shrink-0"
                    >
                      <ArrowRightLeft size={15} />
                    </button>
                  </Tooltip>
                )}
              </div>

              <div className="flex-1 p-4 flex flex-col min-h-0">
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
                  className="w-full flex-1 bg-transparent resize-none outline-none text-slate-800 dark:text-slate-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>

              <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-between gap-3 text-xs text-slate-400 bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={unwrapLines}
                      onChange={(e) => setUnwrapLines(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-dark-border text-brand-600 focus:ring-0"
                    />
                    <span>合并断行（PDF/代码）</span>
                  </label>
                  {input && (
                    <>
                      <span className="text-slate-200 dark:text-dark-border">|</span>
                      <button
                        onClick={clearAll}
                        className="flex items-center gap-1 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 size={13} />
                        <span>清空</span>
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-slate-500 dark:text-slate-500">
                    {input.length} 字符
                  </span>
                  <Tooltip content="朗读原文">
                    <button
                      type="button"
                      onClick={() => speakText(input, sourceSpeakLang)}
                      disabled={!input.trim()}
                      className="p-1 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Volume2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* ---------------- 译文 ---------------- */}
            <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-start justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 mr-1 flex-shrink-0">目标语言:</span>

                  {/* 自动双向：方向随输入走，不必每次手动切 */}
                  <button
                    type="button"
                    onClick={() => setTargetLang(AUTO_TARGET)}
                    className={`px-2.5 py-1 rounded-md text-xs flex-shrink-0 transition ${
                      targetLang === AUTO_TARGET
                        ? 'font-semibold bg-white dark:bg-dark-panel text-brand-700 dark:text-brand-400 shadow-2xs border border-brand-100 dark:border-brand-500/30'
                        : 'font-medium text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-dark-hover hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    自动双向
                  </button>


                  {TARGET_PILLS.map((code) => {
                    const active = targetLang === code
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setTargetLang(code)}
                        className={`px-2.5 py-1 rounded-md text-xs flex-shrink-0 transition ${
                          active
                            ? 'font-semibold bg-white dark:bg-dark-panel text-brand-700 dark:text-brand-400 shadow-2xs border border-brand-100 dark:border-brand-500/30'
                            : 'font-medium text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-dark-hover hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        {langName(code)}
                      </button>
                    )
                  })}
                  <Select
                    value={TARGET_PILLS.includes(targetLang) ? '' : targetLang}
                    onChange={setTargetLang}
                    options={TARGET_OPTIONS.filter((item) => !TARGET_PILLS.includes(item.value))}
                    className="w-[92px]"
                    size="sm"
                    placeholder="更多…"
                    title="更多目标语言"
                  />
                </div>

              </div>

              <div className="flex-1 p-4 flex flex-col min-h-0">
                {/*
                  加载态与占位文案走同一个内联槽位，不做绝对定位浮在上层 ——
                  浮层会和下面的占位文字叠在一起，两者字号、基线都对不齐。
                */}
                <div className="flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100 text-sm leading-relaxed">
                  {output ? (
                    output
                  ) : isTranslating ? (
                    <span className="flex items-center gap-2 text-brand-600 dark:text-brand-400">
                      <Loader2 size={14} className="animate-spin flex-shrink-0" />
                      <span>
                        翻译中
                        {progress.total > 0 ? ` ${progress.current}/${progress.total}` : '…'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600 italic">译文将实时在此呈现…</span>
                  )}
                </div>
              </div>

              <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-between gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {/* 「我的语言」只服务于自动判方向；手动选定了语言时它没有作用，就不占位置。
                      下拉朝上展开：底栏贴着卡片下沿，往下弹会被外层容器裁掉 */}
                  {targetLang === AUTO_TARGET && (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Select
                        value={primaryLang}
                        onChange={setPrimaryLang}
                        options={TARGET_OPTIONS}
                        className="w-[88px]"
                        size="sm"
                        placement="up"
                        title="自动双向时，译回哪一种语言"
                      />
                      {/* 有内容时把这次实际要译到的语言亮出来，省得猜方向 */}
                      {input.trim() && (
                        <span className="text-brand-600 dark:text-brand-400 font-medium truncate">
                          → {langName(effectiveTarget)}
                        </span>
                      )}
                    </span>
                  )}

                  {/* 已有译文时重新翻译，正文不动（避免整段闪一下），进度落在这里 */}
                  <span className="font-mono font-medium flex-shrink-0">
                    {isTranslating ? (
                      <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400">
                        <Loader2 size={12} className="animate-spin" />
                        翻译中…
                      </span>
                    ) : elapsed !== null ? (
                      <span className="text-emerald-600 dark:text-emerald-400">● 耗时 {elapsed}ms</span>
                    ) : null}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Tooltip content="朗读译文">
                    <button
                      type="button"
                      onClick={() => speakText(output, effectiveTarget)}
                      disabled={!output}
                      className="p-1 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Volume2 size={14} />
                    </button>
                  </Tooltip>
                  <button
                    onClick={() => void handleCopyOutput()}
                    disabled={!output}
                    className="px-3 py-1 bg-white dark:bg-dark-panel hover:bg-slate-50 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-dark-border rounded-md transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Copy size={13} className="text-slate-500 dark:text-slate-400" />
                    <span>复制译文</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 底部动作条 */}
          <div className="bg-white dark:bg-dark-panel rounded-xl border border-slate-200/80 dark:border-dark-border px-4 py-3 md:px-5 flex items-center justify-between gap-3 flex-wrap shadow-2xs flex-shrink-0">
            <div className="flex items-center gap-4 md:gap-6 flex-wrap">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => setAutoTranslate(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-dark-border text-brand-600 focus:ring-0"
                />
                <span>实时自动翻译（防抖 {AUTO_DEBOUNCE_MS}ms）</span>
              </label>
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                <span>快捷键:</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-dark-hover border border-slate-200 dark:border-dark-border border-b-2 rounded text-slate-500 dark:text-slate-400">
                  Enter
                </kbd>
                <span>立即翻译</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-dark-hover border border-slate-200 dark:border-dark-border border-b-2 rounded text-slate-500 dark:text-slate-400">
                  Shift
                </kbd>
                <span>+</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-dark-hover border border-slate-200 dark:border-dark-border border-b-2 rounded text-slate-500 dark:text-slate-400">
                  Enter
                </kbd>
                <span>换行</span>
              </div>
            </div>

            <button
              onClick={() => void handleTranslate()}
              disabled={!canTranslate}
              className="tool-button-primary h-9 px-5 bg-brand-600 hover:bg-brand-700 shadow-sm shadow-brand-500/20 disabled:opacity-40"
            >
              {isTranslating ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>翻译中…</span>
                </>
              ) : (
                <>
                  <span>立即翻译</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {historyMounted && (
        <div className="history-overlay" data-state={historyState}>
          <button
            type="button"
            aria-label="关闭历史记录"
            className="history-overlay-backdrop"
            onClick={() => setShowHistory(false)}
          />
          <div className="history-overlay-panel" data-state={historyState} onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200/70 dark:border-dark-border bg-white/80 dark:bg-dark-panel/80 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-black text-xs uppercase tracking-widest">
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
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-400"
                  >
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-dark-bg/50">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300 dark:text-slate-600">
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
                    className="w-full text-left p-5 rounded-2xl bg-white dark:bg-dark-panel border border-slate-200/60 dark:border-dark-border shadow-sm hover:border-brand-600 hover:shadow-brand-500/10 transition-all group"
                  >
                    <p className="text-[11px] font-black text-slate-800 dark:text-slate-200 mb-2 truncate pr-4">
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
    </div>
  )
}
