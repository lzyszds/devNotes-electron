import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { fetchModels, type ModelInfo } from '../../utils/fetchModels'
import {
  AI_PRESETS,
  AI_RECOMMENDED_PRESET_ID,
  DEFAULT_AI_CHANNEL,
  chatCompletion,
  findAiPreset,
  loadAiChannel,
  saveAiChannel,
  type AiChannelConfig,
} from '../../utils/aiChannel'
import { useToast } from '../ui/Toast'
import { NoteCard, Select } from '../ui'
import Tooltip from '../ui/Tooltip'

const INPUT_CLASS =
  'w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 transition-all shadow-2xs'

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5'

/** 全局设置 · AI 渠道：项目里所有 AI 功能共用的服务商与模型配置 */
export default function AiChannelPanel() {
  const { showToast } = useToast()
  const [form, setForm] = useState<AiChannelConfig>(DEFAULT_AI_CHANNEL)
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchModelsError, setFetchModelsError] = useState('')
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
    elapsedMs: number
  } | null>(null)

  useEffect(() => {
    loadAiChannel().then(setForm)
  }, [])

  const patch = (next: Partial<AiChannelConfig>) => {
    setForm((prev) => ({ ...prev, ...next }))
    setTestResult(null)
  }

  const activePreset = findAiPreset(form.baseUrl)

  const modelSelectOptions = useMemo(() => {
    const options = modelOptions.map((m) => ({ value: m.id, label: m.label }))
    const current = form.model.trim()
    if (current && !modelOptions.some((m) => m.id === current)) {
      options.unshift({ value: current, label: `${current}（不在列表中）` })
    }
    return options
  }, [modelOptions, form.model])

  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setFetchModelsError('')
    const result = await fetchModels({ baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model })
    setIsFetchingModels(false)
    if (!result.ok) {
      setFetchModelsError(result.error || '拉取失败')
      return
    }
    setModelOptions(result.models)
    if (!form.model.trim() && result.models[0]) patch({ model: result.models[0].id })
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    const outcome = await chatCompletion(
      [{ role: 'user', content: '请只回复两个字：你好' }],
      // 推理模型（NVIDIA NIM 的 nemotron / step / glm 等）要先跑一大段思考才出
      // 正式回答，16 个 token 连思考都跑不完就被截断。给足预算，慢一点但测得准。
      { temperature: 0, maxTokens: 1024 },
      { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model },
    )
    setTestResult({
      ok: outcome.ok,
      message: outcome.ok ? `连接成功，模型回复：${outcome.text.trim()}` : outcome.error || '测试失败',
      elapsedMs: outcome.elapsedMs,
    })
    setIsTesting(false)
  }

  const handleSave = async () => {
    await saveAiChannel(form)
    showToast('AI 渠道已保存')
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLASS}>服务商</label>
        <div className="flex flex-wrap gap-1.5">
          {AI_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id
            const recommended = preset.id === AI_RECOMMENDED_PRESET_ID
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  const model = preset.models.includes(form.model) ? form.model : preset.models[0] ?? ''
                  setModelOptions([])
                  setFetchModelsError('')
                  patch({ baseUrl: preset.baseUrl, model })
                }}
                title={preset.note ?? preset.baseUrl}
                className={`px-2.5 h-7 rounded-lg text-[11px] font-medium border transition-colors inline-flex items-center gap-1 ${
                  active
                    ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
                }`}
              >
                {preset.label}
                {recommended && (
                  <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">推荐</span>
                )}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setModelOptions([])
              setFetchModelsError('')
              patch({ baseUrl: '', model: '' })
            }}
            className={`px-2.5 h-7 rounded-lg text-[11px] font-medium border transition-colors ${
              !activePreset
                ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
                : 'border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
            }`}
          >
            自定义
          </button>
        </div>
        {activePreset?.note && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1.5">{activePreset.note}</p>
        )}
      </div>

      <div>
        <label className={LABEL_CLASS}>Base URL</label>
        <input
          type="text"
          value={form.baseUrl}
          onChange={(e) => {
            setModelOptions([])
            patch({ baseUrl: e.target.value })
          }}
          placeholder="https://api.example.com/v1"
          className={`${INPUT_CLASS} font-mono`}
        />
        <p className="text-[10px] text-slate-400 mt-1">
          任何 OpenAI 兼容接口都可以，填到版本段即可（如 /v1），没写会自动补上。
        </p>
      </div>

      <div>
        <label className={LABEL_CLASS}>API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
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
        <p className="text-[10px] text-slate-400 mt-1">本地模型（如 Ollama）无需 Key，留空即可。</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={LABEL_CLASS}>模型</label>
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            disabled={isFetchingModels || !form.baseUrl.trim()}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          >
            {isFetchingModels ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {isFetchingModels ? '拉取中…' : '从接口拉取列表'}
          </button>
        </div>

        {modelOptions.length > 0 ? (
          <Select
            value={form.model}
            onChange={(model) => patch({ model })}
            options={modelSelectOptions}
            placeholder={`选择模型（共 ${modelOptions.length} 个）`}
            title="可用模型"
            className="w-full font-mono"
            menuMinWidth={320}
          />
        ) : (
          <input
            type="text"
            value={form.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="deepseek-chat"
            className={`${INPUT_CLASS} font-mono`}
          />
        )}

        {fetchModelsError && (
          <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">{fetchModelsError}</p>
        )}
        {!fetchModelsError && (activePreset?.models.length ?? 0) > 0 && modelOptions.length === 0 && (
          <p className="text-[10px] text-slate-400 mt-1 select-text">
            推荐：{activePreset!.models.join('、')}
          </p>
        )}
      </div>

      <NoteCard variant="warning" icon={KeyRound} title="密钥安全提示">
        密钥以明文保存在本机配置文件中，请勿在共享设备上使用，建议使用权限受限的专用 Key。
      </NoteCard>

      {testResult && (
        <NoteCard variant={testResult.ok ? 'success' : 'danger'}>
          <span className="break-all select-text">{testResult.message}</span>
          <span className="block text-[11px] opacity-70 pt-1">耗时 {testResult.elapsedMs} ms</span>
        </NoteCard>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-dark-border">
        <span className="text-[10px] text-slate-400 truncate">
          {form.model.trim() ? `当前：${form.model.trim()}` : '尚未配置模型'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isTesting || !form.baseUrl.trim() || !form.model.trim()}
            onClick={handleTest}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200/60 dark:border-dark-border transition-all active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50"
          >
            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            <span>测试连接</span>
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
