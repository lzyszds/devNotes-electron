import { useId } from 'react'
import type { ReactNode } from 'react'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  label?: ReactNode
  description?: ReactNode
  className?: string
  id?: string
}

/**
 * 现代高质感流体开关（Switch Toggle）。
 * 遵循系统主题品牌色规范，支持平滑滑动动画、无障碍语义与整行可点交互。
 */
export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  description,
  className = '',
  id,
}: SwitchProps) {
  const generatedId = useId()
  const switchId = id || generatedId

  const isSm = size === 'sm'

  const toggleButton = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
      className={`relative inline-flex flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out outline-none select-none disabled:cursor-not-allowed disabled:opacity-40 ${
        isSm ? 'h-5 w-9 p-0.5' : 'h-6 w-11 p-0.5'
      } ${
        checked
          ? 'bg-brand-600 dark:bg-brand-500'
          : 'bg-slate-200 hover:bg-slate-300/80 dark:bg-slate-700 dark:hover:bg-slate-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out ${
          isSm ? 'h-4 w-4' : 'h-5 w-5'
        } ${
          checked
            ? isSm
              ? 'translate-x-4'
              : 'translate-x-5'
            : 'translate-x-0'
        }`}
      />
    </button>
  )

  if (!label && !description) {
    return <div className={`inline-flex items-center ${className}`}>{toggleButton}</div>
  }

  return (
    <div
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`flex items-start justify-between gap-3 select-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      <div className="min-w-0 flex-1">
        {label && (
          <label
            htmlFor={switchId}
            className={`block text-xs font-semibold text-slate-800 dark:text-slate-200 ${
              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            {label}
          </label>
        )}
        {description && (
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0 pt-0.5">{toggleButton}</div>
    </div>
  )
}
