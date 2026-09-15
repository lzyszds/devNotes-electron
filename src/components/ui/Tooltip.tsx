import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../../hooks/usePresence'
import {
  TOOLTIP_DELAY,
  computeTooltipPosition,
  type TooltipPlacement,
} from './tooltipPosition'

export type TooltipProps = {
  /** 提示文案。传空字符串则完全不显示 */
  content: ReactNode
  /** 唯一子元素，需是能挂 ref 的真实 DOM 元素（本项目里都是 <button>） */
  children: ReactElement
  /** 打开延迟（毫秒），传 0 立即弹出 */
  delay?: number
  /** 为 true 时完全不显示 */
  disabled?: boolean
  /**
   * 优先出现的方向，默认上方。
   * 传 right/left 时改为贴在触发元素侧面 —— 一侧放不下会自动翻到另一侧。
   */
  placement?: TooltipPlacement
}

/**
 * 轻量悬浮提示。
 *
 * 关键取舍：**不给子元素套额外 DOM**。用 cloneElement 把事件挂到子元素自身，
 * 气泡走 createPortal 渲染到 body 并 position:fixed 定位。
 * 因为不新增盒模型节点，在 flex / absolute / grid 布局里插提示不会引起任何位移 ——
 * 这正是它比「包一层 span」安全的地方（包 span 会让 span 顶替按钮成为 flex item，
 * 按钮上的 flex-1 / ml-auto 之类就失效了）。
 *
 * 相应地，children 必须是单个真实 DOM 元素（<button> / <a>），不能是自定义组件：
 * 自定义组件未必转发 ref，也不一定把事件透传到根节点。
 *
 * 已知限制：浏览器不会给 disabled 的表单控件派发鼠标事件，
 * 所以子元素处于 disabled 状态时提示不会弹出（键盘 focus 同样不触发）。
 */
export default function Tooltip({
  content,
  children,
  delay = TOOLTIP_DELAY,
  disabled = false,
  placement = 'top',
}: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // 触发元素的位置快照；非 null 即表示「正在显示」
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  // 气泡自身的定位结果。位置要等气泡渲染出来、量到实际尺寸才能算，见下面的 layout effect
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  // 退出动画时长与 CSS 里 .tooltip-bubble[data-state='closed'] 一致
  const { mounted, state } = usePresence(Boolean(anchor), 110)
  /**
   * hide() 会把 pos 一并清空，但气泡这会儿还在播淡出动画。
   * 不留住最后一帧的位置，气泡会瞬间跳到视口左上角再消失。
   */
  const lastPosRef = useRef<{ top: number; left: number } | null>(null)
  if (pos) lastPosRef.current = pos
  const shownPos = pos ?? lastPosRef.current
  const timerRef = useRef<number | null>(null)
  // 鼠标按下过就抑制随后的 focus 弹出，否则「点一下按钮」会顺带弹一个提示出来
  const suppressFocusRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setAnchor(null)
    setPos(null)
  }, [clearTimer])

  const show = useCallback(() => {
    if (disabled || !content) return
    clearTimer()
    const el = triggerRef.current
    if (!el) return
    const open = () => {
      // 延迟期间触发元素可能已经卸载（历史浮层关闭、切换标签页之类），这时就别弹了
      if (!el.isConnected) return
      setAnchor(el.getBoundingClientRect())
    }
    if (delay > 0) timerRef.current = window.setTimeout(open, delay)
    else open()
  }, [clearTimer, content, delay, disabled])

  // 卸载时清掉尚未触发的计时器
  useEffect(() => clearTimer, [clearTimer])

  // 显示期间位置随时可能失效：滚动、改窗口大小、切走窗口，一律收起
  useEffect(() => {
    if (!anchor) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [anchor, hide])

  // 量到气泡实际尺寸后再定位，并保证在 paint 之前完成，避免第一帧闪在错误位置
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return
    setPos(computeTooltipPosition(anchor, bubble.getBoundingClientRect(), placement))
  }, [anchor, placement])

  if (!isValidElement(children)) return children

  const child = children as ReactElement<Record<string, unknown>>
  const childProps = child.props

  // 子元素原有的处理函数要保留，不能覆盖
  const chain = (name: string, ours: () => void) => (event: unknown) => {
    const existing = childProps[name]
    if (typeof existing === 'function') (existing as (e: unknown) => void)(event)
    ours()
  }

  // 子元素自己的 ref 也要保留
  const childRef = (child as unknown as { ref?: unknown }).ref
  const attachRef = (node: HTMLElement | null) => {
    triggerRef.current = node
    if (typeof childRef === 'function') (childRef as (n: HTMLElement | null) => void)(node)
    else if (childRef && typeof childRef === 'object') {
      ;(childRef as { current: HTMLElement | null }).current = node
    }
  }

  const trigger = cloneElement(child, {
    ref: attachRef,
    onMouseEnter: chain('onMouseEnter', () => {
      suppressFocusRef.current = false
      show()
    }),
    onMouseLeave: chain('onMouseLeave', hide),
    onFocus: chain('onFocus', () => {
      if (suppressFocusRef.current) return
      show()
    }),
    onBlur: chain('onBlur', () => {
      suppressFocusRef.current = false
      hide()
    }),
    // 已经点下去了就不必再解释它是什么，顺手收起
    onMouseDown: chain('onMouseDown', () => {
      suppressFocusRef.current = true
      hide()
    }),
    // 纯图标按钮本来就没有可读名称，顺手补一个，免得读屏只念「按钮」
    'aria-label': childProps['aria-label'] ?? (typeof content === 'string' ? content : undefined),
  })

  return (
    <>
      {trigger}
      {mounted &&
        createPortal(
          // 外层只负责定位；测量阶段先 opacity:0，算出位置后同帧转 1（layout effect 在 paint 前跑完，不会闪）
          // 收起期间 pos 已清空，这时得保持不透明，否则淡出动画是从「本来就看不见」开始播的
          <div
            style={{
              top: shownPos?.top ?? 0,
              left: shownPos?.left ?? 0,
              opacity: pos || state === 'closed' ? 1 : 0,
            }}
            className="pointer-events-none fixed z-[90]"
          >
            <div ref={bubbleRef} role="tooltip" data-state={state} className="tooltip-bubble">
              {content}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
