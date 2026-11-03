import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from './shadcn/dialog'

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
  /* 外壳已换 shadcn Dialog（Radix Presence 负责退出动画），不再用 usePresence。
     收起期间 shortcut 已置空，用快照保住内容供退出动画渲染 —— 与 PreviewModal 同款。 */
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

  // 真实按键演示：监听用户按下对应的组合键（如 Meta / Ctrl + 对应字母）并实时播放下压
  useEffect(() => {
    if (!shortcut) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // （Esc 退出由 Radix Dialog 托管，这里不再自己监听）

      // 监测用户是否按下了对应的按键（如 Meta / Ctrl + 对应字母）
      if (e.metaKey || e.ctrlKey) {
        const lastPart = shortcut.keyParts[shortcut.keyParts.length - 1]?.toLowerCase()
        if (lastPart && e.key.toLowerCase() === lastPart) {
          e.preventDefault()
          /*
           * 这是演示：拦下事件后别让真正的面板同时弹出来。
           * 引导弹窗浮在设置之上，同一个 window 上还有布局层的键位监听，
           * 它们会收到同一个 keydown —— preventDefault 不管这个，
           * 得用 stopImmediatePropagation 才能把这条链掐断。
           */
          e.stopImmediatePropagation()
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

  if (!shown) return null

  const Icon = shown.icon

  return (
    <Dialog open={Boolean(shortcut)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="relative w-full max-w-md h-auto rounded-3xl bg-white/95 border border-slate-200/80 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.35)] backdrop-blur-2xl p-6 sm:p-7 overflow-hidden text-center"
      >
        {/* 背景氛围微光环 */}
        <div className="absolute -top-20 -left-20 w-44 h-44 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-44 h-44 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* 顶部关闭按钮与分类标签 */}
        <div className="flex items-center justify-between mb-4">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-brand-50 text-brand-600 border border-brand-200/60">
              <Sparkles className="w-3 h-3" />
              <span>{shown.category} · 快捷键指引</span>
            </span>
            {/* a11y：Radix 需要可见的 DialogTitle；徽章文字已可见，直接挂它上面 */}
            <DialogTitle className="sr-only">{shown.category} · 快捷键指引</DialogTitle>

            <DialogClose
              type="button"
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </DialogClose>
        </div>

        {/* ================= 拟物 3D 键盘按键区 ================= */}
        <div className="my-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-3">
            {shown.keyParts.map((key, index) => {
              const isCommand = key === '⌘'
              return (
                <div key={index} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="text-xl font-black text-slate-300 ">
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
                        ? 'translate-y-2 shadow-[0_0_0_0_transparent] bg-slate-100  border-2 border-brand-500 ring-4 ring-brand-500/20'
                        : 'shadow-[0_8px_0_0_#cbd5e1]  hover:shadow-[0_6px_0_0_#cbd5e1]  hover:translate-y-0.5 border border-slate-200/90  bg-gradient-to-b from-white via-slate-50 to-slate-100   '
                    }`}
                  >
                    {/* 键帽顶面微光高光线 */}
                    <span className="absolute top-1 inset-x-2 h-[1px] bg-gradient-to-r from-transparent via-white/80  to-transparent rounded-full pointer-events-none" />

                    <span
                      className={`text-2xl transition-colors ${
                        isPressed
                          ? 'text-brand-600 '
                          : 'text-slate-800 '
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
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600  animate-in zoom-in-75 duration-100">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>已检测到组合按键</span>
              </span>
            ) : hasTested ? (
              <span className="text-xs text-emerald-600  font-medium">
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
        <div className="p-4 rounded-2xl bg-slate-50  border border-slate-100  text-left space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-brand-50  text-brand-600  flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800 ">
                {shown.label}
              </h3>
            </div>
          </div>
          <p className="text-xs text-slate-500  leading-relaxed pl-9">
            {shown.description}
          </p>
        </div>

        {/* ================= 底部按钮动作 ================= */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-[11px] font-mono text-slate-400">
            按 <kbd className="px-1 py-0.5 rounded bg-slate-100  border border-slate-200 ">Esc</kbd> 退出
          </span>

          <div className="flex items-center gap-2">
            {onTriggerAction && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onTriggerAction(shown.id)
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors"
              >
                立即执行
              </button>
            )}
            <DialogClose
              type="button"
              className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-xs shadow-brand-500/20 transition-all active:scale-95 cursor-pointer"
            >
              我知道了
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
