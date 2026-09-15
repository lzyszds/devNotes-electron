import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { usePresence } from '../../hooks/usePresence'

export interface ShortcutItem {
  id: string
  keys: string
  keyParts: string[]
  label: string
  description: string
  category: string
  icon: ComponentType<{ className?: string }>
}

export interface ShortcutGuideModalProps {
  shortcut: ShortcutItem | null
  onClose: () => void
  onTriggerAction?: (id: string) => void
}

/**
 * 快捷键全屏拟物引导 HUD 弹窗
 *
 * 带有逼真的 3D 机械按键下压物理动效、发光波纹与功能详细指引，
 * 支持键盘即时按键反馈与点击触发。
 */
export default function ShortcutGuideModal({
  shortcut,
  onClose,
  onTriggerAction,
}: ShortcutGuideModalProps) {
  const [isPressed, setIsPressed] = useState(false)
  const [hasTested, setHasTested] = useState(false)
  // 面板退出动画 160ms，遮罩 150ms，取长者
  const { mounted, state } = usePresence(Boolean(shortcut), 160)
  /**
   * 收起期间 shortcut 已经置空，内容却还要在 DOM 里多留一会儿播退出动画。
   * 留住最后一次的快照，否则渲染到一半就取不到 icon / 按键了。
   */
  const lastShortcutRef = useRef<ShortcutItem | null>(null)
  if (shortcut) lastShortcutRef.current = shortcut
  const shown = shortcut ?? lastShortcutRef.current

  // 弹窗打开后，自动播放一次轻快的机械键帽下压模拟动效
  useEffect(() => {
    if (!shortcut) return

    setHasTested(false)
    setIsPressed(false)

    // 250ms 后模拟下压一次
    const pressTimer = setTimeout(() => {
      setIsPressed(true)
    }, 280)

    // 600ms 后弹起
    const releaseTimer = setTimeout(() => {
      setIsPressed(false)
    }, 620)

    return () => {
      clearTimeout(pressTimer)
      clearTimeout(releaseTimer)
    }
  }, [shortcut])

  // 支持键盘 Esc 退出，以及如果用户真的按下了该键，实时播放下压动效
  useEffect(() => {
    if (!shortcut) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // 监测用户是否按下了对应的按键（如 Meta / Ctrl + 对应字母）
      if (e.metaKey || e.ctrlKey) {
        const lastPart = shortcut.keyParts[shortcut.keyParts.length - 1]?.toLowerCase()
        if (lastPart && e.key.toLowerCase() === lastPart) {
          e.preventDefault()
          setIsPressed(true)
          setHasTested(true)
        }
      }
    }

    const handleKeyUp = () => {
      setIsPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [shortcut, onClose])

  if (!mounted || !shown) return null

  const Icon = shown.icon

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 select-none"
      role="dialog"
      aria-modal="true"
    >
      {/* 毛玻璃半透明暗色背景遮罩 */}
      <div
        onClick={onClose}
        data-state={state}
        className="fe-fade absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-md"
      />

      {/* 居中核心引导卡片 */}
      <div
        data-state={state}
        className="fe-modal relative w-full max-w-md rounded-3xl bg-white/95 dark:bg-dark-panel/95 border border-slate-200/80 dark:border-dark-border shadow-[0_25px_70px_-15px_rgba(0,0,0,0.35)] backdrop-blur-2xl p-6 sm:p-7 overflow-hidden text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 背景氛围微光环 */}
        <div className="absolute -top-20 -left-20 w-44 h-44 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-44 h-44 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* 顶部关闭按钮与分类标签 */}
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200/60 dark:border-brand-800/40">
            <Sparkles className="w-3 h-3" />
            <span>{shown.category} · 快捷键指引</span>
          </span>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ================= 拟物 3D 键盘按键区 ================= */}
        <div className="my-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-3">
            {shown.keyParts.map((key, index) => {
              const isCommand = key === '⌘'
              return (
                <div key={index} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="text-xl font-black text-slate-300 dark:text-slate-600">
                      +
                    </span>
                  )}
                  {/* 单个 3D 机械键帽 */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsPressed(true)
                      setTimeout(() => setIsPressed(false), 200)
                    }}
                    className={`relative min-w-[76px] h-20 px-4 rounded-2xl flex flex-col items-center justify-center font-mono font-bold transition-all duration-150 outline-none select-none cursor-pointer ${
                      isPressed
                        ? 'translate-y-2 shadow-[0_0_0_0_transparent] bg-slate-100 dark:bg-slate-800 border-2 border-brand-500 ring-4 ring-brand-500/20'
                        : 'shadow-[0_8px_0_0_#cbd5e1] dark:shadow-[0_8px_0_0_#1e2533] hover:shadow-[0_6px_0_0_#cbd5e1] dark:hover:shadow-[0_6px_0_0_#1e2533] hover:translate-y-0.5 border border-slate-200/90 dark:border-slate-700 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-800 dark:to-slate-800'
                    }`}
                  >
                    {/* 键帽顶面微光高光线 */}
                    <span className="absolute top-1 inset-x-2 h-[1px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/20 to-transparent rounded-full pointer-events-none" />

                    <span
                      className={`text-2xl transition-colors ${
                        isPressed
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-slate-800 dark:text-white'
                      }`}
                    >
                      {key}
                    </span>

                    {isCommand && (
                      <span className="text-[9px] font-sans font-medium text-slate-400 mt-0.5">
                        Command
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>

          {/* 按键触发状态微动效文案 */}
          <div className="h-6 mt-4 flex items-center justify-center">
            {isPressed ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 animate-in zoom-in-75 duration-100">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>已检测到组合按键</span>
              </span>
            ) : hasTested ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                按键触发成功！
              </span>
            ) : (
              <span className="text-xs text-slate-400 flex items-center gap-1 animate-pulse">
                <span>敲击键盘上的组合键亦可互动体验</span>
              </span>
            )}
          </div>
        </div>

        {/* ================= 功能说明区 ================= */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-sidebar/80 border border-slate-100 dark:border-dark-border text-left space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                {shown.label}
              </h3>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pl-9">
            {shown.description}
          </p>
        </div>

        {/* ================= 底部按钮动作 ================= */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-[11px] font-mono text-slate-400">
            按 <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-dark-sidebar border border-slate-200 dark:border-dark-border">Esc</kbd> 退出
          </span>

          <div className="flex items-center gap-2">
            {onTriggerAction && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onTriggerAction(shown.id)
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-dark-hover hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors"
              >
                立即执行
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-xs shadow-brand-500/20 transition-all active:scale-95"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
