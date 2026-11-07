import { lazy, Suspense, useEffect, useState } from 'react'
import { Segmented, ToolShellHeaderSlot } from '../ui'
import type { JsonToolboxMode } from '../../types'

/*
 * JSON 工具箱：美化 / 比对 / 多语 三件合一。
 *
 * 三个子工具本体零改动（各自带着自己的 ToolShell、历史与状态），
 * 这里只做两件事：把模式切换经 ToolShellHeaderSlot 塞进子工具顶栏，
 * 以及「保活挂载」——切模式不重挂载，格式化历史、比对输入、多语草稿全都在。
 * 不再单独占一行切换条：那条横条会把全局顶栏节奏顶松。
 */

const JsonFormatTool = lazy(() => import('./JsonFormatTool'))
const JsonDiffTool = lazy(() => import('./JsonDiffTool'))
const JsonI18nTool = lazy(() => import('./JsonI18nTool'))

/** 深链接通道：App.openTool 把旧 id（json-diff 等）解析成模式后带进来。
 *  工具箱未挂载时先存着，挂载即消费；已挂载则直接广播切模式。 */
let pendingMode: JsonToolboxMode | null = null
const modeListeners = new Set<(m: JsonToolboxMode) => void>()

export function requestJsonToolboxMode(mode: JsonToolboxMode): void {
  pendingMode = mode
  modeListeners.forEach((fn) => fn(mode))
}

const MODES: { value: JsonToolboxMode; label: string }[] = [
  { value: 'format', label: '美化' },
  { value: 'diff', label: '比对' },
  { value: 'i18n', label: '多语' },
]

export default function JsonToolbox() {
  // 深链接的 pendingMode 不能在 useState 初始化器里消费 ——
  // StrictMode 会把初始化器跑两遍，第一遍就把一次性值取走了；挪到挂载后消费
  const [mode, setMode] = useState<JsonToolboxMode>('format')

  useEffect(() => {
    if (pendingMode) {
      const pending = pendingMode
      pendingMode = null
      setMode(pending)
    }
  }, [])

  useEffect(() => {
    const listener = (m: JsonToolboxMode) => setMode(m)
    modeListeners.add(listener)
    return () => {
      modeListeners.delete(listener)
    }
  }, [])

  // 访问过的子模式才挂载：不用「多语」就永远不为它加载 1400 行
  const [visited, setVisited] = useState<Set<JsonToolboxMode>>(
    () => new Set([mode])
  )
  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(mode)) return prev
      const next = new Set(prev)
      next.add(mode)
      return next
    })
  }, [mode])

  return (
    <ToolShellHeaderSlot
      content={
        <Segmented
          value={mode}
          options={MODES}
          onChange={setMode}
          className="flex-shrink-0"
        />
      }
    >
      <div className="h-full min-h-0 relative bg-[#FFFFFF] text-[#191918]">
        {MODES.map((m) =>
          visited.has(m.value) ? (
            <div
              key={m.value}
              className={`absolute inset-0 ${mode === m.value
                ? 'visible'
                : 'invisible pointer-events-none'
                }`}
              aria-hidden={mode !== m.value}
            >
              <Suspense fallback={null}>
                {m.value === 'format' && <JsonFormatTool />}
                {m.value === 'diff' && <JsonDiffTool />}
                {m.value === 'i18n' && <JsonI18nTool />}
              </Suspense>
            </div>
          ) : null
        )}
      </div>
    </ToolShellHeaderSlot>
  )
}
