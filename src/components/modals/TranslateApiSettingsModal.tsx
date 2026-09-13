import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Languages, Loader2, X } from 'lucide-react'
import { useToast } from '../ui/Toast'
import {
  DEFAULT_TRANSLATE_CONFIG,
  loadTranslateConfig,
  saveTranslateConfig,
  type TranslateApiConfig,
  type TranslateProvider,
} from '../../utils/translateConfig'
import { probeProvider } from '../../utils/translateProviders'

export interface TranslateApiSettingsModalProps {
  open: boolean
  onClose: () => void
}

const INPUT_CLASS =
  'w-full px-3 py-1.5 text-xs bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border rounded-lg outline-none focus:border-indigo-500 text-slate-800 dark:text-white placeholder:text-slate-400'

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5'

const PROVIDER_OPTIONS: { value: TranslateProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'libretranslate', label: 'LibreTranslate' },
]

export default function TranslateApiSettingsModal({
  open,
  onClose,
}: TranslateApiSettingsModalProps) {
  const { showToast } = useToast()
  const [formConfig, setFormConfig] = useState<TranslateApiConfig>(DEFAULT_TRANSLATE_CONFIG)
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 每次打开都重新读盘，避免显示上一次的旧值
  useEffect(() => {
    if (!open) return
    setTestResult(null)
    loadTranslateConfig().then(setFormConfig)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

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
    onClose()
  }

  const currentLabel = PROVIDER_OPTIONS.find((o) => o.value === formConfig.provider)?.label

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-xl bg-white dark:bg-dark-panel rounded-2xl shadow-2xl border border-slate-200/80 dark:border-dark-border overflow-hidden flex flex-col max-h-[88vh]">
        {/* 头部 */}
        <div className="p-4 border-b border-slate-100 dark:border-dark-border flex items-center justify-between bg-slate-50/50 dark:bg-dark-sidebar/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">翻译接口设置</h3>
              <p className="text-xs text-slate-400">
                使用你自己的在线翻译服务，替代内置的 GTX / MyMemory
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className={LABEL_CLASS}>接口类型</label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-dark-hover rounded-xl">
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
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      active
                        ? 'bg-white dark:bg-dark-panel text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
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
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2"
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2"
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="p-2.5 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-[10px] text-amber-900 dark:text-amber-200 leading-relaxed">
            密钥以明文保存在本机配置文件中，请勿在共享设备上使用，建议使用权限受限的专用 Key。
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50'
                  : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <span className="break-all select-text">{testResult.message}</span>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="p-4 border-t border-slate-100 dark:border-dark-border flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400">当前：{currentLabel}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTest}
              className="px-3.5 py-1.5 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>测试翻译</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
