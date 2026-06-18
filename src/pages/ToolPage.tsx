import React from 'react'
import JsonFormatTool from '../components/tools/JsonFormatTool'
import QrCodeTool from '../components/tools/QrCodeTool'
import EncodeTool from '../components/tools/EncodeTool'
import TimestampTool from '../components/tools/TimestampTool'
import RegexpTool from '../components/tools/RegexpTool'
import PasswordTool from '../components/tools/PasswordTool'
import WebsocketTool from '../components/tools/WebsocketTool'
import { tools } from '../types'

const toolComponents: Record<string, React.ComponentType<any>> = {
  'json-format': () => <JsonFormatTool mode="format" />,
  'json-diff': () => <JsonFormatTool mode="diff" />,
  'qr-code': QrCodeTool,
  'en-decode': EncodeTool,
  'timestamp': TimestampTool,
  'regexp': RegexpTool,
  'password': PasswordTool,
  'base64': EncodeTool,
  'url': EncodeTool,
  'websocket': WebsocketTool,
}

export default function ToolPage({ toolId }: { toolId: string }) {
  const tool = tools.find((item) => item.id === toolId)
  const ToolComponent = toolId ? toolComponents[toolId] : null

  if (!tool || !ToolComponent) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">未找到工具</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="app-scene h-full w-full bg-white flex flex-col overflow-hidden">
      {/* 移除 ToolPage 层的滚动和内边距，让内部工具组件控制其布局和滚动 */}
      <div className="flex-1 h-full overflow-hidden">
        <ToolComponent />
      </div>
    </div>
  )
}
