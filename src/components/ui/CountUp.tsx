import { useEffect, useRef, useState } from 'react'

export interface CountUpProps {
  /** 目标数值。变化时从「当前显示值」滚到新值，中途再变会从半路接着滚 */
  value: number
  /** 数值格式化（单位换算、保留几位小数都在这里），每帧调用 */
  format?: (n: number) => string
  /** 滚动时长（毫秒） */
  duration?: number
  className?: string
}

/** 收尾缓出：开头快、末尾慢，读数时最后几位是「稳下来」的而不是急刹 */
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/** 尊重系统的「减少动效」设置：只在首次读取时判断一次，运行中改变设置不重算 */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 数字滚动机。
 *
 * 用于「转换前 2.4 MB → 转换后 312 KB」这类结果的呈现：数字直接跳变只是
 * 换了个字，用户对「省了多少」没有体感；从旧值滚到新值，配合到位时那一下
 * 轻微放大，才有「达成」的触感。
 *
 * 数值本身每帧由 rAF 驱动、直接格式化后写进 DOM（走 state，React 18 会
 * 自动批处理），不做插值缓存的额外抽象 —— 这里要的就是每帧一个新数字。
 */
export default function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  duration = 650,
  className = '',
}: CountUpProps) {
  const [display, setDisplay] = useState(value)
  // 当前正在显示的数值。用 ref 存是为了「中途改目标」时能从半路接着滚，
  // 而不是从上一个目标的终点重新开始
  const displayRef = useRef(value)
  const frameRef = useRef<number | null>(null)
  const [landing, setLanding] = useState(false)

  useEffect(() => {
    const from = displayRef.current
    if (from === value) return

    if (prefersReducedMotion()) {
      displayRef.current = value
      setDisplay(value)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const next = from + (value - from) * easeOutCubic(t)
      displayRef.current = next
      setDisplay(next)
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        displayRef.current = value
        setDisplay(value)
        frameRef.current = null
        // 落定：放大一下再收回，CSS 那边是 .fe-count[data-landing='true']
        setLanding(true)
        window.setTimeout(() => setLanding(false), 340)
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [value, duration])

  return (
    <span className={`fe-count ${className}`} data-landing={landing || undefined}>
      {format(display)}
    </span>
  )
}
