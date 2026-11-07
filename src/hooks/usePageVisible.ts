import { useEffect, useState } from 'react'

/**
 * 窗口当前是否真的在被人看（未隐藏到托盘 / 未最小化 / 未被完全遮挡）。
 *
 * 为什么要有它：工具页是 Keep-Alive 的，切走后组件还挂着，窗口收进托盘后整个
 * 渲染进程也还活着。凡是「每秒一次」「每 30 秒拉一次」的定时器，如果只看
 * 自己页签是否激活，窗口藏起来后依旧在后台烧 CPU、唤醒主进程。
 * 用 visibilitychange 一个信号把这些轮询在「看不见」时统一停掉。
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}
