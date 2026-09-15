import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Cloud,
  Code2,
  Command,
  Download,
  FilePlus,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react'
import Select from '../ui/Select'
import ShortcutGuideModal, { type ShortcutItem } from '../ui/ShortcutGuideModal'
import {
  CODE_BLOCK_THEMES,
  getCachedCodeBlockTheme,
  getCodeBlockPreset,
  saveCodeBlockTheme,
  type CodeBlockThemeId,
} from '../../utils/codeBlockTheme'
import {
  THEMES,
  getThemePreset,
  type ThemeId,
  type ThemePreset,
} from '../../utils/theme'

/**
 * 档位做成下拉项：先按深色/浅色分成两组，组内再按显示名排序。
 */
const CODE_THEME_OPTIONS = (['dark', 'light'] as const).flatMap((tone) =>
  CODE_BLOCK_THEMES.filter((preset) => preset.tone === tone)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((preset) => ({
      value: preset.id,
      label: preset.label,
      group: tone === 'dark' ? '深色主题' : '浅色主题',
    }))
)

export interface GeneralPanelProps {
  theme: ThemeId
  onToggleTheme: () => void
  onSelectTheme: (id: ThemeId) => void
  /** 把二级侧边栏宽度恢复为默认值 */
  onResetSidebarWidth: () => void
}

/** 顶栏与全局快捷键速查及引导动画数据 */
const SHORTCUT_ITEMS: ShortcutItem[] = [
  {
    id: 'cmd-k',
    keys: '⌘ K',
    keyParts: ['⌘', 'K'],
    label: '打开全局指令面板',
    description: '随时在任何地方快速呼出全局搜索与功能指令，输入关键字直接跳往指定工具或笔记。',
    category: '系统导航',
    icon: Search,
  },
  {
    id: 'cmd-b',
    keys: '⌘ B',
    keyParts: ['⌘', 'B'],
    label: '折叠 / 展开文档目录',
    description: '一键收起或展开 Markdown 二级侧边栏，为笔记阅读与沉浸写作腾出更大版心。',
    category: '界面布局',
    icon: PanelLeft,
  },
  {
    id: 'cmd-n',
    keys: '⌘ N',
    keyParts: ['⌘', 'N'],
    label: '新建 Markdown 笔记',
    description: '立即在当前知识库中创建一篇崭新的空白文档，光标自动聚焦标题开始创作。',
    category: '写作编辑',
    icon: FilePlus,
  },
  {
    id: 'cmd-e',
    keys: '⌘ E',
    keyParts: ['⌘', 'E'],
    label: '导出当前文档为 .md',
    description: '将当前正编辑的笔记快速导出为标准本地 .md 文件，方便归档与外部协同。',
    category: '数据管理',
    icon: Download,
  },
  {
    id: 'cmd-d',
    keys: '⌘ D',
    keyParts: ['⌘', 'D'],
    label: '切换浅色 / 深色主题',
    description: '在当前主题与对偶风格之间来回秒切，强光白天与夜间暗光环境自如适应。',
    category: '外观偏好',
    icon: Moon,
  },
  {
    id: 'cmd-u',
    keys: '⌘ U',
    keyParts: ['⌘', 'U'],
    label: '打开云同步设置',
    description: '快速跳转到 Cloudflare 备份与多端同步配置面板，守护每一份笔记资产。',
    category: '云端同步',
    icon: Cloud,
  },
  {
    id: 'cmd-comma',
    keys: '⌘ ,',
    keyParts: ['⌘', ','],
    label: '打开全局设置',
    description: '随时呼出主设置弹窗，调整 20 款主题配色、AI 接口、代码块高亮与界面偏好。',
    category: '全局偏好',
    icon: Settings,
  },
]

type ThemeFilter = 'all' | 'light' | 'dark'

/**
 * 主题微缩窗口预览：高保真模拟该主题下的侧边栏、主界面、卡片与品牌按钮
 */
function MiniThemePreview({ preset }: { preset: ThemePreset }) {
  const { colors } = preset
  const isDark = preset.mode === 'dark'

  return (
    <div
      className="w-full h-24 rounded-lg overflow-hidden border flex flex-col relative select-none shadow-xs transition-transform duration-200 group-hover:scale-[1.01]"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
    >
      {/* 模拟顶栏 */}
      <div
        className="h-4 px-2 border-b flex items-center justify-between flex-shrink-0"
        style={{
          backgroundColor: colors.sidebar,
          borderColor: colors.border,
        }}
      >
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400/80" />
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
        </div>
        <div
          className="h-1.5 w-12 rounded-full opacity-35"
          style={{ backgroundColor: colors.textMuted }}
        />
        <div
          className="w-2.5 h-2 rounded text-[8px] flex items-center justify-center font-bold"
          style={{ color: colors.primary }}
        >
          {isDark ? '🌙' : '☀️'}
        </div>
      </div>

      {/* 模拟主区：左侧边栏 + 右侧正文 */}
      <div className="flex-1 flex min-h-0">
        {/* 微型侧边栏 */}
        <div
          className="w-6 border-r flex flex-col items-center py-1.5 gap-1 flex-shrink-0"
          style={{
            backgroundColor: colors.sidebar,
            borderColor: colors.border,
          }}
        >
          <div
            className="w-3 h-3 rounded-[3px] opacity-90"
            style={{ backgroundColor: colors.primary }}
          />
          <div
            className="w-2.5 h-1.5 rounded-[2px] opacity-35"
            style={{ backgroundColor: colors.textMuted }}
          />
          <div
            className="w-2.5 h-1.5 rounded-[2px] opacity-25"
            style={{ backgroundColor: colors.textMuted }}
          />
        </div>

        {/* 微型内容区 */}
        <div className="flex-1 p-2 flex flex-col justify-between overflow-hidden">
          <div className="space-y-1">
            <div
              className="h-2 w-3/5 rounded-full opacity-85"
              style={{ backgroundColor: colors.text }}
            />
            <div
              className="h-1.5 w-4/5 rounded-full opacity-35"
              style={{ backgroundColor: colors.textMuted }}
            />
            <div
              className="h-1.5 w-2/3 rounded-full opacity-25"
              style={{ backgroundColor: colors.textMuted }}
            />
          </div>

          {/* 模拟卡片或按钮 */}
          <div className="flex items-center justify-between pt-1">
            <div
              className="h-3 px-2 rounded flex items-center gap-1 shadow-2xs"
              style={{
                backgroundColor: colors.primary,
                color: '#ffffff',
              }}
            >
              <div className="w-1 h-1 rounded-full bg-white opacity-80" />
              <div className="w-4 h-1 rounded-full bg-white opacity-90" />
            </div>

            <div
              className="h-2 w-6 rounded-full opacity-40"
              style={{ backgroundColor: colors.accent }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 全局设置 · 通用：外观、界面与关于信息 */
export default function GeneralPanel({
  theme,
  onToggleTheme,
  onSelectTheme,
  onResetSidebarWidth,
}: GeneralPanelProps) {
  const [version, setVersion] = useState('')
  const [filter, setFilter] = useState<ThemeFilter>('all')
  const [activeShortcut, setActiveShortcut] = useState<ShortcutItem | null>(null)

  const currentThemePreset = useMemo(() => getThemePreset(theme), [theme])

  // 代码块主题
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

  // 过滤当前展示的主题列表
  const displayedThemes = useMemo(() => {
    if (filter === 'all') return THEMES
    return THEMES.filter((t) => t.mode === filter)
  }, [filter])

  const lightCount = THEMES.filter((t) => t.mode === 'light').length
  const darkCount = THEMES.filter((t) => t.mode === 'dark').length

  return (
    <div className="space-y-6">
      {/* ================= 外观主题 ================= */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
              <span>外观主题</span>
              <span className="text-[10px] font-normal text-slate-400 lowercase">
                ({THEMES.length} 套专业配色)
              </span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              精心打磨的浅色与深色色彩风格，点击即刻全站生效
            </p>
          </div>

          {/* 筛选切换器 */}
          <div className="flex items-center p-0.5 bg-slate-100 dark:bg-dark-sidebar rounded-lg border border-slate-200/60 dark:border-dark-border text-xs">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                filter === 'all'
                  ? 'bg-white dark:bg-dark-panel text-slate-800 dark:text-white shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              全部 ({THEMES.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('light')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                filter === 'light'
                  ? 'bg-white dark:bg-dark-panel text-slate-800 dark:text-white shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-3 h-3 text-amber-500" />
              <span>浅色 ({lightCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('dark')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                filter === 'dark'
                  ? 'bg-white dark:bg-dark-panel text-slate-800 dark:text-white shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="w-3 h-3 text-brand-400" />
              <span>深色 ({darkCount})</span>
            </button>
          </div>
        </div>

        {/* 当前生效主题状态条 */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50/80 dark:bg-dark-sidebar/70 border border-slate-200/70 dark:border-dark-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-500 dark:text-slate-400">当前正在使用：</span>
            <span className="text-xs font-bold text-slate-800 dark:text-white truncate">
              {currentThemePreset.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono uppercase bg-slate-200/60 dark:bg-dark-hover text-slate-600 dark:text-slate-300">
              {currentThemePreset.englishName}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                currentThemePreset.mode === 'dark'
                  ? 'bg-slate-800 text-slate-200 dark:bg-brand-950/40 dark:text-brand-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
              }`}
            >
              {currentThemePreset.mode === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式'}
            </span>
          </div>

          <div className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
            <span>快捷键</span>
            <kbd className="px-1 py-0.5 bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border rounded">
              ⌘D
            </kbd>
            <span>对偶秒切</span>
          </div>
        </div>

        {/* 主题画廊网格 */}
        <div className="grid grid-cols-2 gap-3.5">
          {displayedThemes.map((item) => {
            const active = theme === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTheme(item.id)}
                className={`group relative p-3 rounded-2xl border text-left transition-all duration-200 outline-none flex flex-col justify-between ${
                  active
                    ? 'border-brand-500 bg-brand-50/40 dark:bg-brand-950/20 ring-2 ring-brand-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/60 dark:hover:bg-dark-hover/40'
                }`}
              >
                {/* 选中徽标 */}
                {active && (
                  <span className="absolute top-2.5 right-2.5 z-10 w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-xs shadow-brand-500/30 animate-in fade-in zoom-in-75 duration-150">
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  </span>
                )}

                {/* 仿真迷你视窗预览 */}
                <div className="mb-2.5">
                  <MiniThemePreview preset={item} />
                </div>

                {/* 主题信息区 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-bold text-slate-800 dark:text-white truncate">
                        {item.name}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
                        {item.categoryLabel}
                      </span>
                    </div>

                    {/* 色彩预览小圆标 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {item.swatches.map((color, idx) => (
                        <span
                          key={idx}
                          className="w-2.5 h-2.5 rounded-full border border-black/10 dark:border-white/10"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-400 dark:text-slate-400 leading-relaxed line-clamp-2">
                    {item.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ================= 编辑器配置 ================= */}
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
                代码块高亮配色取自 shiki，与 Markdown 所见即所得及双栏代码块实时联动。
              </div>
            </div>
          </div>
          <Select
            value={codeTheme}
            options={CODE_THEME_OPTIONS}
            onChange={handleCodeThemeChange}
            className="w-36 shrink-0"
            menuMinWidth="14rem"
          />
        </div>
      </section>

      {/* ================= 界面尺寸偏好 ================= */}
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
            className="flex-shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200/60 dark:border-dark-border transition-all active:scale-[0.98]"
          >
            恢复默认
          </button>
        </div>
      </section>

      {/* ================= 快捷键速查与动画演示 ================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Command className="w-3.5 h-3.5" />
            <span>快捷键速查</span>
          </h4>
          <span className="text-[11px] text-slate-400">
            点击任意条目体验按键引导动画
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-dark-border divide-y divide-slate-100 dark:divide-dark-border overflow-hidden shadow-2xs">
          {SHORTCUT_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveShortcut(item)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-brand-50/50 dark:hover:bg-brand-950/20 text-left transition-all group outline-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-dark-hover text-slate-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 group-hover:bg-brand-50 dark:group-hover:bg-brand-950/40 flex items-center justify-center flex-shrink-0 transition-colors">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">
                      {item.label}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-brand-600 dark:text-brand-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    演示动画
                  </span>
                  <kbd className="px-2 py-1 text-[11px] font-mono font-semibold bg-slate-50 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border group-hover:border-brand-300 dark:group-hover:border-brand-700 rounded-md text-slate-600 dark:text-slate-300 shadow-2xs transition-colors">
                    {item.keys}
                  </kbd>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ================= 快捷键拟物引导动效弹窗 ================= */}
      <ShortcutGuideModal
        shortcut={activeShortcut}
        onClose={() => setActiveShortcut(null)}
        onTriggerAction={(id) => {
          if (id === 'cmd-d') onToggleTheme()
          if (id === 'cmd-b') onResetSidebarWidth()
        }}
      />

      {/* ================= 关于 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          关于 devNotes
        </h4>
        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50/90 via-slate-50/40 to-brand-50/20 dark:from-dark-sidebar/70 dark:via-dark-sidebar/40 dark:to-brand-950/10 border border-slate-200/70 dark:border-dark-border shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 to-brand-400 text-white flex items-center justify-center shadow-xs shadow-brand-500/25">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    devNotes 开发者随手记
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md font-mono text-[10px] font-semibold bg-white dark:bg-dark-panel text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-dark-border shadow-2xs">
                    {version ? `v${version}` : 'v2026.4'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  轻量、安全、专注的本地离线优先 Markdown 写作与开发者工具箱
                </p>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium flex-shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>本地离线保护</span>
            </div>
          </div>

          <div className="pt-2.5 border-t border-slate-200/50 dark:border-dark-border/60 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />
            <span>
              笔记内容、翻译接口密钥与云同步凭据均仅加密存放在您的本机本地数据库中，绝不在未经用户授权的情况下上传至任何第三方云端。
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
