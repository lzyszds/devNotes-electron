import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  History,
  Languages,
  Loader2,
  ScanText,
  Trash2,
  TriangleAlert,
  Volume2,
} from 'lucide-react'
import { useHistoryContextMenu } from '../../../hooks/useHistoryContextMenu'
import { AUTO_TARGET, useTranslate } from '../../../context/TranslateContext'
import Tooltip from '../../ui/Tooltip'
import {
  BTN,
  Select,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  CopyButton,
  iconButtonClass,
  pillClass,
  type SelectOption,
} from '../../ui'
import { useToast } from '../../ui/Toast'
import {
  describeProvider,
  isProvider,
  isProviderConfigured,
  loadTranslateConfig,
  providerLabel,
  subscribeTranslateConfig,
  type TranslateApiConfig,
} from '../../../utils/translateConfig'
import { translateTextBatch, type TranslationAPI } from '../../../utils/jsonI18nTranslate'
import { openAppSettings } from '../../../utils/settingsBus'
import { speak } from '../../../utils/speechSettings'
import { AUTO_LANG, LANGUAGES, langName } from '../../../utils/languages'
import { subscribeOcrRequest } from '../../../utils/ocrBus'
import { translateStream } from '../../../utils/translateStream'
import {
  DEFAULT_TRANSLATE_PREFS,
  loadTranslatePrefs,
  saveTranslatePrefs,
  type TranslatePrefs,
} from '../../../utils/translatePrefs'
import {
  OCR_LANGUAGES,
  describeStatus,
  recognizeText,
  type OcrLanguage,
} from '../../../utils/ocr'

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

/*
 * 「自动双向」哨兵值 AUTO_TARGET 与「我的语言」的持久化都归模块 context 管
 * （见 context/TranslateContext.tsx）—— 专属侧边栏要读同一份语言偏好。
 */

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
  // 语言偏好、输入输出、历史都在模块 context 里：专属侧边栏与这里共用同一份数据
  const {
    input,
    setInput,
    output,
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
  } = useTranslate()

  /*
   * 引擎、实时翻译、合并断行、识别语言 —— 四项都存盘。
   *
   * 原来都是写死初值的 useState，切走再回来就重置：用户选了 OpenAI，
   * 下次进来又变回 LibreTranslate。初始化先用默认值渲染，挂载后异步
   * 读盘补齐（读盘是 IPC，不能阻塞首帧）。
   */
  const [prefs, setPrefs] = useState<TranslatePrefs>(DEFAULT_TRANSLATE_PREFS)
  const { api, autoTranslate, unwrapLines, ocrLang } = prefs
  /** 改一项就写盘，调用方不用各自处理持久化 */
  const patchPrefs = (patch: Partial<TranslatePrefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      void saveTranslatePrefs(next)
      return next
    })
  const setApi = (value: TranslationAPI) => patchPrefs({ api: value })
  const setAutoTranslate = (value: boolean) => patchPrefs({ autoTranslate: value })
  const setUnwrapLines = (value: boolean) => patchPrefs({ unwrapLines: value })
  const setOcrLang = (value: OcrLanguage) => patchPrefs({ ocrLang: value })

  useEffect(() => {
    void loadTranslatePrefs().then(setPrefs)
  }, [])

  const [translateConfig, setTranslateConfig] = useState<TranslateApiConfig | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [ocrState, setOcrState] = useState<{
    status: 'recognizing' | 'done'
    progress: number
    label: string
  } | null>(null)
  const { showToast } = useToast()

  // 代际 id：翻译请求没有 AbortSignal，用它在响应回来时丢弃过期的结果
  const runIdRef = useRef(0)
  /**
   * 正在跑的流式请求。
   *
   * 自动翻译每次输入都会触发新请求，旧的若不断开，两股译文会交错着往
   * 结果区写。代际 id 只挡「写入」，断流还得靠它。
   */
  const streamAbortRef = useRef<AbortController | null>(null)

  /** 输入框。挂载后自动聚焦，用户按快捷键唤起就能直接敲字 */
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const focus = () => inputRef.current?.focus()

    // 挂载即聚焦，覆盖「从别的工具切过来」这条路径。
    // 延迟一帧：快捷键唤起时窗口刚从后台切到前台，立刻 focus 会被系统的
    // 窗口激活流程覆盖掉，等布局落定再聚焦更稳。
    const timer = window.setTimeout(focus, 0)

    /*
     * 还要覆盖「本来就在翻译页，只是窗口被隐藏」这条路径 —— 此时组件不会
     * 重新挂载，只靠上面的 effect 拿不到焦点。窗口重新激活时补一次聚焦。
     *
     * 但用户主动点别处（比如点译文区）时不该抢回来，所以只在窗口级的
     * focus 事件里做，不在 document 上做。
     */
    window.addEventListener('focus', focus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', focus)
    }
  }, [])

  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      useHistoryItem(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  // 跟随设置弹窗里的接口配置
  useEffect(() => {
    loadTranslateConfig().then(setTranslateConfig)
    return subscribeTranslateConfig(setTranslateConfig)
  }, [])

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

  // 选源语言时顺带记下「最近一次明确选择」，交换语言要用它兜底 —— context 内部处理
  const handleSourceChange = setSourceLang

  const handleSwap = swapLanguages

  /**
   * 流式翻译：边收边把累积的译文写进结果区。
   *
   * 不做分段 —— 流式本身就解决了「长文本等太久」，再切段反而会得到一堆
   * 各自不连贯的片段（模型看不到上下文）。整段丢给它，逐字吐出来。
   */
  const runStreaming = async (
    text: string,
    myId: number,
    startedAt: number,
    target: string,
  ) => {
    if (!translateConfig?.openai) return
    // 上一轮还没结束就开新的，会让两股译文交错着写进结果区
    streamAbortRef.current?.abort()
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      const result = await translateStream({
        text,
        sourceLang,
        targetLang: target,
        config: translateConfig.openai,
        signal: controller.signal,
        onDelta: (_delta, full) => {
          // 已经有更新的请求在跑，这次的结果丢掉
          if (myId !== runIdRef.current) return
          setOutput(full)
        },
      })

      if (myId !== runIdRef.current) return
      if (!result.ok && result.error && result.error !== '已取消') {
        setError(result.error)
        // 部分译文也留着，比清空更有用
        if (result.text) setOutput(result.text)
      }
      setElapsed(Math.round(performance.now() - startedAt))
      if (result.ok) {
        const from = sourceLang === AUTO_LANG ? '自动检测' : langName(sourceLang)
        saveHistory(text, `翻译: ${from} → ${langName(target)}`)
      }
    } catch (e) {
      if (myId === runIdRef.current) setError('翻译过程中出错: ' + (e as Error).message)
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null
      if (myId === runIdRef.current) setIsTranslating(false)
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

    /*
     * OpenAI 兼容接口走流式：文字边生成边显示，不用干等整段翻译完。
     * LibreTranslate 之类的接口没有流式能力，保持原来的整段返回。
     */
    if (api === 'openai' && translateConfig?.openai) {
      await runStreaming(text, myId, startedAt, effectiveTarget)
      return
    }

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

  /**
   * 截图取字：收到图片 → OCR → 填进输入框并翻译。
   *
   * 关掉自动翻译会走上面那条 debounce，所以填完 input 什么都不用做，
   * 翻译会自己跟上；这里只需要在关掉自动翻译时手动触发一次。
   */
  const ocrSeqRef = useRef(0)
  useEffect(() => {
    const off = subscribeOcrRequest(async (dataUrl) => {
      // 连续截好几张时，后发的先回来会被旧结果覆盖，用序号挡掉
      const seq = ++ocrSeqRef.current
      setOcrState({ status: 'recognizing', progress: 0, label: '准备识别' })
      setError('')

      try {
        const text = await recognizeText(dataUrl, {
          lang: ocrLang,
          onProgress: (p) => {
            if (ocrSeqRef.current !== seq) return
            setOcrState({
              status: 'recognizing',
              progress: p.progress,
              label: describeStatus(p.status),
            })
          },
        })
        if (ocrSeqRef.current !== seq) return

        if (!text) {
          setOcrState(null)
          setError('没有从这张图里识别出文字，换个区域或换个语言试试')
          return
        }
        setInput(text)
        setOcrState({ status: 'done', progress: 1, label: '识别完成' })
        // 关掉自动翻译时不会有 debounce 兜底，这里补一次
        if (!autoTranslate) window.setTimeout(() => void translateRef.current(), 0)
      } catch (e) {
        if (ocrSeqRef.current !== seq) return
        setOcrState(null)
        setError('识别失败：' + (e instanceof Error ? e.message : String(e)))
      }
    })
    return off
  }, [autoTranslate, ocrLang, setError, setInput])

  useEffect(() => {
    if (!autoTranslate) return
    if (!input.trim() || mymemoryAutoBlocked) return
    // 接口没配就别自动跑：否则每敲一个字都弹一次红色错误条，等着用户去点「立即翻译」时提示一次就够了
    if (needsConfig) return
    const timer = setTimeout(() => void translateRef.current(), AUTO_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      // 输入又变了：正在跑的流式请求作废，断掉它免得两股译文交错写入
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
    }
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

  const clearAll = () => {
    setInput('')
    setOutput('')
    setError('')
    setElapsed(null)
  }

  return (
    <ToolShell
      icon={Languages}
      title="多语言智能翻译"
      subtitle={engineSummary}
      badge={
        needsConfig ? (
          <Tooltip content="打开设置里的翻译接口配置">
            <ToolBadge tone="amber" onClick={() => openAppSettings('translate-api')}>
              未配置，点此填写接口
            </ToolBadge>
          </Tooltip>
        ) : (
          <ToolBadge tone="emerald" pulse className="hidden sm:flex">
            {API_OPTIONS.find((item) => item.value === api)?.label ?? api}
            {elapsed !== null ? ` · ${elapsed}ms` : ' · 就绪'}
          </ToolBadge>
        )
      }
      actions={
        <>
          {/* 识别语言只影响 OCR，跟上面的翻译语言是两回事 */}
          <Select<OcrLanguage>
            value={ocrLang}
            onChange={setOcrLang}
            options={OCR_LANGUAGES}
            className="w-28"
            title="识别语言"
          />

          <Tooltip content="框选屏幕区域，识别其中的文字">
            <button
              onClick={() => void window.electronAPI?.startCapture?.()}
              disabled={!window.electronAPI?.startCapture}
              className="tool-button-secondary h-8"
            >
              <ScanText size={15} />
              <span>截图取字</span>
            </button>
          </Tooltip>

          <Select<TranslationAPI>
            value={api}
            onChange={setApi}
            options={API_OPTIONS}
            className="w-40"
            title="翻译引擎"
          />

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-8 ${
              showHistory
                ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                : ''
            }`}
          >
            <History size={15} />
            <span>历史记录</span>
          </button>
        </>
      }
      // 内容区自己带滚动容器：下面这块是整页排布，交给外壳反而要拆两层
      scroll={false}
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="最近翻译"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {/* 主工作区 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 flex flex-col gap-4">
        {/* MyMemory 不支持自动检测，提前说清楚，别让它把原文当译文返回 */}
        {mymemoryAutoBlocked && (
          <ToolNotice tone="warn" icon={TriangleAlert} className="flex-shrink-0">
            <span>MyMemory 不支持自动检测源语言，请指定源语言或改用 GTX。</span>
          </ToolNotice>
        )}

        {error && (
          <ToolNotice tone="error" icon={TriangleAlert} className="flex-shrink-0">
            <p className="whitespace-pre-line">{error}</p>
          </ToolNotice>
        )}

        {/* 双子卡片：原文 / 译文 */}
        <div className="tool-cascade flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[440px]">
          {/* ---------------- 原文 ---------------- */}
          <ToolCard>
            {/* 语言区自己换行，整条不做横向滚动 —— 滚动容器会把「更多」下拉截断在边上 */}
            <div className="flex items-start justify-between gap-2 px-4 py-2 min-h-11 border-b border-slate-100 dark:border-dark-border shrink-0">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mr-1 shrink-0">
                  源语言
                </span>
                {SOURCE_PILLS.map((code) => {
                  const active = sourceLang === code
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => handleSourceChange(code)}
                      className={pillClass(active)}
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
                    className={iconButtonClass('neutral', 'shrink-0')}
                  >
                    <ArrowRightLeft size={15} />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* 识别进度：只有截了图、还在识别时才出现，识别完自动收掉 */}
          {ocrState?.status === 'recognizing' && (
            <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2 shrink-0">
              <Loader2 size={13} className="animate-spin text-brand-500 shrink-0" />
              <span className="text-[11px] font-medium text-brand-700 dark:text-brand-300 shrink-0">
                {ocrState.label}
              </span>
              <div className="flex-1 h-1 rounded-full bg-brand-200/50 dark:bg-brand-500/20 overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-[width] duration-200"
                  style={{ width: `${Math.round(ocrState.progress * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-brand-500 tabular-nums shrink-0">
                {Math.round(ocrState.progress * 100)}%
              </span>
            </div>
          )}

          <div className="flex-1 min-h-0 p-4 flex flex-col">
              <textarea
                ref={inputRef}
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
                className="w-full flex-1 bg-transparent resize-none outline-none text-[13px] leading-7 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600"
              />
            </div>

            <ToolCardFooter>
              <div className="flex items-center gap-3 min-w-0">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={unwrapLines}
                    onChange={(e) => setUnwrapLines(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-dark-border accent-brand-600 focus:ring-0"
                  />
                  <span>合并断行（PDF/代码）</span>
                </label>
                {input && (
                  <>
                    <span className="text-slate-200 dark:text-dark-border">|</span>
                    <button
                      onClick={clearAll}
                      className="flex items-center gap-1 text-[11px] hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    >
                      <Trash2 size={12} />
                      <span>清空</span>
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-mono">{input.length} 字符</span>
                <Tooltip content="朗读原文">
                  <button
                    type="button"
                    onClick={() => speakText(input, sourceSpeakLang)}
                    disabled={!input.trim()}
                    className={iconButtonClass('brand')}
                  >
                    <Volume2 size={14} />
                  </button>
                </Tooltip>
              </div>
            </ToolCardFooter>
          </ToolCard>

          {/* ---------------- 译文 ---------------- */}
          <ToolCard>
            <div className="flex items-start justify-between gap-2 px-4 py-2 min-h-11 border-b border-slate-100 dark:border-dark-border shrink-0">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mr-1 shrink-0">
                  目标语言
                </span>

                {/* 自动双向：方向随输入走，不必每次手动切 */}
                <button
                  type="button"
                  onClick={() => setTargetLang(AUTO_TARGET)}
                  className={pillClass(targetLang === AUTO_TARGET)}
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
                      className={pillClass(active)}
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

            <div className="flex-1 min-h-0 p-4 flex flex-col">
              {/*
                加载态与占位文案走同一个内联槽位，不做绝对定位浮在上层 ——
                浮层会和下面的占位文字叠在一起，两者字号、基线都对不齐。
              */}
              <div className="flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-7 text-slate-800 dark:text-slate-100">
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
                  <span className="text-slate-300 dark:text-slate-600">译文将实时在此呈现…</span>
                )}
              </div>
            </div>

            <ToolCardFooter>
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
                <span className="font-mono font-medium shrink-0">
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

              <div className="flex items-center gap-1.5 shrink-0">
                <Tooltip content="朗读译文">
                  <button
                    type="button"
                    onClick={() => speakText(output, effectiveTarget)}
                    disabled={!output}
                    className={iconButtonClass('brand')}
                  >
                    <Volume2 size={14} />
                  </button>
                </Tooltip>
                <CopyButton value={() => output} disabled={!output} label="复制译文" />
              </div>
            </ToolCardFooter>
          </ToolCard>
        </div>

        {/* 底部动作条 */}
        <ToolActionBar
          info={
            <div className="flex items-center gap-4 md:gap-6 flex-wrap">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => setAutoTranslate(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-dark-border accent-brand-600 focus:ring-0"
                />
                <span>实时自动翻译（防抖 {AUTO_DEBOUNCE_MS}ms）</span>
              </label>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
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
          }
        >
          <button
            onClick={() => void handleTranslate()}
            disabled={!canTranslate}
            className={BTN.primary}
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
        </ToolActionBar>
      </div>
    </ToolShell>
  )
}
