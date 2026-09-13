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

/** 气泡与触发元素之间的间距 */
const GAP = 8
/** 气泡与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8
/** 默认打开延迟：鼠标扫过一排工具栏按钮时不至于闪出一串提示 */
const DEFAULT_DELAY = 240

export type TooltipProps = {
  /** 提示文案。传空字符串则完全不显示 */
  content: ReactNode
  /** 唯一子元素，需是能挂 ref 的真实 DOM 元素（本项目里都是 <button>） */
  children: ReactElement
  /** 打开延迟（毫秒），传 0 立即弹出 */
  delay?: number
  /** 为 true 时完全不显示 */
  disabled?: boolean
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
  delay = DEFAULT_DELAY,
  disabled = false,
}: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // 触发元素的位置快照；非 null 即表示「正在显示」
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  // 气泡自身的定位结果。位置要等气泡渲染出来、量到实际尺寸才能算，见下面的 layout effect
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
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
    const { width, height } = bubble.getBoundingClientRect()

    // 默认在触发元素上方；顶到视口上沿就翻到下方
    let top = anchor.top - GAP - height
    if (top < VIEWPORT_MARGIN) top = anchor.bottom + GAP

    // 与触发元素水平居中，再夹进视口范围
    const centered = anchor.left + anchor.width / 2 - width / 2
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width
    const left = Math.max(VIEWPORT_MARGIN, Math.min(centered, maxLeft))

    setPos({ top, left })
  }, [anchor])

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
      {anchor &&
        createPortal(
          // 外层只负责定位；测量阶段先 opacity:0，算出位置后同帧转 1（layout effect 在 paint 前跑完，不会闪）
          <div
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
            className="pointer-events-none fixed z-[90]"
          >
            <div ref={bubbleRef} role="tooltip" className="tooltip-bubble">
              {content}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
