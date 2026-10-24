import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { takeToolMode, subscribeToolMode, type ModeRequest } from '../utils/toolModeRequest'

/*
 * 所有工具按需加载（lazy）：用户打开哪个工具才加载那个模块，
 * 不再在启动时把全部工具的 JS 一次性解析执行完。
 */
const NotesTool          = lazy(() => import('../components/tools/NotesTool'))
const JsonFormatTool     = lazy(() => import('../components/tools/JsonFormatTool'))
const JsonDiffTool       = lazy(() => import('../components/tools/JsonDiffTool'))
const JsonI18nTool       = lazy(() => import('../components/tools/JsonI18nTool'))
const QrCodeTool         = lazy(() => import('../components/tools/QrCodeTool'))
const LanTransferTool    = lazy(() => import('../components/tools/LanTransferTool'))
const NetProbeTool       = lazy(() => import('../components/tools/NetProbeTool'))
const FileHashTool       = lazy(() => import('../components/tools/FileHashTool'))
const DataConvertTool    = lazy(() => import('../components/tools/DataConvertTool'))
const ImageConvertTool   = lazy(() => import('../components/tools/ImageConvertTool'))
const EncodeTool         = lazy(() => import('../components/tools/EncodeTool'))
const TimestampTool      = lazy(() => import('../components/tools/TimestampTool'))
const RegexpTool         = lazy(() => import('../components/tools/RegexpTool'))
const PasswordTool       = lazy(() => import('../components/tools/PasswordTool'))
const SignatureTool      = lazy(() => import('../components/tools/SignatureTool'))
const WebsocketTool      = lazy(() => import('../components/tools/WebsocketTool'))
const TextTranslateTool  = lazy(() => import('../components/modules/text-translate/TextTranslateTool'))
const SnippetsTool       = lazy(() => import('../components/modules/snippets/SnippetsTool'))
const TextScratchpadTool = lazy(() => import('../components/tools/TextScratchpadTool'))
const SpeedTestTool      = lazy(() => import('../components/tools/SpeedTestTool'))
const SystemInspectorTool= lazy(() => import('../components/tools/SystemInspectorTool'))
const BitwiseTool        = lazy(() => import('../components/tools/BitwiseTool'))
const PortKillerTool     = lazy(() => import('../components/tools/PortKillerTool'))

/**
 * 编码类工具的入口（编码转换、URL 编码共用同一个编码页面）。
 * modeRequest 状态保留在这个轻量 wrapper 里，Suspense fallback 期间状态不丢失。
 */
function EncodeToolEntry({ toolId, initialType }: { toolId: string; initialType?: string }) {
  const [request, setRequest] = useState<ModeRequest | null>(() => takeToolMode(toolId))
  useEffect(
    () =>
      subscribeToolMode(() => {
        const next = takeToolMode(toolId)
        if (next) setRequest(next)
      }),
    [toolId],
  )
  return <EncodeTool initialType={initialType} modeRequest={request} />
}

const toolComponents: Record<string, React.ComponentType<any>> = {
  'markdown-notes': NotesTool,
  'json-format':    JsonFormatTool,
  'json-diff':      JsonDiffTool,
  'lan-transfer':   LanTransferTool,
  'net-probe':      NetProbeTool,
  'file-hash':      FileHashTool,
  'data-convert':   DataConvertTool,
  'json-i18n':      JsonI18nTool,
  'text-translate': TextTranslateTool,
  'qr-code':        QrCodeTool,
  'image-convert':  ImageConvertTool,
  'en-decode': () => <EncodeToolEntry toolId="en-decode" />,
  'timestamp':      TimestampTool,
  'regexp':         RegexpTool,
  'password':       PasswordTool,
  'base64': () => <EncodeToolEntry toolId="base64" initialType="base64" />,
  'url':    () => <EncodeToolEntry toolId="url"    initialType="url" />,
  'websocket':      WebsocketTool,
  'bitwise':        BitwiseTool,
  'snippets':       SnippetsTool,
  'port-killer':    PortKillerTool,
  'scratchpad':     TextScratchpadTool,
  'signature':      SignatureTool,
  'speed-test':     SpeedTestTool,
  'sys-inspector':  SystemInspectorTool,
}

function ToolLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-white text-slate-400 text-sm font-medium">
      正在加载工具…
    </div>
  )
}

/**
 * 工具页容器 —— Keep-Alive 模式。
 *
 * 核心思路：曾经打开过的工具保持 DOM 挂载，切走时只用 CSS 隐藏（display:none），
 * 切回来时立即可见，不再重新初始化编辑器。
 *
 * 为什么这样做：
 *   NotesTool 内部的 Milkdown / Cherry 编辑器初始化耗时较长（解析 ProseMirror schema、
 *   挂载插件、渲染正文）。之前每次切走工具都会卸载组件，切回来重走一遍初始化，
 *   导致"切回笔记 tab 有明显延迟"。
 *
 * display:none 不会触发组件卸载，组件的所有 state / effect 均保持活跃，
 * 但该元素及其子树不参与 layout / paint，对 GPU 和主线程几乎无额外负担。
 *
 * 仅渲染「访问过的」工具（visited 集合）：首次打开一个工具时仍走 lazy + Suspense，
 * 加载完成后进入 keep-alive，后续切换即时切换。
 */
export default function ToolPage({ toolId }: { toolId: string }) {
  /*
   * 记录曾经打开过的工具 id 集合。
   * 用 ref 做「已访问」的累加（纯副作用，不需要触发重渲染），
   * 用 state 控制渲染列表（才会真正追加新的 DOM）。
   */
  const visitedRef = useRef<Set<string>>(new Set())
  const [visited, setVisited] = useState<string[]>(() => {
    // 初始只挂载第一个活跃工具，避免启动时批量渲染
    visitedRef.current.add(toolId)
    return [toolId]
  })

  useEffect(() => {
    if (visitedRef.current.has(toolId)) return
    visitedRef.current.add(toolId)
    setVisited((prev) => [...prev, toolId])
  }, [toolId])

  return (
    <div className="h-full w-full bg-white flex flex-col overflow-hidden relative">
      {visited.map((id) => {
        const ToolComponent = toolComponents[id]
        const isActive = id === toolId
        if (!ToolComponent) return null
        return (
          /*
           * 使用 absolute + inset-0 配合 visible / invisible：
           * 不活跃的工具保持已有布局与尺寸（不被抹平为 0x0），不接收事件也不触发 Paint。
           * 切回笔记 tab 时直接恢复可见，避免复杂的 Markdown/CodeMirror 重新触发布局重排与测量，
           * 彻底消除切回笔记 tab 时的延迟。
           */
          <div
            key={id}
            className={`absolute inset-0 flex flex-col overflow-hidden ${
              isActive ? 'visible z-10' : 'invisible z-0 pointer-events-none'
            }`}
            aria-hidden={!isActive}
          >
            <Suspense fallback={<ToolLoading />}>
              <ToolComponent />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}
