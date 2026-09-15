import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useToast } from '../ui/Toast'
import { NoteCard } from '../ui'
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
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 面板挂载即读盘，避免显示上一次会话的旧值
  useEffect(() => {
    loadTranslateConfig().then(setFormConfig)
  }, [])

  const patchOpenAI = (patch: Partial<TranslateApiConfig['openai']>) =>
    setFormConfig((prev) => ({ ...prev, openai: { ...prev.openai, ...patch } }))

  const patchLibre = (patch: Partial<TranslateApiConfig['libretranslate']>) =>
    setFormConfig((prev) => ({ ...prev, libretranslate: { ...prev.libretranslate, ...patch } }))

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    const outcome = await probeProvider(
      formConfig.provider,
      formConfig.provider === 'openai' ? formConfig.openai : formConfig.libretranslate
    )

    setTestResult(
      outcome.ok
        ? { ok: true, message: `连接成功，接口返回：${outcome.text}` }
        : { ok: false, message: outcome.error || '测试失败' }
    )
    setIsTesting(false)
  }

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

          <div>
            <label className={LABEL_CLASS}>模型名</label>
            <input
              type="text"
              value={formConfig.openai.model}
              onChange={(e) => patchOpenAI({ model: e.target.value })}
              placeholder="gpt-4o-mini"
              className={`${INPUT_CLASS} font-mono`}
            />
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
          <span className="break-all select-text">{testResult.message}</span>
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
