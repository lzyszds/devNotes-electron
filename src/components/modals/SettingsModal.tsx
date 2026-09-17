import { useEffect } from 'react'
import { Cloud, Languages, Loader2, Settings2, Volume2, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { useNotes } from '../../context/NotesContext'
import { usePresence } from '../../hooks/usePresence'
import GeneralPanel from '../settings/GeneralPanel'
import CloudflareSyncPanel from '../settings/CloudflareSyncPanel'
import TranslateApiPanel from '../settings/TranslateApiPanel'
import SpeechPanel from '../settings/SpeechPanel'
import Tooltip from '../ui/Tooltip'
import type { ThemeId } from '../../utils/theme'

export type SettingsSection = 'general' | 'cloud-sync' | 'translate-api' | 'speech'

export interface SettingsModalProps {
  open: boolean
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  theme: ThemeId
  onToggleTheme: () => void
  onSelectTheme: (id: ThemeId) => void
  onResetSidebarWidth: () => void
}

interface SectionMeta {
  id: SettingsSection
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
}

const SECTIONS: SectionMeta[] = [
  { id: 'general', label: '通用', hint: '外观主题与界面偏好', icon: Settings2 },
  {
    id: 'cloud-sync',
    label: '云同步',
    hint: 'Cloudflare 备份与多设备同步',
    icon: Cloud,
  },
  {
    id: 'translate-api',
    label: 'AI 与翻译',
    hint: '在线翻译接口与模型配置',
    icon: Languages,
  },
  {
    id: 'speech',
    label: '语音朗读',
    hint: '朗读音色、语速与音量',
    icon: Volume2,
  },
]

/**
 * 全局设置弹窗：顶栏各个分散的功能入口（云同步 / 翻译接口 / 外观）统一收拢到这里，
 * 左侧分类导航 + 右侧面板，切换分类不关闭弹窗。
 */
export default function SettingsModal({
  open,
  section,
  onSectionChange,
  onClose,
  theme,
  onToggleTheme,
  onSelectTheme,
  onResetSidebarWidth,
}: SettingsModalProps) {
  const { cfConfig, cfSyncStatus } = useNotes()
  // 面板退出动画 160ms，遮罩 150ms，取长者
  const { mounted, state } = usePresence(open, 160)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!mounted) return null

  // 云同步分类上的角标：同步中显示转圈，已接入显示常驻小圆点
  const cloudBadge =
    cfSyncStatus === 'syncing' ? (
      <Loader2 className="w-3 h-3 animate-spin text-orange-500" />
    ) : cfConfig.enabled ? (
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          cfSyncStatus === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
        }`}
      />
    ) : null

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-state={state}
      className="fe-fade fixed inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-xs z-[60] flex items-center justify-center p-2 md:p-4"
    >
      <div
        data-state={state}
        className="fe-modal w-full max-w-3xl h-[88vh] md:h-[80vh] max-h-[720px] bg-white dark:bg-dark-panel rounded-2xl shadow-2xl border border-slate-200/80 dark:border-dark-border overflow-hidden flex flex-col"
      >
        {/* 头部 */}
        <div className="p-3 md:p-4 border-b border-slate-100 dark:border-dark-border flex items-center justify-between bg-slate-50/50 dark:bg-dark-sidebar/40 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-600 to-slate-800 dark:from-slate-500 dark:to-slate-700 flex items-center justify-center text-white shadow-md shadow-slate-500/20">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">设置</h3>
              <p className="hidden md:block text-xs text-slate-400">全局功能与外观偏好</p>
            </div>
          </div>

          <Tooltip content="关闭设置">
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* 主体：左侧分类导航 + 右侧面板 */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <nav className="w-full md:w-[176px] flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 p-2 flex md:block gap-1 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-y-auto scrollbar-hide">
            {SECTIONS.map((item) => {
              const active = section === item.id
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={`flex-shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-white dark:bg-dark-panel shadow-2xs border border-slate-200/80 dark:border-dark-border'
                      : 'border border-transparent hover:bg-white/60 dark:hover:bg-dark-hover/60'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 ${
                      active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block text-xs truncate ${
                        active
                          ? 'font-bold text-slate-900 dark:text-white'
                          : 'font-medium text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.label}
                    </span>
                    <span className="hidden md:block text-[10px] text-slate-400 truncate">{item.hint}</span>
                  </span>
                  {item.id === 'cloud-sync' && cloudBadge}
                </button>
              )
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-4 md:p-5 min-w-0">
            {section === 'general' && (
              <GeneralPanel
                theme={theme}
                onToggleTheme={onToggleTheme}
                onSelectTheme={onSelectTheme}
                onResetSidebarWidth={onResetSidebarWidth}
              />
            )}
            {section === 'cloud-sync' && <CloudflareSyncPanel />}
            {section === 'translate-api' && <TranslateApiPanel />}
            {section === 'speech' && <SpeechPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
