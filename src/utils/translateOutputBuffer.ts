/* 首字立即显示，后续增量合并到固定时间窗；不用 rAF，避免后台窗口停更。 */
export function createTranslateOutputBuffer(
  write: (text: string) => void,
  intervalMs = 40,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: string | undefined
  let first = true

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (pending === undefined) return
    const text = pending
    pending = undefined
    write(text)
  }

  return {
    push(text: string) {
      pending = text
      if (first) {
        first = false
        flush()
      } else if (timer === undefined) {
        timer = setTimeout(flush, intervalMs)
      }
    },
    flush,
    cancel() {
      clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}
