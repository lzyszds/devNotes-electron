import { lazy, Suspense, useEffect, useState } from 'react'
import { Segmented } from '../ui'
import type { JsonToolboxMode } from '../../types'

/*
 * JSON 工具箱：美化 / 比对 / 多语 三件合一。
 *
 * 三个子工具本体零改动（各自带着自己的 ToolShell、历史与状态），
 * 这里只做两件事：顶上一条模式切换，以及「保活挂载」——
 * 切模式不重挂载，格式化历史、比对输入、多语草稿全都在。
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
    <div className="h-full min-h-0 flex flex-col bg-[#FFFFFF] text-[#191918]">
      {/* 模式切换条：贴着工具自己的标题栏上方 */}
      <div className="h-9 px-3 flex items-center gap-2.5 border-b border-[#E6E6E3] flex-shrink-0">
        <Segmented value={mode} options={MODES} onChange={setMode} />
        <span className="text-[10px] text-[#9A9996]">
          三个 JSON 工具合在一起，各自状态独立保留
        </span>
      </div>

      <div className="flex-1 min-h-0 relative">
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
    </div>
  )
}
