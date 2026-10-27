import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { takeToolMode, subscribeToolMode, type ModeRequest } from '../utils/toolModeRequest'

/*
 * 所有工具按需加载（lazy）：用户打开哪个工具才加载那个模块，
 * 不再在启动时把全部工具的 JS 一次性解析执行完。
 */
const NotesTool          = lazy(() => import('../components/tools/NotesTool'))
const JsonToolbox        = lazy(() => import('../components/tools/JsonToolbox'))
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

const EnDecodeTool = (props: any) => <EncodeToolEntry toolId="en-decode" {...props} />
const Base64Tool = (props: any) => <EncodeToolEntry toolId="base64" initialType="base64" {...props} />
const UrlTool = (props: any) => <EncodeToolEntry toolId="url" initialType="url" {...props} />

const toolComponents: Record<string, React.ComponentType<any>> = {
  'markdown-notes': NotesTool,
  'json-toolbox':   JsonToolbox,
  'lan-transfer':   LanTransferTool,
  'net-probe':      NetProbeTool,
  'file-hash':      FileHashTool,
  'data-convert':   DataConvertTool,
  'text-translate': TextTranslateTool,
  'qr-code':        QrCodeTool,
  'image-convert':  ImageConvertTool,
  'en-decode':      EnDecodeTool,
  'timestamp':      TimestampTool,
  'regexp':         RegexpTool,
  'password':       PasswordTool,
  'base64':         Base64Tool,
  'url':            UrlTool,
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

interface KeepAliveItemProps {
  id: string
  isActive: boolean
  Component: React.ComponentType<any>
}

/**
 * 单个 Keep-Alive 工具容器。
 *
 * 关键性能屏障：
 * 使用 React.memo 配合属性浅比较，彻底切断外层（DashboardLayout / NotesProvider）
 * 重渲染对非活跃工具的级联波及。
 * 当其他工具或顶栏更新时，后台不可见的工具组件完全跳过渲染。
 */
const KeepAliveItem = React.memo(
  function KeepAliveItem({ isActive, Component }: KeepAliveItemProps) {
    return (
      <div
        className={`absolute inset-0 flex flex-col overflow-hidden ${
          isActive ? 'visible z-10' : 'invisible z-0 pointer-events-none'
        }`}
        aria-hidden={!isActive}
      >
        <Suspense fallback={<ToolLoading />}>
          <Component isActive={isActive} />
        </Suspense>
      </div>
    )
  },
  (prev, next) =>
    prev.id === next.id &&
    prev.isActive === next.isActive &&
    prev.Component === next.Component
)

/**
 * 工具页容器 —— Keep-Alive 模式。
 *
 * 核心思路：曾经打开过的工具保持 DOM 挂载，切走时只用 CSS 隐藏（display:none），
 * 切回来时立即可见，不再重新初始化编辑器。
 *
 * 性能保护：通过 KeepAliveItem 的 memo 屏障，非当前工具在后台零重绘零开销。
 */
export default function ToolPage({ toolId }: { toolId: string }) {
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
        if (!ToolComponent) return null
        return (
          <KeepAliveItem
            key={id}
            id={id}
            isActive={id === toolId}
            Component={ToolComponent}
          />
        )
      })}
    </div>
  )
}
