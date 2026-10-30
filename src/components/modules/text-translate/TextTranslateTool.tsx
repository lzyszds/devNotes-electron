import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import { AUTO_TARGET, useTranslate, useTranslateOutput } from '../../../context/TranslateContext'
import Tooltip from '../../ui/Tooltip'
import {
  BTN,
  Checkbox,
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
import { dlog } from '../../../utils/debugLog'
import {
  beginOcrRun,
  failOcrRun,
  finishOcrRun,
  getOcrSnapshot,
  isCurrentOcrRun,
  subscribeOcrRun,
  takeOcrResult,
  updateOcrProgress,
} from '../../../utils/ocrRunStore'
import {
  subscribeTranslateInbox,
  takeTranslateRequest,
  type TranslateRequest,
} from '../../../utils/translateInbox'
import { translateStream } from '../../../utils/translateStream'
import { createTranslateOutputBuffer } from '../../../utils/translateOutputBuffer'
import { CHUNK_BYTE_LIMIT, toSegments, unwrapHardBreaks } from '../../../utils/translateTextSegments'
import {
  DEFAULT_TRANSLATE_PREFS,
  loadTranslatePrefs,
  saveTranslatePrefs,
  type TranslatePrefs,
} from '../../../utils/translatePrefs'
import {
  OCR_LANGUAGES,
  recognizeText,
  type OcrLanguage,
} from '../../../utils/ocr'
import OcrProgressBar from './OcrProgressBar'

const API_OPTIONS: SelectOption<TranslationAPI>[] = [
  { value: 'gtx', label: 'GTX' },
  { value: 'mymemory', label: 'MyMemory' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'libretranslate', label: 'LibreTranslate' },
]

/** 翻译页组件的挂载序号，仅用于调试日志 */
let translateMountSeq = 0

/** 毫秒转「123ms / 1.2s」：一秒以内给毫秒，上面给秒 */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

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

/* 高频流式内容单独订阅；memo 挡住输入时对已有长译文的无关更新。 */
const TranslationOutput = memo(function TranslationOutput({
  isTranslating,
  progress,
}: {
  isTranslating: boolean
  progress: { current: number; total: number }
}) {
  const output = useTranslateOutput()
  return (
    <div className="flex-1 select-text overflow-y-scroll whitespace-pre-wrap break-words text-[13px] leading-7 text-slate-800 dark:text-slate-100">
      {output ? output : isTranslating ? (
        <span className="flex items-center gap-2 text-brand-600 dark:text-brand-400">
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          <span>翻译中{progress.total > 0 ? ` ${progress.current}/${progress.total}` : '…'}</span>
        </span>
      ) : (
        <span className="text-slate-300 dark:text-slate-600">译文将实时在此呈现…</span>
      )}
    </div>
  )
})

const TranslationOutputActions = memo(function TranslationOutputActions({ lang }: { lang: string }) {
  const output = useTranslateOutput()
  const { showToast } = useToast()
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Tooltip content="朗读译文">
        <button
          type="button"
          onClick={() => {
            if (!speak(output, lang)) showToast('当前环境不支持朗读', 'error')
          }}
          disabled={!output}
          className={iconButtonClass('brand')}
        >
          <Volume2 size={14} />
        </button>
      </Tooltip>
      <CopyButton value={output} disabled={!output} label="复制译文" />
    </div>
  )
})

export default function TextTranslateTool() {
  /*
   * 挂载/卸载留痕。冷启动第一次截图出现「已订阅但没收到图」时，这两个日志能
   * 直接区分两种情况：StrictMode 双挂载、或组件被反复卸载重挂（切页动画把
   * 翻译页整个换掉了）。
   */
  useEffect(() => {
    const instance = ++translateMountSeq
    dlog('[translate] 组件挂载 #' + instance)
    return () => dlog('[translate] 组件卸载 #' + instance)
  }, [])

  // 语言偏好、输入输出、历史都在模块 context 里：专属侧边栏与这里共用同一份数据
  const {
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
  const prefsLoadedRef = useRef(false)

  /** 改一项就同步状态；实际落盘移至后台 effect，不阻塞当前帧交互 */
  const patchPrefs = (patch: Partial<TranslatePrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }))
  }
  const setApi = (value: TranslationAPI) => patchPrefs({ api: value })
  const setAutoTranslate = (value: boolean) => patchPrefs({ autoTranslate: value })
  const setUnwrapLines = (value: boolean) => patchPrefs({ unwrapLines: value })
  const setOcrLang = (value: OcrLanguage) => patchPrefs({ ocrLang: value })

  useEffect(() => {
    void loadTranslatePrefs().then((saved) => {
      setPrefs(saved)
      prefsLoadedRef.current = true
    })
  }, [])

  // 偏好变更后异步写盘，避免在交互主链路内同步执行 IPC 引发掉帧
  useEffect(() => {
    if (!prefsLoadedRef.current) return
    void saveTranslatePrefs(prefs)
  }, [prefs])

  const [translateConfig, setTranslateConfig] = useState<TranslateApiConfig | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  /*
   * 识别进度与结果放在模块级 store 里（utils/ocrRunStore）：
   * Keep-Alive 环境下本组件可能被卸载重建，状态不能跟着实例一起丢。
   */
  const ocrSnapshot = useSyncExternalStore(subscribeOcrRun, getOcrSnapshot, getOcrSnapshot)
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
  const requestAbortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const [isComposing, setIsComposing] = useState(false)

  /**
   * 作废「正在跑的这次翻译」：递增代际、断流、立刻解除忙碌。
   *
   * 输入一变就同步调它 —— 旧请求的迟到结果写不进来，新的自动翻译也不会
   * 被上一轮的忙碌状态挡在门外（原来要等旧请求自己结束，长文下能拖好几秒）。
   */
  const cancelTranslation = () => {
    ++runIdRef.current
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    busyRef.current = false
    setIsTranslating(false)
  }

  /*
   * 当前引擎实际用到的配置，变化时要作废旧译文。只比这一段而不是整个对象：
   * GTX / MyMemory 与自定义接口无关，OpenAI 的改动也不该影响 LibreTranslate
   * 的请求 —— 否则在设置里改个无关项就把手头这轮翻译掐掉了。
   */
  const activeProviderConfig =
    api === 'openai'
      ? JSON.stringify(translateConfig?.openai ?? null)
      : api === 'libretranslate'
        ? JSON.stringify(translateConfig?.libretranslate ?? null)
        : ''

  useEffect(() => {
    cancelTranslation()
    return () => {
      ++runIdRef.current
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
      requestAbortRef.current?.abort()
      requestAbortRef.current = null
      busyRef.current = false
    }
  }, [input, sourceLang, targetLang, primaryLang, api, unwrapLines, activeProviderConfig])

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

  const needsConfig = isProvider(api) &&
    (translateConfig?.provider !== api || !isProviderConfigured(translateConfig))
  // MyMemory 不支持自动检测：langpair=auto|xx 不被接受，它会把原文当译文静默返回
  const mymemoryAutoBlocked = api === 'mymemory' && sourceLang === AUTO_LANG
  // 空输入 / 正在翻译 / 引擎与源语言冲突，这三种情况都不发起翻译
  const canTranslate = !!input.trim() && !isTranslating && !isComposing && !mymemoryAutoBlocked

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
    const outputBuffer = createTranslateOutputBuffer((full) => {
      if (myId === runIdRef.current) setOutput(full)
    })
    controller.signal.addEventListener('abort', outputBuffer.cancel, { once: true })

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
          outputBuffer.push(full)
        },
      })

      if (myId !== runIdRef.current) return
      outputBuffer.flush()
      if (result.ok) setOutput(result.text)
      if (!result.ok && result.error && result.error !== '已取消') {
        setError(result.error)
        // 部分译文也留着，比清空更有用
        if (result.text) setOutput(result.text)
      }
      reportTranslateTime(Math.round(performance.now() - startedAt))
      if (result.ok) {
        const from = sourceLang === AUTO_LANG ? '自动检测' : langName(sourceLang)
        saveHistory(text, `翻译: ${from} → ${langName(target)}`)
      }
    } catch (e) {
      if (myId === runIdRef.current) setError('翻译过程中出错: ' + (e as Error).message)
    } finally {
      outputBuffer.cancel()
      controller.signal.removeEventListener('abort', outputBuffer.cancel)
      if (streamAbortRef.current === controller) streamAbortRef.current = null
      if (myId === runIdRef.current) {
        busyRef.current = false
        setIsTranslating(false)
      }
    }
  }

  /**
   * 最近一次「截图识别」的耗时，等着和紧随其后的那次翻译拼成一条记录。
   *
   * 用 ref 而不是 state：它只是给 reportTranslateTime 读的临时值，
   * 放进 state 反而会让每次翻译都多一轮渲染。
   */
  const ocrTimingRef = useRef<{ ocrMs: number } | null>(null)
  /** 状态栏上展示的耗时组合（识别 / 翻译 / 合计） */
  const [ocrTiming, setOcrTiming] = useState<{
    ocrMs: number
    translateMs?: number
    combinedMs?: number
  } | null>(null)

  /**
   * 翻译耗时的唯一出口。
   *
   * 除了「只翻译」的 ms，还顺手记下一个组合耗时：
   *  - 截图识别 → 自动翻译：记录 = 识别 + 翻译；
   *  - 普通翻译：记录 = 翻译。
   * 状态栏显示哪个见后面的 render，两段都能看到，不必自己相加。
   */
  const reportTranslateTime = (ms: number) => {
    setElapsed(ms)
    const ocr = ocrTimingRef.current
    if (ocr) {
      setOcrTiming({ ...ocr, translateMs: ms, combinedMs: ocr.ocrMs + ms })
    } else {
      setOcrTiming(null)
    }
  }

  const handleTranslate = async () => {
    if (!input.trim() || busyRef.current || isComposing || mymemoryAutoBlocked) return
    dlog('[translate] 开始翻译，输入长度', input.length)
    // 翻译真的起来了：截图的看门狗不必再补
    ocrTranslatePendingRef.current = 0
    window.clearTimeout(ocrTranslateWatchdogRef.current)

    if (needsConfig) {
      setError(
        `尚未配置「${providerLabel(api as 'openai' | 'libretranslate')}」接口。\n\n` +
          '请点击顶部的「未配置」按钮，或从顶栏进入设置填写后重试。'
      )
      return
    }

    setError('')
    busyRef.current = true
    setIsTranslating(true)
    setProgress({ current: 0, total: 0 })

    const myId = ++runIdRef.current
    const text = input
    const startedAt = performance.now()
    /* 记下一次翻译真正的起点：截图识别后的翻译要能把两段耗时合并显示 */

    /*
     * OpenAI 兼容接口走流式：文字边生成边显示，不用干等整段翻译完。
     * LibreTranslate 之类的接口没有流式能力，保持原来的整段返回。
     */
    if (api === 'openai' && translateConfig?.openai) {
      await runStreaming(text, myId, startedAt, effectiveTarget)
      return
    }

    const controller = new AbortController()
    requestAbortRef.current = controller
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
        shouldStop: () => myId !== runIdRef.current,
        signal: controller.signal,
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
      reportTranslateTime(Math.round(performance.now() - startedAt))
      // 即使部分失败也把已拿到的译文显示出来（失败块回落原文）
      if (!result.ok && result.error) setError(result.error)

      if (result.ok) {
        const from = sourceLang === AUTO_LANG ? '自动检测' : langName(sourceLang)
        saveHistory(text, `翻译: ${from} → ${langName(effectiveTarget)}`)
      }
    } catch (e) {
      if (myId === runIdRef.current) setError('翻译过程中出错: ' + (e as Error).message)
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null
      if (myId === runIdRef.current) {
        busyRef.current = false
        setIsTranslating(false)
      }
    }
  }

  // 实时翻译的定时器要用到「最新那次渲染的 handleTranslate」，
  // 而它每次渲染都会重建 —— 直接进依赖数组会把自己无限重启，所以走 ref。
  const translateRef = useRef(handleTranslate)
  translateRef.current = handleTranslate

  /**
   * 截图取字：收到图片 → OCR → 填进输入框并翻译。
   *
   * 开着自动翻译会走下面那条 debounce，所以填完 input 什么都不用做，
   * 翻译会自己跟上；这里只需要在关掉自动翻译时手动触发一次。
   */
  /**
   * 截图识别是否在等一次自动翻译。
   *
   * 冷启动后第一次截图时，翻译页是刚挂载的：`input` 从空变成识别结果，自动
   * 翻译那条 300ms 防抖会起跑；但同一时刻挂载流程里还有别的 effect 在跑，
   * 实测那次翻译会被「切页/挂载」撞掉（用户看到的就是只填了原文没出译文）。
   * 所以截图这条路自己记一笔，翻译丢了就补一次。
   */
  const ocrTranslatePendingRef = useRef(0)
  /** 上面那笔「待翻译」的看门狗计时器 */
  const ocrTranslateWatchdogRef = useRef(0)

  /**
   * 处理一件排队来的活（截图识别 / 待翻译文字）。
   *
   * 活由 utils/translateInbox 收件，这里在挂载后与「有新活」时来取。
   * 不在本组件里直接监听 IPC：翻译页是懒加载的，冷启动第一次截图时它还不存在。
   */
  const runRequest = useCallback(async (request: TranslateRequest) => {
    if (request.kind === 'text') {
      setInput(request.text)
      // 纯文字直接翻，不必等自动翻译的防抖（用户是明确点了「翻译这段」）
      window.setTimeout(() => void translateRef.current(), 0)
      return
    }

    /*
     * 截图识别：状态全部写进 ocrRunStore，而不是本组件的 state。
     *
     * 这样即使本组件在识别途中被卸载重建（Keep-Alive / Suspense 都可能），
     * 进度仍然在 store 里继续更新，结果也会落在新挂载的实例上 —— 不会出现
     * 「识别时看不到进度、识别完才突然冒出来」。
     */
    const seq = beginOcrRun()
    setError('')
    dlog('[translate] 收到图片，开始识别 seq', seq)

    try {
      const text = await recognizeText(request.dataUrl, {
        lang: ocrLang,
        onProgress: (p) => updateOcrProgress(seq, p),
      })
      if (!isCurrentOcrRun(seq)) return

      if (!text) {
        failOcrRun(seq)
        setError('没有从这张图里识别出文字，换个区域或换个语言试试')
        return
      }

      dlog('[translate] 识别完成，seq', seq, 'autoTranslate =', autoTranslate)
      finishOcrRun(seq, text)

      /*
       * 记下「这次识别还在等译文」：handleTranslate 一旦真的启动就会把它清掉，
       * 2.5s 后还没清就说明自动翻译那次被吞了（冷启动挂载/切页时会发生），
       * 由看门狗补一次。只在开着自动翻译时需要 —— 关着的话下面立刻手动翻。
       */
      ocrTranslatePendingRef.current = autoTranslate ? seq : 0
      window.clearTimeout(ocrTranslateWatchdogRef.current)
      ocrTranslateWatchdogRef.current = window.setTimeout(() => {
        // 防抖 300ms + 挂载余量，2.5s 还没看到翻译启动就补一次
        dlog('[translate] 看门狗触发，补一次翻译；pending =', ocrTranslatePendingRef.current, 'seq =', seq)
        if (ocrTranslatePendingRef.current !== seq) return
        ocrTranslatePendingRef.current = 0
        void translateRef.current()
      }, 2500)
      // 关掉自动翻译时不会有 debounce 兜底，这里补一次
      if (!autoTranslate) window.setTimeout(() => void translateRef.current(), 0)
    } catch (e) {
      if (!isCurrentOcrRun(seq)) return
      failOcrRun(seq)
      setError('识别失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }, [autoTranslate, ocrLang, setError, setInput])

  /*
   * 识别结果从 store 取出来填进输入框。
   *
   * 放在渲染期的 effect 里而不是识别完成时直接 setInput：组件可能是重挂后的
   * 新实例，只有它在跑 effect 才说明已经就绪。
   */
  useEffect(() => {
    const result = takeOcrResult()
    if (!result) return
    setInput(result.text)
    // 记下识别耗时：紧接着的翻译会把两段拼成「识别 + 翻译」一起显示
    ocrTimingRef.current = { ocrMs: result.elapsedMs }
    setOcrTiming({ ocrMs: result.elapsedMs })
    dlog('[translate] 消费识别结果', result.text.length, '字符')
  }, [ocrSnapshot])

  /*
   * 挂载即来取活：冷启动第一次截图时，图早就在队列里等着了。
   * 之后靠事件驱动（桥入队时通知），不再轮询。
   *
   * ⚠️ 取原有活只在**真正的挂载**时做一次，不能放在下面这个 effect 体里。
   *
   * StrictMode 下 React 会把 effect 体跑两遍（挂载 → 卸载 → 再挂载），日志里
   * 就是「开始取活 / 取到活 ocr / 组件卸载 / 开始取活」。effect 体里再 take
   * 一次的话，队列里若恰好还有第二张截图（连截两张很常见），第二趟就会把它
   * 领走并重新 beginOcrRun —— 识别进度被打回 0，第一帧就处在「刚开始」的
   * 状态，翻页动画的起点跟着错位。所以：
   *   - 挂载时取件放在 ref 守卫后面，双跑也只取一次；
   *   - effect 本体只负责订阅，真要走事件路径。
   */
  const drainStartedRef = useRef(false)

  useEffect(() => {
    const take = (next: TranslateRequest) => {
      dlog('[translate] 取到活', next.kind)
      void runRequest(next)
    }

    return subscribeTranslateInbox(() => {
      const request = takeTranslateRequest()
      if (request) take(request)
    })
  }, [runRequest])

  useEffect(() => {
    if (drainStartedRef.current) return
    drainStartedRef.current = true
    dlog('[translate] 开始取活（挂载）')
    const request = takeTranslateRequest()
    if (request) {
      dlog('[translate] 取到活', request.kind)
      void runRequest(request)
    }
  }, [runRequest])

  useEffect(() => {
    if (!autoTranslate || isComposing) return
    if (!input.trim() || mymemoryAutoBlocked) return
    // 接口没配就别自动跑：否则每敲一个字都弹一次红色错误条，等着用户去点「立即翻译」时提示一次就够了
    if (needsConfig) return
    const timer = setTimeout(() => void translateRef.current(), AUTO_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input, autoTranslate, isComposing, sourceLang, targetLang, primaryLang, api, unwrapLines, activeProviderConfig, mymemoryAutoBlocked, needsConfig])

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
    cancelTranslation()
    setInput('')
    setOutput('')
    setError('')
    setElapsed(null)
    ocrTimingRef.current = null
    setOcrTiming(null)
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
      /*
       * scroll={false}：这一页是「固定满页 + 卡片内滚动」布局 —— 页面本身
       * 不滚动，原文/译文各自在卡片内部滚，东西多时页面骨架不动。
       */
      scroll={false}
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="最近翻译"
          items={history}
          onClear={clearHistory}
          onDelete={removeHistoryItem}
          onPick={(item) => {
            setInput(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {/* 主工作区：占满剩余高度，不滚动 —— 滚动交给卡片内部 */}
      <div className="flex-1 min-h-0 overflow-hidden p-3 lg:p-8 flex flex-col gap-4">
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

        {/*
          双子卡片：原文 / 译文。grid-rows 用 minmax(0,1fr)（grid-rows-* 写法）
          把行高钉死在视口内：缺省的 auto 行会被长内容撑开、顺带把整页撑出滚动，
          卡片里的 flex-1 min-h-0 也就失效了。手机单列时上下等分两行。
        */}
        <div className="tool-cascade flex-1 min-h-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1 gap-4">
          {/* ---------------- 原文 ---------------- */}
          <ToolCard className="min-h-0 overflow-hidden">
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

          <div className="flex-1 min-h-0 p-4 flex flex-col">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  // 打字先同步作废旧请求，别等 effect —— 晚一帧旧译文还会闪一下
                  cancelTranslation()
                  setInput(e.target.value)
                  if (error) setError('')
                }}
                onCompositionStart={() => {
                  cancelTranslation()
                  setIsComposing(true)
                }}
                onCompositionEnd={() => setIsComposing(false)}
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

            {/*
              底栏做成「上下滚翻」的槽位：识别时翻上去显示进度，识别完翻回来
              恢复原工具栏。两屏共用同一个固定高度，不改变布局尺寸，所以不会
              顶动上面的正文（见 OcrProgressBar 的注释）。
            */}
            {/* ⚠️ 不要换回 ToolCardFooter：它自带 h-8，与槽位的高度规则会打架 */}
            <div className="h-8 shrink-0 rounded-b-xl border-t border-[#E6E6E3] bg-[#FBFBFA]">
              {/* 进度直接读 store：组件重挂也不丢，收摊计时也在 store 里 */}
              <OcrProgressBar run={ocrSnapshot.run}>
                <div className="flex w-full items-center justify-between gap-3 px-3.5 text-[10px] font-medium text-[#787774] tabular-nums">
                  <div className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      size="sm"
                      checked={unwrapLines}
                      onChange={setUnwrapLines}
                      label={<span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">合并断行（PDF/代码）</span>}
                    />
                    {input && (
                      <>
                        <span className="text-slate-200 dark:text-dark-border">|</span>
                        <button
                          onClick={clearAll}
                          className="flex items-center gap-1 text-[11px] transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          <Trash2 size={12} />
                          <span>清空</span>
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
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
                </div>
              </OcrProgressBar>
            </div>
          </ToolCard>

          {/* ---------------- 译文 ---------------- */}
          <ToolCard className="min-h-0 overflow-hidden">
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
              <TranslationOutput isTranslating={isTranslating} progress={progress} />
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
                  ) : ocrTiming?.translateMs !== undefined ? (
                    /*
                     * 截图识别 + 翻译的完整链路：两段分开列，再给一个合计。
                     * 只显示翻译那段会让人以为「识别不算数」，只显示合计又看不出慢在哪一步。
                     */
                    <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <span title="识别耗时">识别 {formatDuration(ocrTiming.ocrMs)}</span>
                      <span className="text-emerald-600/40 dark:text-emerald-400/40">·</span>
                      <span title="翻译耗时">翻译 {formatDuration(ocrTiming.translateMs)}</span>
                      <span className="text-emerald-600/40 dark:text-emerald-400/40">·</span>
                      <span title="识别 + 翻译" className="font-semibold">
                        合计 {formatDuration(ocrTiming.combinedMs ?? ocrTiming.ocrMs + ocrTiming.translateMs)}
                      </span>
                    </span>
                  ) : elapsed !== null ? (
                    <span className="text-emerald-600 dark:text-emerald-400">● 耗时 {elapsed}ms</span>
                  ) : null}
                </span>
              </div>

              <TranslationOutputActions lang={effectiveTarget} />
            </ToolCardFooter>
          </ToolCard>
        </div>

        {/* 底部动作条 */}
        <ToolActionBar
          info={
            <div className="flex items-center gap-4 md:gap-6 flex-wrap">
              <Checkbox
                checked={autoTranslate}
                onChange={setAutoTranslate}
                label={`实时自动翻译（防抖 ${AUTO_DEBOUNCE_MS}ms）`}
              />
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
