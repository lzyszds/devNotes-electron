import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'onChange'> {
  /**
   * 尺寸大小：
   * - sm: 14x14px，适合密集信息栏、卡片底栏、微型工具条
   * - md: 16x16px (默认)，适合常规表单与卡片
   */
  size?: 'sm' | 'md'
  /** 标签文本或节点（整行或相邻可点击） */
  label?: React.ReactNode
  /** 说明描述文本（仅在有 label 时呈现） */
  description?: React.ReactNode
  /** 容器额外样式类 */
  wrapperClassName?: string
  /**
   * 便捷的标准 boolean 变更回调。
   * 如果你需要处理 'indeterminate'，请直接使用 Radix 原生 `onCheckedChange`。
   */
  onChange?: (checked: boolean) => void
}

/**
 * 基于 Radix UI 原语 + Tailwind 打造的现代化 shadcn 风格 Checkbox 组件。
 *
 * 核心设计考量：
 * 1. 遵循 WAI-ARIA Checkbox 规范，具备完全的键盘交互（Tab / Space）与读屏器支持。
 * 2. 融入项目 Notion 极简与品牌青蓝主题，支持深浅色模式（data-theme 与 dark: 变体）。
 * 3. 完整支持选中（Check）、未选中与半选（Indeterminate / Minus）状态与微动效。
 * 4. 内置高可用 Label / Description 布局，支持整行点击防误触，亦可独立作为受控原语使用。
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(
  (
    {
      className = '',
      wrapperClassName = '',
      size = 'md',
      label,
      description,
      checked,
      onCheckedChange,
      onChange,
      disabled = false,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId()
    const checkboxId = id || generatedId
    const isSm = size === 'sm'

    const handleCheckedChange = (state: CheckboxPrimitive.CheckedState) => {
      onCheckedChange?.(state)
      if (typeof state === 'boolean') {
        onChange?.(state)
      } else if (state === 'indeterminate') {
        onChange?.(true)
      }
    }

    const checkboxRoot = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={checkboxId}
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
        data-no-ripple
        className={`peer inline-flex shrink-0 items-center justify-center transition-colors duration-100 ease-out select-none outline-none border cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          isSm
            ? 'h-3.5 w-3.5 rounded-[4px]'
            : 'h-4 w-4 rounded-[5px]'
        } ${
          // 边框与背景色：未选中与选中状态
          'border-slate-300 bg-white hover:border-slate-400 dark:border-dark-border dark:bg-dark-panel/90 dark:hover:border-slate-600'
        } ${
          // 选中 / 半选时的品牌色高亮
          'data-[state=checked]:bg-brand-600 data-[state=checked]:border-brand-600 data-[state=checked]:text-white dark:data-[state=checked]:bg-brand-500 dark:data-[state=checked]:border-brand-500'
        } ${
          'data-[state=indeterminate]:bg-brand-600 data-[state=indeterminate]:border-brand-600 data-[state=indeterminate]:text-white dark:data-[state=indeterminate]:bg-brand-500 dark:data-[state=indeterminate]:border-brand-500'
        } ${
          // 聚焦光圈：聚焦时微拟物光晕
          'focus-visible:ring-2 focus-visible:ring-brand-500/25 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-dark-panel'
        } ${className}`}
        {...props}
      >
        <CheckboxPrimitive.Indicator
          className="flex items-center justify-center text-current transition-opacity duration-100 ease-out"
        >
          {checked === 'indeterminate' ? (
            <Minus
              size={isSm ? 10 : 12}
              strokeWidth={3}
              className="shrink-0"
            />
          ) : (
            <Check
              size={isSm ? 10 : 12}
              strokeWidth={3}
              className="shrink-0"
            />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    )

    // 纯复选框（无外包 label）
    if (!label && !description) {
      return checkboxRoot
    }

    // 带有 label 或 description 的组合控件，外层单一语义 label，避免嵌套事件冒泡冲突
    return (
      <label
        htmlFor={checkboxId}
        className={`inline-flex items-start gap-2 select-none ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        } ${wrapperClassName}`}
      >
        <div className="shrink-0 pt-0.5">{checkboxRoot}</div>
        <div className="min-w-0 flex-1">
          {label && (
            <span
              className={`block text-xs font-semibold leading-normal text-slate-700 dark:text-slate-200 transition-colors ${
                disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </span>
          )}
          {description && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </label>
    )
  }
)

Checkbox.displayName = CheckboxPrimitive.Root.displayName

export default Checkbox

