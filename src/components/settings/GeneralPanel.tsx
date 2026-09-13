import { useEffect, useState } from 'react'
import { Check, Code2, Command, Moon, PanelLeft, Sun } from 'lucide-react'
import Select from '../ui/Select'
import {
  CODE_BLOCK_THEMES,
  getCachedCodeBlockTheme,
  getCodeBlockPreset,
  saveCodeBlockTheme,
  type CodeBlockThemeId,
} from '../../utils/codeBlockTheme'

/** 8 个档位直接做成下拉项，label 就是档位名 */
const CODE_THEME_OPTIONS = CODE_BLOCK_THEMES.map((preset) => ({
  value: preset.id,
  label: preset.label,
}))

export interface GeneralPanelProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  /** 把二级侧边栏宽度恢复为默认值 */
  onResetSidebarWidth: () => void
}

/** 顶栏与全局快捷键速查表 */
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘ K', label: '打开全局指令面板' },
  { keys: '⌘ B', label: '折叠 / 展开文档目录' },
  { keys: '⌘ N', label: '新建 Markdown 笔记' },
  { keys: '⌘ E', label: '导出当前文档为 .md' },
  { keys: '⌘ D', label: '切换浅色 / 深色主题' },
  { keys: '⌘ U', label: '打开云同步设置' },
  { keys: '⌘ ,', label: '打开全局设置' },
]

/** 全局设置 · 通用：外观、界面与关于信息 */
export default function GeneralPanel({
  theme,
  onToggleTheme,
  onResetSidebarWidth,
}: GeneralPanelProps) {
  const [version, setVersion] = useState('')

  // 纯本地偏好，选完即生效，不需要「保存」按钮。
  // 初值直接从模块缓存同步取：这个面板可能晚于编辑器挂载，那时缓存已是用户上次的值
  const [codeTheme, setCodeTheme] = useState<CodeBlockThemeId>(() => getCachedCodeBlockTheme())
  const activePreset = getCodeBlockPreset(codeTheme)

  const handleCodeThemeChange = (next: CodeBlockThemeId) => {
    setCodeTheme(next)
    saveCodeBlockTheme(next)
  }

  useEffect(() => {
    window.electronAPI
      ?.getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(''))
  }, [])

  const THEMES = [
    {
      value: 'light' as const,
      label: '浅色',
      hint: '明亮背景，适合白天与强光环境',
      icon: Sun,
    },
    {
      value: 'dark' as const,
      label: '深色',
      hint: '暗色背景，夜间长时间写作更护眼',
      icon: Moon,
    },
  ]

  return (
    <div className="space-y-6">
      {/* 外观 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          外观
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {THEMES.map((item) => {
            const active = theme === item.value
            const Icon = item.icon
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  if (!active) onToggleTheme()
                }}
                className={`relative p-3.5 rounded-xl border text-left transition-all ${
                  active
                    ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/20'
                    : 'border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover'
                }`}
              >
                {active && (
                  <span className="absolute top-2.5 right-2.5 text-brand-600 dark:text-brand-400">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
                <Icon
                  className={`w-4 h-4 mb-2 ${
                    active
                      ? 'text-brand-600 dark:text-brand-400'
                      : 'text-slate-400'
                  }`}
                />
                <div className="text-xs font-bold text-slate-800 dark:text-white">{item.label}</div>
                <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">{item.hint}</div>
              </button>
            )
          })}
        </div>
      </section>

      {/* 编辑器 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          编辑器
        </h4>
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-dark-border">
          <div className="flex items-start gap-2.5 min-w-0">
            <Code2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-800 dark:text-white">代码块主题</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    activePreset.tone === 'dark'
                      ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                  }`}
                >
                  {activePreset.tone === 'dark' ? '深色' : '浅色'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                {activePreset.hint}。三种编辑器内核共用同一档位，各自映射到同名风格的主题。
              </div>
            </div>
          </div>
          <Select
            value={codeTheme}
            options={CODE_THEME_OPTIONS}
            onChange={handleCodeThemeChange}
            className="w-36 shrink-0"
          />
        </div>
      </section>

      {/* 界面 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          界面
        </h4>
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-dark-border">
          <div className="flex items-start gap-2.5">
            <PanelLeft className="w-4 h-4 text-slate-400 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-white">
                文档目录宽度
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                拖动目录右侧分割线可自由调整，双击分割线亦可恢复默认宽度
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onResetSidebarWidth}
            className="flex-shrink-0 px-3 py-1.5 bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            恢复默认
          </button>
        </div>
      </section>

      {/* 快捷键 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Command className="w-3.5 h-3.5" />
          快捷键
        </h4>
        <div className="rounded-xl border border-slate-200 dark:border-dark-border divide-y divide-slate-100 dark:divide-dark-border overflow-hidden">
          {SHORTCUTS.map((item) => (
            <div
              key={item.keys}
              className="flex items-center justify-between px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-dark-hover/50 transition-colors"
            >
              <span className="text-xs text-slate-700 dark:text-slate-300">{item.label}</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border rounded text-slate-500 dark:text-slate-400">
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      {/* 关于 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          关于
        </h4>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-dark-sidebar/60 border border-slate-100 dark:border-dark-border space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-white">DevNotes</span>
            <span className="text-[11px] font-mono text-slate-400">
              {version ? `v${version}` : '—'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            笔记、翻译接口密钥与云同步凭据均保存在本机，不会上传到除你自行配置的服务之外的任何地方。
          </p>
        </div>
      </section>
    </div>
  )
}
