import { useEffect, useState } from 'react'

/**
 * 让「关闭」也有一段动画。
 *
 * React 是**同步卸载**的：`open` 一变成 false，节点当场从 DOM 里消失，
 * 写在类名上的退出动画根本没有机会跑 —— 所以全站的浮层此前都只有「弹出来」，
 * 没有「收回去」，收的时候是硬切。
 *
 * 这个 hook 把「挂载」与「打开」拆成两件事：
 *   打开 → 立刻挂载，state = 'open'
 *   关闭 → 先留在 DOM 里、state 切到 'closed'（此时 CSS 播退出动画），
 *          等动画时长过去再真正卸载
 *
 * 用法：
 *   const { mounted, state } = usePresence(open)
 *   if (!mounted) return null
 *   return <div data-state={state} ...>
 *
 * 配套 CSS 约定：`[data-state='closed']` 上挂退出动画。
 * 时长要和 CSS 里那一条保持一致，否则要么被截断、要么留一段空等。
 */
export function usePresence(open: boolean, duration = 160) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return

    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [open, mounted, duration])

  return { mounted, closing, state: closing ? ('closed' as const) : ('open' as const) }
}
