import { useEffect, useRef, useState } from 'react'

export type SlideDirection = 'up' | 'down'

/** 位移时长。必须与 index.css 里 .fe-slide-in / .fe-slide-out 的 320ms 一致 */
const SLIDE_MS = 320

interface SlideTransition {
  /** 当前应该渲染哪一页（切换动画期间是「即将进入的那一页」，也是最新那一页） */
  renderValue: string
  /** 上一页的值与它的 key —— 退场动画期间还要把它留在 DOM 里 */
  leaving: { value: string; key: number } | null
  /** 本次切换的方向，写到容器的 data-dir 上供 CSS 选关键帧 */
  direction: SlideDirection
}

/**
 * 页面级竖滑转场。
 *
 * 解决的问题和 usePresence 一样 —— React 是同步卸载的，直接换掉 children 只有
 * 「啪」的一下，没有退场动画可播。区别在于这里换的是**整页内容**，而且新旧两页
 * 要同时在 DOM 里各播各的动画（旧的往上走、新的从下上来），所以不能只留一个
 * mounted 布尔，得把「正在离开的那一页」也存一份下来。
 *
 * 方向由「上一步的顺序」推断：切到列表里更靠后的项 = down（新页从下方上来），
 * 更靠前 = up。调用方给 order 一个稳定顺序（工具在列表中的下标、页面的层级），
 * 不给就一律按 down 处理。
 *
 * 顺序被打断（快速连点几个工具）时，上一次的 leaving 直接被顶掉 —— 上一个
 * 离场动画还没播完就被新动画接管的视觉是同向的，看着仍然是「一路往下滑」，
 * 比排队播完再切要跟手得多。
 */
export function useSlideTransition(
  value: string,
  order?: (v: string) => number,
): SlideTransition {
  const [renderValue, setRenderValue] = useState(value)
  const [leaving, setLeaving] = useState<{ value: string; key: number } | null>(null)
  const [direction, setDirection] = useState<SlideDirection>('down')

  /** 上一个已渲染的值，用来算方向；也用它在 effect 里判断是否真的换了页 */
  const prevValueRef = useRef(value)
  const keyRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const prev = prevValueRef.current
    if (prev === value) return
    prevValueRef.current = value

    // 方向：order 缺失时保守取 down（首次进入、或从工具中心切过来都是往下走）
    if (order) {
      setDirection(order(value) >= order(prev) ? 'down' : 'up')
    } else {
      setDirection('down')
    }

    // 上一次还没播完的退场直接顶掉，别叠着
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const key = ++keyRef.current
    setLeaving({ value: prev, key })
    setRenderValue(value)

    timerRef.current = window.setTimeout(() => {
      setLeaving(null)
      timerRef.current = null
    }, SLIDE_MS)

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [value, order])

  return { renderValue, leaving, direction }
}
