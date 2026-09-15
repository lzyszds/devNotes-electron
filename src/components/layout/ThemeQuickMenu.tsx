import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Moon, Palette, Settings2, Sun } from 'lucide-react'
import {
  THEMES,
  getThemePreset,
  isDarkTheme,
  type ThemeId,
} from '../../utils/theme'
import Tooltip from '../ui/Tooltip'

export interface ThemeQuickMenuProps {
  theme: ThemeId
  onSelectTheme: (id: ThemeId) => void
  onOpenSettings: () => void
}

/**
 * 顶栏快捷主题切换下拉菜单
 *
 * 允许用户在不打开全局设置弹窗的情况下，一键在 10 套主题之间自由切换，
 * 也提供直接跳往「通用外观设置」的快捷入口。
 */
export default function ThemeQuickMenu({
  theme,
  onSelectTheme,
  onOpenSettings,
}: ThemeQuickMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const currentPreset = getThemePreset(theme)
  const isDark = isDarkTheme(theme)

  // 点击外部自动关闭
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <Tooltip content={`当前主题：${currentPreset.name} · 点击快速换肤`}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`no-drag flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
            open
              ? 'bg-slate-100 dark:bg-dark-hover text-slate-800 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover'
          }`}
        >
          {/* 当前主题主色标示圆点 */}
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/10 dark:border-white/20 shadow-2xs"
            style={{ backgroundColor: currentPreset.colors.primary }}
          />

          {isDark ? (
            <Moon className="w-3.5 h-3.5 text-brand-400" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-amber-500" />
          )}

          <span className="font-medium hidden sm:inline max-w-[70px] truncate text-[11px]">
            {currentPreset.name}
          </span>

          <ChevronDown
            className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </Tooltip>

      {/* 浮动下拉面板 */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-2xl bg-white/95 dark:bg-dark-panel/95 backdrop-blur-xl border border-slate-200/80 dark:border-dark-border shadow-xl p-2 animate-in fade-in zoom-in-95 duration-150">
          {/* 顶栏说明 */}
          <div className="flex items-center justify-between px-2.5 py-1.5 mb-1 border-b border-slate-100 dark:border-dark-border">
            <div className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
              <span className="text-xs font-bold text-slate-800 dark:text-white">
                外观配色
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              共 10 款
            </span>
          </div>

          {/* 主题选项列表 */}
          <div className="space-y-0.5 max-h-72 overflow-y-auto pr-0.5">
            {THEMES.map((item) => {
              const active = item.id === theme
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTheme(item.id)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                    active
                      ? 'bg-brand-50/80 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300 font-semibold'
                      : 'hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {/* 调色板预览点 */}
                    <div className="flex items-center -space-x-1 flex-shrink-0">
                      <span
                        className="w-3 h-3 rounded-full border border-white dark:border-dark-panel"
                        style={{ backgroundColor: item.colors.primary }}
                      />
                      <span
                        className="w-3 h-3 rounded-full border border-white dark:border-dark-panel"
                        style={{ backgroundColor: item.colors.sidebar }}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate">{item.name}</span>
                        <span className="text-[9px] opacity-60 font-mono">
                          {item.mode === 'dark' ? '🌙' : '☀️'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {item.categoryLabel}
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 stroke-[2.5]" />}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 底部功能栏 */}
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-between px-1">
            <span className="text-[10px] text-slate-400 font-mono">
              快捷键 <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-dark-sidebar rounded border border-slate-200 dark:border-dark-border">⌘D</kbd> 切明暗
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline px-1.5 py-0.5 rounded"
            >
              <Settings2 className="w-3 h-3" />
              <span>设置画廊</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
