import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '../../utils/clipboard'
import Tooltip from './Tooltip'
import { useToast } from './Toast'
import { iconButtonClass, type IconTone } from './ToolKit'

export interface CopyButtonProps {
  /**
   * 要复制的内容。传函数可延迟取最新值（渲染期不用为了这个按钮拼一遍字符串）。
   * 空字符串视为「没内容」，点了会提示而不是静默失败。
   */
  value: string | (() => string)
  /**
   * 复制成功后的 Toast 文案。默认不弹 —— 按钮自己会原地变成对勾，
   * 反馈已经落在手指按下那个位置上了，再飘一个右上角气泡是重复噪音。
   * 传字符串则额外弹一条（上下文菜单这类没有按钮承载反馈的场景用得上）。
   */
  toast?: string | null
  /** 图标按钮色调，与 iconButtonClass 同一套 */
  tone?: IconTone
  /** 图标尺寸，默认 15（与卡片标题条上其它图标按钮一致） */
  size?: number
  disabled?: boolean
  /** 悬浮提示文案，默认「复制」 */
  label?: string
  /** 追加类名 */
  className?: string
}

/** 对勾停留时长；与 CSS 里 .copy-morph-in 的过渡节奏对齐，别改单边 */
const COPIED_HOLD = 1300

/**
 * 全站统一的复制按钮。
 *
 * 此前每个工具各写一份 `<button onClick={copyOutput}><Copy/></button>` +
 * `showToast('已复制xxx')`，图标不会变、成功提示飘在右上角，与手指所在的位置
 * 隔着整个屏幕。这里把反馈收回到按钮本身：按下 → Copy 旋出 / Check 旋入，
 * 底色转成极淡的绿，1.3 秒后自己转回来。
 *
 * 失败仍然要出声：复制失败是异常路径，绿对勾表达不了它，一律走 Toast.
 */
export default function CopyButton({
  value,
  toast = null,
  tone = 'brand',
  size = 15,
  disabled = false,
  label = '复制',
  className = '',
}: CopyButtonProps) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 卸载时清掉还没到点的还原计时器，避免对已卸载组件 setState
  useEffect(() => clearTimer, [clearTimer])

  const handleCopy = async () => {
    const text = typeof value === 'function' ? value() : value
    if (!text) {
      showToast('没有可复制的内容', 'error')
      return
    }

    const ok = await copyText(text)
    if (!ok) {
      showToast('复制失败', 'error')
      return
    }

    clearTimer()
    setCopied(true)
    if (toast) showToast(toast)
    timerRef.current = window.setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, COPIED_HOLD)
  }

  return (
    <Tooltip content={copied ? '已复制' : label} disabled={disabled}>
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={disabled}
        data-copied={copied || undefined}
        className={`${iconButtonClass(copied ? 'emerald' : tone)} ${className}`}
      >
        {/* 两层等大同心叠在同一个网格格里做交叉：按钮宽度不变，标题条不会抖 */}
        <span className="copy-morph-stack">
          <Copy size={size} className="copy-morph-out" />
          <Check size={size} strokeWidth={2.6} className="copy-morph-in" />
        </span>
      </button>
    </Tooltip>
  )
}

export interface CopyImageButtonProps {
  /** 真正执行图片复制的动作（ClipboardItem 那条路径由调用方自己走） */
  onClick: () => void
  disabled?: boolean
  /** 悬浮提示文案，默认「复制图片」 */
  label?: string
  tone?: IconTone
  size?: number
}

/**
 * 图片版复制按钮。
 *
 * 与文本版共用同一套「图标原地变对勾」的反馈，但复制动作不同 ——
 * 二进制走 ClipboardItem，不用 copyText，成功与否也由调用方判定。
 * 所以这里不接 value，只接一个 onClick，按下就地给自己播一次反馈。
 */
export function CopyImageButton({
  onClick,
  disabled = false,
  label = '复制图片',
  tone = 'brand',
  size = 15,
}: CopyImageButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handle = () => {
    onClick()
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = window.setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, COPIED_HOLD)
  }

  return (
    <Tooltip content={copied ? '已复制' : label} disabled={disabled}>
      <button
        type="button"
        onClick={handle}
        disabled={disabled}
        data-copied={copied || undefined}
        className={iconButtonClass(copied ? 'emerald' : tone)}
      >
        <span className="copy-morph-stack">
          <Copy size={size} className="copy-morph-out" />
          <Check size={size} strokeWidth={2.6} className="copy-morph-in" />
        </span>
      </button>
    </Tooltip>
  )
}

export interface CopyButtonPrimaryProps {
  value: string | (() => string)
  disabled?: boolean
  /** 按钮文案，默认「复制结果」 */
  label?: string
}

/**
 * 主按钮形态的复制按钮（品牌底色 + 文案 + 图标）。
 *
 * 与图标版的差别只有外观与位置：它通常挂在卡片底部的动作区，
 * 是那一屏唯一的主行动点，所以保留文字标签。反馈形态完全一致 ——
 * 按下后图标变成对勾、文案切成「已复制」，让同一套动效覆盖两种形态。
 */
export function CopyButtonPrimary({
  value,
  disabled = false,
  label = '复制结果',
}: CopyButtonPrimaryProps) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    const text = typeof value === 'function' ? value() : value
    if (!text) {
      showToast('没有可复制的内容', 'error')
      return
    }
    const ok = await copyText(text)
    if (!ok) {
      showToast('复制失败', 'error')
      return
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = window.setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, COPIED_HOLD)
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={disabled}
      data-copied={copied || undefined}
      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
    >
      <span className="copy-morph-stack">
        <Copy size={15} className="copy-morph-out" />
        <Check size={15} strokeWidth={2.6} className="copy-morph-in" />
      </span>
      <span>{copied ? '已复制' : label}</span>
    </button>
  )
}
