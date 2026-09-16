import { useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import { usePresence } from '../../../hooks/usePresence'

export type ToolbarMenuProps = {
  /** 菜单触发器上的提示文案 */
  label: string
  /** 菜单图标 */
  icon: ComponentType<{ className?: string }>
  /** 是否在按钮上显示文字标签（默认只显示图标加向下小箭头） */
  showText?: boolean
  /** 当前是否有子项处于激活状态 */
  active?: boolean
  disabled?: boolean
  /** 自定义菜单宽度，默认 200px */
  width?: number | string
  className?: string
  /** 渲染菜单项的函数，传入 close 用于点击后收起菜单 */
  children: (close: () => void) => ReactNode
}

/**
 * 工具栏分组折叠菜单。
 *
 * 关键特性：
 * 1. 使用 createPortal 挂载至 document.body，配合 position: fixed 彻底避免 overflow-x-auto 裁剪
 * 2. 菜单内部 mousedown 默认 preventDefault，确保点选项时不丢失编辑器内已选中的文字和光标
 * 3. 监听全局滚动、缩放、Esc 及外部点击自动关闭
 * 4. 接入项目统一的 fe-pop 进出动效（usePresence 130ms）
 * 5. 自动贴合视口边界，防止靠右时菜单滑出屏幕
 */
export default function ToolbarMenu({
  label,
  icon: Icon,
  showText = false,
  active = false,
  disabled = false,
  width = 200,
  className = '',
  children,
}: ToolbarMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const { mounted, state } = usePresence(open, 130)

  // 计算弹层位置：挂在触发按钮正下方，贴紧对齐
  const updatePosition = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const menuWidth = typeof width === 'number' ? width : 200
    const margin = 8

    let left = rect.left
    // 如果靠右溢出视口，则向左偏移
    if (left + menuWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - menuWidth)
    }

    setPos({
      top: rect.bottom + 4,
      left,
    })
  }

  const handleToggle = () => {
    if (disabled) return
    if (!open) updatePosition()
    setOpen((prev) => !prev)
  }

  const handleClose = () => setOpen(false)

  // 监听外部点击、Esc 与外部滚动自动关闭
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }

    const handleScroll = (event: Event) => {
      // 如果是在菜单自身内部滚动，不关闭
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [open])

  return (
    <>
      <Tooltip content={open ? undefined : label}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          // 阻止 mousedown 默认行为：DOM 焦点全程留在编辑区，保证选中的文字高亮不丢失
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleToggle}
          className={`flex-shrink-0 flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors disabled:pointer-events-none disabled:opacity-35 text-xs ${
            open || active
              ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-dark-hover dark:hover:text-white'
          } ${className}`}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0" />
          {showText && <span className="font-medium leading-none">{label}</span>}
          <ChevronDown
            className={`h-3 w-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </Tooltip>

      {mounted &&
        createPortal(
          <div
            ref={menuRef}
            data-state={state}
            // 阻断 mousedown 默认行为，保证编辑器内文字选区不会被取消
            onMouseDown={(event) => event.preventDefault()}
            style={{
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              width: typeof width === 'number' ? `${width}px` : width,
            }}
            className="fe-pop fixed z-[85] max-h-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xl dark:border-dark-border dark:bg-dark-panel"
          >
            {children(handleClose)}
          </div>,
          document.body
        )}
    </>
  )
}
