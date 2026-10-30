/**
 * 渲染层的调试日志出口。
 *
 * 全部走这里，好处有两个：
 *  1. 统一格式（时间 + [render] 前缀），和主进程写进同一个文件后一眼能按
 *     时间顺序还原现场 —— 这次排查的「有时能用、有时要等」全是时序问题，
 *     两个进程的日志必须能在一条时间线上读；
 *  2. 一处开关。排查完毕把 DEBUG_LOG 置 false，全项目就安静了，不用满仓库删。
 *
 * 落盘走 preload 暴露的 `debugLog`（ipcRenderer.send），页面控制台照样输出，
 * 所以开着 DevTools 时体验不变。
 */

/** 排查开关。为 false 时既不输出控制台也不落盘（保留这一个开关就够了） */
export const DEBUG_LOG = true

type LogArgs = unknown[]

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function dlog(...args: LogArgs): void {
  if (!DEBUG_LOG) return
  const text = args.map(stringify).join(' ')
  const line = `${new Date().toISOString()} [render] ${text}`
  console.log(line)
  try {
    window.electronAPI?.debugLog?.(line)
  } catch {
    // preload 还没就绪（极早期日志）时忽略即可
  }
}
