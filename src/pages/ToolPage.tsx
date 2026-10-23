import React, { Suspense, lazy, useEffect, useState } from 'react'
import { takeToolMode, subscribeToolMode, type ModeRequest } from '../utils/toolModeRequest'
import JsonFormatTool from '../components/tools/JsonFormatTool'
import JsonDiffTool from '../components/tools/JsonDiffTool'
import JsonI18nTool from '../components/tools/JsonI18nTool'
import QrCodeTool from '../components/tools/QrCodeTool'
import LanTransferTool from '../components/tools/LanTransferTool'
import NetProbeTool from '../components/tools/NetProbeTool'
import FileHashTool from '../components/tools/FileHashTool'
import DataConvertTool from '../components/tools/DataConvertTool'
import ImageConvertTool from '../components/tools/ImageConvertTool'
import EncodeTool from '../components/tools/EncodeTool'
import TimestampTool from '../components/tools/TimestampTool'
import RegexpTool from '../components/tools/RegexpTool'
import PasswordTool from '../components/tools/PasswordTool'
import SignatureTool from '../components/tools/SignatureTool'
import WebsocketTool from '../components/tools/WebsocketTool'
import TextTranslateTool from '../components/modules/text-translate/TextTranslateTool'
import SnippetsTool from '../components/modules/snippets/SnippetsTool'
import TextScratchpadTool from '../components/tools/TextScratchpadTool'
import { allModules } from '../types'

const NotesTool = lazy(() => import('../components/tools/NotesTool'))
// 这两个各自拖着一大坨（位运算沙箱的位图、端口表的解析），按需加载
const BitwiseTool = lazy(() => import('../components/tools/BitwiseTool'))
const PortKillerTool = lazy(() => import('../components/tools/PortKillerTool'))

/**
 * 编码类工具的入口（编码转换、URL 编码共用同一个编码页面）。
 * 搜索面板可能指定了某种编码（如 Unicode），这里负责把请求交给工具：
 * 工具还没挂载就在挂载时取走，已经开着就订阅变化。
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
  'json-format': JsonFormatTool,
  'json-diff': JsonDiffTool,
  'lan-transfer': LanTransferTool,
  'net-probe': NetProbeTool,
  'file-hash': FileHashTool,
  'data-convert': DataConvertTool,
  'json-i18n': JsonI18nTool,
  'text-translate': TextTranslateTool,
  'qr-code': QrCodeTool,
  'image-convert': ImageConvertTool,
  'en-decode': () => <EncodeToolEntry toolId="en-decode" />,
  'timestamp': TimestampTool,
  'regexp': RegexpTool,
  'password': PasswordTool,
  'base64': () => <EncodeTool initialType="base64" />,
  'url': () => <EncodeToolEntry toolId="url" initialType="url" />,
  'websocket': WebsocketTool,
  'bitwise': BitwiseTool,
  'snippets': SnippetsTool,
  'port-killer': PortKillerTool,
  'scratchpad': TextScratchpadTool,
  'signature': SignatureTool,
}

function ToolLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-white dark:bg-dark-bg text-slate-400 text-sm font-medium">
      正在加载工具…
    </div>
  )
}

/**
 * 工具页容器。
 *
 * 切工具是硬切，页面本身不做任何动画 —— 之前叠两层做竖滑转场时，新旧两页
 * 必然有一段同时半透明，旧页的内容会从新页底下透出来（切页时先闪一下上一个
 * 工具的内容）。入场感交给各工具内容自己「级联落位」：顶栏瞬间就位，卡片依次
 * 落下，见 index.css 的 .tool-cascade。
 */
export default function ToolPage({ toolId }: { toolId: string }) {
  const tool = allModules.find((item) => item.id === toolId)
  const ToolComponent = toolId ? toolComponents[toolId] : null

  if (!tool || !ToolComponent) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-dark-bg">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">未找到工具</h2>
      </div>
    )
  }

  return (
    <div className="app-scene h-full w-full bg-white dark:bg-dark-bg flex flex-col overflow-hidden">
      {/* 移除 ToolPage 层的滚动和内边距，让内部工具组件控制其布局和滚动 */}
      <div className="flex-1 h-full overflow-hidden">
        <Suspense fallback={<ToolLoading />}>
          <ToolComponent />
        </Suspense>
      </div>
    </div>
  )
}
