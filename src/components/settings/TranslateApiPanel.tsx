import { useEffect, useMemo, useState } from 'react'
import { Clock, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Timer, Zap } from 'lucide-react'
import { PROVIDER_PRESETS, type ThinkingParamStyle } from '../../utils/translateConfig'
import { fetchModels, type ModelInfo } from '../../utils/fetchModels'
import { useToast } from '../ui/Toast'
import { NoteCard, Select, Switch, type SelectOption } from '../ui'
import {
  DEFAULT_TRANSLATE_CONFIG,
  loadTranslateConfig,
  saveTranslateConfig,
  type TranslateApiConfig,
  type TranslateProvider,
} from '../../utils/translateConfig'
import { probeProvider } from '../../utils/translateProviders'
import Tooltip from '../ui/Tooltip'

const INPUT_CLASS =
  'w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 transition-all shadow-2xs'

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5'

const PROVIDER_OPTIONS: { value: TranslateProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'libretranslate', label: 'LibreTranslate' },
]

/** 全局设置 · AI 与翻译：在线翻译接口配置面板（自 TranslateApiSettingsModal 迁移而来） */
export default function TranslateApiPanel() {
  const { showToast } = useToast()
  const [formConfig, setFormConfig] = useState<TranslateApiConfig>(DEFAULT_TRANSLATE_CONFIG)
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  /** 从 /models 拉到的可选模型，空数组表示还没拉过（退回手填） */
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchModelsError, setFetchModelsError] = useState('')

  /** 关闭思考的参数写法。带说明是因为名字本身看不出区别 */
  const THINKING_PARAM_OPTIONS: SelectOption<ThinkingParamStyle>[] = [
    { value: 'enable_thinking', label: 'enable_thinking: false' },
    { value: 'chat_template_kwargs', label: 'chat_template_kwargs' },
  ]
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
    /** 总耗时（毫秒），失败时也有 */
    elapsedMs: number
    /** 首字延迟，仅 OpenAI 兼容接口有 */
    firstTokenMs?: number
    /** 测试发生的时刻，便于对比多次结果 */
    at: number
  } | null>(null)

  // 面板挂载即读盘，避免显示上一次会话的旧值
  useEffect(() => {
    loadTranslateConfig().then(setFormConfig)
  }, [])

  const patchOpenAI = (patch: Partial<TranslateApiConfig['openai']>) =>
    setFormConfig((prev) => ({ ...prev, openai: { ...prev.openai, ...patch } }))

  const patchLibre = (patch: Partial<TranslateApiConfig['libretranslate']>) =>
    setFormConfig((prev) => ({ ...prev, libretranslate: { ...prev.libretranslate, ...patch } }))

  /** 当前 Base URL 命中的预设，用于高亮与提示 */
  const activePreset = PROVIDER_PRESETS.find(
    (p) => p.baseUrl === formConfig.openai.baseUrl.trim(),
  )

  /**
   * 模型下拉的选项。
   *
   * 手填过、但这次拉取的列表里没有的模型，额外补一项 —— 否则用户切一下
   * 下拉就把原来的值弄丢了（下拉里没有它，Select 会显示成空）。
   */
  const modelSelectOptions = useMemo(() => {
    const options = modelOptions.map((m) => ({ value: m.id, label: m.label }))
    const current = formConfig.openai.model.trim()
    if (current && !modelOptions.some((m) => m.id === current)) {
      options.unshift({ value: current, label: `${current}（不在列表中）` })
    }
    return options
  }, [modelOptions, formConfig.openai.model])

  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setFetchModelsError('')
    const result = await fetchModels(formConfig.openai)
    setIsFetchingModels(false)
    if (!result.ok) {
      setFetchModelsError(result.error || '拉取失败')
      return
    }
    setModelOptions(result.models)
    // 列表拉到了但还没选模型，顺手填第一个，省一次点击
    if (!formConfig.openai.model.trim()) patchOpenAI({ model: result.models[0].id })
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    const startedAt = Date.now()
    const outcome = await probeProvider(
      formConfig.provider,
      formConfig.provider === 'openai' ? formConfig.openai : formConfig.libretranslate
    )

    setTestResult({
      ok: outcome.ok,
      message: outcome.ok ? `连接成功，接口返回：${outcome.text}` : outcome.error || '测试失败',
      elapsedMs: outcome.elapsedMs,
      firstTokenMs: outcome.firstTokenMs,
      at: startedAt,
    })
    setIsTesting(false)
  }

  /** 耗时分级着色：200ms 内算快，1 秒以上提醒用户这条链路偏慢 */
  const speedTone = (ms: number) =>
    ms < 200
      ? 'text-emerald-600 dark:text-emerald-400'
      : ms < 1000
        ? 'text-slate-500 dark:text-slate-400'
        : 'text-amber-600 dark:text-amber-400'

  /** 毫秒转可读文本 */
  const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`)

  const handleSave = async () => {
    await saveTranslateConfig(formConfig)
    showToast('翻译接口配置已保存')
  }

  const currentLabel = PROVIDER_OPTIONS.find((o) => o.value === formConfig.provider)?.label

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLASS}>接口类型</label>
        <div className="grid grid-cols-2 gap-0.5 p-0.5 bg-slate-100 dark:bg-dark-sidebar rounded-xl border border-slate-200/60 dark:border-dark-border">
          {PROVIDER_OPTIONS.map((opt) => {
            const active = formConfig.provider === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setFormConfig((prev) => ({ ...prev, provider: opt.value }))
                  setTestResult(null)
                }}
                className={`py-1.5 text-xs rounded-lg transition-all ${
                  active
                    ? 'bg-white dark:bg-dark-panel text-slate-900 dark:text-white font-semibold shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {formConfig.provider === 'openai' ? (
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Base URL</label>
            <input
              type="text"
              value={formConfig.openai.baseUrl}
              onChange={(e) => patchOpenAI({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className={`${INPUT_CLASS} font-mono`}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              请包含版本段（如 /v1）。DeepSeek、通义、硅基流动、Ollama 等兼容服务填各自的地址即可。
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={formConfig.openai.apiKey}
                onChange={(e) => patchOpenAI({ apiKey: e.target.value })}
                placeholder="sk-..."
                className={`${INPUT_CLASS} pr-9 font-mono`}
              />
              <Tooltip content={showKey ? '隐藏' : '显示'}>
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* 服务商预设：一键填好 Base URL 与推荐模型，省得翻文档 */}
          <div>
            <label className={LABEL_CLASS}>服务商预设</label>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_PRESETS.map((preset) => {
                const active = formConfig.openai.baseUrl.trim() === preset.baseUrl
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      patchOpenAI({
                        baseUrl: preset.baseUrl,
                        // 只在模型为空时填默认值，别把用户手填的覆盖掉
                        model: formConfig.openai.model.trim() || preset.models[0] || '',
                      })
                    }
                    title={preset.note ?? preset.baseUrl}
                    className={`px-2.5 h-7 rounded-lg text-[11px] font-medium border transition-colors ${
                      active
                        ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
                    }`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            {activePreset?.note && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1.5">
                {activePreset.note}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={LABEL_CLASS}>模型名</label>
              <button
                type="button"
                onClick={() => void handleFetchModels()}
                disabled={isFetchingModels || !formConfig.openai.baseUrl.trim()}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              >
                {isFetchingModels ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <RefreshCw size={10} />
                )}
                {isFetchingModels ? '拉取中…' : '从接口拉取列表'}
              </button>
            </div>

            {/* 拉到列表就用下拉，没拉过就退回手填 —— 不是所有网关都实现了 /models */}
            {modelOptions.length > 0 ? (
              <Select
                value={formConfig.openai.model}
                onChange={(model) => patchOpenAI({ model })}
                options={modelSelectOptions}
                placeholder={`选择模型（共 ${modelOptions.length} 个）`}
                title="可用模型"
                className="w-full font-mono"
                menuMinWidth={320}
              />
            ) : (
              <input
                type="text"
                value={formConfig.openai.model}
                onChange={(e) => patchOpenAI({ model: e.target.value })}
                placeholder="Qwen/Qwen3-30B-A3B-Instruct-2507"
                className={`${INPUT_CLASS} font-mono`}
              />
            )}

            {fetchModelsError && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">{fetchModelsError}</p>
            )}
            {formConfig.openai.model && !fetchModelsError && (
              <p className="text-[10px] text-slate-400 mt-1">
                当前：<span className="font-mono">{formConfig.openai.model}</span>
              </p>
            )}
          </div>

          {/* 关闭思考模式：推理模型的配置项，翻译场景下几乎总是该打开 */}
          <div className="rounded-xl border border-slate-200/70 dark:border-dark-border p-3 space-y-2.5">
            <Switch
              checked={formConfig.openai.disableThinking === true}
              onChange={(checked) => patchOpenAI({ disableThinking: checked })}
              label="关闭思考模式"
              description="推理模型（Qwen3.5 系列、DeepSeek-R1 等）会先生成一大段思考再输出，翻译场景下纯属浪费 —— 实测 Qwen3.5-9B 首字要等 5.4 秒。打开此项可直接出译文。"
            />

            {formConfig.openai.disableThinking && (
              <div className="pt-1 border-t border-slate-100 dark:border-dark-border">
                <label className={LABEL_CLASS}>参数写法</label>
                <Select<ThinkingParamStyle>
                  value={formConfig.openai.thinkingParam ?? 'enable_thinking'}
                  onChange={(thinkingParam) => patchOpenAI({ thinkingParam })}
                  options={THINKING_PARAM_OPTIONS}
                  title="关闭思考的参数写法"
                  className="w-full"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  各家网关认的参数名不同。默认第一种；若报「未知参数」就换第二种。
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>服务地址</label>
            <input
              type="text"
              value={formConfig.libretranslate.baseUrl}
              onChange={(e) => patchLibre({ baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:5000"
              className={`${INPUT_CLASS} font-mono`}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              自建实例示例：docker run -p 5000:5000 libretranslate/libretranslate
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>API Key（可选）</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={formConfig.libretranslate.apiKey}
                onChange={(e) => patchLibre({ apiKey: e.target.value })}
                placeholder="公共实例通常无需填写"
                className={`${INPUT_CLASS} pr-9 font-mono`}
              />
              <Tooltip content={showKey ? '隐藏' : '显示'}>
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )}

      <NoteCard variant="warning" icon={KeyRound} title="密钥安全提示">
        密钥以明文保存在本机配置文件中，请勿在共享设备上使用，建议使用权限受限的专用 Key。
      </NoteCard>

      {testResult && (
        <NoteCard variant={testResult.ok ? 'success' : 'danger'}>
          <div className="flex flex-col gap-1.5">
            <span className="break-all select-text">{testResult.message}</span>

            {/*
              耗时单独一行：挑模型/接口时这个数字比「成功」有用得多。
              失败也给 —— 立刻报错（几十毫秒）和超时（几十秒）原因完全不同。
            */}
            <div className="flex items-center gap-3 text-[11px] pt-1 border-t border-current/10 flex-wrap">
              {/* 首字延迟才是体感速度：决定「按下到看见字开始动」的等待 */}
              {testResult.firstTokenMs !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <Zap size={11} className="opacity-70" />
                  <span className="opacity-70">首字</span>
                  <span
                    className={`font-semibold tabular-nums ${speedTone(testResult.firstTokenMs)}`}
                  >
                    {fmtMs(testResult.firstTokenMs)}
                  </span>
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Timer size={11} className="opacity-70" />
                <span className="opacity-70">总计</span>
                <span
                  className={`font-semibold tabular-nums ${speedTone(testResult.elapsedMs)}`}
                >
                  {fmtMs(testResult.elapsedMs)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 opacity-70">
                <Clock size={11} />
                <span className="tabular-nums">
                  {new Date(testResult.at).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </span>
              <span className="opacity-60">
                {(() => {
                  // 以首字延迟为准判断体验 —— 总耗时受译文长短影响，不该拿来评价
                  const ms = testResult.firstTokenMs ?? testResult.elapsedMs
                  return ms < 500 ? '很快' : ms < 1500 ? '正常' : '偏慢，可考虑换更小的模型'
                })()}
              </span>
            </div>
          </div>
        </NoteCard>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-dark-border">
        <span className="text-[10px] text-slate-400">当前：{currentLabel}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isTesting}
            onClick={handleTest}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200/60 dark:border-dark-border transition-all active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50"
          >
            {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>测试翻译</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg shadow-xs shadow-brand-500/20 transition-all active:scale-[0.98]"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}
