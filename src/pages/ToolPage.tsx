import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Download, RefreshCw } from 'lucide-react'
import { tools } from '../types'
import JsonFormatTool from '../components/tools/JsonFormatTool'
import QrCodeTool from '../components/tools/QrCodeTool'
import EncodeTool from '../components/tools/EncodeTool'
import TimestampTool from '../components/tools/TimestampTool'
import RegexpTool from '../components/tools/RegexpTool'
import PasswordTool from '../components/tools/PasswordTool'

const toolComponents: Record<string, React.ComponentType> = {
  'json-format': JsonFormatTool,
  'json-diff': JsonFormatTool,
  'qr-code': QrCodeTool,
  'en-decode': EncodeTool,
  'timestamp': TimestampTool,
  'regexp': RegexpTool,
  'password': PasswordTool,
  'base64': EncodeTool,
  'url': EncodeTool,
}

export default function ToolPage() {
  const { toolName } = useParams<{ toolName: string }>()
  const navigate = useNavigate()
  
  const tool = tools.find(t => t.id === toolName)
  const ToolComponent = toolName ? toolComponents[toolName] : null

  if (!tool || !ToolComponent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">工具未找到</h2>
          <button 
            onClick={() => navigate('/')}
            className="text-primary-500 hover:text-primary-600"
          >
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate('/')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{tool.name}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
              <Copy className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
            <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
              <Download className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      </header>

      {/* Tool Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700">
          <ToolComponent />
        </div>
      </main>
    </div>
  )
}
